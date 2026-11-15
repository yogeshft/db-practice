export default {
  n: 56,
  phase: 'p6',
  review: true,
  big: true,
  title: 'Review: performance and transactions',
  goal: 'Pull Sessions 50–55 back out of memory: sorting, pagination, statistics, settings and transactions, mixed on the big tables.',
  minutes: 150,
  lesson: [
    { h: 'How to run this review' },
    { list: [
      'You need both practice.sql (reloaded for Phase 6) and big.sql loaded.',
      'First 20 minutes: redo every question in <code>mistakes.md</code> from Sessions 50–55, cold.',
      'Then the 14 questions below. Predict each plan before you run EXPLAIN, and predict each transcript before you run it.',
      'Then the challenge: archive old orders in safe, restartable batches.'
    ] },
    { h: 'Cheat sheet: Sessions 50–55' },
    { pre: "ORDER BY … LIMIT n        index on the ORDER BY columns → no Sort; otherwise top-N heapsort\nSort Method               quicksort (memory) · top-N heapsort · external merge (disk: raise work_mem with SET LOCAL)\nKeyset pagination         WHERE (a, b) < (:a, :b) ORDER BY a DESC, b DESC LIMIT n   + index (…, a, b)\nEstimates                 pg_stats: MCV list, histogram, n_distinct; CREATE STATISTICS for correlated columns\nGeneric plans             prepared statements with skewed data: plan_cache_mode\nSettings                  random_page_cost (SSD 1.1), work_mem (per sort/hash), effective_cache_size\nTransactions              BEGIN … COMMIT; an error aborts all; COMMIT of a failed transaction = ROLLBACK\nSavepoints                SAVEPOINT s … ROLLBACK TO SAVEPOINT s (undo part, continue)\nNot rolled back           sequences (gaps), anything outside the database", lang: 'text' }
  ],
  questions: [
    { pts: 1, q: 'Page 2 of the newest orders, 5 per page, newest first with order_id as tiebreaker. Page 1 ended with order 199,996 (created_at 2025-11-25 10:17:28 India time).', hint: 'WHERE (created_at, order_id) < (…) ORDER BY created_at DESC, order_id DESC LIMIT 5', sql: "SELECT order_id, created_at\nFROM big_orders\nWHERE (created_at, order_id) < ('2025-11-25 10:17:28+05:30', 199996)\nORDER BY created_at DESC, order_id DESC\nLIMIT 5;", why: 'Orders 199,995 down to 199,991. S51: the cursor holds both sort columns.', expectRows: 5 },
    { pts: 1, q: "Inside BEGIN … ROLLBACK: give one query enough memory to sort all orders by total in memory, and show the sort method with EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, TIMING OFF, SUMMARY OFF).", hint: "SET LOCAL work_mem = '32MB';", sql: "BEGIN;\nSET LOCAL work_mem = '32MB';\nEXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, TIMING OFF, SUMMARY OFF)\nSELECT order_id, total FROM big_orders ORDER BY total;\nROLLBACK;", why: 'quicksort in memory. S50/S53: SET LOCAL ends with the transaction.', expectPlan: 'Sort Method: quicksort' },
    { pts: 1, q: 'What fraction of big_orders does the planner think is cancelled? Read it from pg_stats.', hint: "most_common_vals / most_common_freqs for status", sql: "SELECT v AS status, f AS frequency\nFROM pg_stats,\n     unnest(most_common_vals::text::text[], most_common_freqs) AS x(v, f)\nWHERE tablename = 'big_orders' AND attname = 'status' AND v = 'cancelled';", why: '0.02955: 5,910 of 200,000. S52. unnest with two arrays zips them into rows.', expectRows: 1 },
    { pts: 1, q: 'Move 250 from Ananya to Diya as one transaction and show both balances.', hint: 'BEGIN; two UPDATEs; COMMIT;', steps: [
      'BEGIN;',
      'UPDATE accounts SET balance = balance - 250 WHERE account_id = 4;',
      'UPDATE accounts SET balance = balance + 250 WHERE account_id = 2;',
      'COMMIT;',
      'SELECT account_id, balance FROM accounts WHERE account_id IN (2, 4) ORDER BY account_id;'
    ], why: 'Diya 3,250, Ananya 950. S55.', expectOut: '3250\\.00[\\s\\S]*950\\.00' },
    { pts: 1, q: 'Inside a transaction, create an index on big_orders(status), roll back, and check whether the index exists.', hint: "pg_indexes WHERE indexname = …", steps: [
      'BEGIN;',
      'CREATE INDEX big_orders_status_idx ON big_orders (status);',
      'ROLLBACK;',
      "SELECT count(*) FROM pg_indexes WHERE indexname = 'big_orders_status_idx';"
    ], why: '0: DDL is transactional (S55). That is why every Phase 5 question could try indexes inside BEGIN … ROLLBACK.', expectOut: 'ROLLBACK[\\s\\S]*\\b0\\b' },
    { pts: 1, q: 'In one statement, take 100 from Aarav and from Diya and give 200 to Kabir. Return the three new balances.', hint: 'CASE account_id WHEN … in one UPDATE.', sql: 'UPDATE accounts\nSET balance = balance + CASE account_id WHEN 1 THEN -100 WHEN 2 THEN -100 WHEN 3 THEN 200 END\nWHERE account_id IN (1, 2, 3)\nRETURNING account_id, balance;', why: 'One statement is atomic. S55.', expectRows: 3 },
    { pts: 1, q: "Inside BEGIN … ROLLBACK: create the index that lets \"customer 42's 10 newest orders\" run without a Sort, and show the plan (COSTS OFF).", hint: 'Index (customer_id, created_at).', sql: 'BEGIN;\nCREATE INDEX big_orders_customer_created_idx ON big_orders (customer_id, created_at);\nEXPLAIN (COSTS OFF)\nSELECT * FROM big_orders WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 10;\nROLLBACK;', why: 'Limit → Index Scan Backward. S50.', expectPlan: '^(?![\\s\\S]*Sort)[\\s\\S]*Index Scan Backward' },
    { pts: 1, q: 'An error in the middle of a transaction: add 1 to every balance, divide by zero, then try to COMMIT. What did COMMIT do?', hint: 'Look at the reply to COMMIT.', steps: [
      'BEGIN;',
      'UPDATE accounts SET balance = balance + 1;',
      'SELECT 1 / 0;',
      'COMMIT;',
      'SELECT sum(balance) FROM accounts;'
    ], why: 'COMMIT replied ROLLBACK and the total is still 9,200. S55.', expectOut: 'COMMIT;\\nROLLBACK[\\s\\S]*9200\\.00' },
    { pts: 2, q: "Inside BEGIN … ROLLBACK: make page 2 of customer 42's history (5 per page, newest first, cursor 2025-11-18 00:00 India time / order 197640) an Index Only Scan returning order_id, created_at, total. Show EXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, TIMING OFF, SUMMARY OFF).", hint: 'Index (customer_id, created_at, order_id) INCLUDE (total).', sql: "BEGIN;\nCREATE INDEX big_orders_history_idx ON big_orders (customer_id, created_at, order_id) INCLUDE (total);\nEXPLAIN (ANALYZE, BUFFERS OFF, COSTS OFF, TIMING OFF, SUMMARY OFF)\nSELECT order_id, created_at, total\nFROM big_orders\nWHERE customer_id = 42 AND (created_at, order_id) < ('2025-11-18 00:00+05:30', 197640)\nORDER BY created_at DESC, order_id DESC\nLIMIT 5;\nROLLBACK;", why: 'Limit → Index Only Scan Backward, 5 rows, Heap Fetches: 0. S47 + S51.', expectPlan: 'Index Only Scan Backward using big_orders_history_idx[\\s\\S]*Heap Fetches: 0' },
    { pts: 2, q: "Inside BEGIN … ROLLBACK: fix the estimate for big_customers with city 'London' and country 'UK', and show EXPLAIN (ANALYZE, BUFFERS OFF, TIMING OFF, SUMMARY OFF).", hint: 'CREATE STATISTICS … (dependencies); ANALYZE.', sql: "BEGIN;\nCREATE STATISTICS big_customers_city_country (dependencies) ON city, country FROM big_customers;\nANALYZE big_customers;\nEXPLAIN (ANALYZE, BUFFERS OFF, TIMING OFF, SUMMARY OFF)\nSELECT * FROM big_customers WHERE city = 'London' AND country = 'UK';\nROLLBACK;", why: '400 estimated, 400 actual. S52.', expectPlan: 'rows=400 width=51\\) \\(actual rows=400' },
    { pts: 2, q: 'Queue three jobs in one transaction, each behind its own savepoint, where the middle one reuses an existing id (4). Commit and count the jobs.', hint: 'SAVEPOINT / RELEASE / ROLLBACK TO for each insert.', steps: [
      'BEGIN;',
      'SAVEPOINT j;',
      "INSERT INTO jobs (job_id, kind, run_after) VALUES (11, 'send_email', now());",
      'RELEASE SAVEPOINT j;',
      'SAVEPOINT j;',
      "INSERT INTO jobs (job_id, kind, run_after) VALUES (4, 'send_email', now());",
      'ROLLBACK TO SAVEPOINT j;',
      'SAVEPOINT j;',
      "INSERT INTO jobs (job_id, kind, run_after) VALUES (12, 'send_email', now());",
      'RELEASE SAVEPOINT j;',
      'COMMIT;',
      'SELECT count(*) FROM jobs;'
    ], why: '12 jobs: 10 + 11 + 12. S55.', expectOut: 'duplicate key[\\s\\S]*COMMIT[\\s\\S]*\\b12\\b' },
    { pts: 2, q: "Inside BEGIN … ROLLBACK: with an index on big_orders(status), show the plan a <b>generic</b> prepared statement would use for status 'delivered'.", hint: 'PREPARE …; SET LOCAL plan_cache_mode = force_generic_plan; EXPLAIN (COSTS OFF) EXECUTE …; DEALLOCATE …', sql: "BEGIN;\nCREATE INDEX big_orders_status_idx ON big_orders (status);\nPREPARE by_status(text) AS SELECT * FROM big_orders WHERE status = $1;\nSET LOCAL plan_cache_mode = force_generic_plan;\nEXPLAIN (COSTS OFF) EXECUTE by_status('delivered');\nDEALLOCATE by_status;\nROLLBACK;", why: 'An Index Scan with status = $1, even for 95% of the table. S52.', expectPlan: 'Index Scan using big_orders_status_idx[\\s\\S]*\\$1' },
    { pts: 2, q: 'Health check for the big tables: table_name, rows (estimate), table_size, index_size, ordered by total size.', hint: 'pg_class with reltuples, pg_relation_size, pg_indexes_size.', sql: "SELECT relname AS table_name, reltuples::bigint AS rows,\n       pg_size_pretty(pg_relation_size(oid)) AS table_size,\n       pg_size_pretty(pg_indexes_size(oid)) AS index_size\nFROM pg_class\nWHERE relkind = 'r' AND relname LIKE 'big\\_%'\nORDER BY pg_total_relation_size(oid) DESC;", why: 'big_orders, big_events, big_customers. S53.', expectRows: 3 },
    { pts: 2, q: 'Run a transfer of 300 from Diya to Kabir and, in the same transaction, check that the total is still 9,200 before committing. Then show the total from outside.', hint: 'SELECT sum(balance) inside the transaction sees your own changes.', steps: [
      'BEGIN;',
      'UPDATE accounts SET balance = balance - 300 WHERE account_id = 2;',
      'UPDATE accounts SET balance = balance + 300 WHERE account_id = 3;',
      'SELECT sum(balance) AS inside FROM accounts;',
      'COMMIT;',
      'SELECT sum(balance) AS outside FROM accounts;'
    ], why: '9,200 both times. S55 challenge.', expectOut: 'inside[\\s\\S]*9200\\.00[\\s\\S]*outside[\\s\\S]*9200\\.00' }
  ],
  hard: {
    q: 'Archive the orders of the first week of 2024 (created before 2024-01-08) from big_orders into big_orders_archive (same columns), in batches of 2,000 rows. Each batch must move rows atomically (delete and insert in one statement), so the job can be stopped and restarted at any time. Run batches until one moves nothing, then show how many rows are in the archive and how many first-week orders are left.',
    hint: 'CREATE TABLE big_orders_archive (LIKE big_orders); WITH moved AS (DELETE … WHERE order_id IN (SELECT … LIMIT 2000) RETURNING *) INSERT INTO big_orders_archive SELECT * FROM moved;',
    steps: [
      'CREATE TABLE big_orders_archive (LIKE big_orders);',
      "WITH moved AS (\n  DELETE FROM big_orders\n  WHERE order_id IN (SELECT order_id FROM big_orders WHERE created_at < '2024-01-08' ORDER BY order_id LIMIT 2000)\n  RETURNING *\n)\nINSERT INTO big_orders_archive SELECT * FROM moved;",
      "WITH moved AS (\n  DELETE FROM big_orders\n  WHERE order_id IN (SELECT order_id FROM big_orders WHERE created_at < '2024-01-08' ORDER BY order_id LIMIT 2000)\n  RETURNING *\n)\nINSERT INTO big_orders_archive SELECT * FROM moved;",
      "WITH moved AS (\n  DELETE FROM big_orders\n  WHERE order_id IN (SELECT order_id FROM big_orders WHERE created_at < '2024-01-08' ORDER BY order_id LIMIT 2000)\n  RETURNING *\n)\nINSERT INTO big_orders_archive SELECT * FROM moved;",
      "SELECT (SELECT count(*) FROM big_orders_archive) AS archived,\n       (SELECT count(*) FROM big_orders WHERE created_at < '2024-01-08') AS left_behind;"
    ],
    why: 'INSERT 0 2000, INSERT 0 16, INSERT 0 0: 2,016 orders archived, 0 left. Each batch is one statement, so a crash between batches loses nothing and duplicates nothing: the next run simply continues (it is idempotent, S40). Small batches keep locks short and let autovacuum keep up (S61). In production, add an index on created_at (or batch by order_id ranges) so each batch does not scan the table, and pause between batches.',
    expectOut: 'INSERT 0 2000[\\s\\S]*INSERT 0 16[\\s\\S]*INSERT 0 0[\\s\\S]*2016 \\|\\s+0'
  }
};
