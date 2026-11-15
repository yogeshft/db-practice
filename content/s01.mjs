export default {
  n: 1,
  phase: 'p0',
  title: 'Set up your lab and warm up',
  goal: 'Load the practice database, set up psql the way professionals use it, learn how a query is really executed, and warm up with single-table questions.',
  minutes: 150,
  lesson: [
    { h: 'What you are setting up' },
    { p: 'Every session from now on uses one database called <b>practice</b>. It is a small online shop: customers, orders, order items, products, payments, reviews, employees and a few lookup tables. It is small on purpose (20 customers, 36 orders) so you can read the data with your own eyes and check every answer. It is also full of the mess real data has: customers who never ordered, an order with no items, payments for orders that do not exist, NULL cities and a duplicate customer. Those edge cases are exactly where joins go wrong, so they are where you will learn.' },
    { h: 'Step 1 · Create and load the database' },
    { p: 'Download <a href="data/practice.sql" download>practice.sql</a> (also in this repo at <code>docs/data/practice.sql</code>). Then in a terminal:' },
    { sql: 'psql -U postgres -c "CREATE DATABASE practice"\npsql -U postgres -d practice -f practice.sql', lang: 'bash' },
    { p: 'The file starts with <code>DROP TABLE IF EXISTS …</code>, so you can run it again any time to reset the data, for example after practising UPDATEs and DELETEs.' },
    { h: 'Step 2 · Configure psql once' },
    { p: 'psql reads a start-up file every time it opens. On Windows it is <code>%APPDATA%\\postgresql\\psqlrc.conf</code> (create the folder if it does not exist); on Mac/Linux it is <code>~/.psqlrc</code>. Put this in it:' },
    { sql: "\\set QUIET 1\n\\pset null '∅'\n\\timing on\n\\x auto\n\\set ON_ERROR_ROLLBACK interactive\n\\set HISTSIZE 5000\n\\set QUIET 0", lang: 'psql' },
    { list: [
      "<code>\\pset null '∅'</code> prints NULL as ∅. Without it a NULL and an empty string look identical, and you will misread join results. The expected outputs on this site also show NULL as ∅.",
      '<code>\\timing on</code> prints how long every query took. You will start caring about this in Phase 5.',
      '<code>\\x auto</code> switches to vertical output when a row is too wide for the screen.',
      '<code>ON_ERROR_ROLLBACK interactive</code> means a typo inside a transaction does not throw away everything you did before it.'
    ] },
    { h: 'Step 3 · Look around the schema' },
    { p: 'Connect with <code>psql -U postgres -d practice</code>, then try <code>\\dt</code> (list tables) and <code>\\d orders</code> (describe one table). The relationships you will join on all session long:' },
    { pre: 'customers ──< orders ──< order_items >── products >── categories\n    │            │                            │\n    │            ├── payments (no FK!)        └──< product_suppliers >── suppliers\n    │            └── deliveries (one per shipped order)\n    ├── referred_by → customers (self)\n    ├──< page_views (website clicks)\n    └──< reviews >── products\n\ndepartments ──< employees ── manager_id → employees (self)\n\nroutes: one-way shipping routes between cities\nlookups: discount_tiers, shipping_zones, sizes, colors\n\nPhase 4 (arrays, JSONB, modelling):\nproducts ──  product_details (tags[], specs JSONB)\n         ──< product_attributes, price_history, inventory (per warehouse)\ncustomers ──< events (JSONB payload)\nstock_feed: incoming stock counts (no FK!)\n\nPhase 6 (transactions and locking): accounts, jobs (a work queue), table_bookings\n\nPhase 5 (load big.sql): big_customers ──< big_orders (200,000 rows); big_events (JSONB)\n\n──<  means "one to many": one customer has many orders' },
    { h: 'How Postgres really runs a query' },
    { p: 'You write a query top to bottom, but Postgres evaluates it in a different order. Learn this order now; almost every confusing join result later is explained by it.' },
    { pre: '1. FROM / JOIN    build the rows (this is where joins happen)\n2. WHERE          throw away rows that fail the condition\n3. GROUP BY       collapse rows into groups\n4. HAVING         throw away groups\n5. SELECT         compute the output columns (aliases are born here)\n6. DISTINCT       remove duplicate output rows\n7. ORDER BY       sort (can use SELECT aliases)\n8. LIMIT/OFFSET   cut' },
    { p: 'That is why <code>WHERE total &gt; 100</code> fails when <code>total</code> is an alias defined in SELECT (WHERE runs before SELECT), while <code>ORDER BY total</code> works (ORDER BY runs after).' },
    { sql: "SELECT order_id, quantity * unit_price AS line_total\nFROM order_items\nWHERE quantity * unit_price > 100000   -- repeat the expression: the alias does not exist yet\nORDER BY line_total DESC;             -- the alias works here", run: true },
    { h: 'NULL is not a value, it is "unknown"' },
    { p: 'Any comparison with NULL gives NULL (unknown), and WHERE only keeps rows where the condition is <b>true</b>. So <code>city = NULL</code> never matches anything, and neither does <code>city &lt;&gt; \'Mumbai\'</code> for a row whose city is NULL. Use <code>IS NULL</code> / <code>IS NOT NULL</code>, and <code>IS DISTINCT FROM</code> when you want NULL to count as "different".' },
    { sql: "SELECT\n  count(*) FILTER (WHERE city <> 'Mumbai')                  AS not_mumbai_with_equals,\n  count(*) FILTER (WHERE city IS DISTINCT FROM 'Mumbai')    AS not_mumbai_null_safe\nFROM customers;", run: true },
    { p: 'The second number is 2 higher: the two customers with an unknown city. Remember this. In joins, NULL keys never match anything, which is the root of half the bugs in this phase.' },
    { h: 'How to work through every session' },
    { list: [
      'Read the topics and type every example yourself.',
      'Create one file per session in <code>psql/</code> (for example <code>psql/s01.sql</code>) and write each answer there.',
      'Before running a query, guess how many rows it will return. Then run it and compare with <b>Expected</b>.',
      'Open <b>Answer</b> only after a real attempt, then retype the answer yourself.',
      'Got one wrong? Write it in <code>mistakes.md</code> and redo it at the start of the next session.'
    ] },
    { tip: 'Questions say how to order the output, so your rows should match the expected output exactly, row for row.' }
  ],
  questions: [
    { pts: 1, q: 'How many customers are there? Return one number.', hint: 'count(*) counts rows.', sql: 'SELECT count(*) AS customers\nFROM customers;', why: 'count(*) counts rows regardless of NULLs. There are 20.', expectRows: 1 },
    { pts: 1, q: 'List the customer_id and full_name of customers who live in Mumbai, ordered by customer_id.', hint: "WHERE city = 'Mumbai'", sql: "SELECT customer_id, full_name\nFROM customers\nWHERE city = 'Mumbai'\nORDER BY customer_id;", why: 'A simple equality filter. Text comparison is case-sensitive.', expectRows: 3 },
    { pts: 1, q: 'Which customers have an unknown city? Show customer_id and full_name.', hint: 'city = NULL never matches.', sql: 'SELECT customer_id, full_name\nFROM customers\nWHERE city IS NULL\nORDER BY customer_id;', why: 'NULL must be tested with IS NULL; `= NULL` is never true.', expectRows: 2 },
    { pts: 1, q: 'Products priced above 10,000: name and price, most expensive first.', hint: 'ORDER BY … DESC', sql: 'SELECT name, price\nFROM products\nWHERE price > 10000\nORDER BY price DESC;', why: 'Filter, then sort descending.', expectRows: 6 },
    { pts: 1, q: 'Orders placed in 2026: order_id and order_date, oldest first.', hint: 'Compare order_date with a date literal.', sql: "SELECT order_id, order_date\nFROM orders\nWHERE order_date >= DATE '2026-01-01'\nORDER BY order_date;", why: "Use a half-open range (>= start) instead of extracting the year: it can use an index on order_date later.", expectRows: 4 },
    { pts: 1, q: 'List every distinct order status, alphabetically.', hint: 'SELECT DISTINCT', sql: 'SELECT DISTINCT status\nFROM orders\nORDER BY status;', why: 'DISTINCT removes duplicate output rows after SELECT is computed.', expectRows: 4 },
    { pts: 1, q: 'Employees hired before 2020: full_name and hired_on, earliest first.', hint: "hired_on < '2020-01-01'", sql: "SELECT full_name, hired_on\nFROM employees\nWHERE hired_on < DATE '2020-01-01'\nORDER BY hired_on;", why: 'Dates compare chronologically.', expectRows: 4 },
    { pts: 1, q: 'The 3 highest-paid employees: full_name and salary. If salaries tie, the earlier hire comes first.', hint: 'ORDER BY two columns, then LIMIT.', sql: 'SELECT full_name, salary\nFROM employees\nORDER BY salary DESC, hired_on\nLIMIT 3;', why: 'Always add a tie-breaker before LIMIT, or the result can change between runs.', expectRows: 3 },
    { pts: 2, q: 'Number of orders per status, most common first (ties alphabetical by status).', hint: 'GROUP BY status, then ORDER BY the count.', sql: 'SELECT status, count(*) AS orders\nFROM orders\nGROUP BY status\nORDER BY orders DESC, status;', why: 'GROUP BY collapses rows per status; ORDER BY can use the alias because it runs after SELECT.', expectRows: 4 },
    { pts: 2, q: 'For order 9, show product_id, quantity, unit_price and the line total (quantity × unit_price), biggest line first.', hint: 'Compute the expression in SELECT and give it an alias.', sql: 'SELECT product_id, quantity, unit_price, quantity * unit_price AS line_total\nFROM order_items\nWHERE order_id = 9\nORDER BY line_total DESC;', why: 'Expressions can be computed per row; the alias is usable in ORDER BY.', expectRows: 3 },
    { pts: 2, q: 'Find customers whose email contains uppercase letters. Show customer_id and email.', hint: 'Compare the email with lower(email).', sql: 'SELECT customer_id, email\nFROM customers\nWHERE email <> lower(email);', why: 'If lowering the email changes it, it had uppercase letters. This is customer 18, a duplicate of customer 2. You will merge them in S9.', expectRows: 1 },
    { pts: 2, q: 'Show every refund: payments with a negative amount (payment_id, order_id, amount).', hint: 'amount < 0', sql: 'SELECT payment_id, order_id, amount\nFROM payments\nWHERE amount < 0;', why: 'The shop stores refunds as negative payments.', expectRows: 1 },
    { pts: 2, q: 'Products that are not discontinued and cost between 2,000 and 10,000 inclusive: name and price, cheapest first.', hint: 'BETWEEN is inclusive; booleans can be tested with NOT.', sql: 'SELECT name, price\nFROM products\nWHERE NOT discontinued\n  AND price BETWEEN 2000 AND 10000\nORDER BY price;', why: 'Earbuds Lite (2,500) is in the price range but discontinued, so it is excluded.', expectRows: 6 },
    { pts: 2, q: 'Orders with no shipping city recorded: order_id, customer_id, status.', hint: 'IS NULL again.', sql: 'SELECT order_id, customer_id, status\nFROM orders\nWHERE shipping_city IS NULL;', why: 'Order 24 has no shipping city. Remember it: it will disappear from joins on city later.', expectRows: 1 }
  ],
  hard: {
    q: 'This one runs on your <b>track1</b> database (from <code>psql/track1.sql</code>), not on practice. Fix track1 Q31: one UPDATE that gives Engineering +12%, Finance +8%, HR +6%, Sales +10% and everyone else +3%, capped at 150,000. Every employee with a salary must be raised, including Nisha Shah, whose department_id (99) matches no department. Employees with a NULL salary must stay NULL. Run it inside BEGIN … ROLLBACK and RETURN employee_id, full_name and the new salary.',
    hint: '`UPDATE … FROM departments` is an inner join: employees with no matching department are silently skipped. Look the department name up with a scalar subquery instead. Then check what LEAST(NULL, 150000) returns.',
    sql: "BEGIN;\n\nUPDATE employees e\nSET salary = LEAST(\n      e.salary * CASE (SELECT d.name FROM departments d WHERE d.department_id = e.department_id)\n                   WHEN 'Engineering' THEN 1.12\n                   WHEN 'Finance'     THEN 1.08\n                   WHEN 'HR'          THEN 1.06\n                   WHEN 'Sales'       THEN 1.10\n                   ELSE 1.03                 -- also covers department 99 (subquery returns NULL)\n                 END,\n      150000)\nWHERE e.salary IS NOT NULL                    -- LEAST ignores NULLs: LEAST(NULL, 150000) = 150000!\nRETURNING e.employee_id, e.full_name, e.salary;\n\nROLLBACK;",
    why: 'Two bugs hide in the original. 1) UPDATE … FROM is an inner join, so Nisha (department 99) never matched and was never updated. A scalar subquery returns NULL when nothing matches, which falls through to ELSE. 2) LEAST and GREATEST ignore NULL arguments, so without the WHERE clause a NULL salary would become 150,000.',
    verify: false
  }
};
