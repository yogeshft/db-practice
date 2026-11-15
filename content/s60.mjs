const revenueView = "CREATE VIEW customer_revenue AS\nSELECT o.customer_id, count(DISTINCT o.order_id) AS orders, sum(oi.quantity * oi.unit_price) AS revenue\nFROM orders o JOIN order_items oi ON oi.order_id = o.order_id\nWHERE o.status = 'delivered'\nGROUP BY o.customer_id;";
const monthlyMv = "CREATE MATERIALIZED VIEW monthly_revenue AS\nSELECT date_trunc('month', o.order_date)::date AS month, sum(oi.quantity * oi.unit_price) AS revenue\nFROM orders o JOIN order_items oi ON oi.order_id = o.order_id\nWHERE o.status = 'delivered'\nGROUP BY 1;";

export default {
  n: 60,
  phase: 'p6',
  title: 'Views and materialized views',
  goal: 'Name and reuse queries with views, write through simple views safely, and serve expensive reports from materialized views refreshed without blocking readers.',
  minutes: 150,
  lesson: [
    { h: 'A view is a stored query' },
    { p: 'A view stores a SELECT under a name. It holds no data: every query on the view runs the underlying query. The planner <b>inlines</b> it, so <code>WHERE customer_id = 1</code> on the view is pushed into the query, and a view costs nothing compared with writing the query out.' },
    { sql: revenueView + "\n\nSELECT * FROM customer_revenue ORDER BY revenue DESC LIMIT 3;", run: true },
    { list: [
      'Use views to give a name to business logic ("delivered revenue") so every report computes it the same way.',
      'A view is also an interface: applications can read the view while you change the tables underneath, as long as the view keeps returning the same columns (Session 61).',
      'Views are <b>not</b> a performance tool. A slow query is exactly as slow behind a view.'
    ] },
    { h: 'Writing through a view' },
    { p: 'A view over <b>one</b> table, without aggregates, DISTINCT, GROUP BY, LIMIT or window functions, is automatically updatable: INSERT, UPDATE and DELETE on the view change the table. <code>WITH CHECK OPTION</code> rejects changes that would make the row fall out of the view, for example a "pending orders" view that must not be used to ship an order.' },
    { pre: "CREATE VIEW pending_orders AS\n  SELECT order_id, customer_id, order_date, status FROM orders WHERE status = 'pending'\n  WITH CHECK OPTION;\n\nUPDATE pending_orders SET status = 'shipped' WHERE order_id = 27;\n-- ERROR:  new row violates check option for view \"pending_orders\"", lang: 'text' },
    { h: 'Views and schema changes' },
    { list: [
      'Postgres records which columns a view uses. <code>DROP COLUMN</code> or <code>DROP TABLE</code> of something a view uses fails (unless CASCADE, which drops the view too).',
      '<code>CREATE OR REPLACE VIEW</code> can only add new columns at the end; renaming, removing or retyping a column needs DROP VIEW + CREATE VIEW (in one transaction).',
      '<code>SELECT *</code> in a view is expanded when the view is created: columns added to the table later do not appear in the view.'
    ] },
    { h: 'Materialized views: stored results' },
    { p: 'A <b>materialized view</b> runs its query once and stores the result like a table. Reading it is as fast as reading a small table, and it can have indexes. The data is a snapshot: it changes only when you run <code>REFRESH MATERIALIZED VIEW</code>.' },
    { sql: monthlyMv + "\n\nSELECT * FROM monthly_revenue ORDER BY month LIMIT 4;", run: true },
    { h: 'Refreshing without blocking readers' },
    { p: 'A plain REFRESH rebuilds the view and holds an ACCESS EXCLUSIVE lock while it does: every reader waits until it commits.' },
    { two: [
      ['B', 'BEGIN;'],
      ['B', 'REFRESH MATERIALIZED VIEW monthly_revenue;'],
      ['A', 'SELECT count(*) FROM monthly_revenue;'],
      ['B', 'COMMIT;']
    ], setup: monthlyMv, expectOut: 'blocked[\\s\\S]*finishes[\\s\\S]*\\b10\\b' },
    { p: '<code>REFRESH MATERIALIZED VIEW CONCURRENTLY</code> computes the new result next to the old one and applies only the differences. Readers keep reading the old data while it runs. It needs a <b>unique index</b> on the materialized view (to match old rows with new ones) and is slower than a plain refresh when most rows change.' },
    { pre: "CREATE UNIQUE INDEX ON monthly_revenue (month);\nREFRESH MATERIALIZED VIEW CONCURRENTLY monthly_revenue;", lang: 'text' },
    { tip: 'Schedule refreshes with pg_cron (Phase 7) or your application\'s scheduler, and record when the data was refreshed, so dashboards can show "as of 10:00". If the data must always be current, a materialized view is the wrong tool: use a normal view (and indexes), or a summary table kept up to date in the same transaction as the source changes (Phase 7: triggers).' }
  ],
  questions: [
    { pts: 1, q: 'Create the view customer_revenue from the lesson and use it to show the delivered revenue of customers 1 and 2.', hint: 'CREATE VIEW …; SELECT * FROM customer_revenue WHERE customer_id IN (1, 2);', sql: revenueView + "\n\nSELECT * FROM customer_revenue WHERE customer_id IN (1, 2) ORDER BY customer_id;", why: 'A view is queried like a table. Inside BEGIN … ROLLBACK the view disappears again; in your own database, keep it.', expectRows: 2 },
    { pts: 1, q: 'Create a simple view pending_orders (order_id, customer_id, order_date, status of pending orders) and cancel order 36 <b>through the view</b>. Return the updated row.', hint: "UPDATE pending_orders SET status = 'cancelled' WHERE order_id = 36 RETURNING …", sql: "CREATE VIEW pending_orders AS\n  SELECT order_id, customer_id, order_date, status FROM orders WHERE status = 'pending';\n\nUPDATE pending_orders SET status = 'cancelled' WHERE order_id = 36\nRETURNING order_id, status;", why: 'One table, no aggregates: Postgres rewrites the UPDATE into an UPDATE of orders. Without WITH CHECK OPTION, the order now silently disappears from the view, which is allowed.', expectRows: 1 },
    { pts: 1, q: 'Recreate pending_orders <code>WITH CHECK OPTION</code> and try to mark order 27 as shipped through it.', hint: 'Add WITH CHECK OPTION at the end of CREATE VIEW.', steps: [
      "CREATE VIEW pending_orders AS\n  SELECT order_id, customer_id, order_date, status FROM orders WHERE status = 'pending'\n  WITH CHECK OPTION;",
      "UPDATE pending_orders SET status = 'shipped' WHERE order_id = 27;",
      "UPDATE pending_orders SET order_date = '2025-10-04' WHERE order_id = 27;"
    ], why: 'The status change fails: the row would leave the view. Changing the date is fine, since the row stays pending. Give a limited role access to the view only, and it can edit pending orders but not ship them (Phase 7 covers privileges).', expectOut: 'new row violates check option for view "pending_orders"[\\s\\S]*UPDATE 1' },
    { pts: 1, q: 'Create a view on orders that uses shipping_city, then try to drop the shipping_city column from orders.', hint: 'CREATE VIEW order_cities AS SELECT order_id, shipping_city FROM orders; ALTER TABLE orders DROP COLUMN shipping_city;', steps: [
      'CREATE VIEW order_cities AS SELECT order_id, shipping_city FROM orders;',
      'ALTER TABLE orders DROP COLUMN shipping_city;'
    ], why: '"cannot drop column … because other objects depend on it", with the view named in DETAIL. Dependencies protect you from breaking reports silently, and they also mean that schema changes have to deal with views first (Session 61).', expectOut: 'cannot drop column shipping_city of table orders because other objects depend on it' },
    { pts: 1, q: 'Change the view customer_revenue so that revenue comes <b>before</b> orders, using CREATE OR REPLACE VIEW. What happens?', hint: 'Swap two columns in the SELECT list.', steps: [
      revenueView,
      "CREATE OR REPLACE VIEW customer_revenue AS\nSELECT o.customer_id, sum(oi.quantity * oi.unit_price) AS revenue, count(DISTINCT o.order_id) AS orders\nFROM orders o JOIN order_items oi ON oi.order_id = o.order_id\nWHERE o.status = 'delivered'\nGROUP BY o.customer_id;"
    ], why: '"cannot change name of view column": CREATE OR REPLACE may only append columns. To reorder, rename or retype, run DROP VIEW and CREATE VIEW in one transaction, so readers never see the view missing.', expectOut: 'cannot change name of view column' },
    { pts: 1, q: 'Create the materialized view monthly_revenue from the lesson and show how many months it contains and the best month.', hint: 'count(*) and max() over the materialized view.', sql: monthlyMv + "\n\nSELECT count(*) AS months, max(revenue) AS best_month_revenue FROM monthly_revenue;", why: '10 months; the best is 156,000. The query ran once, at CREATE; this SELECT only read 10 stored rows.', expectRows: 1 },
    { pts: 1, q: 'Show that a materialized view goes stale: create one that counts orders, add an order, read both the view and a fresh count, then REFRESH and read again.', hint: 'CREATE MATERIALIZED VIEW order_count AS SELECT count(*) AS n FROM orders;', steps: [
      'CREATE MATERIALIZED VIEW order_count AS SELECT count(*) AS n FROM orders;',
      "INSERT INTO orders VALUES (37, 1, '2026-02-15', 'pending', 'Mumbai');",
      'SELECT (SELECT n FROM order_count) AS view_says, (SELECT count(*) FROM orders) AS really;',
      'REFRESH MATERIALIZED VIEW order_count;',
      'SELECT n FROM order_count;'
    ], why: '36 vs 37 until the refresh. A materialized view answers "what was true at the last refresh", which is fine for dashboards and wrong for anything transactional (stock levels, balances).', expectOut: '\\b36 \\|\\s+37[\\s\\S]*REFRESH MATERIALIZED VIEW[\\s\\S]*\\b37\\b' },
    { pts: 1, q: 'Create a materialized view <code>WITH NO DATA</code>, check pg_matviews, and try to read it.', hint: 'CREATE MATERIALIZED VIEW … WITH NO DATA; SELECT matviewname, ispopulated FROM pg_matviews;', steps: [
      'CREATE MATERIALIZED VIEW order_count AS SELECT count(*) AS n FROM orders WITH NO DATA;',
      'SELECT matviewname, ispopulated FROM pg_matviews;',
      'SELECT * FROM order_count;'
    ], why: 'ispopulated is f and reading fails: "materialized view order_count has not been populated". WITH NO DATA creates the definition instantly, useful in migrations, where the first REFRESH runs later in the background.', expectOut: 'order_count\\s+\\| f[\\s\\S]*has not been populated' },
    { pts: 2, q: 'Try <code>REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_revenue</code>, then fix what it complains about and refresh again.', hint: 'It needs a unique index.', steps: [
      monthlyMv,
      'REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_revenue;',
      'CREATE UNIQUE INDEX monthly_revenue_month ON monthly_revenue (month);',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_revenue;'
    ], why: 'The first refresh fails: CONCURRENTLY compares the old and new results row by row and needs a unique key to match them. After the unique index it works. The index also speeds up reads that filter on month.', expectOut: 'cannot refresh materialized view "public.monthly_revenue" concurrently[\\s\\S]*REFRESH MATERIALIZED VIEW$' },
    { pts: 2, q: 'With the unique index in place, run the lesson\'s blocking demo again but with CONCURRENTLY: B refreshes in an open transaction while A reads.', hint: 'REFRESH MATERIALIZED VIEW CONCURRENTLY in B.', setup: monthlyMv + '\nCREATE UNIQUE INDEX monthly_revenue_month ON monthly_revenue (month);', two: [
      ['B', 'BEGIN;'],
      ['B', 'REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_revenue;'],
      ['A', 'SELECT count(*) FROM monthly_revenue;'],
      ['B', 'COMMIT;']
    ], why: 'A reads immediately: CONCURRENTLY takes only an EXCLUSIVE lock, which allows reads (two refreshes still cannot run at once). This is the form to use in production whenever anyone reads the view while it refreshes.', expectOut: '^(?![\\s\\S]*blocked)[\\s\\S]*A=# SELECT count\\(\\*\\) FROM monthly_revenue;\\n\\s+count[\\s\\S]*\\b10\\n[\\s\\S]*B=\\*# COMMIT' },
    { pts: 2, q: 'A dashboard reads monthly_revenue while new delivered orders arrive: B adds a delivered order in March 2025 and refreshes CONCURRENTLY inside a transaction; A reads March before and after B commits.', hint: "INSERT into orders and order_items, then REFRESH … CONCURRENTLY; A: SELECT revenue … WHERE month = '2025-03-01'", setup: monthlyMv + '\nCREATE UNIQUE INDEX monthly_revenue_month ON monthly_revenue (month);', two: [
      ['B', 'BEGIN;'],
      ['B', "INSERT INTO orders VALUES (37, 1, '2025-03-20', 'delivered', 'Mumbai');"],
      ['B', 'INSERT INTO order_items VALUES (37, 3, 10, 1500);'],
      ['B', 'REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_revenue;'],
      ['A', "SELECT revenue FROM monthly_revenue WHERE month = '2025-03-01';"],
      ['B', 'COMMIT;'],
      ['A', "SELECT revenue FROM monthly_revenue WHERE month = '2025-03-01';"]
    ], why: 'Before B commits, A sees 121,500; afterwards 136,500. The refresh is part of B\'s transaction, so readers switch from the old snapshot to the new one at COMMIT, never seeing half a refresh. Refreshing in the same transaction as the change is possible, but a full refresh per write is far too expensive: schedule it instead.', expectOut: '121500\\.00[\\s\\S]*COMMIT[\\s\\S]*136500\\.00' },
    { pts: 2, q: 'Try to update through a view that joins two tables: a view order_customers (order_id, status, full_name) over orders JOIN customers. Cancel order 36 through it.', hint: 'Views over more than one table are not automatically updatable.', steps: [
      'CREATE VIEW order_customers AS\nSELECT o.order_id, o.status, c.full_name\nFROM orders o JOIN customers c ON c.customer_id = o.customer_id;',
      "UPDATE order_customers SET status = 'cancelled' WHERE order_id = 36;"
    ], why: '"cannot update view order_customers": with a join, Postgres cannot know which table a change belongs to. Options: update the base table directly, or an INSTEAD OF trigger on the view (Phase 7) that says exactly what an UPDATE means.', expectOut: 'cannot update view "order_customers"' },
    { pts: 2, q: 'Before changing the orders table, list every view that reads from it. Create customer_revenue and pending_orders first, then query information_schema.view_table_usage.', hint: "WHERE table_name = 'orders'", sql: revenueView + "\nCREATE VIEW pending_orders AS SELECT order_id, status FROM orders WHERE status = 'pending';\n\nSELECT view_name FROM information_schema.view_table_usage\nWHERE table_schema = 'public' AND table_name = 'orders'\nORDER BY view_name;", why: 'Both views. Run this before every migration that touches a table: each listed view must be checked, and possibly dropped and recreated, in the same transaction as the change.', expectRows: 2 },
    { pts: 2, q: 'A leaderboard as a materialized view: delivered revenue per customer with its rank (dense_rank, highest first) and a unique index on customer_id. Show the top 3.', hint: 'CREATE MATERIALIZED VIEW leaderboard AS SELECT …, dense_rank() OVER (ORDER BY revenue DESC) AS rank FROM …', sql: "CREATE MATERIALIZED VIEW leaderboard AS\nSELECT customer_id, revenue, dense_rank() OVER (ORDER BY revenue DESC) AS rank\nFROM (\n  SELECT o.customer_id, sum(oi.quantity * oi.unit_price) AS revenue\n  FROM orders o JOIN order_items oi ON oi.order_id = o.order_id\n  WHERE o.status = 'delivered'\n  GROUP BY o.customer_id\n) t;\nCREATE UNIQUE INDEX leaderboard_customer ON leaderboard (customer_id);\n\nSELECT customer_id, revenue, rank FROM leaderboard WHERE rank <= 3 ORDER BY rank;", why: 'Customer 8 first, then 1, then 10. Session 50 Q14 showed that a leaderboard cannot avoid reading everything; a materialized view does that work once per refresh instead of once per page view.', expectRows: 3 }
  ],
  hard: {
    q: 'Materialized views refresh everything. Build an <b>incremental</b> alternative: a summary table daily_revenue (day primary key, revenue) plus a one-row watermark table (last order_id processed). Load it fully once, then add two delivered orders (ids 37 and 38, on 2025-03-20 and 2026-02-15) and refresh incrementally: recompute only the days touched by orders after the watermark, with an upsert, and move the watermark. Show the two affected days.',
    hint: 'WITH touched AS (SELECT DISTINCT order_date FROM orders WHERE order_id > watermark) … INSERT … ON CONFLICT (day) DO UPDATE …; then UPDATE watermark.',
    steps: [
      'CREATE TABLE daily_revenue (day date PRIMARY KEY, revenue numeric NOT NULL);',
      'CREATE TABLE revenue_watermark (last_order_id int NOT NULL);',
      "INSERT INTO daily_revenue\nSELECT o.order_date, sum(oi.quantity * oi.unit_price)\nFROM orders o JOIN order_items oi ON oi.order_id = o.order_id\nWHERE o.status = 'delivered' GROUP BY o.order_date;",
      'INSERT INTO revenue_watermark SELECT max(order_id) FROM orders;',
      "INSERT INTO orders VALUES (37, 1, '2025-03-20', 'delivered', 'Mumbai'), (38, 2, '2026-02-15', 'delivered', 'Bengaluru');",
      'INSERT INTO order_items VALUES (37, 3, 10, 1500), (38, 6, 1, 18000);',
      "BEGIN;",
      "WITH touched AS (\n  SELECT DISTINCT order_date FROM orders\n  WHERE order_id > (SELECT last_order_id FROM revenue_watermark)\n)\nINSERT INTO daily_revenue (day, revenue)\nSELECT o.order_date, sum(oi.quantity * oi.unit_price)\nFROM orders o JOIN order_items oi ON oi.order_id = o.order_id\nWHERE o.status = 'delivered' AND o.order_date IN (SELECT order_date FROM touched)\nGROUP BY o.order_date\nON CONFLICT (day) DO UPDATE SET revenue = EXCLUDED.revenue;",
      'UPDATE revenue_watermark SET last_order_id = (SELECT max(order_id) FROM orders);',
      'COMMIT;',
      "SELECT day, revenue FROM daily_revenue WHERE day IN ('2025-03-20', '2026-02-15') ORDER BY day;"
    ],
    why: 'Only two days were recomputed, however big the history is. 20 March 2025 had no delivered revenue before, so it is inserted; 15 Feb 2026 is new too. The days are recomputed from scratch (not "add the new order"), so running the refresh twice gives the same result (idempotent, Session 40), and the watermark moves in the same transaction as the data. Limits: an order that changes status later (pending → delivered) has an old id and is missed; production versions track an updated_at column or use triggers (Phase 7).',
    expectOut: 'INSERT 0 2[\\s\\S]*2025-03-20 \\| 15000[\\s\\S]*2026-02-15 \\| 18000'
  }
};
