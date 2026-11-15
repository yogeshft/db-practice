const doctors = "CREATE TABLE on_call (doctor text PRIMARY KEY, on_duty boolean NOT NULL);\nINSERT INTO on_call VALUES ('Asha', true), ('Rahul', true);";
const bal = 'SELECT balance FROM accounts WHERE account_id = 1;';

export default {
  n: 57,
  phase: 'p6',
  title: 'Isolation levels and anomalies',
  goal: 'Know exactly what one transaction can see of another at each isolation level, recognise lost updates and write skew, and handle serialization failures with retries.',
  minutes: 150,
  lesson: [
    { h: 'Two terminals' },
    { p: 'Everything in this session needs <b>two psql windows</b> on the practice database, called A and B. Run the statements in the order shown. In the transcripts, B\'s output is indented, and <code>⏳</code> marks a statement that waits for the other terminal.' },
    { h: 'READ COMMITTED: the default' },
    { p: 'Each <b>statement</b> sees the data committed before that statement started. Two SELECTs in the same transaction can therefore see different values:' },
    { two: [
      ['A', 'BEGIN;'], ['A', bal],
      ['B', 'UPDATE accounts SET balance = balance + 100 WHERE account_id = 1;'],
      ['A', bal], ['A', 'COMMIT;']
    ], expectOut: '5000\\.00[\\s\\S]*UPDATE 1[\\s\\S]*5100\\.00' },
    { p: 'This is a <b>non-repeatable read</b>. Postgres never shows you uncommitted data (a <b>dirty read</b>), not even at READ UNCOMMITTED, which Postgres treats as READ COMMITTED.' },
    { h: 'REPEATABLE READ: one snapshot for the whole transaction' },
    { two: [
      ['A', 'BEGIN ISOLATION LEVEL REPEATABLE READ;'], ['A', bal],
      ['B', 'UPDATE accounts SET balance = balance + 100 WHERE account_id = 1;'],
      ['A', bal], ['A', 'COMMIT;'], ['A', bal]
    ], expectOut: '5000\\.00[\\s\\S]*UPDATE 1[\\s\\S]*5000\\.00[\\s\\S]*COMMIT[\\s\\S]*5100\\.00' },
    { p: 'The snapshot is taken at the first statement, not at BEGIN. Every later read in the transaction sees the database as of that moment: no non-repeatable reads, and (in Postgres, stronger than the standard requires) no <b>phantoms</b> either. Perfect for reports that run several queries and must add up.' },
    { pre: 'Level            dirty read   non-repeatable read   phantom   lost update   write skew\n---------------  -----------  --------------------  --------  ------------  ----------\nREAD COMMITTED   no           possible              possible  possible*     possible\nREPEATABLE READ  no           no                    no        error 40001   possible\nSERIALIZABLE     no           no                    no        error 40001   error 40001\n\n* with read-then-write in the application; UPDATE … SET x = x - 1 is safe (below)', lang: 'text' },
    { h: 'The lost update' },
    { p: 'The classic bug: the application reads a value, computes a new one, and writes it back. Two of these at once and one change is lost:' },
    { two: [
      ['A', 'BEGIN;'], ['A', bal],
      ['B', 'BEGIN;'], ['B', bal],
      ['--', 'both apps compute 5000 - 100 = 4900 and 5000 - 200 = 4800'],
      ['A', 'UPDATE accounts SET balance = 4900 WHERE account_id = 1;'],
      ['A', 'COMMIT;'],
      ['B', 'UPDATE accounts SET balance = 4800 WHERE account_id = 1;'],
      ['B', 'COMMIT;'],
      ['A', bal]
    ], expectOut: '4800\\.00\\n\\(1 row\\)$' },
    { p: 'Two withdrawals of 100 and 200 should leave 4,700. The result is 4,800: A\'s withdrawal vanished. Fixes, from simplest: let the database do the arithmetic (<code>SET balance = balance - 100</code>, Q4), lock the row when reading it (<code>SELECT … FOR UPDATE</code>, Session 58), or use REPEATABLE READ and retry on conflict (Q5).' },
    { h: 'How READ COMMITTED handles concurrent UPDATEs' },
    { p: 'When an UPDATE in READ COMMITTED finds a row that another transaction is changing, it <b>waits</b> for that transaction to finish, then re-reads the new version of the row, <b>re-checks its WHERE clause</b>, and applies its change to the new version. That is why <code>balance = balance - 100</code> never loses an update, and why a WHERE condition can stop matching while you wait (Q6).' },
    { h: 'Write skew and SERIALIZABLE' },
    { p: 'Two doctors are on call, and the rule is "at least one must stay on call". Each checks the rule, sees two on duty, and goes off duty. Neither transaction changed a row the other changed, so REPEATABLE READ sees no conflict, and the rule is broken. SERIALIZABLE tracks what each transaction <i>read</i> and aborts one of them:' },
    { two: [
      ['A', 'BEGIN ISOLATION LEVEL SERIALIZABLE;'],
      ['A', 'SELECT count(*) FROM on_call WHERE on_duty;'],
      ['B', 'BEGIN ISOLATION LEVEL SERIALIZABLE;'],
      ['B', 'SELECT count(*) FROM on_call WHERE on_duty;'],
      ['A', "UPDATE on_call SET on_duty = false WHERE doctor = 'Asha';"],
      ['B', "UPDATE on_call SET on_duty = false WHERE doctor = 'Rahul';"],
      ['A', 'COMMIT;'],
      ['B', 'COMMIT;'],
      ['A', 'SELECT * FROM on_call ORDER BY doctor;']
    ], setup: doctors, expectOut: 'could not serialize access due to read/write dependencies among transactions[\\s\\S]*Rahul\\s+\\| t' },
    { list: [
      'SERIALIZABLE guarantees that the result is the same as if the transactions had run one after the other, in some order. You write each transaction as if it ran alone.',
      'The price: any transaction may fail with SQLSTATE <b>40001</b> (serialization_failure), sometimes at COMMIT. The application must <b>retry the whole transaction</b> from the start. Not retrying is the most common bug with SERIALIZABLE.',
      'REPEATABLE READ can fail with 40001 too ("could not serialize access due to concurrent update") when it tries to change a row that changed after its snapshot.',
      'Deadlocks (40P01, Session 58) also need a retry. Write one retry loop for both.'
    ] },
    { pre: 'retry loop (any language)\n\n  for attempt in 1..5:\n      BEGIN ISOLATION LEVEL SERIALIZABLE\n      … all reads and writes …\n      COMMIT\n      success → stop\n      error 40001 or 40P01 → ROLLBACK, wait a little (random backoff), try again\n      any other error → ROLLBACK, give up', lang: 'text' },
    { tip: 'Choosing: READ COMMITTED + atomic UPDATEs + row locks covers most OLTP code. REPEATABLE READ for reports and exports that must be consistent across queries. SERIALIZABLE when correctness depends on reading several rows and the rules are too complex for constraints and locks (and you have the retry loop). <code>SET default_transaction_isolation</code> changes the default per role or database.' }
  ],
  questions: [
    { pts: 1, q: 'Which isolation level is your session using? Show it, then show it again inside a transaction started with BEGIN ISOLATION LEVEL REPEATABLE READ.', hint: 'SHOW transaction_isolation;', steps: [
      'SHOW transaction_isolation;',
      'BEGIN ISOLATION LEVEL REPEATABLE READ;',
      'SHOW transaction_isolation;',
      'COMMIT;'
    ], why: 'read committed by default; the level applies to one transaction. <code>SET TRANSACTION ISOLATION LEVEL …</code> as the first statement after BEGIN does the same.', expectOut: 'read committed[\\s\\S]*repeatable read' },
    { pts: 1, q: 'Dirty reads do not exist in Postgres. A changes Kabir\'s balance to 999 without committing; B starts a READ UNCOMMITTED transaction and reads it. Then A rolls back.', hint: 'BEGIN ISOLATION LEVEL READ UNCOMMITTED; in B.', two: [
      ['A', 'BEGIN;'],
      ['A', 'UPDATE accounts SET balance = 999 WHERE account_id = 3;'],
      ['B', 'BEGIN ISOLATION LEVEL READ UNCOMMITTED;'],
      ['B', 'SELECT balance FROM accounts WHERE account_id = 3;'],
      ['B', 'COMMIT;'],
      ['A', 'ROLLBACK;']
    ], why: 'B sees 0.00. Postgres accepts READ UNCOMMITTED but runs it as READ COMMITTED: uncommitted data is never visible to anyone else. Note that B did not wait: readers never block writers and writers never block readers (MVCC, Phase 8).', expectOut: '0\\.00' },
    { pts: 1, q: 'A phantom in READ COMMITTED: A counts the bookings for 20 Feb 19:00 twice in one transaction; between the two counts, B books table 4 for that slot.', hint: "count(*) … WHERE slot = '2026-02-20 19:00+05:30'", two: [
      ['A', 'BEGIN;'],
      ['A', "SELECT count(*) FROM table_bookings WHERE slot = '2026-02-20 19:00+05:30';"],
      ['B', "INSERT INTO table_bookings VALUES (6, 4, '2026-02-20 19:00+05:30', 'Myra', 2);"],
      ['A', "SELECT count(*) FROM table_bookings WHERE slot = '2026-02-20 19:00+05:30';"],
      ['A', 'COMMIT;']
    ], why: '2, then 3: a new row appeared inside A\'s transaction. A report that counts first and then lists the rows can disagree with itself.', expectOut: '\\b2\\b[\\s\\S]*INSERT 0 1[\\s\\S]*\\b3\\b' },
    { pts: 1, q: 'Fix the lost update from the lesson: A and B both withdraw (100 and 200) from Aarav with <code>SET balance = balance - …</code> in their own transactions. What happens to B, and what is the final balance?', hint: 'B\'s UPDATE waits for A.', two: [
      ['A', 'BEGIN;'],
      ['A', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;'],
      ['B', 'BEGIN;'],
      ['B', 'UPDATE accounts SET balance = balance - 200 WHERE account_id = 1;'],
      ['A', 'COMMIT;'],
      ['B', 'COMMIT;'],
      ['A', bal]
    ], why: 'B waits until A commits, re-reads the row (4,900) and subtracts 200: 4,700. Correct, with no extra code. Whenever the change can be written as an expression of the current value, write it that way.', expectOut: 'blocked[\\s\\S]*UPDATE 1[\\s\\S]*4700\\.00' },
    { pts: 1, q: 'The lost update under REPEATABLE READ: A reads Aarav\'s balance in a REPEATABLE READ transaction, B withdraws 100 and commits, then A tries to withdraw 200.', hint: 'A: BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT …; later UPDATE …', two: [
      ['A', 'BEGIN ISOLATION LEVEL REPEATABLE READ;'],
      ['A', bal],
      ['B', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;'],
      ['A', 'UPDATE accounts SET balance = balance - 200 WHERE account_id = 1;'],
      ['A', 'ROLLBACK;']
    ], why: '"could not serialize access due to concurrent update" (40001). A\'s snapshot says 5,000, but the row changed after it was taken, and silently applying 5,000 − 200 would lose B\'s change. Postgres refuses; the application retries the whole transaction, which then sees 4,900.', expectOut: 'could not serialize access due to concurrent update' },
    { pts: 1, q: 'READ COMMITTED re-checks the WHERE clause after waiting. A and B each withdraw 4,000 from Aarav, but only "if balance &gt;= 4000", written in the UPDATE\'s WHERE. How many rows does B update?', hint: 'WHERE account_id = 1 AND balance >= 4000', two: [
      ['A', 'BEGIN;'],
      ['A', 'UPDATE accounts SET balance = balance - 4000 WHERE account_id = 1 AND balance >= 4000;'],
      ['B', 'UPDATE accounts SET balance = balance - 4000 WHERE account_id = 1 AND balance >= 4000;'],
      ['A', 'COMMIT;'],
      ['A', bal]
    ], why: 'B waits, then finds the new version (1,000), re-evaluates <code>balance &gt;= 4000</code> as false, and reports <b>UPDATE 0</b>. The balance is 1,000, never negative. "Check and change in one UPDATE, then look at the row count" is a race-free pattern in READ COMMITTED.', expectOut: 'UPDATE 0[\\s\\S]*1000\\.00' },
    { pts: 1, q: 'A consistent report: in one REPEATABLE READ transaction, A reads the total balance, B moves 1,000 from Aarav to Kabir (one statement), then A lists every balance and the total again. Does A\'s report add up?', hint: 'Two SELECTs in A, a single UPDATE in B.', two: [
      ['A', 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'],
      ['A', 'SELECT sum(balance) FROM accounts;'],
      ['B', 'UPDATE accounts SET balance = balance + CASE account_id WHEN 1 THEN -1000 ELSE 1000 END WHERE account_id IN (1, 3);'],
      ['A', 'SELECT account_id, balance FROM accounts ORDER BY account_id;'],
      ['A', 'COMMIT;']
    ], why: 'Yes: A sees Aarav 5,000 and Kabir 0 in both queries, a consistent picture as of its snapshot. Under READ COMMITTED the list would show the new balances while the earlier total was from before; here it does not matter, but with a non-atomic transfer it could. READ ONLY tells Postgres the transaction will not write, which also lets SERIALIZABLE READ ONLY DEFERRABLE skip all conflict tracking.', expectOut: 'UPDATE 2[\\s\\S]*5000\\.00[\\s\\S]*0\\.00' },
    { pts: 1, q: 'Write skew without SERIALIZABLE: replay the on-call example at REPEATABLE READ. (Create the on_call table first: doctors Asha and Rahul, both on duty.)', hint: "CREATE TABLE on_call (doctor text PRIMARY KEY, on_duty boolean NOT NULL); INSERT … ('Asha', true), ('Rahul', true);", two: [
      ['A', 'BEGIN ISOLATION LEVEL REPEATABLE READ;'],
      ['A', 'SELECT count(*) FROM on_call WHERE on_duty;'],
      ['B', 'BEGIN ISOLATION LEVEL REPEATABLE READ;'],
      ['B', 'SELECT count(*) FROM on_call WHERE on_duty;'],
      ['A', "UPDATE on_call SET on_duty = false WHERE doctor = 'Asha';"],
      ['B', "UPDATE on_call SET on_duty = false WHERE doctor = 'Rahul';"],
      ['A', 'COMMIT;'],
      ['B', 'COMMIT;'],
      ['A', 'SELECT count(*) AS still_on_duty FROM on_call WHERE on_duty;']
    ], setup: doctors, why: '0 doctors on call. Both commits succeed, because each transaction changed a different row; their snapshots each showed two doctors. Repeatable read prevents conflicting writes to the same row, not decisions based on rows someone else changes.', expectOut: 'COMMIT[\\s\\S]*COMMIT[\\s\\S]*\\b0\\b' },
    { pts: 2, q: 'Run the lesson\'s write-skew example at SERIALIZABLE, but let B commit first. Which transaction fails now?', hint: 'Swap the order of the two COMMITs.', two: [
      ['A', 'BEGIN ISOLATION LEVEL SERIALIZABLE;'],
      ['A', 'SELECT count(*) FROM on_call WHERE on_duty;'],
      ['B', 'BEGIN ISOLATION LEVEL SERIALIZABLE;'],
      ['B', 'SELECT count(*) FROM on_call WHERE on_duty;'],
      ['A', "UPDATE on_call SET on_duty = false WHERE doctor = 'Asha';"],
      ['B', "UPDATE on_call SET on_duty = false WHERE doctor = 'Rahul';"],
      ['B', 'COMMIT;'],
      ['A', 'COMMIT;'],
      ['A', 'SELECT * FROM on_call ORDER BY doctor;']
    ], setup: doctors, why: 'A fails at COMMIT this time: the first committer wins, the other gets 40001. Which one fails is not something you choose, so every SERIALIZABLE transaction needs the retry loop. A retry of A would see one doctor on duty and refuse to go off duty.', expectOut: 'B=\\*# COMMIT;\\n\\s+COMMIT[\\s\\S]*A=\\*# COMMIT;\\nERROR:  could not serialize access' },
    { pts: 2, q: 'Prevent the write skew without SERIALIZABLE: at READ COMMITTED, lock both on-call rows when reading them (<code>FOR UPDATE</code>), then let each doctor go off duty only if the count is still 2.', hint: 'SELECT … FOR UPDATE makes the second transaction wait; after waiting it sees the new data.', two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT doctor FROM on_call WHERE on_duty FOR UPDATE;'],
      ['B', 'BEGIN;'],
      ['B', 'SELECT doctor FROM on_call WHERE on_duty FOR UPDATE;'],
      ['A', "UPDATE on_call SET on_duty = false WHERE doctor = 'Asha';"],
      ['A', 'COMMIT;'],
      ['B', 'COMMIT;'],
      ['A', 'SELECT count(*) AS still_on_duty FROM on_call WHERE on_duty;']
    ], setup: doctors, why: 'B\'s SELECT … FOR UPDATE waits for A. When A commits, B\'s query re-checks the rows and returns only Rahul: B now knows it is the last doctor and does not go off duty. Explicit locks turn "read, decide, write" into a queue. Session 58 covers row locks in depth.', expectOut: 'blocked[\\s\\S]*finishes[\\s\\S]*Rahul\\n\\s+\\(1 row\\)[\\s\\S]*\\b1\\b' },
    { pts: 2, q: 'An insert race at SERIALIZABLE: A and B both want to book <b>any free table</b> for Saanvi at 21:00. Each checks how many bookings Saanvi already has that evening (0), then books a different table. Show what happens.', hint: "Each: SELECT count(*) … WHERE guest = 'Saanvi'; then INSERT a booking.", two: [
      ['A', 'BEGIN ISOLATION LEVEL SERIALIZABLE;'],
      ['A', "SELECT count(*) FROM table_bookings WHERE guest = 'Saanvi';"],
      ['B', 'BEGIN ISOLATION LEVEL SERIALIZABLE;'],
      ['B', "SELECT count(*) FROM table_bookings WHERE guest = 'Saanvi';"],
      ['A', "INSERT INTO table_bookings VALUES (6, 1, '2026-02-20 21:00+05:30', 'Saanvi', 2);"],
      ['B', "INSERT INTO table_bookings VALUES (7, 2, '2026-02-20 21:00+05:30', 'Saanvi', 2);"],
      ['A', 'COMMIT;'],
      ['B', 'COMMIT;'],
      ['A', "SELECT booking_id, table_no FROM table_bookings WHERE guest = 'Saanvi';"]
    ], why: 'B fails with a serialization error; Saanvi has one booking. No UNIQUE constraint could express "one booking per guest per evening" across different tables here, yet SERIALIZABLE caught the race, because each transaction read data ("no bookings for Saanvi") that the other then changed. (A unique index on (guest, evening) would also work, if the rule can be written as one.)', expectOut: 'could not serialize access[\\s\\S]*\\(1 row\\)' },
    { pts: 2, q: 'REPEATABLE READ snapshots start at the first query, not at BEGIN. A begins a REPEATABLE READ transaction but does not query yet; B adds 100 to Aarav; then A reads.', hint: 'Compare with the lesson, where A read before B\'s update.', two: [
      ['A', 'BEGIN ISOLATION LEVEL REPEATABLE READ;'],
      ['B', 'UPDATE accounts SET balance = balance + 100 WHERE account_id = 1;'],
      ['A', bal],
      ['A', 'COMMIT;']
    ], why: 'A sees 5,100: its snapshot was taken by its first statement, after B committed. Nothing is "frozen" until you read. To take a snapshot that matches another session exactly, Postgres has <code>pg_export_snapshot()</code> (used by pg_dump for parallel dumps).', expectOut: '5100\\.00' },
    { pts: 2, q: 'Deadlock-free money transfer at READ COMMITTED: A moves 100 from Aarav to Diya, B moves 100 from Diya to Aarav, both at the same time. Lock the two rows in the same order (lowest account_id first) with one <code>SELECT … ORDER BY account_id FOR UPDATE</code> before updating.', hint: 'SELECT … WHERE account_id IN (1, 2) ORDER BY account_id FOR UPDATE;', two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT account_id FROM accounts WHERE account_id IN (1, 2) ORDER BY account_id FOR UPDATE;'],
      ['B', 'BEGIN;'],
      ['B', 'SELECT account_id FROM accounts WHERE account_id IN (1, 2) ORDER BY account_id FOR UPDATE;'],
      ['A', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;'],
      ['A', 'UPDATE accounts SET balance = balance + 100 WHERE account_id = 2;'],
      ['A', 'COMMIT;'],
      ['B', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 2;'],
      ['B', 'UPDATE accounts SET balance = balance + 100 WHERE account_id = 1;'],
      ['B', 'COMMIT;'],
      ['A', 'SELECT account_id, balance FROM accounts WHERE account_id IN (1, 2) ORDER BY account_id;']
    ], why: 'B simply waits for A, then runs; both balances end where they started. If each transaction had just updated "its" source account first, A would hold row 1 and want row 2 while B held row 2 and wanted row 1: a deadlock (Session 58 shows one). Taking locks in one global order makes deadlocks impossible.', expectOut: 'blocked[\\s\\S]*5000\\.00[\\s\\S]*3000\\.00' },
    { pts: 2, q: 'What does a serialization failure look like to an application? In A, run a REPEATABLE READ transaction that fails as in Q5, then show the SQLSTATE of the error with psql\'s <code>:LAST_ERROR_SQLSTATE</code>. (Run this one in psql; the transcript shows the error text.)', hint: 'After the error: \\echo :LAST_ERROR_SQLSTATE', two: [
      ['A', 'BEGIN ISOLATION LEVEL REPEATABLE READ;'],
      ['A', bal],
      ['B', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;'],
      ['A', 'UPDATE accounts SET balance = balance - 200 WHERE account_id = 1;'],
      ['A', 'ROLLBACK;'],
      ['--', 'in psql: \\echo :LAST_ERROR_SQLSTATE   → 40001']
    ], why: 'SQLSTATE 40001 (serialization_failure). Applications must decide "retry or give up" from the SQLSTATE code, never from the message text, which is translated and can change between versions. 40001 and 40P01 (deadlock) mean "retry the whole transaction".', expectOut: 'could not serialize access due to concurrent update' }
  ],
  hard: {
    q: 'Make the doctors\' rule safe <b>without</b> SERIALIZABLE and without locking every row, using one atomic UPDATE: "set on_duty = false for this doctor, but only if at least one <i>other</i> doctor is still on duty". Run it for Asha in A and for Rahul in B at the same time (both in open transactions), commit both, and show who is still on duty.',
    hint: "UPDATE on_call SET on_duty = false WHERE doctor = 'Asha' AND EXISTS (SELECT 1 FROM on_call o WHERE o.doctor <> 'Asha' AND o.on_duty) — and think about whether that is enough at READ COMMITTED.",
    setup: doctors,
    two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT doctor FROM on_call FOR UPDATE;'],
      ['A', "UPDATE on_call SET on_duty = false\nWHERE doctor = 'Asha'\n  AND EXISTS (SELECT 1 FROM on_call o WHERE o.doctor <> 'Asha' AND o.on_duty);"],
      ['B', 'BEGIN;'],
      ['B', 'SELECT doctor FROM on_call FOR UPDATE;'],
      ['A', 'COMMIT;'],
      ['B', "UPDATE on_call SET on_duty = false\nWHERE doctor = 'Rahul'\n  AND EXISTS (SELECT 1 FROM on_call o WHERE o.doctor <> 'Rahul' AND o.on_duty);"],
      ['B', 'COMMIT;'],
      ['A', 'SELECT * FROM on_call ORDER BY doctor;']
    ],
    why: 'The EXISTS alone is <b>not</b> enough at READ COMMITTED: each UPDATE only locks the row it changes, and both EXISTS subqueries could read the old state at the same moment (the write skew again, just faster). The fix is to serialise the decision on something both transactions must lock: here all on-call rows (<code>FOR UPDATE</code>), so B waits, then its EXISTS sees that Asha is off duty and updates 0 rows. With many rows, lock one "parent" row instead (the shift, the ward) or use an advisory lock (Session 59). Rules about "at least / at most N rows" are exactly the ones that need a lock or SERIALIZABLE.',
    expectOut: 'blocked[\\s\\S]*UPDATE 0[\\s\\S]*Rahul\\s+\\| t'
  }
};
