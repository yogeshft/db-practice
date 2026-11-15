const claim = (w) => `UPDATE jobs SET status = 'running', locked_by = '${w}', locked_at = now(), attempts = attempts + 1\nWHERE job_id = (SELECT job_id FROM jobs WHERE status = 'queued' AND run_after <= now()\n                ORDER BY run_after, job_id FOR UPDATE SKIP LOCKED LIMIT 1)\nRETURNING job_id;`;
const rooms = "CREATE EXTENSION IF NOT EXISTS btree_gist;\nCREATE TABLE room_bookings (room int NOT NULL, during tstzrange NOT NULL, guest text NOT NULL,\n  EXCLUDE USING gist (room WITH =, during WITH &&));";

export default {
  n: 62,
  phase: 'p6',
  title: 'Exit test + Apply: Concurrency',
  goal: 'Prove you can keep data correct when many sessions work at once: 14 questions written cold, no notes, at least 11 of 14 correct.',
  minutes: 150,
  lesson: [
    { h: 'Exit test rules' },
    { list: [
      '<b>Cold:</b> no notes, no earlier sessions, no answers until you are done.',
      '<b>Time box:</b> 90 minutes. Most questions need two psql windows (A and B); run the steps in the order the question gives.',
      '<b>Predict first:</b> before running a two-terminal question, write down what each terminal will print (including who waits and who gets an error). A question counts only if your prediction <b>and</b> your output match the answer.',
      '<b>Pass = 11 of 14 or more.</b> Pass → Phase 7 (functions, triggers and security). Fail → redo every missed question, re-read its session, and retake the test later.',
      'Reload practice.sql before you start.'
    ] },
    { h: 'What the test checks' },
    { pre: 'Q1, Q2, Q7      transactions, savepoints, ON CONFLICT          (S55, S59)\nQ3, Q4, Q9, Q10 isolation levels and anomalies                (S57)\nQ5, Q6, Q11     row locks, job queues, deadlocks               (S58)\nQ12             advisory locks                                 (S59)\nQ8, Q13         DDL locks and safe migrations                  (S61)\nQ14             materialized views                             (S60)', lang: 'text' },
    { h: 'Apply project: a concurrency-safe job system' },
    { p: 'Write <code>psql/projects/p6-concurrency.sql</code> and a short <code>p6-concurrency.md</code>:' },
    { list: [
      'A <code>jobs</code> table with the partial index that serves the claim query, and the claim, finish (with fencing), fail (attempts limit) and reaper statements from Session 58.',
      'Open three psql windows as three workers and process all queued jobs with your statements. Paste the transcript into the .md and explain why no job ran twice.',
      'Add an <code>idempotency_key</code> to job creation (Session 59) so that a client retrying "create job" cannot create it twice.',
      'Write the migration that adds a <code>priority</code> column and changes the claim index to (priority DESC, run_after), as a zero-downtime script: lock_timeout, CREATE INDEX CONCURRENTLY, DROP INDEX CONCURRENTLY (Session 61).',
      'For your Visitly app: list every place where two users can act on the same thing at once (the same table, the same slot, the same coupon), and which tool from this phase protects each one.'
    ] },
    { tip: 'The last step is the one interviewers ask about: "what happens if two users book the last table at the same time?" Being able to answer with the exact constraint or lock, and show the transcript, is what this phase was for.' }
  ],
  questions: [
    { pts: 1, q: 'Move 1,200 from Ananya to Aarav as one transaction and show the total of all balances afterwards.', hint: 'No hints in an exit test.', steps: [
      'BEGIN;',
      'UPDATE accounts SET balance = balance - 1200 WHERE account_id = 4;',
      'UPDATE accounts SET balance = balance + 1200 WHERE account_id = 1;',
      'COMMIT;',
      'SELECT sum(balance) AS total FROM accounts;'
    ], why: 'S55. Ananya ends at 0.00, which the CHECK allows.', expectOut: 'COMMIT[\\s\\S]*9200\\.00' },
    { pts: 1, q: 'In one transaction: book table 4 at 19:00 for Myra (party 2), then try table 1 at 19:00 for Tara (taken), then book table 2 at 21:00 for Tara. Keep Myra\'s and Tara\'s second booking. Show the booking count afterwards.', hint: 'No hints in an exit test.', steps: [
      'BEGIN;',
      "INSERT INTO table_bookings VALUES (6, 4, '2026-02-20 19:00+05:30', 'Myra', 2);",
      'SAVEPOINT s;',
      "INSERT INTO table_bookings VALUES (7, 1, '2026-02-20 19:00+05:30', 'Tara', 2);",
      'ROLLBACK TO SAVEPOINT s;',
      "INSERT INTO table_bookings VALUES (7, 2, '2026-02-20 21:00+05:30', 'Tara', 2);",
      'COMMIT;',
      'SELECT count(*) FROM table_bookings;'
    ], why: 'S55: 7 bookings.', expectOut: 'duplicate key[\\s\\S]*COMMIT[\\s\\S]*\\b7\\b' },
    { pts: 1, q: 'A reads Kabir\'s balance twice in one READ COMMITTED transaction; between the reads, B adds 500 to it. What does A\'s second read return?', hint: 'No hints in an exit test.', two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT balance FROM accounts WHERE account_id = 3;'],
      ['B', 'UPDATE accounts SET balance = balance + 500 WHERE account_id = 3;'],
      ['A', 'SELECT balance FROM accounts WHERE account_id = 3;'],
      ['A', 'COMMIT;']
    ], why: 'S57: 0.00, then 500.00 (non-repeatable read).', expectOut: '0\\.00[\\s\\S]*500\\.00' },
    { pts: 1, q: 'A and B each add 100 to Diya\'s balance at the same time, A inside an open transaction. Write it so that no update is lost, and show the final balance.', hint: 'No hints in an exit test.', two: [
      ['A', 'BEGIN;'],
      ['A', 'UPDATE accounts SET balance = balance + 100 WHERE account_id = 2;'],
      ['B', 'UPDATE accounts SET balance = balance + 100 WHERE account_id = 2;'],
      ['A', 'COMMIT;'],
      ['A', 'SELECT balance FROM accounts WHERE account_id = 2;']
    ], why: 'S57: B waits, then applies its change to the new row: 3,200.', expectOut: 'blocked[\\s\\S]*3200\\.00' },
    { pts: 1, q: 'Two workers claim jobs at the same time, both inside open transactions. Which job does each get?', hint: 'No hints in an exit test.', two: [
      ['A', 'BEGIN;'], ['A', claim('worker-A')],
      ['B', 'BEGIN;'], ['B', claim('worker-B')],
      ['A', 'COMMIT;'], ['B', 'COMMIT;']
    ], why: 'S58: A gets job 4, B gets job 5 (SKIP LOCKED), and nobody waits.', expectOut: '\\b4\\n[\\s\\S]*\\b5\\n' },
    { pts: 1, q: 'A holds a lock on job 10. B wants to edit job 10 but must be told immediately that someone else is working on it.', hint: 'No hints in an exit test.', two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT job_id FROM jobs WHERE job_id = 10 FOR UPDATE;'],
      ['B', 'SELECT job_id FROM jobs WHERE job_id = 10 FOR UPDATE NOWAIT;'],
      ['A', 'COMMIT;']
    ], why: 'S58: NOWAIT raises "could not obtain lock" at once.', expectOut: 'could not obtain lock on row' },
    { pts: 1, q: 'Register idempotency key \'req-001\' for a payment of 500 from Diya, and debit her only if the key is new. Run it twice and show her balance.', hint: 'No hints in an exit test.', setup: 'CREATE TABLE payment_requests (idempotency_key text PRIMARY KEY, account_id int NOT NULL, amount numeric(12,2) NOT NULL);', steps: [
      "WITH req AS (INSERT INTO payment_requests VALUES ('req-001', 2, 500) ON CONFLICT DO NOTHING RETURNING account_id, amount)\nUPDATE accounts a SET balance = balance - req.amount FROM req WHERE a.account_id = req.account_id;",
      "WITH req AS (INSERT INTO payment_requests VALUES ('req-001', 2, 500) ON CONFLICT DO NOTHING RETURNING account_id, amount)\nUPDATE accounts a SET balance = balance - req.amount FROM req WHERE a.account_id = req.account_id;",
      'SELECT balance FROM accounts WHERE account_id = 2;'
    ], why: 'S59: UPDATE 1, then UPDATE 0; balance 2,500.', expectOut: 'UPDATE 1[\\s\\S]*UPDATE 0[\\s\\S]*2500\\.00' },
    { pts: 1, q: 'Which table lock does <code>ALTER TABLE jobs ADD COLUMN priority int</code> take? Show it from pg_locks inside the transaction.', hint: 'No hints in an exit test.', sql: "ALTER TABLE jobs ADD COLUMN priority int;\nSELECT mode FROM pg_locks WHERE relation = 'jobs'::regclass AND pid = pg_backend_pid();", why: 'S61: AccessExclusiveLock.', expectRows: 1 },
    { pts: 2, q: 'A starts a REPEATABLE READ transaction and reads Aarav\'s balance. B withdraws 500 from Aarav. A then tries to withdraw 1,000. What happens to A, and what must the application do?', hint: 'No hints in an exit test.', two: [
      ['A', 'BEGIN ISOLATION LEVEL REPEATABLE READ;'],
      ['A', 'SELECT balance FROM accounts WHERE account_id = 1;'],
      ['B', 'UPDATE accounts SET balance = balance - 500 WHERE account_id = 1;'],
      ['A', 'UPDATE accounts SET balance = balance - 1000 WHERE account_id = 1;'],
      ['A', 'ROLLBACK;']
    ], why: 'S57: "could not serialize access due to concurrent update" (40001). Retry the whole transaction.', expectOut: 'could not serialize access due to concurrent update' },
    { pts: 2, q: 'Rule: a guest may hold at most one booking on 20 Feb 2026. A and B both book a table for Vivaan at the same time (A table 1, B table 2, both at 21:00), each first checking that Vivaan has no booking yet. Use SERIALIZABLE and show the result.', hint: 'No hints in an exit test.', two: [
      ['A', 'BEGIN ISOLATION LEVEL SERIALIZABLE;'],
      ['A', "SELECT count(*) FROM table_bookings WHERE guest = 'Vivaan';"],
      ['B', 'BEGIN ISOLATION LEVEL SERIALIZABLE;'],
      ['B', "SELECT count(*) FROM table_bookings WHERE guest = 'Vivaan';"],
      ['A', "INSERT INTO table_bookings VALUES (6, 1, '2026-02-20 21:00+05:30', 'Vivaan', 2);"],
      ['B', "INSERT INTO table_bookings VALUES (7, 2, '2026-02-20 21:00+05:30', 'Vivaan', 2);"],
      ['A', 'COMMIT;'],
      ['B', 'COMMIT;'],
      ['A', "SELECT count(*) FROM table_bookings WHERE guest = 'Vivaan';"]
    ], why: 'S57: B fails with a serialization error; Vivaan has 1 booking.', expectOut: 'could not serialize access[\\s\\S]*\\b1\\n\\(1 row\\)$' },
    { pts: 2, q: 'A moves 50 from Diya to Aarav while B moves 50 from Aarav to Diya, both at once. Each debits its source account first. Write them so they cannot deadlock, and show both balances at the end.', hint: 'No hints in an exit test.', two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT account_id FROM accounts WHERE account_id IN (1, 2) ORDER BY account_id FOR UPDATE;'],
      ['B', 'BEGIN;'],
      ['B', 'SELECT account_id FROM accounts WHERE account_id IN (1, 2) ORDER BY account_id FOR UPDATE;'],
      ['A', 'UPDATE accounts SET balance = balance - 50 WHERE account_id = 2;'],
      ['A', 'UPDATE accounts SET balance = balance + 50 WHERE account_id = 1;'],
      ['A', 'COMMIT;'],
      ['B', 'UPDATE accounts SET balance = balance - 50 WHERE account_id = 1;'],
      ['B', 'UPDATE accounts SET balance = balance + 50 WHERE account_id = 2;'],
      ['B', 'COMMIT;'],
      ['A', 'SELECT account_id, balance FROM accounts WHERE account_id IN (1, 2) ORDER BY account_id;']
    ], why: 'S58: both lock rows 1 and 2 in id order before changing anything, so B simply waits for A. Without that first SELECT, A would hold Diya and want Aarav while B held Aarav and wanted Diya: a deadlock. Final: Aarav 5,000, Diya 3,000.', expectOut: 'blocked[\\s\\S]*5000\\.00[\\s\\S]*3000\\.00' },
    { pts: 2, q: 'Only one "monthly statement" job per customer may run at a time. A runs it for customer 7; B tries customer 7 (must not wait) and customer 8. Use transaction-level advisory locks.', hint: 'No hints in an exit test.', two: [
      ['A', 'BEGIN;'],
      ['A', "SELECT pg_advisory_xact_lock(hashtext('statement:7'));"],
      ['B', 'BEGIN;'],
      ['B', "SELECT pg_try_advisory_xact_lock(hashtext('statement:7')) AS c7, pg_try_advisory_xact_lock(hashtext('statement:8')) AS c8;"],
      ['A', 'COMMIT;'],
      ['B', 'COMMIT;']
    ], why: 'S59: c7 f, c8 t.', expectOut: 'c7 \\| c8[\\s\\S]*\\bf\\s+\\| t\\b' },
    { pts: 2, q: 'A has an open transaction that read jobs. Run a migration in B that adds a column to jobs but gives up after 1 second instead of blocking the application, and show that the column was not added.', hint: 'No hints in an exit test.', two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT count(*) FROM jobs;'],
      ['B', "SET lock_timeout = '1s';"],
      ['B', 'ALTER TABLE jobs ADD COLUMN priority int;'],
      ['wait', 'B'],
      ['A', 'COMMIT;'],
      ['B', "SELECT count(*) AS has_priority FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'priority';"]
    ], why: 'S61: lock timeout after 1 s; 0 columns. Retry later.', expectOut: 'canceling statement due to lock timeout[\\s\\S]*has_priority\\n\\s+-+\\n\\s+0' },
    { pts: 2, q: 'Create a materialized view jobs_by_status (status, jobs) that can be refreshed without blocking readers, refresh it that way after marking job 10 as failed, and read it.', hint: 'No hints in an exit test.', steps: [
      'CREATE MATERIALIZED VIEW jobs_by_status AS SELECT status, count(*) AS jobs FROM jobs GROUP BY status;',
      'CREATE UNIQUE INDEX jobs_by_status_status ON jobs_by_status (status);',
      "UPDATE jobs SET status = 'failed' WHERE job_id = 10;",
      'REFRESH MATERIALIZED VIEW CONCURRENTLY jobs_by_status;',
      'SELECT * FROM jobs_by_status ORDER BY status;'
    ], why: 'S60: CONCURRENTLY needs a unique index. failed: 2, queued: 5.', expectOut: 'failed\\s+\\|\\s+2[\\s\\S]*queued\\s+\\|\\s+5' }
  ],
  hard: {
    q: 'Visitly rooms: private dining rooms are booked by time range. Create room_bookings with an exclusion constraint so a room can never be double-booked. Then A books room 1 from 19:00 to 21:00 (open transaction) while B tries 20:00–22:00 on room 1, and C books 20:00–22:00 on room 2. Show who waits, who fails, and the final bookings.',
    hint: 'btree_gist; EXCLUDE USING gist (room WITH =, during WITH &&).',
    setup: rooms,
    two: [
      ['A', 'BEGIN;'],
      ['A', "INSERT INTO room_bookings VALUES (1, '[2026-02-20 19:00+05:30, 2026-02-20 21:00+05:30)', 'Aarav');"],
      ['B', "INSERT INTO room_bookings VALUES (1, '[2026-02-20 20:00+05:30, 2026-02-20 22:00+05:30)', 'Diya');"],
      ['C', "INSERT INTO room_bookings VALUES (2, '[2026-02-20 20:00+05:30, 2026-02-20 22:00+05:30)', 'Kabir');"],
      ['A', 'COMMIT;'],
      ['A', 'SELECT room, guest FROM room_bookings ORDER BY room;']
    ],
    why: 'B waits for A (its range overlaps A\'s uncommitted booking on the same room) and fails when A commits; C, on another room, is not affected at all. The exclusion constraint is both the rule and the lock: no application code, no SERIALIZABLE, no race. This is the answer to "what if two users book the same room at once?"',
    expectOut: 'blocked[\\s\\S]*C=# INSERT[^\\n]*\\n\\s+INSERT 0 1[\\s\\S]*conflicting key value violates exclusion constraint[\\s\\S]*\\(2 rows\\)'
  }
};
