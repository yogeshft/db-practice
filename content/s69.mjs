const auditTable = "CREATE TABLE audit_log (\n  audit_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  table_name text NOT NULL,\n  op         text NOT NULL,\n  old_row    jsonb,\n  new_row    jsonb,\n  changed_by text NOT NULL DEFAULT current_user,\n  changed_at timestamptz NOT NULL DEFAULT now()\n);";
const auditFn = "CREATE FUNCTION audit() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  INSERT INTO audit_log (table_name, op, old_row, new_row)\n  VALUES (TG_TABLE_NAME, TG_OP, to_jsonb(OLD), to_jsonb(NEW));   -- OLD is NULL on INSERT, NEW on DELETE\n  RETURN NULL;                                                     -- ignored for AFTER triggers\nEND;\n$$;";
const lowerEmail = "CREATE FUNCTION normalize_email() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  NEW.email := lower(trim(NEW.email));\n  RETURN NEW;\nEND;\n$$;";
const newCustomer = "INSERT INTO customers (customer_id, full_name, email, city, signup_date)\nVALUES (21, 'Tara Iyer', '  Tara.Iyer@Mail.TEST ', 'Pune', '2026-02-20');";

export default {
  n: 69,
  phase: 'p7',
  title: 'Triggers',
  goal: 'Run code automatically when rows change: fill in and clean values, enforce rules, keep an audit trail, and know when a trigger is the wrong tool.',
  minutes: 150,
  lesson: [
    { h: 'Two parts' },
    { p: 'A <b>trigger function</b> (RETURNS trigger, no arguments) holds the code. <code>CREATE TRIGGER</code> attaches it to a table and says when it runs. One function can serve many tables.' },
    { pre: "CREATE TRIGGER customers_email\n  BEFORE INSERT OR UPDATE OF email ON customers   -- when: BEFORE / AFTER, which events, which columns\n  FOR EACH ROW                                   -- once per row (or FOR EACH STATEMENT)\n  WHEN (NEW.email IS NOT NULL)                   -- optional filter, checked before calling the function\n  EXECUTE FUNCTION normalize_email();", lang: 'text' },
    { h: 'What the function sees' },
    { list: [
      '<code>NEW</code>: the row being written (INSERT, UPDATE). <code>OLD</code>: the row before (UPDATE, DELETE).',
      '<code>TG_OP</code> (INSERT, UPDATE, DELETE, TRUNCATE), <code>TG_TABLE_NAME</code>, <code>TG_WHEN</code>, <code>TG_LEVEL</code>.',
      '<b>BEFORE ROW</b>: may change NEW, and its return value matters: return NEW (or OLD for DELETE) to go ahead, return NULL to <i>silently skip</i> this row.',
      '<b>AFTER ROW</b>: the row is written; the return value is ignored. Use it for side effects: audit rows, queue entries, summaries.',
      '<b>Statement-level</b>: runs once per statement, even if 0 rows changed; with <code>REFERENCING NEW TABLE AS …</code> it can read all changed rows at once.',
      'Several triggers on the same event run in <b>alphabetical order of their names</b>.'
    ] },
    { steps: [lowerEmail, 'CREATE TRIGGER customers_email BEFORE INSERT OR UPDATE OF email ON customers FOR EACH ROW EXECUTE FUNCTION normalize_email();', newCustomer, 'SELECT customer_id, email FROM customers WHERE customer_id = 21;'], expectOut: '21 \\| tara\\.iyer@mail\\.test' },
    { trap: 'Triggers are invisible. Someone reading <code>UPDATE accounts …</code> does not see the three triggers it fires. Use them for things that must happen <i>whatever</i> code writes the row (audit, timestamps, invariants); keep business workflows in functions and the application. And they run once per row: a 1,000,000-row UPDATE runs a row trigger 1,000,000 times.' }
  ],
  questions: [
    { pts: 1, q: 'Add <code>updated_at timestamptz</code> to products and a BEFORE UPDATE trigger that sets it to now(). Change the price of product 2 and show its updated_at compared with now().', hint: 'NEW.updated_at := now(); RETURN NEW;', sql: "ALTER TABLE products ADD COLUMN updated_at timestamptz;\n\nCREATE FUNCTION set_updated_at() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  NEW.updated_at := now();\n  RETURN NEW;\nEND;\n$$;\n\nCREATE TRIGGER products_updated_at BEFORE UPDATE ON products\n  FOR EACH ROW EXECUTE FUNCTION set_updated_at();\n\nUPDATE products SET price = 82000 WHERE product_id = 2;\n\nSELECT product_id, price, updated_at = now() AS stamped_now\nFROM products WHERE product_id IN (1, 2) ORDER BY product_id;", why: 'Product 2 is stamped (true); product 1 was not updated, so its updated_at is NULL. The trigger sets the column whatever the UPDATE says: even <code>SET updated_at = \'2000-01-01\'</code> is overwritten. set_updated_at() is generic: attach it to every table that has an updated_at column.', expectRows: 2 },
    { pts: 1, q: 'Create the normalize_email trigger from the lesson, insert Tara with email <code>\'  Tara.Iyer@Mail.TEST \'</code>, then update Aarav\'s email to <code>\'AARAV@MAIL.TEST\'</code>. Show both emails.', hint: 'BEFORE INSERT OR UPDATE OF email', steps: [lowerEmail, 'CREATE TRIGGER customers_email BEFORE INSERT OR UPDATE OF email ON customers FOR EACH ROW EXECUTE FUNCTION normalize_email();', newCustomer, "UPDATE customers SET email = 'AARAV@MAIL.TEST' WHERE customer_id = 1;", 'SELECT customer_id, email FROM customers WHERE customer_id IN (1, 21) ORDER BY customer_id;'], why: 'aarav@mail.test and tara.iyer@mail.test. Every path that writes an email (the app, an import script, a psql session) now stores it the same way, so a unique index on email really catches duplicates. A CHECK (email = lower(email)) would reject instead of fixing; both are valid choices.', expectOut: '1 \\| aarav@mail\\.test[\\s\\S]*21 \\| tara\\.iyer@mail\\.test' },
    { pts: 1, q: 'Validate in a trigger: bookings must start on the hour and be for at most 8 people. Write a BEFORE INSERT OR UPDATE trigger on table_bookings that raises a clear error otherwise, and try a booking at 19:30 and one for 10 people.', hint: "date_trunc('hour', NEW.slot) <> NEW.slot", steps: [
      "CREATE FUNCTION check_booking() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  IF date_trunc('hour', NEW.slot) <> NEW.slot THEN\n    RAISE EXCEPTION 'bookings start on the hour, got %', NEW.slot USING ERRCODE = 'check_violation';\n  END IF;\n  IF NEW.party_size > 8 THEN\n    RAISE EXCEPTION 'party of % is too large (max 8)', NEW.party_size USING ERRCODE = 'check_violation';\n  END IF;\n  RETURN NEW;\nEND;\n$$;",
      'CREATE TRIGGER table_bookings_check BEFORE INSERT OR UPDATE ON table_bookings FOR EACH ROW EXECUTE FUNCTION check_booking();',
      "INSERT INTO table_bookings VALUES (6, 4, '2026-02-20 19:30+05:30', 'Vivaan', 2);",
      "INSERT INTO table_bookings VALUES (7, 4, '2026-02-20 19:00+05:30', 'Neel', 10);"
    ], why: 'Both are rejected. Honestly, both rules fit in CHECK constraints (<code>CHECK (party_size &lt;= 8)</code>, <code>CHECK (date_trunc(\'hour\', slot) = slot)</code>), which are simpler and faster, and visible in \\d. Use a trigger for a rule only when it needs other rows or other tables, which CHECK cannot read.', expectOut: 'bookings start on the hour[\\s\\S]*party of 10 is too large \\(max 8\\)' },
    { pts: 1, q: 'An audit trail: create audit_log and the generic audit() function, attach it AFTER INSERT OR UPDATE OR DELETE on accounts, then: move 100 from Aarav to Diya, add account 5 (Ishaan, 0), delete account 4. Show the log.', hint: 'to_jsonb(OLD), to_jsonb(NEW); OLD is NULL on INSERT and NEW is NULL on DELETE.', steps: [
      auditTable, auditFn,
      'CREATE TRIGGER accounts_audit AFTER INSERT OR UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION audit();',
      'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;',
      'UPDATE accounts SET balance = balance + 100 WHERE account_id = 2;',
      "INSERT INTO accounts VALUES (5, 'Ishaan', 0);",
      'DELETE FROM accounts WHERE account_id = 4;',
      "SELECT audit_id, op, old_row->>'owner' AS owner, old_row->>'balance' AS old_balance, new_row->>'balance' AS new_balance\nFROM audit_log ORDER BY audit_id;"
    ], why: 'Four rows: two UPDATEs (5000 → 4900, 3000 → 3100), the INSERT (no old row) and the DELETE (no new row; Ananya\'s 1200 is preserved in old_row). jsonb makes one function and one log table work for every table. The log is written in the same transaction: if the change rolls back, so does its audit row.', expectOut: '1 \\| UPDATE \\| Aarav\\s+\\| 5000\\.00\\s+\\| 4900\\.00[\\s\\S]*3 \\| INSERT \\|[\\s\\S]*4 \\| DELETE \\| Ananya \\| 1200\\.00' },
    { pts: 1, q: 'Log only real balance changes: replace the UPDATE part of the audit with a trigger that has <code>WHEN (OLD.balance IS DISTINCT FROM NEW.balance)</code>. Rename Kabir to "Kabir S", then add 50 to Kabir. How many audit rows?', hint: 'A WHEN clause on an UPDATE trigger can compare OLD and NEW.', steps: [
      auditTable, auditFn,
      'CREATE TRIGGER accounts_audit_balance AFTER UPDATE ON accounts FOR EACH ROW\n  WHEN (OLD.balance IS DISTINCT FROM NEW.balance)\n  EXECUTE FUNCTION audit();',
      "UPDATE accounts SET owner = 'Kabir S' WHERE account_id = 3;",
      'UPDATE accounts SET balance = balance + 50 WHERE account_id = 3;',
      "SELECT count(*) AS audit_rows, max(new_row->>'owner') AS owner FROM audit_log;"
    ], why: 'One row: the rename did not call the function at all. A WHEN clause is checked before the function is called, which is cheaper than an IF inside it. <code>UPDATE OF balance</code> would be weaker: it fires whenever balance is in the SET list, even <code>SET balance = balance</code>.', expectOut: 'audit_rows \\|\\s+owner\\n-+\\+-+\\n\\s+1 \\| Kabir S' },
    { pts: 1, q: 'A BEFORE trigger that returns NULL: on jobs, skip (with a NOTICE) any DELETE of a running job. Then run <code>DELETE FROM jobs WHERE status IN (\'running\', \'done\')</code>.', hint: "IF OLD.status = 'running' THEN … RETURN NULL; END IF; RETURN OLD;", steps: [
      "CREATE FUNCTION keep_running_jobs() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  IF OLD.status = 'running' THEN\n    RAISE NOTICE 'job % is running, not deleted', OLD.job_id;\n    RETURN NULL;\n  END IF;\n  RETURN OLD;\nEND;\n$$;",
      'CREATE TRIGGER jobs_keep_running BEFORE DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION keep_running_jobs();',
      "DELETE FROM jobs WHERE status IN ('running', 'done');"
    ], why: '"DELETE 2": three rows matched, job 9 was skipped. Without the NOTICE, nobody would know why the count is 2. This is the classic trigger bug: a BEFORE ROW function that forgets <code>RETURN NEW</code> returns NULL and silently throws away every insert. If a row must not be deleted, raising an error is usually clearer.', expectOut: 'job 9 is running, not deleted\\nDELETE 2' },
    { pts: 1, q: 'Row vs statement: create two triggers on accounts, one FOR EACH ROW and one FOR EACH STATEMENT, that only RAISE NOTICE. Run an UPDATE that touches 3 accounts and one that touches none.', hint: 'RAISE NOTICE \'% % trigger\', TG_LEVEL, TG_OP;', steps: [
      "CREATE FUNCTION say() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  RAISE NOTICE '% trigger, %', TG_LEVEL, TG_OP;\n  RETURN NULL;\nEND;\n$$;",
      'CREATE TRIGGER accounts_row AFTER UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION say();',
      'CREATE TRIGGER accounts_stmt AFTER UPDATE ON accounts FOR EACH STATEMENT EXECUTE FUNCTION say();',
      'UPDATE accounts SET balance = balance WHERE account_id <= 3;',
      'UPDATE accounts SET balance = balance WHERE account_id = 99;'
    ], why: 'The first UPDATE gives three ROW notices and one STATEMENT notice. The second gives only the STATEMENT notice: statement triggers fire even when no row changed. Note that <code>SET balance = balance</code> still counts as an update, so the triggers fire.', expectOut: 'NOTICE:  ROW trigger, UPDATE\\nNOTICE:  ROW trigger, UPDATE\\nNOTICE:  ROW trigger, UPDATE\\nNOTICE:  STATEMENT trigger, UPDATE\\nUPDATE 3[\\s\\S]*NOTICE:  STATEMENT trigger, UPDATE\\nUPDATE 0' },
    { pts: 2, q: 'Transition tables: an AFTER UPDATE … FOR EACH STATEMENT trigger on accounts that compares sum(balance) in the old and new rows and raises if money was created or lost. Move 100 from Aarav to Diya in <b>one</b> UPDATE, then in <b>two</b> UPDATEs.', hint: 'REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows', steps: [
      "CREATE FUNCTION check_money() RETURNS trigger\nLANGUAGE plpgsql AS $$\nDECLARE\n  v_old numeric; v_new numeric;\nBEGIN\n  SELECT sum(balance) INTO v_old FROM old_rows;\n  SELECT sum(balance) INTO v_new FROM new_rows;\n  IF v_old IS DISTINCT FROM v_new THEN\n    RAISE EXCEPTION 'money was created or lost: % before, % after', v_old, v_new;\n  END IF;\n  RETURN NULL;\nEND;\n$$;",
      'CREATE TRIGGER accounts_money AFTER UPDATE ON accounts\n  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows\n  FOR EACH STATEMENT EXECUTE FUNCTION check_money();',
      'UPDATE accounts SET balance = balance + CASE account_id WHEN 1 THEN -100 ELSE 100 END\nWHERE account_id IN (1, 2);',
      'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;'
    ], why: 'The single-statement transfer passes (8000 before and after for the two rows). The two-statement version fails at its first UPDATE: "4900.00 before, 4800.00 after". A statement trigger checks one statement; a rule that only holds at the end of the transaction needs a deferred constraint trigger (Session 71). Transition tables are also the fast way to audit big updates: one INSERT … SELECT per statement instead of one per row.', expectOut: 'UPDATE 2[\\s\\S]*money was created or lost: 4900\\.00 before, 4800\\.00 after' },
    { pts: 2, q: 'Trigger order: on a fresh copy of customers\' email rules, create a_check_email (rejects emails that are not lower case) and z_normalize_email (lower-cases them), both BEFORE INSERT. Insert Tara. Then fix the order without changing either function.', hint: 'Triggers for the same event run in alphabetical order. ALTER TRIGGER … ON … RENAME TO …', steps: [
      lowerEmail,
      "CREATE FUNCTION check_email() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  IF NEW.email <> lower(NEW.email) THEN\n    RAISE EXCEPTION 'email must be lower case: %', NEW.email;\n  END IF;\n  RETURN NEW;\nEND;\n$$;",
      'CREATE TRIGGER a_check_email BEFORE INSERT ON customers FOR EACH ROW EXECUTE FUNCTION check_email();',
      'CREATE TRIGGER z_normalize_email BEFORE INSERT ON customers FOR EACH ROW EXECUTE FUNCTION normalize_email();',
      newCustomer,
      'ALTER TRIGGER z_normalize_email ON customers RENAME TO a0_normalize_email;',
      newCustomer
    ], why: 'The first insert fails: a_check_email ran first and saw the raw value. After renaming the normalizer to a0_… (which sorts before a_check…), the insert works. Order by name is easy to break by accident; when two steps depend on each other, put them in one trigger function in the order you want.', expectOut: 'email must be lower case[\\s\\S]*ALTER TRIGGER\\n[\\s\\S]*INSERT 0 1' },
    { pts: 2, q: 'Infinite recursion: an AFTER UPDATE trigger on jobs that does <code>UPDATE jobs SET attempts = attempts + 1</code> for the same row. Update job 4 and see what happens. Then add <code>WHEN (pg_trigger_depth() = 0)</code> and try again.', hint: 'pg_trigger_depth() is 0 for a normal statement and 1 inside a trigger.', steps: [
      "CREATE FUNCTION bump_attempts() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  UPDATE jobs SET attempts = attempts + 1 WHERE job_id = NEW.job_id;\n  RETURN NULL;\nEND;\n$$;",
      'CREATE TRIGGER jobs_bump AFTER UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION bump_attempts();',
      "UPDATE jobs SET status = 'running' WHERE job_id = 4;",
      'DROP TRIGGER jobs_bump ON jobs;',
      'CREATE TRIGGER jobs_bump AFTER UPDATE ON jobs FOR EACH ROW\n  WHEN (pg_trigger_depth() = 0)\n  EXECUTE FUNCTION bump_attempts();',
      "UPDATE jobs SET status = 'running' WHERE job_id = 4;",
      'SELECT job_id, status, attempts FROM jobs WHERE job_id = 4;'
    ], why: 'The first UPDATE fires the trigger, whose UPDATE fires it again, and so on until "stack depth limit exceeded"; everything rolls back. With the depth guard, the inner UPDATE does not fire it: status running, attempts 1. Better still: change NEW in a BEFORE trigger (<code>NEW.attempts := OLD.attempts + 1</code>), which needs no second UPDATE at all.', expectOut: 'stack depth limit exceeded[\\s\\S]*4 \\| running \\|\\s+1' },
    { pts: 2, q: 'Protect history: a BEFORE UPDATE OR DELETE trigger on orders that rejects any change to a delivered order. Try to cancel order 1 (delivered) and to delete it; then cancel a pending order.', hint: "IF OLD.status = 'delivered' THEN RAISE …; RETURN COALESCE(NEW, OLD);", steps: [
      "CREATE FUNCTION freeze_delivered() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  IF OLD.status = 'delivered' THEN\n    RAISE EXCEPTION 'order % is delivered and cannot be changed (%)', OLD.order_id, TG_OP;\n  END IF;\n  RETURN COALESCE(NEW, OLD);\nEND;\n$$;",
      'CREATE TRIGGER orders_freeze BEFORE UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION freeze_delivered();',
      "UPDATE orders SET status = 'cancelled' WHERE order_id = 1;",
      'DELETE FROM orders WHERE order_id = 1;',
      "UPDATE orders SET status = 'cancelled' WHERE order_id = (SELECT min(order_id) FROM orders WHERE status = 'pending');"
    ], why: 'Both changes to order 1 are rejected; the pending order is cancelled (UPDATE 1). <code>COALESCE(NEW, OLD)</code> returns the right row for UPDATE (NEW) and DELETE (NEW is NULL, so OLD). This rule needs the old value, which a CHECK constraint cannot see: a good use of a trigger.', expectOut: 'order 1 is delivered and cannot be changed \\(UPDATE\\)[\\s\\S]*\\(DELETE\\)[\\s\\S]*UPDATE 1' },
    { pts: 2, q: 'See and switch off triggers: list the user triggers on accounts (name, timing, enabled) from pg_trigger after creating the audit trigger, then disable it for a bulk change and enable it again.', hint: "ALTER TABLE accounts DISABLE TRIGGER accounts_audit; … ENABLE TRIGGER …; pg_trigger.tgenabled is 'O' (on) or 'D' (disabled).", steps: [
      auditTable, auditFn,
      'CREATE TRIGGER accounts_audit AFTER INSERT OR UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION audit();',
      'ALTER TABLE accounts DISABLE TRIGGER accounts_audit;',
      "SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'accounts'::regclass AND NOT tgisinternal;",
      'UPDATE accounts SET balance = balance + 1;',
      'ALTER TABLE accounts ENABLE TRIGGER accounts_audit;',
      'UPDATE accounts SET balance = balance - 1 WHERE account_id = 1;',
      'SELECT count(*) AS audit_rows FROM audit_log;'
    ], why: 'tgenabled D while disabled; the bulk UPDATE of 4 rows left no audit rows, the later one left 1. NOT tgisinternal hides the system triggers that implement foreign keys. In psql, \\d accounts lists triggers too. Disabling needs ownership of the table and an exclusive lock, and it affects every session: never a way to "skip the audit" in normal operation.', expectOut: 'accounts_audit \\| D[\\s\\S]*audit_rows\\n-+\\n\\s+1\\n' }
  ],
  hard: {
    q: 'Maintain price_history automatically: when a product\'s price changes, close its open range (upper bound = today) and open a new one from today with the new price. If the open range already starts today (a second change on the same day), just update its price. Change product 2\'s price twice and show its history (price, whether the range starts today, whether it is open).',
    hint: "AFTER UPDATE OF price ON products … WHEN (OLD.price IS DISTINCT FROM NEW.price). Find the open row with upper_inf(valid_during).",
    steps: [
      "CREATE FUNCTION track_price() RETURNS trigger\nLANGUAGE plpgsql AS $$\nBEGIN\n  UPDATE price_history SET price = NEW.price\n  WHERE product_id = NEW.product_id AND upper_inf(valid_during) AND lower(valid_during) = current_date;\n  IF NOT FOUND THEN\n    UPDATE price_history SET valid_during = daterange(lower(valid_during), current_date)\n    WHERE product_id = NEW.product_id AND upper_inf(valid_during);\n    INSERT INTO price_history VALUES (NEW.product_id, NEW.price, daterange(current_date, NULL));\n  END IF;\n  RETURN NULL;\nEND;\n$$;",
      'CREATE TRIGGER products_price_history AFTER UPDATE OF price ON products FOR EACH ROW\n  WHEN (OLD.price IS DISTINCT FROM NEW.price)\n  EXECUTE FUNCTION track_price();',
      'UPDATE products SET price = 82000 WHERE product_id = 2;',
      'UPDATE products SET price = 80000 WHERE product_id = 2;',
      'SELECT price, lower(valid_during) = current_date AS starts_today, upper_inf(valid_during) AS open\nFROM price_history WHERE product_id = 2 ORDER BY lower(valid_during);'
    ],
    why: 'Two rows: 85,000 (closed, ends today) and 80,000 (starts today, open). The 82,000 never appears: same-day changes overwrite, because a range [today, today) would be empty. Now no code path can change a price without leaving history, and the history never has gaps or overlaps (the exclusion constraint from Session 47 guarantees it).',
    expectOut: '85000\\.00 \\| f\\s+\\| f[\\s\\S]*80000\\.00 \\| t\\s+\\| t\\n\\(2 rows\\)'
  }
};
