const subs = 'CREATE TABLE subscribers (email text NOT NULL, plan text NOT NULL);';
const subsU = 'CREATE TABLE subscribers (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email text NOT NULL UNIQUE, plan text NOT NULL);';
const rooms = "CREATE EXTENSION IF NOT EXISTS btree_gist;\nCREATE TABLE room_bookings (\n  room int NOT NULL,\n  during tstzrange NOT NULL,\n  guest text NOT NULL,\n  EXCLUDE USING gist (room WITH =, during WITH &&)\n);";
const invoices = "CREATE TABLE invoice_counter (year int PRIMARY KEY, last_no int NOT NULL);\nINSERT INTO invoice_counter VALUES (2026, 41);\nCREATE TABLE invoices (year int, no int, customer_id int, PRIMARY KEY (year, no));";
const idem = "CREATE TABLE payment_requests (\n  idempotency_key text PRIMARY KEY,\n  account_id int NOT NULL,\n  amount numeric(12,2) NOT NULL,\n  created_at timestamptz NOT NULL DEFAULT now()\n);";

export default {
  n: 59,
  phase: 'p6',
  title: 'Race-free creation and advisory locks',
  goal: 'Create rows exactly once under concurrency (constraints, ON CONFLICT, exclusion constraints, idempotency keys), and serialise work that has no row to lock with advisory locks.',
  minutes: 150,
  lesson: [
    { h: 'Check-then-insert is a race' },
    { p: '"If the email is not subscribed yet, insert it": two requests at the same moment both check, both see nothing, both insert. Row locks cannot help, because there is no row yet to lock. Without a constraint you get a duplicate:' },
    { two: [
      ['A', 'BEGIN;'],
      ['A', "SELECT count(*) FROM subscribers WHERE email = 'aarav@mail.test';"],
      ['B', 'BEGIN;'],
      ['B', "SELECT count(*) FROM subscribers WHERE email = 'aarav@mail.test';"],
      ['A', "INSERT INTO subscribers VALUES ('aarav@mail.test', 'free');"],
      ['B', "INSERT INTO subscribers VALUES ('aarav@mail.test', 'pro');"],
      ['A', 'COMMIT;'], ['B', 'COMMIT;'],
      ['A', "SELECT * FROM subscribers;"]
    ], setup: subs, expectOut: '\\(2 rows\\)$' },
    { p: 'Even SERIALIZABLE only turns this into an error to retry. The robust fix is to let a <b>unique index</b> decide. The index is the one place where two inserts of the same key are forced to meet: the second waits for the first transaction, and then either fails (the first committed) or proceeds (the first rolled back).' },
    { two: [
      ['A', 'BEGIN;'],
      ['A', "INSERT INTO subscribers (email, plan) VALUES ('aarav@mail.test', 'free');"],
      ['B', "INSERT INTO subscribers (email, plan) VALUES ('aarav@mail.test', 'pro');"],
      ['A', 'COMMIT;']
    ], setup: subsU, expectOut: 'blocked[\\s\\S]*duplicate key value violates unique constraint "subscribers_email_key"' },
    { h: 'ON CONFLICT: insert-or-ignore, insert-or-update, get-or-create' },
    { pre: "INSERT … ON CONFLICT (email) DO NOTHING                        insert once; a duplicate is skipped silently\nINSERT … ON CONFLICT (email) DO UPDATE SET plan = EXCLUDED.plan  insert, or update the existing row (upsert)\nINSERT … ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id\n                                                                get-or-create: always returns the id", lang: 'text' },
    { p: 'ON CONFLICT is atomic even under concurrency: it uses the same unique index, waits for an in-progress insert of the same key, and then takes the right branch. It never fails with a duplicate-key error for its conflict target (Session 40).' },
    { h: 'Rules that are not equality: exclusion constraints' },
    { p: '"A room cannot be booked twice for overlapping times" is a uniqueness rule on ranges. An exclusion constraint (Session 47) enforces it under concurrency exactly like UNIQUE does: the second overlapping insert waits, then fails.' },
    { two: [
      ['A', 'BEGIN;'],
      ['A', "INSERT INTO room_bookings VALUES (1, '[2026-02-20 19:00+05:30, 2026-02-20 21:00+05:30)', 'Aarav');"],
      ['B', "INSERT INTO room_bookings VALUES (1, '[2026-02-20 20:00+05:30, 2026-02-20 22:00+05:30)', 'Diya');"],
      ['A', 'COMMIT;']
    ], setup: rooms, expectOut: 'blocked[\\s\\S]*conflicting key value violates exclusion constraint' },
    { h: 'Idempotency keys' },
    { p: 'A payment request times out on the client, which retries. Did the first one go through? An <b>idempotency key</b> chosen by the client (a UUID per logical request) makes the retry safe: the server records each key with a unique constraint in the <b>same transaction</b> as the work, and a retry with the same key does nothing (Q9). Stripe, payment gateways and most good APIs work this way.' },
    { h: 'Advisory locks: locks on an idea' },
    { p: 'Sometimes there is no row to lock: "only one export of this customer\'s data at a time", "only one instance of the nightly job". An <b>advisory lock</b> is a lock on a number you choose; Postgres enforces nothing except that two sessions cannot hold the same number at once.' },
    { pre: "pg_advisory_xact_lock(key)        wait for the lock; released at COMMIT / ROLLBACK      ← prefer this\npg_try_advisory_xact_lock(key)    true if taken, false immediately if someone has it\npg_advisory_lock(key)             session-level: held until pg_advisory_unlock(key) or disconnect\npg_try_advisory_lock(key)         session-level, non-blocking\n\nkey: a bigint, or two ints. From text: hashtext('export:customer:3') (collisions are possible but rare).", lang: 'text' },
    { two: [
      ['A', 'BEGIN;'],
      ['A', "SELECT pg_advisory_xact_lock(hashtext('export:customer:3'));"],
      ['B', 'BEGIN;'],
      ['B', "SELECT pg_try_advisory_xact_lock(hashtext('export:customer:3')) AS got_it;"],
      ['B', "SELECT pg_try_advisory_xact_lock(hashtext('export:customer:5')) AS got_it;"],
      ['A', 'COMMIT;'], ['B', 'COMMIT;']
    ], expectOut: 'got_it[\\s\\S]*\\bf\\b[\\s\\S]*got_it[\\s\\S]*\\bt\\b' },
    { trap: 'Session-level advisory locks survive COMMIT. With a connection pooler (PgBouncer in transaction mode), the next transaction on that connection may belong to another user, and it inherits your lock. Use the <code>_xact_</code> versions unless you really need a lock across transactions.' },
    { tip: 'Order of preference: a constraint (UNIQUE, exclusion, CHECK, foreign key) when the rule can be written as one; ON CONFLICT for create-once; row locks when the rule is about existing rows; advisory locks when there is nothing to lock; SERIALIZABLE when the rule is too complex for all of these.' }
  ],
  questions: [
    { pts: 1, q: 'Subscribe aarav@mail.test to the free plan in a way that does nothing (and raises no error) if he is already subscribed. Run it twice. (Table subscribers with a UNIQUE email, as in the lesson.)', hint: 'ON CONFLICT (email) DO NOTHING', setup: subsU, steps: [
      "INSERT INTO subscribers (email, plan) VALUES ('aarav@mail.test', 'free') ON CONFLICT (email) DO NOTHING;",
      "INSERT INTO subscribers (email, plan) VALUES ('aarav@mail.test', 'free') ON CONFLICT (email) DO NOTHING;",
      'SELECT email, plan FROM subscribers;'
    ], why: 'INSERT 0 1, then INSERT 0 0: the second does nothing. The command tag (or RETURNING returning no row) tells the application whether it created the row.', expectOut: 'INSERT 0 1[\\s\\S]*INSERT 0 0' },
    { pts: 1, q: 'Same table: upgrade-or-subscribe diya@mail.test to pro. Run it once with the plan free, then with pro; she must end up with one row on pro.', hint: 'ON CONFLICT (email) DO UPDATE SET plan = EXCLUDED.plan', setup: subsU, steps: [
      "INSERT INTO subscribers (email, plan) VALUES ('diya@mail.test', 'free')\nON CONFLICT (email) DO UPDATE SET plan = EXCLUDED.plan;",
      "INSERT INTO subscribers (email, plan) VALUES ('diya@mail.test', 'pro')\nON CONFLICT (email) DO UPDATE SET plan = EXCLUDED.plan;",
      'SELECT email, plan FROM subscribers;'
    ], why: 'One row, plan pro. Both statements report INSERT 0 1, because ON CONFLICT … DO UPDATE counts the updated row too.', expectOut: 'diya@mail\\.test \\| pro\\n\\(1 row\\)' },
    { pts: 1, q: 'Get-or-create: return the id of kabir@mail.test, creating him on the free plan if needed. The same statement must return his id on both runs.', hint: 'ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id', setup: subsU, steps: [
      "INSERT INTO subscribers (email, plan) VALUES ('kabir@mail.test', 'free')\nON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email\nRETURNING id;",
      "INSERT INTO subscribers (email, plan) VALUES ('kabir@mail.test', 'free')\nON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email\nRETURNING id;"
    ], why: 'Both return id 1. DO NOTHING returns no row for an existing key; the no-op DO UPDATE makes RETURNING always return one. The price is a new row version for every call (Phase 8), so for hot keys the Session 40 pattern (INSERT … DO NOTHING RETURNING, UNION ALL a SELECT) is cheaper.', expectOut: 'id\\n-+\\n\\s+1\\n\\(1 row\\)[\\s\\S]*id\\n-+\\n\\s+1\\n' },
    { pts: 1, q: 'A and B both try to subscribe aarav@mail.test at the same moment, both with ON CONFLICT DO NOTHING, A inside an open transaction. What does B see?', hint: 'B waits for A\'s insert to be decided.', setup: subsU, two: [
      ['A', 'BEGIN;'],
      ['A', "INSERT INTO subscribers (email, plan) VALUES ('aarav@mail.test', 'free') ON CONFLICT (email) DO NOTHING;"],
      ['B', "INSERT INTO subscribers (email, plan) VALUES ('aarav@mail.test', 'pro') ON CONFLICT (email) DO NOTHING;"],
      ['A', 'COMMIT;'],
      ['A', 'SELECT email, plan FROM subscribers;']
    ], why: 'B waits until A commits, then reports INSERT 0 0. Had A rolled back, B would have inserted its row. No error, no duplicate, no retry loop: this is why ON CONFLICT beats "SELECT first, then INSERT".', expectOut: 'blocked[\\s\\S]*INSERT 0 0[\\s\\S]*free' },
    { pts: 1, q: 'Book the restaurant: table 2 is free at 20:00 on 20 Feb 2026. A and B both try to book it for different guests at the same moment. Use the existing UNIQUE (table_no, slot) on table_bookings.', hint: 'Both: INSERT INTO table_bookings VALUES (…, 2, \'2026-02-20 20:00+05:30\', …)', two: [
      ['A', 'BEGIN;'],
      ['A', "INSERT INTO table_bookings VALUES (6, 2, '2026-02-20 20:00+05:30', 'Saanvi', 2);"],
      ['B', "INSERT INTO table_bookings VALUES (7, 2, '2026-02-20 20:00+05:30', 'Vivaan', 4);"],
      ['A', 'COMMIT;']
    ], why: 'B waits, then fails with a duplicate key on table_bookings_table_no_slot_key. The application catches SQLSTATE 23505 and tells Vivaan that the table was just taken. No locking code was needed: the constraint is the lock.', expectOut: 'blocked[\\s\\S]*table_bookings_table_no_slot_key' },
    { pts: 1, q: 'Only one copy of the nightly report may run. A takes a session-level advisory lock with key 777 and keeps it; B tries to take it without waiting.', hint: 'pg_try_advisory_lock(777)', two: [
      ['A', 'SELECT pg_try_advisory_lock(777) AS got_it;'],
      ['B', 'SELECT pg_try_advisory_lock(777) AS got_it;'],
      ['A', 'SELECT pg_advisory_unlock(777);'],
      ['B', 'SELECT pg_try_advisory_lock(777) AS got_it;']
    ], why: 'A: t; B: f, so B exits ("already running"); after A unlocks, B gets it. A session-level lock fits here because the job holds it across many transactions; if the job crashes, its connection closes and the lock goes with it, so it can never be left stuck.', expectOut: 'got_it[\\s\\S]*\\bt\\b[\\s\\S]*got_it[\\s\\S]*\\bf\\b[\\s\\S]*got_it[\\s\\S]*\\bt\\b' },
    { pts: 1, q: 'Show the advisory lock in pg_locks: in one transaction, take <code>pg_advisory_xact_lock(777)</code>, then list your own advisory locks (locktype, objid, mode, granted).', hint: "pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()", sql: "SELECT pg_advisory_xact_lock(777);\nSELECT locktype, objid, mode, granted\nFROM pg_locks\nWHERE locktype = 'advisory' AND pid = pg_backend_pid();", why: 'One advisory lock, objid 777, ExclusiveLock, granted. The <code>pg_advisory_lock_shared</code> variants take a ShareLock instead (many readers, one writer).', expectRows: 1 },
    { pts: 1, q: 'Without any constraint, two parallel "subscribe if not exists" requests created two rows for aarav@mail.test (the lesson\'s first example). Write the query that finds such duplicates in subscribers, case-insensitively: email, copies.', hint: 'GROUP BY lower(email) HAVING count(*) > 1', setup: subs, steps: [
      "INSERT INTO subscribers VALUES ('aarav@mail.test', 'free'), ('Aarav@Mail.test', 'pro'), ('diya@mail.test', 'free');",
      'SELECT lower(email) AS email, count(*) AS copies FROM subscribers GROUP BY 1 HAVING count(*) > 1;'
    ], why: 'aarav@mail.test, 2 copies. Find and clean duplicates first; only then can you add the unique index (on lower(email)) that stops them from coming back (Session 40 Q13).', expectOut: 'aarav@mail\\.test \\|\\s+2' },
    { pts: 2, q: 'Idempotent payments. Create payment_requests (idempotency_key primary key, account_id, amount). The client sends "charge Aarav 300" with key \'req-7f3a\', times out, and retries with the same key. Write one transaction that records the key and debits the account <b>only if the key is new</b>, and run it twice.', hint: 'WITH ins AS (INSERT … ON CONFLICT DO NOTHING RETURNING …) UPDATE accounts … WHERE EXISTS (SELECT 1 FROM ins)', setup: idem, steps: [
      "WITH req AS (\n  INSERT INTO payment_requests (idempotency_key, account_id, amount)\n  VALUES ('req-7f3a', 1, 300)\n  ON CONFLICT (idempotency_key) DO NOTHING\n  RETURNING account_id, amount\n)\nUPDATE accounts a SET balance = balance - req.amount\nFROM req WHERE a.account_id = req.account_id\nRETURNING a.account_id, a.balance;",
      "WITH req AS (\n  INSERT INTO payment_requests (idempotency_key, account_id, amount)\n  VALUES ('req-7f3a', 1, 300)\n  ON CONFLICT (idempotency_key) DO NOTHING\n  RETURNING account_id, amount\n)\nUPDATE accounts a SET balance = balance - req.amount\nFROM req WHERE a.account_id = req.account_id\nRETURNING a.account_id, a.balance;",
      'SELECT balance FROM accounts WHERE account_id = 1;'
    ], why: 'The first run debits 300 (4,700); the retry inserts nothing, so the UPDATE has no row to join and debits nothing. The key and the debit are in one statement, so they cannot get out of step. A real API also stores the response with the key and returns it again on a retry.', expectOut: '4700\\.00[\\s\\S]*\\(0 rows\\)[\\s\\S]*4700\\.00' },
    { pts: 2, q: 'Same idempotent statement, but the client\'s two attempts arrive <b>concurrently</b>: A runs it inside an open transaction, B runs it while A has not committed yet.', hint: 'The same statement in both terminals.', setup: idem, two: [
      ['A', 'BEGIN;'],
      ['A', "WITH req AS (INSERT INTO payment_requests (idempotency_key, account_id, amount) VALUES ('req-7f3a', 1, 300) ON CONFLICT (idempotency_key) DO NOTHING RETURNING account_id, amount)\nUPDATE accounts a SET balance = balance - req.amount FROM req WHERE a.account_id = req.account_id RETURNING a.balance;"],
      ['B', "WITH req AS (INSERT INTO payment_requests (idempotency_key, account_id, amount) VALUES ('req-7f3a', 1, 300) ON CONFLICT (idempotency_key) DO NOTHING RETURNING account_id, amount)\nUPDATE accounts a SET balance = balance - req.amount FROM req WHERE a.account_id = req.account_id RETURNING a.balance;"],
      ['A', 'COMMIT;'],
      ['A', 'SELECT balance FROM accounts WHERE account_id = 1;']
    ], why: 'B waits on A\'s uncommitted key, then finds it committed and does nothing (0 rows): one debit of 300. If A had rolled back (say, the debit failed a check), B would have performed the payment instead. The unique key turns two racing attempts into one.', expectOut: 'blocked[\\s\\S]*\\(0 rows\\)[\\s\\S]*4700\\.00' },
    { pts: 2, q: 'Overlapping room bookings. With the exclusion constraint from the lesson, book room 1 for Aarav 19:00–21:00, then try Diya 21:00–23:00 and Kabir 20:30–21:30. Which ones succeed?', hint: 'tstzrange bounds are [from, to): 21:00 is free again for Diya.', setup: rooms, steps: [
      "INSERT INTO room_bookings VALUES (1, '[2026-02-20 19:00+05:30, 2026-02-20 21:00+05:30)', 'Aarav');",
      "INSERT INTO room_bookings VALUES (1, '[2026-02-20 21:00+05:30, 2026-02-20 23:00+05:30)', 'Diya');",
      "INSERT INTO room_bookings VALUES (1, '[2026-02-20 20:30+05:30, 2026-02-20 21:30+05:30)', 'Kabir');",
      'SELECT guest, during FROM room_bookings ORDER BY lower(during);'
    ], why: 'Aarav and Diya succeed (back-to-back ranges do not overlap with half-open bounds); Kabir fails, overlapping both. The DETAIL names the conflicting booking. Your Visitly bookings table should have exactly this constraint (Session 43 Apply).', expectOut: 'INSERT 0 1[\\s\\S]*INSERT 0 1[\\s\\S]*conflicting key value violates exclusion constraint[\\s\\S]*\\(2 rows\\)' },
    { pts: 2, q: 'Gapless invoice numbers. A sequence has gaps (Session 55), but the law may require invoice numbers without gaps. With a counter table (year, last_no = 41), A and B each create an invoice at the same time: lock the counter row, increment it, insert the invoice with the new number.', hint: 'UPDATE invoice_counter SET last_no = last_no + 1 WHERE year = 2026 RETURNING last_no — the row lock queues the writers.', setup: invoices, two: [
      ['A', 'BEGIN;'],
      ['A', 'WITH n AS (UPDATE invoice_counter SET last_no = last_no + 1 WHERE year = 2026 RETURNING last_no)\nINSERT INTO invoices SELECT 2026, last_no, 3 FROM n RETURNING no;'],
      ['B', 'BEGIN;'],
      ['B', 'WITH n AS (UPDATE invoice_counter SET last_no = last_no + 1 WHERE year = 2026 RETURNING last_no)\nINSERT INTO invoices SELECT 2026, last_no, 5 FROM n RETURNING no;'],
      ['A', 'COMMIT;'],
      ['B', 'COMMIT;'],
      ['A', 'SELECT year, no, customer_id FROM invoices ORDER BY no;']
    ], why: 'A gets 42; B waits on the counter row and gets 43 after A commits. If A had rolled back, its increment would be undone too and B would get 42: no gap. The price is that invoice creation is serialised (one at a time per year), which is fine for invoices and fatal for a hot table. That is why ordinary ids use sequences.', expectOut: 'blocked[\\s\\S]*\\b42\\b[\\s\\S]*\\b43\\b' },
    { pts: 2, q: 'Serialise per customer, not globally: A and B both start a "recalculate loyalty points" job, A for customer 3, B first for customer 3 and then for customer 5. Use <code>pg_advisory_xact_lock(hashtext(…))</code> with a per-customer key.', hint: "hashtext('loyalty:' || customer_id)", two: [
      ['A', 'BEGIN;'],
      ['A', "SELECT pg_advisory_xact_lock(hashtext('loyalty:3'));"],
      ['B', 'BEGIN;'],
      ['B', "SELECT pg_try_advisory_xact_lock(hashtext('loyalty:3')) AS customer_3, pg_try_advisory_xact_lock(hashtext('loyalty:5')) AS customer_5;"],
      ['B', "SELECT pg_advisory_xact_lock(hashtext('loyalty:3'));"],
      ['A', 'COMMIT;'],
      ['B', 'COMMIT;']
    ], why: 'B cannot get customer 3 (f) but gets customer 5 (t) at once; its blocking request for customer 3 then waits until A commits. Different customers run in parallel, the same customer never twice. A per-key advisory lock is the tool for "one at a time per X" when X has no row you could lock (or locking that row would block unrelated work).', expectOut: 'customer_3 \\| customer_5[\\s\\S]*\\bf\\s+\\| t\\b[\\s\\S]*blocked[\\s\\S]*finishes' },
    { pts: 2, q: 'The pooler trap, demonstrated: in one session, take a <b>session-level</b> advisory lock inside a transaction, commit, and check whether you still hold it. Then do the same with the <code>_xact_</code> version.', hint: "pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()", steps: [
      'BEGIN;',
      'SELECT pg_advisory_lock(1001);',
      'COMMIT;',
      "SELECT count(*) AS still_held FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid();",
      'SELECT pg_advisory_unlock(1001);',
      'BEGIN;',
      'SELECT pg_advisory_xact_lock(1002);',
      'COMMIT;',
      "SELECT count(*) AS still_held FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid();"
    ], why: 'The session lock is still held after COMMIT (1); the transaction lock is gone (0). Behind a pooler in transaction mode, a forgotten session lock stays on a pooled connection and blocks whoever wants that key next, possibly forever. Prefer <code>_xact_</code> locks, and if you must use session locks, always unlock in a finally block.', expectOut: 'still_held\\n-+\\n\\s+1[\\s\\S]*still_held\\n-+\\n\\s+0' }
  ],
  hard: {
    q: 'A seat-limited event: the cooking class has 3 seats. Bookings arrive concurrently. Make it impossible to sell a 4th seat, without SERIALIZABLE, by locking the class row while counting. Create classes (class_id, seats) and class_bookings (class_id, guest), give the class 3 seats and 2 bookings, then let A and B each book the last seat at the same time with a single statement that inserts only if a seat is free. Show the final bookings.',
    hint: 'INSERT … SELECT … FROM classes c WHERE c.class_id = 1 AND (SELECT count(*) …) < c.seats — but lock the class row first (SELECT … FOR UPDATE) so the count is taken after the other booking commits.',
    setup: "CREATE TABLE classes (class_id int PRIMARY KEY, seats int NOT NULL);\nCREATE TABLE class_bookings (class_id int REFERENCES classes, guest text);\nINSERT INTO classes VALUES (1, 3);\nINSERT INTO class_bookings VALUES (1, 'Aarav'), (1, 'Diya');",
    two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT seats FROM classes WHERE class_id = 1 FOR UPDATE;'],
      ['A', "INSERT INTO class_bookings\nSELECT 1, 'Kabir'\nWHERE (SELECT count(*) FROM class_bookings WHERE class_id = 1) < (SELECT seats FROM classes WHERE class_id = 1);"],
      ['B', 'BEGIN;'],
      ['B', 'SELECT seats FROM classes WHERE class_id = 1 FOR UPDATE;'],
      ['A', 'COMMIT;'],
      ['B', "INSERT INTO class_bookings\nSELECT 1, 'Ananya'\nWHERE (SELECT count(*) FROM class_bookings WHERE class_id = 1) < (SELECT seats FROM classes WHERE class_id = 1);"],
      ['B', 'COMMIT;'],
      ['A', 'SELECT guest FROM class_bookings ORDER BY guest;']
    ],
    why: 'A books Kabir (INSERT 0 1). B\'s FOR UPDATE on the class row waits until A commits; its INSERT then runs as a new statement in READ COMMITTED, counts 3 bookings and inserts nothing (INSERT 0 0). Without the lock on the class row both would count 2 and both would insert: the write skew of Session 57. Locking a "parent" row is the standard way to protect a rule about a set of child rows ("at most N per X"). Alternatives: a <code>booked</code> counter column on classes with <code>CHECK (booked &lt;= seats)</code> updated in the same transaction, or SERIALIZABLE with retries.',
    expectOut: 'INSERT 0 1[\\s\\S]*blocked[\\s\\S]*INSERT 0 0[\\s\\S]*\\(3 rows\\)'
  }
};
