const doctors = "CREATE TABLE on_call (doctor text PRIMARY KEY, ward text NOT NULL, on_duty boolean NOT NULL);\nINSERT INTO on_call VALUES ('Asha', 'ICU', true), ('Rahul', 'ICU', true), ('Meera', 'ER', true);";

export default {
  n: 63,
  phase: 'p6',
  review: true,
  title: 'Review: isolation, locks and migrations',
  goal: 'Pull Sessions 57–62 back out of memory, mixed with earlier phases, before moving on to functions and triggers.',
  minutes: 150,
  lesson: [
    { h: 'How to run this review' },
    { list: [
      'Reload practice.sql. First 20 minutes: redo every question you got wrong in the exit test (Session 62), cold.',
      'Then the 14 questions below. For every two-terminal question, write down your prediction first: which statement waits, which one fails, what each SELECT returns.',
      'Then the challenge: one booking flow that combines everything.'
    ] },
    { h: 'Cheat sheet: Sessions 57–62' },
    { pre: "Problem                                  Tool\n---------------------------------------  -------------------------------------------------------------\nread-modify-write loses updates          UPDATE … SET x = x + 1   or   SELECT … FOR UPDATE first\nreport must be consistent across queries BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY\nrule over several rows (write skew)      lock a parent row FOR UPDATE, or SERIALIZABLE + retry (40001)\nmany workers, one queue                  … FOR UPDATE SKIP LOCKED LIMIT 1, lease + fencing + reaper\ndo not wait                              NOWAIT · lock_timeout · pg_try_advisory_xact_lock\ndeadlocks (40P01)                        lock in one global order; retry\ncreate exactly once                      UNIQUE / exclusion constraint + INSERT … ON CONFLICT\nretries of the same request              idempotency key in the same transaction\none at a time per X, no row to lock      pg_advisory_xact_lock(hashtext('x:' || id))\nexpensive report, read often             materialized view + unique index + REFRESH … CONCURRENTLY\nschema change on a busy table            lock_timeout, NOT VALID + VALIDATE, CONCURRENTLY, expand/contract", lang: 'text' }
  ],
  questions: [
    { pts: 1, q: 'In a REPEATABLE READ transaction, A counts the jobs per status; B queues a new job; A counts again. Same result?', hint: 'Two identical SELECTs in A around B\'s INSERT.', two: [
      ['A', 'BEGIN ISOLATION LEVEL REPEATABLE READ;'],
      ['A', "SELECT count(*) FROM jobs WHERE status = 'queued';"],
      ['B', "INSERT INTO jobs (job_id, kind, run_after) VALUES (11, 'send_email', now());"],
      ['A', "SELECT count(*) FROM jobs WHERE status = 'queued';"],
      ['A', 'COMMIT;']
    ], why: 'Yes, 6 both times: no phantoms in REPEATABLE READ (S57).', expectOut: '\\b6\\n[\\s\\S]*INSERT 0 1[\\s\\S]*\\b6\\n' },
    { pts: 1, q: 'Which of these changes can lose an update when two sessions run it at once in READ COMMITTED: (a) <code>UPDATE accounts SET balance = balance - 100 WHERE account_id = 1</code>, or (b) reading the balance into the application and writing <code>SET balance = &lt;value&gt;</code>? Demonstrate (a).', hint: 'Run (a) in A (open transaction) and B.', two: [
      ['A', 'BEGIN;'],
      ['A', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;'],
      ['B', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;'],
      ['A', 'COMMIT;'],
      ['A', 'SELECT balance FROM accounts WHERE account_id = 1;']
    ], why: '(b) can; (a) cannot: B waits and applies its change to the new value, 4,800 (S57).', expectOut: 'blocked[\\s\\S]*4800\\.00' },
    { pts: 1, q: 'List the queued jobs that worker B can see when worker A has locked jobs 4 and 5 with FOR UPDATE: use SKIP LOCKED.', hint: 'A: SELECT … WHERE job_id IN (4, 5) FOR UPDATE; B: … FOR UPDATE SKIP LOCKED', two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT job_id FROM jobs WHERE job_id IN (4, 5) FOR UPDATE;'],
      ['B', "SELECT job_id FROM jobs WHERE status = 'queued' AND run_after <= now() ORDER BY job_id FOR UPDATE SKIP LOCKED;"],
      ['A', 'COMMIT;']
    ], why: 'Jobs 6, 7 and 10 (S58). Job 8 is not due.', expectOut: '\\b6\\n\\s+7\\n\\s+10\\n' },
    { pts: 1, q: 'Create a bookings rule with a constraint: no guest name may appear twice for the same slot (across all tables). Add it, then try to book Aarav (already at table 1, 19:00) at table 4 for the same slot.', hint: 'UNIQUE (guest, slot)', steps: [
      'ALTER TABLE table_bookings ADD CONSTRAINT one_table_per_guest UNIQUE (guest, slot);',
      "INSERT INTO table_bookings VALUES (6, 4, '2026-02-20 19:00+05:30', 'Aarav', 2);"
    ], why: 'Rejected by one_table_per_guest. Where a rule can be a constraint, it beats SERIALIZABLE: no retries, enforced for every writer (S59).', expectOut: 'one_table_per_guest' },
    { pts: 1, q: 'Which lock does <code>CREATE INDEX</code> (not concurrently) take on jobs, and which statements does it block?', hint: 'pg_locks after CREATE INDEX inside a transaction.', sql: "CREATE INDEX jobs_status_idx ON jobs (status);\nSELECT mode FROM pg_locks WHERE relation = 'jobs'::regclass AND pid = pg_backend_pid();", why: 'ShareLock: blocks INSERT, UPDATE and DELETE until the build ends (S61). Use CONCURRENTLY on busy tables.', expectRows: 1 },
    { pts: 1, q: 'Delivered revenue per month (Phase 3) as a materialized view, refreshable without blocking readers. Create it with the right index and show the 3 best months.', hint: 'CREATE MATERIALIZED VIEW … ; CREATE UNIQUE INDEX … (month);', sql: "CREATE MATERIALIZED VIEW monthly_revenue AS\nSELECT date_trunc('month', o.order_date)::date AS month, sum(oi.quantity * oi.unit_price) AS revenue\nFROM orders o JOIN order_items oi ON oi.order_id = o.order_id\nWHERE o.status = 'delivered'\nGROUP BY 1;\nCREATE UNIQUE INDEX monthly_revenue_month ON monthly_revenue (month);\n\nSELECT month, revenue FROM monthly_revenue ORDER BY revenue DESC LIMIT 3;", why: 'January, September and April 2025 (S60).', expectRows: 3 },
    { pts: 1, q: 'A deadlock between two sessions: which error code tells the application to retry, and what does the error look like? Produce one with accounts 3 and 4.', hint: 'A: 3 then 4; B: 4 then 3.', two: [
      ['A', 'BEGIN;'], ['B', 'BEGIN;'],
      ['A', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 3;'],
      ['B', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 4;'],
      ['A', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 4;'],
      ['B', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 3;'],
      ['A', 'ROLLBACK;'], ['B', 'ROLLBACK;']
    ], why: '"deadlock detected", SQLSTATE 40P01: retry the whole transaction, like 40001 (S58).', expectOut: 'deadlock detected' },
    { pts: 1, q: 'Add a NOT NULL-like rule to jobs.payload safely: a CHECK that payload is a JSON object, added NOT VALID and then validated. Show convalidated.', hint: "CHECK (jsonb_typeof(payload) = 'object') NOT VALID; VALIDATE CONSTRAINT", sql: "ALTER TABLE jobs ADD CONSTRAINT payload_is_object CHECK (jsonb_typeof(payload) = 'object') NOT VALID;\nALTER TABLE jobs VALIDATE CONSTRAINT payload_is_object;\nSELECT conname, convalidated FROM pg_constraint WHERE conname = 'payload_is_object';", why: 'Validated (t). JSONB (Phase 4) plus a safe migration (S61).', expectRows: 1 },
    { pts: 2, q: 'Write skew per ward: the rule is "at least one doctor on duty <b>per ward</b>". Asha and Rahul (ICU) both try to go off duty at once; Meera is in the ER. Prevent it at READ COMMITTED by locking only the ICU rows, and show that Meera is not affected.', hint: "SELECT … WHERE ward = 'ICU' FOR UPDATE in both; C changes Meera meanwhile.", setup: doctors, two: [
      ['A', 'BEGIN;'],
      ['A', "SELECT doctor FROM on_call WHERE ward = 'ICU' AND on_duty FOR UPDATE;"],
      ['B', 'BEGIN;'],
      ['B', "SELECT doctor FROM on_call WHERE ward = 'ICU' AND on_duty FOR UPDATE;"],
      ['C', "UPDATE on_call SET on_duty = false WHERE doctor = 'Meera';"],
      ['A', "UPDATE on_call SET on_duty = false WHERE doctor = 'Asha';"],
      ['A', 'COMMIT;'],
      ['B', 'COMMIT;'],
      ['A', 'SELECT * FROM on_call ORDER BY doctor;']
    ], why: 'B waits for A, then sees only Rahul and stays on duty; C was never blocked because it touched another ward\'s row. Lock exactly the set the rule is about (S57, S58). (Meera is now off duty in the ER: the per-ward rule would need the same treatment there.)', expectOut: 'blocked[\\s\\S]*UPDATE 1[\\s\\S]*finishes[\\s\\S]*Rahul\\n\\s+\\(1 row\\)' },
    { pts: 2, q: 'Gapless invoice numbers vs. a sequence: A takes the next invoice number from a counter row and then rolls back; B takes the next number afterwards. Which number does B get?', hint: 'UPDATE counter SET last_no = last_no + 1 RETURNING last_no', setup: 'CREATE TABLE invoice_counter (year int PRIMARY KEY, last_no int NOT NULL);\nINSERT INTO invoice_counter VALUES (2026, 41);', two: [
      ['A', 'BEGIN;'],
      ['A', 'UPDATE invoice_counter SET last_no = last_no + 1 WHERE year = 2026 RETURNING last_no;'],
      ['B', 'UPDATE invoice_counter SET last_no = last_no + 1 WHERE year = 2026 RETURNING last_no;'],
      ['A', 'ROLLBACK;']
    ], why: 'B waits for A; when A rolls back, B gets 42, the number A gave up: no gap (S59). A sequence would have skipped 42.', expectOut: 'blocked[\\s\\S]*finishes[\\s\\S]*\\b42\\b' },
    { pts: 2, q: 'The lock queue: A has an open transaction that read jobs; B runs <code>ALTER TABLE jobs ADD COLUMN priority int</code> without a timeout; C tries to claim a job. Who waits for whom?', hint: 'Three terminals; A commits last.', two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT count(*) FROM jobs;'],
      ['B', 'ALTER TABLE jobs ADD COLUMN priority int;'],
      ['C', "SELECT job_id FROM jobs WHERE status = 'queued' ORDER BY job_id LIMIT 1;"],
      ['A', 'COMMIT;']
    ], why: 'B waits for A, and C waits behind B although C and A do not conflict: everything piles up behind the waiting ALTER (S61). Always set lock_timeout for migrations.', expectOut: 'B=# ALTER[\\s\\S]*blocked[\\s\\S]*C=# SELECT[\\s\\S]*blocked' },
    { pts: 2, q: 'Recover from a failed CREATE INDEX CONCURRENTLY: try a unique index on jobs(kind) (kinds repeat), find the invalid index, drop it and build a normal one on (kind) concurrently.', hint: "pg_index.indisvalid; DROP INDEX CONCURRENTLY", steps: [
      'CREATE UNIQUE INDEX CONCURRENTLY jobs_kind_idx ON jobs (kind);',
      "SELECT indexrelid::regclass AS index_name, indisvalid FROM pg_index WHERE indrelid = 'jobs'::regclass AND NOT indisvalid;",
      'DROP INDEX CONCURRENTLY jobs_kind_idx;',
      'CREATE INDEX CONCURRENTLY jobs_kind_idx ON jobs (kind);',
      "SELECT count(*) AS invalid_indexes FROM pg_index WHERE indrelid = 'jobs'::regclass AND NOT indisvalid;"
    ], why: 'The failed build leaves jobs_kind_idx invalid; after dropping and rebuilding, there are 0 invalid indexes (S61).', expectOut: 'jobs_kind_idx \\| f[\\s\\S]*invalid_indexes\\n-+\\n\\s+0' },
    { pts: 2, q: 'Idempotent job creation: the client sends "export report for 2026-01" with key \'exp-2026-01\' twice, concurrently (A in an open transaction). Make sure only one job is created.', hint: 'A unique idempotency_key column on jobs; INSERT … ON CONFLICT DO NOTHING RETURNING job_id.', setup: 'ALTER TABLE jobs ADD COLUMN idempotency_key text UNIQUE;', two: [
      ['A', 'BEGIN;'],
      ['A', "INSERT INTO jobs (job_id, kind, payload, run_after, idempotency_key)\nVALUES (11, 'export_report', '{\"month\": \"2026-01\"}', now(), 'exp-2026-01')\nON CONFLICT (idempotency_key) DO NOTHING RETURNING job_id;"],
      ['B', "INSERT INTO jobs (job_id, kind, payload, run_after, idempotency_key)\nVALUES (12, 'export_report', '{\"month\": \"2026-01\"}', now(), 'exp-2026-01')\nON CONFLICT (idempotency_key) DO NOTHING RETURNING job_id;"],
      ['A', 'COMMIT;'],
      ['A', "SELECT count(*) FROM jobs WHERE idempotency_key = 'exp-2026-01';"]
    ], why: 'B waits for A\'s insert, then returns 0 rows: one job (S59). Note that B\'s job_id 12 conflicted on the key, not the id.', expectOut: 'blocked[\\s\\S]*\\(0 rows\\)[\\s\\S]*\\b1\\n\\(1 row\\)$' },
    { pts: 2, q: 'Phase 5 meets Phase 6: the claim query must stay fast with millions of done jobs. Inside BEGIN … ROLLBACK, create the partial index for it and show the plan of the claim\'s inner SELECT (COSTS OFF), with seq scans switched off for this tiny table.', hint: "CREATE INDEX … ON jobs (run_after, job_id) WHERE status = 'queued'; SET LOCAL enable_seqscan = off;", sql: "BEGIN;\nCREATE INDEX jobs_claim_idx ON jobs (run_after, job_id) WHERE status = 'queued';\nSET LOCAL enable_seqscan = off;\nEXPLAIN (COSTS OFF)\nSELECT job_id FROM jobs\nWHERE status = 'queued' AND run_after <= now()\nORDER BY run_after, job_id\nFOR UPDATE SKIP LOCKED\nLIMIT 1;\nROLLBACK;", why: 'Limit → LockRows → Index Scan on the partial index: no Sort, and the index only ever contains queued jobs, however many done jobs pile up (S47, S58). On 10 rows the planner would prefer a Seq Scan, which is why seq scans are switched off for the demonstration.', expectPlan: 'Limit[\\s\\S]*LockRows[\\s\\S]*Index Scan using jobs_claim_idx' }
  ],
  hard: {
    q: 'One booking flow with everything: a guest books a table, and the booking also creates a confirmation-email job, all or nothing; the client may retry with the same idempotency key; two different clients may race for the same table. Add an idempotency_key to table_bookings, then let A (key k1, table 2 at 20:00 for Saanvi) and B (key k2, same table and slot, for Vivaan) race, and let A\'s client retry k1 afterwards. Show bookings and jobs at the end.',
    hint: 'One statement: WITH b AS (INSERT INTO table_bookings … ON CONFLICT (idempotency_key) DO NOTHING RETURNING …) INSERT INTO jobs SELECT … FROM b. The UNIQUE (table_no, slot) handles the race.',
    setup: 'ALTER TABLE table_bookings ADD COLUMN idempotency_key text UNIQUE;',
    two: [
      ['A', 'BEGIN;'],
      ['A', "WITH b AS (\n  INSERT INTO table_bookings VALUES (6, 2, '2026-02-20 20:00+05:30', 'Saanvi', 2, 'k1')\n  ON CONFLICT (idempotency_key) DO NOTHING RETURNING booking_id, guest\n)\nINSERT INTO jobs (job_id, kind, payload, run_after)\nSELECT 11, 'send_email', jsonb_build_object('booking', booking_id, 'guest', guest), now() FROM b\nRETURNING job_id;"],
      ['B', "WITH b AS (\n  INSERT INTO table_bookings VALUES (7, 2, '2026-02-20 20:00+05:30', 'Vivaan', 4, 'k2')\n  ON CONFLICT (idempotency_key) DO NOTHING RETURNING booking_id, guest\n)\nINSERT INTO jobs (job_id, kind, payload, run_after)\nSELECT 12, 'send_email', jsonb_build_object('booking', booking_id, 'guest', guest), now() FROM b\nRETURNING job_id;"],
      ['A', 'COMMIT;'],
      ['--', "A's client did not get the reply and retries with the same key k1:"],
      ['A', "WITH b AS (\n  INSERT INTO table_bookings VALUES (6, 2, '2026-02-20 20:00+05:30', 'Saanvi', 2, 'k1')\n  ON CONFLICT (idempotency_key) DO NOTHING RETURNING booking_id, guest\n)\nINSERT INTO jobs (job_id, kind, payload, run_after)\nSELECT 11, 'send_email', jsonb_build_object('booking', booking_id, 'guest', guest), now() FROM b\nRETURNING job_id;"],
      ['A', "SELECT (SELECT count(*) FROM table_bookings WHERE slot = '2026-02-20 20:00+05:30' AND table_no = 2) AS bookings_table2,\n       (SELECT count(*) FROM jobs WHERE kind = 'send_email' AND payload ? 'booking') AS confirmation_jobs;"]
    ],
    why: 'B waits on the (table_no, slot) unique index and then fails with a duplicate key: its booking and its email job are both rolled back (one statement). A\'s retry with key k1 is a no-op (0 rows): no second booking, no second email. Final: 1 booking for table 2 at 20:00, 1 confirmation job. Constraints did all the concurrency work; the transaction made the booking and the job atomic; the idempotency key made retries safe. Phase 7 moves this flow into a function.',
    expectOut: 'blocked[\\s\\S]*table_bookings_table_no_slot_key[\\s\\S]*\\(0 rows\\)[\\s\\S]*\\b1 \\|\\s+1\\n'
  }
};
