const fileOf = (t) => `(SELECT relfilenode FROM pg_class WHERE relname = '${t}')`;

export default {
  n: 61,
  phase: 'p6',
  title: 'Zero-downtime migrations',
  goal: 'Change the schema of a busy database without blocking the application: know which DDL takes which lock, avoid the lock queue, and use NOT VALID, CONCURRENTLY and expand/contract.',
  minutes: 150,
  lesson: [
    { h: 'DDL takes table locks' },
    { p: 'Every statement takes a <b>table-level lock</b> besides any row locks. Most are harmless (SELECT takes ACCESS SHARE, writes take ROW EXCLUSIVE), but most ALTER TABLE forms take <b>ACCESS EXCLUSIVE</b>, which conflicts with everything, even SELECT.' },
    { pre: 'Lock                     taken by (examples)                                    conflicts with\n-----------------------  -----------------------------------------------------  -------------------------------\nACCESS SHARE             SELECT                                                 ACCESS EXCLUSIVE\nROW EXCLUSIVE            INSERT, UPDATE, DELETE, MERGE                          SHARE and stronger\nSHARE UPDATE EXCLUSIVE   VACUUM, ANALYZE, CREATE INDEX CONCURRENTLY,            itself and stronger\n                         VALIDATE CONSTRAINT, REFRESH … CONCURRENTLY            (reads and writes go on)\nSHARE                    CREATE INDEX (not concurrently)                        all writes\nEXCLUSIVE                REFRESH MATERIALIZED VIEW CONCURRENTLY                 everything except SELECT\nACCESS EXCLUSIVE         most ALTER TABLE, DROP, TRUNCATE, VACUUM FULL,         everything, even SELECT\n                         REFRESH MATERIALIZED VIEW', lang: 'text' },
    { p: 'An ACCESS EXCLUSIVE lock held for a millisecond is fine. The danger is how long the statement <i>waits</i> for it, and how long it holds it once it has it.' },
    { h: 'The lock queue: how a fast ALTER takes the site down' },
    { p: 'Locks are granted in order. An ALTER that waits for a long-running transaction also makes everyone who arrives after it wait, including plain SELECTs that would not conflict with the long transaction at all:' },
    { two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT count(*) FROM orders;'],
      ['--', 'A is a slow report (or a forgotten open transaction). Now the migration starts:'],
      ['B', 'ALTER TABLE orders ADD COLUMN note text;'],
      ['--', 'and an ordinary request from the application:'],
      ['C', 'SELECT order_id, status FROM orders WHERE order_id = 1;'],
      ['A', 'COMMIT;']
    ], expectOut: 'B=# ALTER[\\s\\S]*blocked[\\s\\S]*C=# SELECT[\\s\\S]*blocked[\\s\\S]*A=\\*# COMMIT' },
    { p: 'C\'s one-row SELECT waited behind B, which waited behind A. On a busy site every request piles up behind the ALTER, connections run out, and the application is down although the ALTER itself needs a millisecond. The fix: <b>never wait long for a DDL lock</b>. Set <code>lock_timeout</code> for the migration and retry if it gives up:' },
    { two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT count(*) FROM orders;'],
      ['B', "SET lock_timeout = '1s';"],
      ['B', 'ALTER TABLE orders ADD COLUMN note text;'],
      ['wait', 'B'],
      ['C', 'SELECT order_id, status FROM orders WHERE order_id = 1;'],
      ['A', 'COMMIT;']
    ], expectOut: 'canceling statement due to lock timeout[\\s\\S]*C=# SELECT[\\s\\S]*\\(1 row\\)' },
    { h: 'Fast and slow ALTERs' },
    { pre: 'Instant (catalog only)                         Rewrites or scans the whole table under ACCESS EXCLUSIVE\n---------------------------------------------  ----------------------------------------------------------\nADD COLUMN (no default, or a constant default) ADD COLUMN with a volatile default (clock_timestamp(), random())\nDROP COLUMN (space reclaimed later)            ALTER COLUMN TYPE that changes the storage (int → bigint)\nRENAME TABLE / COLUMN                          SET NOT NULL (a full scan, unless a valid CHECK proves it)\nvarchar(50) → varchar(100) or text             text → varchar(n) (every value must be checked)\n                                               ADD CONSTRAINT … CHECK / FOREIGN KEY (full scan)\nADD CONSTRAINT … NOT VALID                     CREATE INDEX (blocks writes for the whole build)\nDROP / CREATE VIEW                             VACUUM FULL, CLUSTER', lang: 'text' },
    { p: 'You can see whether a statement rewrote a table: the table\'s <code>relfilenode</code> (its data file) changes on a rewrite (Q4, Q5).' },
    { h: 'The safe recipes' },
    { list: [
      '<b>Indexes:</b> <code>CREATE INDEX CONCURRENTLY</code> builds without blocking writes (it takes longer and cannot run inside a transaction block; if it fails it leaves an INVALID index to drop and retry).',
      '<b>Constraints:</b> <code>ADD CONSTRAINT … NOT VALID</code> (instant, checks new rows only), then <code>VALIDATE CONSTRAINT</code> (scans, but under SHARE UPDATE EXCLUSIVE, so reads and writes continue). Works for CHECK and FOREIGN KEY.',
      '<b>NOT NULL:</b> add <code>CHECK (col IS NOT NULL) NOT VALID</code>, validate it, then <code>SET NOT NULL</code> uses the valid check and skips the scan; drop the check afterwards (challenge).',
      '<b>Renames and type changes:</b> expand/contract. Add the new column, write to both, backfill in batches, switch reads, stop writing the old one, drop it. Each step is a separate, quick, deployable change.',
      '<b>Backfills:</b> in batches of a few thousand rows, each its own transaction, so locks are short and VACUUM can keep up (Q10).',
      '<b>Every migration:</b> <code>SET lock_timeout = \'2s\'</code> (and a retry), and one change per transaction where possible.'
    ] },
    { tip: 'Most migration tools (Flyway, Liquibase, Rails, Django, Prisma) wrap each migration in a transaction. That is great for atomicity (Session 55), but CREATE INDEX CONCURRENTLY must run outside it: every tool has a way to mark a migration as "no transaction". Check what yours does before production does it for you.' }
  ],
  questions: [
    { pts: 1, q: 'Which lock does <code>ALTER TABLE orders ADD COLUMN note text</code> take? Run it inside a transaction and look at your own locks on orders in pg_locks.', hint: "pg_locks WHERE relation = 'orders'::regclass AND pid = pg_backend_pid()", sql: "ALTER TABLE orders ADD COLUMN note text;\nSELECT mode, granted FROM pg_locks\nWHERE relation = 'orders'::regclass AND pid = pg_backend_pid();", why: 'AccessExclusiveLock, held until the transaction ends. That is why an ALTER inside a long migration transaction blocks the table for the whole migration, not just for its own statement.', expectRows: 1 },
    { pts: 1, q: 'Which lock does a plain <code>CREATE INDEX</code> on orders(customer_id) take, and what does it block?', hint: 'Same pg_locks query after CREATE INDEX.', sql: "CREATE INDEX orders_customer_id_idx ON orders (customer_id);\nSELECT mode FROM pg_locks\nWHERE relation = 'orders'::regclass AND pid = pg_backend_pid();", why: 'ShareLock: reads continue, but every INSERT, UPDATE and DELETE on orders waits until the index is built. On a big table that can be minutes. Use CREATE INDEX CONCURRENTLY instead (Q8).', expectRows: 1 },
    { pts: 1, q: 'Try to run <code>CREATE INDEX CONCURRENTLY</code> inside BEGIN … COMMIT.', hint: 'BEGIN; CREATE INDEX CONCURRENTLY …', steps: [
      'BEGIN;',
      'CREATE INDEX CONCURRENTLY orders_customer_id_idx ON orders (customer_id);',
      'ROLLBACK;',
      'CREATE INDEX CONCURRENTLY orders_customer_id_idx ON orders (customer_id);'
    ], why: '"CREATE INDEX CONCURRENTLY cannot run inside a transaction block". It needs several transactions of its own (build, then wait for old transactions, then validate). Outside BEGIN it works.', expectOut: 'cannot run inside a transaction block[\\s\\S]*CREATE INDEX$' },
    { pts: 1, q: 'Does adding a column with a constant default rewrite the table? Compare orders\' relfilenode before and after <code>ADD COLUMN source text NOT NULL DEFAULT \'web\'</code>.', hint: 'Store the relfilenode in a temp table first.', sql: `CREATE TEMP TABLE before AS SELECT ${fileOf('orders')} AS f;\nALTER TABLE orders ADD COLUMN source text NOT NULL DEFAULT 'web';\nSELECT ${fileOf('orders')} = (SELECT f FROM before) AS same_file,\n       (SELECT count(*) FROM orders WHERE source = 'web') AS rows_with_default;`, why: 'Same file (t), and all 36 rows report "web". Since Postgres 11 a constant default is stored once in the catalog and returned for old rows on read: instant, even on a billion rows.', expectRows: 1 },
    { pts: 1, q: 'Now a <b>volatile</b> default: <code>ADD COLUMN imported_at timestamptz NOT NULL DEFAULT clock_timestamp()</code>. Does the file change?', hint: 'Same before/after comparison.', sql: `CREATE TEMP TABLE before AS SELECT ${fileOf('orders')} AS f;\nALTER TABLE orders ADD COLUMN imported_at timestamptz NOT NULL DEFAULT clock_timestamp();\nSELECT ${fileOf('orders')} = (SELECT f FROM before) AS same_file;`, why: 'f: a new file. Every row needs its own value, so Postgres rewrote the whole table under ACCESS EXCLUSIVE. On a big table: add the column without a default (instant), set the default for new rows, and backfill old rows in batches.', expectRows: 1 },
    { pts: 1, q: 'Which type changes rewrite the table? customers.full_name is text. Change it to varchar(200), then widen it to varchar(300), then back to text, and record after each step whether customers got a new data file.', hint: 'Save relfilenode in temp tables between the ALTERs.', sql: `CREATE TEMP TABLE f0 AS SELECT ${fileOf('customers')} AS f;\nALTER TABLE customers ALTER COLUMN full_name TYPE varchar(200);\nCREATE TEMP TABLE f1 AS SELECT ${fileOf('customers')} AS f;\nALTER TABLE customers ALTER COLUMN full_name TYPE varchar(300);\nALTER TABLE customers ALTER COLUMN full_name TYPE text;\nSELECT (SELECT f FROM f1) = (SELECT f FROM f0)          AS same_after_text_to_varchar,\n       ${fileOf('customers')} = (SELECT f FROM f1) AS same_after_widening;`, why: 'f, then t. text → varchar(200) must check every existing value against the new limit, and Postgres does that by rewriting the table. Widening a varchar, or going back to text, is only a catalog change, since the stored bytes are identical. int → bigint rewrites too (the bytes change), along with its indexes and the foreign keys that reference it: give new tables bigint ids from the start. Always test a type change on a copy and look at relfilenode before running it in production.', expectRows: 1 },
    { pts: 1, q: 'Add a CHECK that order totals in order_items are positive (unit_price &gt; 0) without scanning the table under a blocking lock: add it NOT VALID, check pg_constraint, validate, check again.', hint: 'ADD CONSTRAINT … CHECK (…) NOT VALID; VALIDATE CONSTRAINT …', sql: "ALTER TABLE order_items ADD CONSTRAINT unit_price_positive CHECK (unit_price > 0) NOT VALID;\nALTER TABLE order_items VALIDATE CONSTRAINT unit_price_positive;\nSELECT conname, convalidated FROM pg_constraint WHERE conname = 'unit_price_positive';", why: 'convalidated t after VALIDATE. The ADD is instant (it only checks new rows from now on); VALIDATE scans the existing rows under SHARE UPDATE EXCLUSIVE, so the application keeps reading and writing during the scan. Session 41 used the same pair to clean data first.', expectRows: 1 },
    { pts: 1, q: 'The payments table has no foreign key to orders (Phase 1). Add one without blocking writes, knowing that some existing payments point to missing orders. What happens at VALIDATE?', hint: 'ADD CONSTRAINT … FOREIGN KEY … NOT VALID; then VALIDATE CONSTRAINT.', steps: [
      'ALTER TABLE payments ADD CONSTRAINT payments_order_fk FOREIGN KEY (order_id) REFERENCES orders NOT VALID;',
      "INSERT INTO payments VALUES (33, 5000, 10, 'upi', now());",
      'ALTER TABLE payments VALIDATE CONSTRAINT payments_order_fk;'
    ], why: 'The NOT VALID constraint is enforced at once: the new payment for order 5000 is rejected. VALIDATE then fails on the old orphans (orders 40 and 9999): clean them up (or move them to a quarantine table), and validate again. Until then the constraint protects all new data, which is already most of the value.', expectOut: 'payments_order_fk[\\s\\S]*Key \\(order_id\\)=\\(5000\\) is not present[\\s\\S]*VALIDATE[\\s\\S]*violates foreign key constraint' },
    { pts: 2, q: 'Show that a plain CREATE INDEX blocks writers while CREATE INDEX CONCURRENTLY does not. A has an open transaction that updated an order; B creates an index on orders(customer_id) <b>concurrently</b>; C inserts an order meanwhile.', hint: 'B waits for A (CONCURRENTLY waits for old transactions), but C\'s insert should not wait for B.', two: [
      ['A', 'BEGIN;'],
      ['A', "UPDATE orders SET status = 'cancelled' WHERE order_id = 36;"],
      ['B', 'CREATE INDEX CONCURRENTLY orders_customer_id_idx ON orders (customer_id);'],
      ['C', "INSERT INTO orders VALUES (37, 1, '2026-02-15', 'pending', 'Mumbai');"],
      ['A', 'COMMIT;']
    ], why: 'C\'s INSERT completes immediately although B is still waiting: CONCURRENTLY holds only SHARE UPDATE EXCLUSIVE, which allows writes. B finishes once A\'s transaction is over (it must wait for every transaction that could have started before the index existed). With a plain CREATE INDEX, C would have queued behind B: the lock queue again.', expectOut: 'B=# CREATE INDEX CONCURRENTLY[\\s\\S]*blocked[\\s\\S]*C=# INSERT[^\\n]*\\n\\s+INSERT 0 1[\\s\\S]*finishes[\\s\\S]*CREATE INDEX' },
    { pts: 2, q: 'Backfill in batches. A new column orders.city_code (text) must be filled with the first 3 letters of shipping_city, upper-cased. Write one batch that updates at most 10 orders that still need it, oldest first; run it until it updates nothing, and count how many orders remain without a code.', hint: 'UPDATE … WHERE order_id IN (SELECT order_id … WHERE city_code IS NULL AND shipping_city IS NOT NULL ORDER BY order_id LIMIT 10)', steps: [
      'ALTER TABLE orders ADD COLUMN city_code text;',
      "UPDATE orders SET city_code = upper(left(shipping_city, 3))\nWHERE order_id IN (SELECT order_id FROM orders WHERE city_code IS NULL AND shipping_city IS NOT NULL ORDER BY order_id LIMIT 10);",
      "UPDATE orders SET city_code = upper(left(shipping_city, 3))\nWHERE order_id IN (SELECT order_id FROM orders WHERE city_code IS NULL AND shipping_city IS NOT NULL ORDER BY order_id LIMIT 10);",
      "UPDATE orders SET city_code = upper(left(shipping_city, 3))\nWHERE order_id IN (SELECT order_id FROM orders WHERE city_code IS NULL AND shipping_city IS NOT NULL ORDER BY order_id LIMIT 10);",
      "UPDATE orders SET city_code = upper(left(shipping_city, 3))\nWHERE order_id IN (SELECT order_id FROM orders WHERE city_code IS NULL AND shipping_city IS NOT NULL ORDER BY order_id LIMIT 10);",
      "UPDATE orders SET city_code = upper(left(shipping_city, 3))\nWHERE order_id IN (SELECT order_id FROM orders WHERE city_code IS NULL AND shipping_city IS NOT NULL ORDER BY order_id LIMIT 10);",
      'SELECT count(*) FILTER (WHERE city_code IS NULL) AS without_code, count(*) AS orders FROM orders;'
    ], why: 'UPDATE 10, 10, 10, 5, 0: done. One order is left without a code because its shipping_city is NULL (order 24): decide what it should be before you make the column NOT NULL. In real life the batch is run by a script in a loop with a short pause, each batch its own transaction, so row locks last milliseconds and autovacuum keeps up. With millions of rows, batch by primary-key range (order_id BETWEEN x AND x + 9999) to avoid re-scanning for NULLs.', expectOut: 'UPDATE 10[\\s\\S]*UPDATE 10[\\s\\S]*UPDATE 10[\\s\\S]*UPDATE 5[\\s\\S]*UPDATE 0[\\s\\S]*\\b1 \\|\\s+36' },
    { pts: 2, q: 'Rename orders.shipping_city to ship_to_city <b>without breaking the running application</b>, which still reads shipping_city. Run the first expand steps in SQL: add ship_to_city, backfill it from shipping_city, and check that every row is in sync. The remaining steps are application deploys: describe them.', hint: 'Expand: ADD COLUMN ship_to_city; backfill; (app writes both); switch reads; contract: DROP COLUMN shipping_city.', steps: [
      'ALTER TABLE orders ADD COLUMN ship_to_city text;',
      'UPDATE orders SET ship_to_city = shipping_city WHERE ship_to_city IS DISTINCT FROM shipping_city;',
      'SELECT count(*) FILTER (WHERE ship_to_city IS NOT DISTINCT FROM shipping_city) AS in_sync, count(*) AS orders FROM orders;'
    ], why: 'All 36 in sync. A plain RENAME is instant, but every running application server that still says shipping_city starts failing at that moment, and you cannot deploy all servers in the same millisecond. Expand/contract: (1) add ship_to_city; (2) deploy code that writes both columns; (3) backfill; (4) deploy code that reads ship_to_city; (5) deploy code that stops writing shipping_city; (6) drop shipping_city. Six boring steps, zero errors. (A trigger can do step 2 inside the database, Phase 7.)', expectOut: '\\b36 \\|\\s+36' },
    { pts: 2, q: 'A migration script with protection: set lock_timeout to 1 second, start a transaction and add a column to orders, while another session (A) holds a long transaction that read orders. What happens, and what state is the table in afterwards?', hint: 'The whole migration transaction is rolled back when the lock wait times out.', two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT count(*) FROM orders;'],
      ['B', "SET lock_timeout = '1s';"],
      ['B', 'BEGIN;'],
      ['B', 'ALTER TABLE orders ADD COLUMN priority int;'],
      ['wait', 'B'],
      ['B', 'ROLLBACK;'],
      ['A', 'COMMIT;'],
      ['B', "SELECT count(*) AS priority_columns FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'priority';"]
    ], why: 'The ALTER gives up after 1 second; the transaction rolls back and the table is untouched (0 columns): nothing half-applied, nobody blocked for more than a second. The deploy script retries a few times with a pause; if it keeps failing, someone looks at what holds the lock (Session 58 Q12). Never "fix" this by removing lock_timeout.', expectOut: 'canceling statement due to lock timeout[\\s\\S]*priority_columns\\n\\s+-+\\n\\s+0' },
    { pts: 2, q: 'CREATE INDEX CONCURRENTLY can fail and leave an <b>invalid</b> index behind. Make it fail on purpose: create a UNIQUE index concurrently on orders(customer_id) (customers have several orders), then look at pg_index.indisvalid.', hint: "SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indrelid = 'orders'::regclass", steps: [
      'CREATE UNIQUE INDEX CONCURRENTLY orders_one_per_customer ON orders (customer_id);',
      "SELECT indexrelid::regclass AS index_name, indisvalid FROM pg_index WHERE indrelid = 'orders'::regclass ORDER BY 1;",
      'DROP INDEX CONCURRENTLY orders_one_per_customer;'
    ], why: 'The build fails on a duplicate key, but the index stays in the catalog with indisvalid = f. It is not used for queries, yet every write still maintains it. After any failed concurrent build, drop the invalid index (DROP INDEX CONCURRENTLY) and retry. A monitoring query for <code>NOT indisvalid</code> catches the ones nobody noticed.', expectOut: 'could not create unique index "orders_one_per_customer"[\\s\\S]*orders_one_per_customer \\| f' }
  ],
  hard: {
    q: 'Make orders.shipping_city NOT NULL on a busy table. Order 24 has no shipping city; set it to \'Unknown\'. Then add the NOT NULL without a long blocking scan: a CHECK (shipping_city IS NOT NULL) NOT VALID, VALIDATE it, SET NOT NULL (which uses the valid check and skips the scan), and drop the now redundant check. Show attnotnull at the end.',
    hint: 'Five statements, each short. SET NOT NULL still takes ACCESS EXCLUSIVE, but only briefly when a valid CHECK proves the column has no NULLs.',
    steps: [
      "UPDATE orders SET shipping_city = 'Unknown' WHERE shipping_city IS NULL;",
      'ALTER TABLE orders ADD CONSTRAINT shipping_city_not_null CHECK (shipping_city IS NOT NULL) NOT VALID;',
      'ALTER TABLE orders VALIDATE CONSTRAINT shipping_city_not_null;',
      'ALTER TABLE orders ALTER COLUMN shipping_city SET NOT NULL;',
      'ALTER TABLE orders DROP CONSTRAINT shipping_city_not_null;',
      "SELECT attname, attnotnull FROM pg_attribute WHERE attrelid = 'orders'::regclass AND attname = 'shipping_city';"
    ],
    why: 'attnotnull = t. The only long step, VALIDATE, runs under SHARE UPDATE EXCLUSIVE (reads and writes continue); SET NOT NULL sees the validated CHECK and skips its own full-table scan, so its ACCESS EXCLUSIVE lock lasts milliseconds. In a real migration each statement is its own transaction with lock_timeout set, and the backfill (step 1) runs in batches. Postgres 18 can also add NOT NULL itself as NOT VALID (<code>ADD CONSTRAINT … NOT NULL shipping_city NOT VALID</code>); the CHECK recipe works on every version.',
    expectOut: 'UPDATE 1[\\s\\S]*shipping_city \\| t'
  }
};
