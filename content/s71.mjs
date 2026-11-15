const counts = "CREATE TABLE customer_order_counts (customer_id int PRIMARY KEY, n bigint NOT NULL);\nINSERT INTO customer_order_counts SELECT customer_id, count(*) FROM orders GROUP BY customer_id;\n\nCREATE FUNCTION count_orders() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  IF TG_OP IN ('INSERT', 'UPDATE') THEN\n    INSERT INTO customer_order_counts VALUES (NEW.customer_id, 1)\n    ON CONFLICT (customer_id) DO UPDATE SET n = customer_order_counts.n + 1;\n  END IF;\n  IF TG_OP IN ('DELETE', 'UPDATE') THEN\n    UPDATE customer_order_counts SET n = n - 1 WHERE customer_id = OLD.customer_id;\n  END IF;\n  RETURN NULL;\nEND;\n$$;\n\nCREATE TRIGGER orders_count AFTER INSERT OR DELETE OR UPDATE OF customer_id ON orders\n  FOR EACH ROW EXECUTE FUNCTION count_orders();";
const moneyCheck = "CREATE FUNCTION check_total() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  IF (SELECT sum(balance) FROM accounts) <> 9200 THEN\n    RAISE EXCEPTION 'money was created or lost: total is %', (SELECT sum(balance) FROM accounts);\n  END IF;\n  RETURN NULL;\nEND;\n$$;\n\nCREATE CONSTRAINT TRIGGER accounts_total AFTER INSERT OR UPDATE OR DELETE ON accounts\n  DEFERRABLE INITIALLY DEFERRED\n  FOR EACH ROW EXECUTE FUNCTION check_total();";
const jobNotify = "CREATE FUNCTION notify_job() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  PERFORM pg_notify('jobs_ready', NEW.job_id::text);\n  RETURN NULL;\nEND;\n$$;\n\nCREATE TRIGGER jobs_notify AFTER INSERT ON jobs FOR EACH ROW\n  WHEN (NEW.status = 'queued' AND NEW.run_after <= now())\n  EXECUTE FUNCTION notify_job();";
const outbox = "CREATE TABLE outbox (\n  event_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  event_type text NOT NULL,\n  payload    jsonb NOT NULL,\n  created_at timestamptz NOT NULL DEFAULT now()\n);\n\nCREATE FUNCTION order_status_event() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  INSERT INTO outbox (event_type, payload)\n  VALUES ('order_' || NEW.status, jsonb_build_object('order_id', NEW.order_id, 'from', OLD.status, 'to', NEW.status));\n  RETURN NULL;\nEND;\n$$;\n\nCREATE TRIGGER orders_outbox AFTER UPDATE OF status ON orders FOR EACH ROW\n  WHEN (OLD.status IS DISTINCT FROM NEW.status)\n  EXECUTE FUNCTION order_status_event();";

export default {
  n: 71,
  phase: 'p7',
  title: 'Triggers 2: summaries, views, deferred checks and LISTEN/NOTIFY',
  goal: 'Keep summary tables correct, make join views writable, check rules at COMMIT, react to DDL, and tell other programs about changes the moment they commit.',
  minutes: 150,
  lesson: [
    { h: 'More kinds of triggers' },
    { pre: "INSTEAD OF … ON a_view FOR EACH ROW     run instead of the INSERT/UPDATE/DELETE on a view\nCREATE CONSTRAINT TRIGGER …\n  DEFERRABLE INITIALLY DEFERRED          an AFTER ROW trigger that runs at COMMIT\nCREATE EVENT TRIGGER … ON ddl_command_end  runs on CREATE / ALTER / DROP, not on rows", lang: 'text' },
    { h: 'Summary tables' },
    { p: 'A count that a dashboard needs a thousand times a second can be kept in a small table and updated by a trigger. Always change it with an atomic statement (<code>n = n + 1</code> or an upsert), never by reading the old value first (Session 57). The cost: every order for the same customer now updates the same summary row, so concurrent writers queue on that row lock (Q2).' },
    { h: 'LISTEN / NOTIFY' },
    { p: 'A session runs <code>LISTEN jobs_ready;</code>. Any other session runs <code>NOTIFY jobs_ready, \'42\'</code> (or <code>SELECT pg_notify(\'jobs_ready\', \'42\')</code>, which takes the channel as a value). Every listener gets the message, but only <b>when the sending transaction commits</b>; a rollback sends nothing. Workers can sleep until there is work instead of polling every second.' },
    { two: [
      ['B', 'LISTEN jobs_ready;'],
      ['A', 'BEGIN;'],
      ['A', "NOTIFY jobs_ready, 'job 11';"],
      ['B', 'SELECT 1 AS before_commit;'],
      ['A', 'COMMIT;'],
      ['B', 'SELECT 1 AS after_commit;']
    ], expectOut: 'before_commit\\n-+\\n\\s+1\\n\\(1 row\\)\\n\\s*A=[\\s\\S]*after_commit\\n-+\\n\\s+1\\n\\(1 row\\)\\nAsynchronous notification "jobs_ready" with payload "job 11"' },
    { p: 'psql only shows a notification after the next command it runs, which is why B runs a SELECT. Real listeners (drivers like psycopg or node-postgres) receive them as events.' },
    { trap: 'NOTIFY is not a queue. A listener that is disconnected when the message is sent never gets it, and payloads are limited to 8,000 bytes. Keep the real work in a table (jobs, outbox) and use NOTIFY only as a "wake up and look" signal.' }
  ],
  questions: [
    { pts: 1, q: 'Create customer_order_counts with the count_orders() trigger (code below), then insert order 37 for customer 3, move it to customer 5, insert order 38 for customer 3 and delete it again. Compare the summary with a real count for customers 3 and 5.', hint: 'The trigger code is in the answer; read it first. Moving an order is an UPDATE of customer_id.', steps: [counts, "INSERT INTO orders VALUES (37, 3, '2026-02-20', 'pending', 'Pune');", 'UPDATE orders SET customer_id = 5 WHERE order_id = 37;', "INSERT INTO orders VALUES (38, 3, '2026-02-20', 'pending', 'Pune');", 'DELETE FROM orders WHERE order_id = 38;', "SELECT s.customer_id, s.n AS summary, (SELECT count(*) FROM orders o WHERE o.customer_id = s.customer_id) AS real\nFROM customer_order_counts s\nWHERE s.customer_id IN (3, 5)\nORDER BY s.customer_id;"], why: 'Customer 3 is back to 3 and customer 5 went from 3 to 4; summary and real count agree. The upsert also covers a customer\'s first order (no summary row yet). UPDATE OF customer_id moves the count when an order is reassigned. Check a summary against the truth with a query like this one from time to time: a trigger that was disabled once (Session 69 Q12) means drift forever.', expectOut: '\\s+3 \\|\\s+3 \\|\\s+3\\n\\s+5 \\|\\s+4 \\|\\s+4\\n' },
    { pts: 1, q: 'The cost of a summary row: with the counting trigger in place, A and B each insert an order for customer 3 in their own transaction. What happens to B?', hint: 'Both triggers update the same customer_order_counts row.', setup: counts, showSetup: true, two: [
      ['A', 'BEGIN;'],
      ['A', "INSERT INTO orders VALUES (37, 3, '2026-02-20', 'pending', 'Pune');"],
      ['B', "INSERT INTO orders VALUES (38, 3, '2026-02-20', 'pending', 'Pune');"],
      ['A', 'COMMIT;'],
      ['B', 'SELECT n FROM customer_order_counts WHERE customer_id = 3;']
    ], why: 'B is blocked until A commits: the orders do not conflict, but both triggers update the same summary row. Then B adds its 1 and the count is 5. Correct, but every write for the same customer is serialised. For hot counters, insert +1/−1 rows into a delta table and add them up periodically, or count on demand with an index.', expectOut: 'blocked[\\s\\S]*\\b5\\n\\s*\\(1 row\\)' },
    { pts: 1, q: 'Make a join view writable: create order_view (order_id, status, customer name) over orders JOIN customers, try to UPDATE its status, then add an INSTEAD OF UPDATE trigger that changes orders.status and rejects name changes. Try again.', hint: 'An INSTEAD OF trigger returns NEW to report one updated row (or NULL for zero).', steps: [
      "CREATE VIEW order_view AS\nSELECT o.order_id, o.status, c.full_name\nFROM orders o JOIN customers c ON c.customer_id = o.customer_id;",
      "UPDATE order_view SET status = 'shipped' WHERE order_id = 30;",
      "CREATE FUNCTION order_view_update() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN\n    RAISE EXCEPTION 'change the name in customers, not through order_view';\n  END IF;\n  UPDATE orders SET status = NEW.status WHERE order_id = OLD.order_id;\n  RETURN NEW;\nEND;\n$$;",
      'CREATE TRIGGER order_view_update INSTEAD OF UPDATE ON order_view FOR EACH ROW EXECUTE FUNCTION order_view_update();',
      "UPDATE order_view SET status = 'shipped' WHERE order_id = 30;",
      "UPDATE order_view SET full_name = 'Someone Else' WHERE order_id = 30;",
      'SELECT order_id, status FROM orders WHERE order_id = 30;'
    ], why: 'The first UPDATE fails ("cannot update view"; a view over a join is not automatically updatable, Session 60). With the trigger, the status change works (UPDATE 1) and the name change is rejected. Useful when old code writes to a table you have split into two (Sessions 73–74: the view keeps the old shape).', expectOut: 'cannot update view "order_view"[\\s\\S]*UPDATE 1[\\s\\S]*change the name in customers[\\s\\S]*30 \\| shipped' },
    { pts: 2, q: 'A check at COMMIT: create the deferred constraint trigger accounts_total (code below) that requires the total to be 9,200. Run a two-statement transfer in a transaction, then a transaction that only debits.', hint: 'The trigger fires after every row change, but not before COMMIT.', steps: [moneyCheck, 'BEGIN;', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;', 'UPDATE accounts SET balance = balance + 100 WHERE account_id = 2;', 'COMMIT;', 'BEGIN;', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;', 'COMMIT;', 'SELECT sum(balance) FROM accounts;'], why: 'The transfer commits: in the middle the total was 9,100, but nobody checked until COMMIT. The debit-only transaction fails <i>at COMMIT</i> and is rolled back; the total stays 9,200. This fixes Session 69 Q8, where a statement-level check rejected a correct two-step transfer. (The check reads the whole table per changed row, fine for 4 accounts; a real system sums only what the transaction changed.)', expectOut: 'COMMIT\\n[\\s\\S]*UPDATE 1\\npractice=\\*# COMMIT;\\nERROR:  money was created or lost: total is 9100\\.00[\\s\\S]*9200\\.00' },
    { pts: 2, q: 'Check early when you want to: in a transaction with the deferred check, debit 100, then run <code>SET CONSTRAINTS accounts_total IMMEDIATE;</code>. What happens, and when?', hint: 'SET CONSTRAINTS … IMMEDIATE runs the pending checks right away.', steps: [moneyCheck, 'BEGIN;', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;', 'SET CONSTRAINTS accounts_total IMMEDIATE;', 'ROLLBACK;'], why: 'The SET CONSTRAINTS statement itself fails with the money error: pending deferred checks run at that moment. Use it to find out before a long transaction continues, or to check at a known point in a batch. Deferred foreign keys work the same way (DEFERRABLE on the constraint).', expectOut: 'SET CONSTRAINTS accounts_total IMMEDIATE;\\nERROR:  money was created or lost' },
    { pts: 2, q: 'Log every schema change: create ddl_log, an event trigger function that records the command tag and object for each DDL command, and an event trigger on ddl_command_end. Then create a table, add a column, create an index, and show the log.', hint: 'RETURNS event_trigger; FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP …', steps: [
      'CREATE TABLE ddl_log (logged_at timestamptz DEFAULT now(), username text DEFAULT current_user, command text, object text);',
      "CREATE FUNCTION log_ddl() RETURNS event_trigger\nLANGUAGE plpgsql AS $$\nDECLARE\n  r record;\nBEGIN\n  FOR r IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP\n    INSERT INTO ddl_log (command, object) VALUES (r.command_tag, r.object_identity);\n  END LOOP;\nEND;\n$$;",
      'CREATE EVENT TRIGGER log_ddl ON ddl_command_end EXECUTE FUNCTION log_ddl();',
      'CREATE TABLE coupons (code text PRIMARY KEY, pct int);',
      'ALTER TABLE coupons ADD COLUMN expires date;',
      'CREATE INDEX ON coupons (expires);',
      'SELECT command, object FROM ddl_log;'
    ], why: 'Four rows: CREATE TABLE public.coupons, CREATE INDEX public.coupons_pkey (the primary key\'s index), ALTER TABLE public.coupons, CREATE INDEX public.coupons_expires_idx. Event triggers are database-wide and need a superuser to create. Teams use them to audit who changed the schema in production, and to block dangerous commands (Q7).', expectOut: 'CREATE TABLE \\| public\\.coupons\\n[\\s\\S]*ALTER TABLE\\s+\\| public\\.coupons\\n[\\s\\S]*CREATE INDEX \\| public\\.coupons_expires_idx' },
    { pts: 2, q: 'Block DROP TABLE: an event trigger on ddl_command_start, limited with <code>WHEN TAG IN (\'DROP TABLE\')</code>, that raises unless the setting app.allow_drop is \'on\'. Try to drop jobs, then allow it for one transaction with SET LOCAL.', hint: "current_setting('app.allow_drop', true) returns NULL when the setting does not exist.", steps: [
      "CREATE FUNCTION no_drop_table() RETURNS event_trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  IF current_setting('app.allow_drop', true) IS DISTINCT FROM 'on' THEN\n    RAISE EXCEPTION 'DROP TABLE is blocked'\n      USING HINT = 'SET LOCAL app.allow_drop = on inside the transaction if you really mean it.';\n  END IF;\nEND;\n$$;",
      "CREATE EVENT TRIGGER no_drop_table ON ddl_command_start WHEN TAG IN ('DROP TABLE') EXECUTE FUNCTION no_drop_table();",
      'DROP TABLE jobs;',
      'BEGIN;',
      'SET LOCAL app.allow_drop = on;',
      'DROP TABLE jobs;',
      'ROLLBACK;'
    ], why: 'The first DROP is blocked with the hint; inside the transaction with the setting it goes through (and the ROLLBACK brings jobs back anyway). A seatbelt against a wrong terminal window, not security: a superuser can disable event triggers. Real protection is privileges (Session 72).', expectOut: 'ERROR:  DROP TABLE is blocked\\nHINT:  SET LOCAL[\\s\\S]*SET\\n[\\s\\S]*DROP TABLE\\n[\\s\\S]*ROLLBACK' },
    { pts: 1, q: 'NOTIFY from a trigger, and rollback: attach the jobs_notify trigger (code below; it notifies for due jobs). B listens. A inserts job 11 and rolls back; then inserts job 12 and commits. What does B receive?', hint: 'Notifications are sent at commit only.', setup: jobNotify, showSetup: true, two: [
      ['B', 'LISTEN jobs_ready;'],
      ['A', 'BEGIN;'],
      ['A', "INSERT INTO jobs (job_id, kind, run_after) VALUES (11, 'send_email', now());"],
      ['A', 'ROLLBACK;'],
      ['B', 'SELECT 1 AS after_rollback;'],
      ['A', "INSERT INTO jobs (job_id, kind, run_after) VALUES (12, 'send_email', now());"],
      ['B', 'SELECT 1 AS after_commit;']
    ], why: 'Nothing after the rollback; "12" after the commit. A worker woken by the message will always find job 12 in the table, because the notification is sent only after the row is visible. That is what makes NOTIFY safe to send from inside a transaction.', expectOut: 'after_rollback\\n-+\\n\\s+1\\n\\(1 row\\)\\n\\s*A=[\\s\\S]*after_commit\\n-+\\n\\s+1\\n\\(1 row\\)\\nAsynchronous notification "jobs_ready" with payload "12"' },
    { pts: 1, q: 'Duplicates in one transaction: A sends <code>NOTIFY ping, \'a\'</code> twice and <code>NOTIFY ping, \'b\'</code> once in one transaction. How many notifications does B get?', hint: 'Identical channel + payload in the same transaction are folded together.', two: [
      ['B', 'LISTEN ping;'],
      ['A', 'BEGIN;'],
      ['A', "NOTIFY ping, 'a';"],
      ['A', "NOTIFY ping, 'a';"],
      ['A', "NOTIFY ping, 'b';"],
      ['A', 'COMMIT;'],
      ['B', 'SELECT 1;']
    ], why: 'Two: "a" once and "b". A trigger that notifies for each of 10,000 updated rows with the same payload sends one message; with job_id in the payload it sends 10,000. For bulk changes, notify from a statement-level trigger, or just send "something changed" and let the listener read the table.', expectOut: 'payload "a" received[^\\n]*\\nAsynchronous notification "ping" with payload "b" received[^\\n]*\\n*$' },
    { pts: 2, q: 'The outbox pattern: create the outbox table and the orders_outbox trigger (code below). Ship order 30, then deliver it. Then act as the relay: take up to 10 events with FOR UPDATE SKIP LOCKED, delete them, and return them (in a real system: publish them to a message broker, then commit).', hint: 'DELETE FROM outbox WHERE event_id IN (SELECT event_id FROM outbox ORDER BY event_id LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING …', steps: [
      outbox,
      "UPDATE orders SET status = 'shipped' WHERE order_id = 30;",
      "UPDATE orders SET status = 'delivered' WHERE order_id = 30;",
      "DELETE FROM outbox\nWHERE event_id IN (SELECT event_id FROM outbox ORDER BY event_id LIMIT 10 FOR UPDATE SKIP LOCKED)\nRETURNING event_id, event_type, payload;",
      'SELECT count(*) AS left_in_outbox FROM outbox;'
    ], why: 'Two events, order_shipped and order_delivered, in order; the outbox is then empty. The event is written in the same transaction as the change, so you never publish "shipped" for an update that rolled back, and never lose one for an update that committed. Sending to a broker directly from the app cannot promise both. SKIP LOCKED lets several relays run (Session 58).', expectOut: 'order_shipped\\s+\\| \\{"to": "shipped", "from": "pending", "order_id": 30\\}[\\s\\S]*order_delivered[\\s\\S]*left_in_outbox\\n-+\\n\\s+0' },
    { pts: 2, q: 'A bulk-friendly summary: replace the row-level counter with an AFTER INSERT statement-level trigger that reads a transition table and does one grouped upsert. Insert three orders (two for customer 3, one for customer 5) in one INSERT.', hint: 'INSERT INTO customer_order_counts SELECT customer_id, count(*) FROM new_rows GROUP BY customer_id ON CONFLICT (customer_id) DO UPDATE SET n = customer_order_counts.n + EXCLUDED.n;', steps: [
      "CREATE TABLE customer_order_counts (customer_id int PRIMARY KEY, n bigint NOT NULL);\nINSERT INTO customer_order_counts SELECT customer_id, count(*) FROM orders GROUP BY customer_id;",
      "CREATE FUNCTION count_new_orders() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  INSERT INTO customer_order_counts\n  SELECT customer_id, count(*) FROM new_rows GROUP BY customer_id\n  ON CONFLICT (customer_id) DO UPDATE SET n = customer_order_counts.n + EXCLUDED.n;\n  RETURN NULL;\nEND;\n$$;",
      'CREATE TRIGGER orders_count_bulk AFTER INSERT ON orders REFERENCING NEW TABLE AS new_rows\n  FOR EACH STATEMENT EXECUTE FUNCTION count_new_orders();',
      "INSERT INTO orders VALUES\n  (37, 3, '2026-02-20', 'pending', 'Pune'),\n  (38, 3, '2026-02-20', 'pending', 'Pune'),\n  (39, 5, '2026-02-20', 'pending', 'Delhi');",
      'SELECT customer_id, n FROM customer_order_counts WHERE customer_id IN (3, 5) ORDER BY customer_id;'
    ], why: 'Customer 3 goes from 3 to 5 and customer 5 gains 1, with one trigger call and one upsert for the whole INSERT. With a row-level trigger a 100,000-row import would run 100,000 upserts. A grouped upsert also touches each summary row once, which keeps lock waits short.', expectOut: '\\b3 \\|\\s+5\\n' }
  ],
  hard: {
    q: 'A worker that sleeps until there is work: with the jobs_notify trigger in place, B is a worker that LISTENs on jobs_ready. A queues two jobs in one transaction: job 11 due now and job 12 for tomorrow, and commits. B wakes on the notification and claims one due job with the claim statement from Session 58 (SKIP LOCKED). Which notifications does B get, and which job does it claim?',
    hint: "Claim: UPDATE jobs SET status = 'running', locked_by = 'worker-B', locked_at = now(), attempts = attempts + 1 WHERE job_id = (SELECT job_id FROM jobs WHERE status = 'queued' AND run_after <= now() ORDER BY run_after, job_id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING job_id;",
    setup: jobNotify, showSetup: true,
    two: [
      ['B', 'LISTEN jobs_ready;'],
      ['A', 'BEGIN;'],
      ['A', "INSERT INTO jobs (job_id, kind, run_after) VALUES (11, 'send_email', now()),\n                                              (12, 'send_email', now() + interval '1 day');"],
      ['A', 'COMMIT;'],
      ['B', "UPDATE jobs SET status = 'running', locked_by = 'worker-B', locked_at = now(), attempts = attempts + 1\nWHERE job_id = (SELECT job_id FROM jobs WHERE status = 'queued' AND run_after <= now()\n                ORDER BY run_after, job_id LIMIT 1 FOR UPDATE SKIP LOCKED)\nRETURNING job_id, kind;"]
    ],
    why: 'One notification ("11"): the trigger\'s WHEN skipped job 12, which is not due. But B claims job 4, not 11: the oldest due job wins, and 4 to 10 were already waiting. That is the right design: the notification only says "look now", and the claim query decides what to take. Job 12 needs a timer anyway (a worker still polls, say, every 30 s for jobs that become due later); LISTEN just removes the delay for new work.',
    expectOut: 'job_id \\|\\s+kind\\n-+\\+-+\\n\\s+4 \\| send_email\\n\\(1 row\\)\\nAsynchronous notification "jobs_ready" with payload "11"'
  }
};
