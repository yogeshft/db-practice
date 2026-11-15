export default {
  n: 55,
  phase: 'p6',
  title: 'Transactions and savepoints',
  goal: 'Group changes into all-or-nothing units, recover from errors inside a transaction with savepoints, and know what a rollback does and does not undo.',
  minutes: 150,
  lesson: [
    { h: 'Why transactions' },
    { p: 'Moving 1,000 from Aarav\'s wallet to Kabir\'s is two UPDATEs. If the server crashes, or the second UPDATE fails, between the two, money has disappeared. A <b>transaction</b> makes several statements one unit: either all of them take effect, or none do. This is the <b>A</b> (atomicity) in ACID; the others are <b>C</b>onsistency (constraints hold at commit), <b>I</b>solation (Session 57) and <b>D</b>urability (once COMMIT returns, the change survives a crash).' },
    { p: 'This phase uses three new tables: <code>accounts</code> (four wallets, 9,200 in total, with <code>CHECK (balance &gt;= 0)</code>), <code>jobs</code> (a work queue) and <code>table_bookings</code> (restaurant tables). <b>Reload practice.sql first.</b>' },
    { steps: [
      'BEGIN;',
      'UPDATE accounts SET balance = balance - 1000 WHERE account_id = 1;',
      'UPDATE accounts SET balance = balance + 1000 WHERE account_id = 3;',
      'COMMIT;',
      'SELECT account_id, owner, balance FROM accounts ORDER BY account_id;'
    ], expectOut: 'COMMIT[\\s\\S]*4000\\.00[\\s\\S]*1000\\.00' },
    { list: [
      'Outside BEGIN … COMMIT, every statement is its own transaction (<b>autocommit</b>). A single statement is always atomic: an UPDATE of 10,000 rows that fails on the last row changes nothing.',
      'The prompt shows the state: <code>practice=#</code> no transaction, <code>practice=*#</code> inside one, <code>practice=!#</code> inside a <b>failed</b> one.',
      'Until COMMIT, other sessions do not see your changes (Session 57). ROLLBACK throws them all away.'
    ] },
    { h: 'An error aborts the whole transaction' },
    { steps: [
      'BEGIN;',
      'UPDATE accounts SET balance = balance + 100 WHERE account_id = 2;',
      'UPDATE accounts SET balance = balance - 2000 WHERE account_id = 4;',
      'UPDATE accounts SET balance = balance + 50 WHERE account_id = 1;',
      'COMMIT;',
      'SELECT account_id, balance FROM accounts WHERE account_id IN (2, 4) ORDER BY account_id;'
    ], expectOut: 'violates check constraint "accounts_balance_check"[\\s\\S]*current transaction is aborted[\\s\\S]*ROLLBACK' },
    { p: 'After an error, Postgres refuses every further statement until the transaction ends, and <code>COMMIT</code> on a failed transaction quietly answers <b>ROLLBACK</b>. Application code that ignores the reply to COMMIT believes it saved data it did not save. Even the first, successful UPDATE (+100 for Diya) is gone.' },
    { h: 'Savepoints: undo part of a transaction' },
    { steps: [
      'BEGIN;',
      "INSERT INTO table_bookings VALUES (6, 2, '2026-02-20 20:00+05:30', 'Saanvi', 2);",
      'SAVEPOINT before_second;',
      "INSERT INTO table_bookings VALUES (7, 1, '2026-02-20 19:00+05:30', 'Vivaan', 2);",
      'ROLLBACK TO SAVEPOINT before_second;',
      "INSERT INTO table_bookings VALUES (7, 3, '2026-02-20 19:00+05:30', 'Vivaan', 2);",
      'COMMIT;',
      'SELECT booking_id, table_no, guest FROM table_bookings WHERE booking_id >= 6 ORDER BY booking_id;'
    ], expectOut: 'duplicate key value violates unique constraint "table_bookings_table_no_slot_key"[\\s\\S]*ROLLBACK[\\s\\S]*COMMIT[\\s\\S]*\\(2 rows\\)' },
    { list: [
      '<code>SAVEPOINT name</code> marks a point; <code>ROLLBACK TO SAVEPOINT name</code> undoes everything after it, including an error, and the transaction can continue. The savepoint stays defined; <code>RELEASE SAVEPOINT name</code> forgets it.',
      'psql can do this for you: <code>\\set ON_ERROR_ROLLBACK interactive</code> (Session 1) wraps every statement you type in an invisible savepoint, so a typo does not ruin a long manual transaction.',
      'Savepoints are not free: each one is a subtransaction. Thousands of them in one transaction slow Postgres down (Phase 8). Use them around risky steps, not around every row.'
    ] },
    { h: 'What ROLLBACK does not undo' },
    { list: [
      '<b>Sequences</b>: <code>nextval()</code> is never rolled back, so identity and serial columns get gaps (Session 40).',
      'Anything outside the database: an email you sent or an HTTP call you made from the application before the rollback.',
      'Almost all <b>DDL is transactional</b> in Postgres: CREATE TABLE, ALTER TABLE, CREATE INDEX roll back like data. Exceptions: <code>CREATE DATABASE</code>, <code>VACUUM</code>, <code>CREATE INDEX CONCURRENTLY</code> cannot run inside a transaction at all.'
    ] },
    { h: 'Time inside a transaction' },
    { p: '<code>now()</code> (= <code>transaction_timestamp()</code>) is frozen at the start of the transaction, so every row written by one transaction gets the same timestamp. <code>clock_timestamp()</code> is the real wall clock and changes during a statement. <code>statement_timestamp()</code> is the start of the current statement.' },
    { h: 'When constraints are checked' },
    { p: 'Normally every constraint is checked as each row is changed (UNIQUE: at the end of the statement only if the constraint is DEFERRABLE). A constraint declared <code>DEFERRABLE INITIALLY DEFERRED</code>, or switched with <code>SET CONSTRAINTS … DEFERRED</code>, is checked at COMMIT instead. That lets a transaction pass through a temporarily invalid state, such as swapping two unique values or inserting rows that reference each other.' },
    { tip: 'Keep transactions <b>short</b>. A transaction holds its locks until it ends (Session 58), and an open transaction stops VACUUM from cleaning up after it (Phase 8). Never wait for user input, an HTTP call or a sleep inside one.' }
  ],
  questions: [
    { pts: 1, q: 'Move 500 from Diya (account 2) to Kabir (account 3) as one transaction, then show every account\'s balance and the total.', hint: 'BEGIN; two UPDATEs; COMMIT; then SELECT.', steps: [
      'BEGIN;',
      'UPDATE accounts SET balance = balance - 500 WHERE account_id = 2;',
      'UPDATE accounts SET balance = balance + 500 WHERE account_id = 3;',
      'COMMIT;',
      'SELECT account_id, balance, sum(balance) OVER () AS total FROM accounts ORDER BY account_id;'
    ], why: 'Diya 2,500, Kabir 500, total still 9,200. The total is the invariant to check after any money movement: if it changes, a transfer was half-done.', expectOut: '9200\\.00' },
    { pts: 1, q: 'Try to move 6,000 from Aarav (balance 5,000) to Kabir in a transaction. Debit first. What happens, and what is left afterwards?', hint: 'The CHECK constraint fires on the debit.', steps: [
      'BEGIN;',
      'UPDATE accounts SET balance = balance - 6000 WHERE account_id = 1;',
      'UPDATE accounts SET balance = balance + 6000 WHERE account_id = 3;',
      'ROLLBACK;',
      'SELECT account_id, balance FROM accounts WHERE account_id IN (1, 3) ORDER BY account_id;'
    ], why: 'The debit violates <code>CHECK (balance &gt;= 0)</code>, the transaction is aborted, the credit is refused and ROLLBACK ends it. Nothing changed. A constraint in the database is the last line of defence when application code forgets to check the balance.', expectOut: 'violates check constraint[\\s\\S]*5000\\.00' },
    { pts: 1, q: 'Inside a transaction, cause an error (divide by zero), then try to read the accounts. What does Postgres answer, and how do you get out?', hint: 'SELECT 1/0; then SELECT … FROM accounts;', steps: [
      'BEGIN;',
      'SELECT 1 / 0;',
      'SELECT count(*) FROM accounts;',
      'ROLLBACK;',
      'SELECT count(*) FROM accounts;'
    ], why: '"current transaction is aborted, commands ignored until end of transaction block". Only ROLLBACK (or ROLLBACK TO SAVEPOINT) gets you out. Some databases continue after an error; Postgres deliberately does not, so a half-failed unit of work cannot be committed by accident.', expectOut: 'division by zero[\\s\\S]*current transaction is aborted' },
    { pts: 1, q: 'In one transaction, queue three jobs (ids 11, 12, 13, kind send_email, run_after now()). The second insert accidentally reuses id 11. Use a savepoint so that the first and third jobs still get saved, then count the queued jobs.', hint: 'SAVEPOINT before the risky insert; ROLLBACK TO SAVEPOINT after the error.', steps: [
      'BEGIN;',
      "INSERT INTO jobs (job_id, kind, run_after) VALUES (11, 'send_email', now());",
      'SAVEPOINT s1;',
      "INSERT INTO jobs (job_id, kind, run_after) VALUES (11, 'send_email', now());",
      'ROLLBACK TO SAVEPOINT s1;',
      "INSERT INTO jobs (job_id, kind, run_after) VALUES (13, 'send_email', now());",
      'COMMIT;',
      "SELECT count(*) AS queued FROM jobs WHERE status = 'queued';"
    ], why: '8 queued jobs: the 6 that were there (job 8, scheduled for 2099, counts too), plus 11 and 13. ROLLBACK TO SAVEPOINT undid only the failed insert, and the transaction carried on as if it had never happened.', expectOut: 'duplicate key[\\s\\S]*ROLLBACK[\\s\\S]*COMMIT[\\s\\S]*\\b8\\b' },
    { pts: 1, q: 'Show that now() is frozen inside a transaction while clock_timestamp() moves: start a transaction, store now() in a temp table, sleep 0.2 seconds, then compare.', hint: 'CREATE TEMP TABLE t AS SELECT now() AS started; SELECT pg_sleep(0.2);', steps: [
      'BEGIN;',
      'CREATE TEMP TABLE t AS SELECT now() AS started;',
      'SELECT pg_sleep(0.2);',
      'SELECT now() = started AS now_unchanged, clock_timestamp() > started AS clock_moved FROM t;',
      'COMMIT;'
    ], why: 't and t. Every row inserted by one transaction gets the same now(), which is usually what you want for created_at. For measuring durations inside a transaction, use clock_timestamp().', expectOut: '\\bt\\s+\\|\\s+t\\b' },
    { pts: 1, q: 'Show that DDL is transactional: in a transaction, create a table promo_codes, insert a row, roll back, then try to read it.', hint: 'BEGIN; CREATE TABLE …; INSERT …; ROLLBACK; SELECT …', steps: [
      'BEGIN;',
      'CREATE TABLE promo_codes (code text PRIMARY KEY);',
      "INSERT INTO promo_codes VALUES ('FEST20');",
      'ROLLBACK;',
      'SELECT * FROM promo_codes;'
    ], why: '"relation promo_codes does not exist": the CREATE TABLE was rolled back with the data. That is why Postgres migrations can run inside one transaction and leave nothing half-applied when a step fails (Session 61). MySQL and Oracle commit DDL implicitly.', expectOut: 'relation "promo_codes" does not exist' },
    { pts: 1, q: 'Show that a sequence is not rolled back: create a sequence demo_seq, take a value inside a transaction that you roll back, then take another value.', hint: "nextval('demo_seq') twice, with a ROLLBACK in between.", steps: [
      'CREATE SEQUENCE demo_seq;',
      'BEGIN;',
      "SELECT nextval('demo_seq');",
      'ROLLBACK;',
      "SELECT nextval('demo_seq');"
    ], why: 'The second call returns 2. Sequences never go back, so that many concurrent transactions can take numbers without waiting for each other. Ids therefore have gaps; never use them to count rows or as invoice numbers that must be gapless.', expectOut: 'nextval[\\s\\S]*\\b1\\b[\\s\\S]*ROLLBACK[\\s\\S]*\\b2\\b' },
    { pts: 1, q: 'Move 700 from Aarav (1) to Ananya (4) in a <b>single</b> UPDATE statement (no BEGIN). Return account_id and the new balance.', hint: 'UPDATE … SET balance = balance + CASE account_id WHEN 1 THEN -700 WHEN 4 THEN 700 END WHERE account_id IN (1, 4) RETURNING …', sql: 'UPDATE accounts\nSET balance = balance + CASE account_id WHEN 1 THEN -700 WHEN 4 THEN 700 END\nWHERE account_id IN (1, 4)\nRETURNING account_id, balance;', why: 'One statement is one transaction: both rows change or neither does. When a change fits in one statement, you get atomicity without BEGIN.', expectRows: 2 },
    { pts: 2, q: 'Swap the positions of two queue entries. Create table queue_slots (job_id int primary key, pos int UNIQUE) and table queue_slots_d (same, but the UNIQUE is <code>DEFERRABLE</code>), each with rows (4, 1) and (5, 2). Run <code>UPDATE … SET pos = 3 - pos</code> on both.', hint: 'UNIQUE (pos) vs UNIQUE (pos) DEFERRABLE', steps: [
      'CREATE TABLE queue_slots   (job_id int PRIMARY KEY, pos int UNIQUE);',
      'CREATE TABLE queue_slots_d (job_id int PRIMARY KEY, pos int UNIQUE DEFERRABLE);',
      'INSERT INTO queue_slots   VALUES (4, 1), (5, 2);',
      'INSERT INTO queue_slots_d VALUES (4, 1), (5, 2);',
      'UPDATE queue_slots   SET pos = 3 - pos;',
      'UPDATE queue_slots_d SET pos = 3 - pos;',
      'SELECT * FROM queue_slots_d ORDER BY pos;'
    ], why: 'The plain UNIQUE fails: Postgres checks it row by row, and after the first row is changed two rows briefly have pos 2. A DEFERRABLE unique constraint is checked at the end of the statement (and with SET CONSTRAINTS … DEFERRED, at COMMIT), when the swap is complete. A Postgres quirk worth knowing; the SQL standard says statement-end for all.', expectOut: 'duplicate key value violates unique constraint "queue_slots_pos_key"[\\s\\S]*UPDATE 2' },
    { pts: 2, q: 'Import three bookings in one transaction, giving each its own savepoint so that a bad row is skipped instead of failing the batch: (6, table 2, 20:00, Saanvi), (7, table 1, 19:00, Vivaan, which is taken), (8, table 3, 19:00, Myra), all on 20 Feb 2026, party size 2. Then count the bookings.', hint: 'SAVEPOINT b; INSERT …; RELEASE or ROLLBACK TO for each row.', steps: [
      'BEGIN;',
      'SAVEPOINT b;',
      "INSERT INTO table_bookings VALUES (6, 2, '2026-02-20 20:00+05:30', 'Saanvi', 2);",
      'RELEASE SAVEPOINT b;',
      'SAVEPOINT b;',
      "INSERT INTO table_bookings VALUES (7, 1, '2026-02-20 19:00+05:30', 'Vivaan', 2);",
      'ROLLBACK TO SAVEPOINT b;',
      'SAVEPOINT b;',
      "INSERT INTO table_bookings VALUES (8, 3, '2026-02-20 19:00+05:30', 'Myra', 2);",
      'RELEASE SAVEPOINT b;',
      'COMMIT;',
      'SELECT count(*) FROM table_bookings;'
    ], why: '7 bookings: the 5 existing ones plus Saanvi and Myra. This is how import scripts and ORMs ("nested transactions") skip bad rows. For many rows, prefer INSERT … ON CONFLICT DO NOTHING (Session 40): one statement, no subtransactions.', expectOut: 'duplicate key[\\s\\S]*COMMIT[\\s\\S]*\\b7\\b' },
    { pts: 2, q: 'Transfer 2,000 from Ananya (balance 1,200) to Kabir in one statement that moves nothing, without any error, when the balance is too low. Return the credited rows.', hint: 'WITH debit AS (UPDATE … WHERE account_id = 4 AND balance >= 2000 RETURNING …) UPDATE … WHERE … AND EXISTS (SELECT 1 FROM debit)', sql: 'WITH debit AS (\n  UPDATE accounts SET balance = balance - 2000\n  WHERE account_id = 4 AND balance >= 2000\n  RETURNING account_id\n)\nUPDATE accounts SET balance = balance + 2000\nWHERE account_id = 3 AND EXISTS (SELECT 1 FROM debit)\nRETURNING account_id, balance;', why: '0 rows: the debit found no row with enough money, so the credit had nothing to depend on. The application checks "rows returned = 1" instead of catching an exception. Both strategies are fine; the CHECK constraint stays as the safety net either way.', expectRows: 0 },
    { pts: 2, q: 'Nested savepoints: in a transaction, set Kabir\'s balance to 1 after savepoint a, set it to 2 after savepoint b, then ROLLBACK TO SAVEPOINT a and read the balance. Commit and read it again.', hint: 'SAVEPOINT a; UPDATE …; SAVEPOINT b; UPDATE …; ROLLBACK TO SAVEPOINT a;', steps: [
      'BEGIN;',
      'SAVEPOINT a;',
      'UPDATE accounts SET balance = 1 WHERE account_id = 3;',
      'SAVEPOINT b;',
      'UPDATE accounts SET balance = 2 WHERE account_id = 3;',
      'ROLLBACK TO SAVEPOINT a;',
      'SELECT balance FROM accounts WHERE account_id = 3;',
      'COMMIT;',
      'SELECT balance FROM accounts WHERE account_id = 3;'
    ], why: '0.00 both times. Rolling back to a undoes everything after it, including savepoint b and its change. Savepoints nest like a stack.', expectOut: 'ROLLBACK[\\s\\S]*0\\.00[\\s\\S]*COMMIT[\\s\\S]*0\\.00' },
    { pts: 2, q: 'The silent-commit trap: in a transaction, queue job 11, then try to queue job 4 (it exists), then COMMIT. What does COMMIT answer, and is job 11 there?', hint: 'Look at the word printed after COMMIT.', steps: [
      'BEGIN;',
      "INSERT INTO jobs (job_id, kind, run_after) VALUES (11, 'send_email', now());",
      "INSERT INTO jobs (job_id, kind, run_after) VALUES (4, 'send_email', now());",
      'COMMIT;',
      'SELECT count(*) FROM jobs WHERE job_id = 11;'
    ], why: 'COMMIT answers <b>ROLLBACK</b> and job 11 is not there. Drivers report this differently: some raise an error, some just return the "ROLLBACK" tag. Always check that the commit really committed, and treat any error inside a transaction as "the whole transaction is gone".', expectOut: 'COMMIT;\\nROLLBACK[\\s\\S]*\\b0\\b' },
    { pts: 2, q: 'Without BEGIN, run <code>UPDATE accounts SET balance = balance - 1500</code> (everyone pays 1,500). Then list the balances.', hint: 'Kabir and Ananya cannot pay.', steps: [
      'UPDATE accounts SET balance = balance - 1500;',
      'SELECT account_id, balance FROM accounts ORDER BY account_id;'
    ], why: 'The UPDATE fails on Kabir\'s row, and <b>no</b> row changed, not even Aarav\'s and Diya\'s, which were processed before. A single statement is atomic. Bulk fixes that may fail halfway are safe to retry.', expectOut: 'violates check constraint[\\s\\S]*5000\\.00[\\s\\S]*3000\\.00' }
  ],
  hard: {
    q: 'Build an audited transfer. Create table transfers (transfer_id int generated always as identity primary key, from_id int, to_id int, amount numeric(12,2) check (amount &gt; 0), at timestamptz default now()). In one transaction move 1,500 from Aarav to Ananya: insert the transfer row, debit, credit, and before committing check in the same transaction that the total is still 9,200. Then show the transfer row and the two balances.',
    hint: 'All five statements inside BEGIN … COMMIT. The invariant query sees the transaction\'s own uncommitted changes.',
    steps: [
      'CREATE TABLE transfers (transfer_id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, from_id int NOT NULL, to_id int NOT NULL, amount numeric(12,2) NOT NULL CHECK (amount > 0), at timestamptz NOT NULL DEFAULT now());',
      'BEGIN;',
      'INSERT INTO transfers (from_id, to_id, amount) VALUES (1, 4, 1500);',
      'UPDATE accounts SET balance = balance - 1500 WHERE account_id = 1;',
      'UPDATE accounts SET balance = balance + 1500 WHERE account_id = 4;',
      'SELECT sum(balance) AS total FROM accounts;',
      'COMMIT;',
      'SELECT t.transfer_id, t.amount, f.balance AS from_balance, d.balance AS to_balance\nFROM transfers t\nJOIN accounts f ON f.account_id = t.from_id\nJOIN accounts d ON d.account_id = t.to_id;'
    ],
    why: 'The ledger row and the two balance changes commit together or not at all, so the audit log can never disagree with the balances. Inside the transaction you see your own uncommitted changes (total still 9,200); other sessions see nothing until COMMIT. In Phase 7 this becomes a function, and the invariant becomes a check the database runs for you.',
    expectOut: '9200\\.00[\\s\\S]*COMMIT[\\s\\S]*3500\\.00 \\|\\s+2700\\.00'
  }
};
