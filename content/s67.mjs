const transferEx = `CREATE FUNCTION transfer(p_from int, p_to int, p_amount numeric) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_balance numeric;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive, got %', p_amount USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM 1 FROM accounts WHERE account_id IN (p_from, p_to) ORDER BY account_id FOR UPDATE;
  SELECT balance INTO v_balance FROM accounts WHERE account_id = p_from;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account % does not exist', p_from USING ERRCODE = 'no_data_found';
  END IF;
  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'insufficient funds in account %', p_from
      USING ERRCODE = 'P1001',
            DETAIL = format('balance %s, requested %s', v_balance, p_amount),
            HINT = 'Transfer a smaller amount.';
  END IF;
  UPDATE accounts SET balance = balance - p_amount WHERE account_id = p_from;
  UPDATE accounts SET balance = balance + p_amount WHERE account_id = p_to;
END;
$$;`;
const unsafeFind = "CREATE FUNCTION count_customers_named(p_name text) RETURNS bigint\nLANGUAGE plpgsql AS $$\nDECLARE\n  v bigint;\nBEGIN\n  EXECUTE 'SELECT count(*) FROM customers WHERE full_name = ''' || p_name || '''' INTO v;\n  RETURN v;\nEND;\n$$;";

export default {
  n: 67,
  phase: 'p7',
  title: 'PL/pgSQL errors and dynamic SQL',
  goal: 'Raise meaningful errors with codes, details and hints, catch and handle specific errors, and build SQL at run time without opening the door to SQL injection.',
  minutes: 150,
  lesson: [
    { h: 'Raising errors' },
    { p: 'A function that returns "insufficient funds" as text (Session 66) can be ignored by a careless caller. An <b>exception</b> cannot: it aborts the statement and the transaction (Session 55), and the caller receives a SQLSTATE code it can act on.' },
    { pre: "RAISE EXCEPTION 'insufficient funds in account %', p_from\n  USING ERRCODE = 'P1001',            -- your own 5-character code, or a name like 'check_violation'\n        DETAIL  = 'balance 0.00, requested 500',\n        HINT    = 'Transfer a smaller amount.';\n\nRAISE NOTICE / WARNING / INFO …     messages that do not stop anything\nASSERT condition, 'message';         a check for \"this cannot happen\" (can be switched off)", lang: 'text' },
    { steps: [transferEx, 'SELECT transfer(3, 1, 500);'], expectOut: 'ERROR:  insufficient funds in account 3\\nDETAIL:  balance 0\\.00, requested 500\\nHINT:  Transfer a smaller amount\\.' },
    { p: 'Pick codes deliberately. Built-in names (<code>unique_violation</code> 23505, <code>check_violation</code> 23514, <code>no_data_found</code> P0002, <code>invalid_parameter_value</code> 22023) tell any client what kind of problem it was. For business rules, use your own codes (letters + digits, not starting with 0, 1 or 2, which are taken), document them, and let the application map them to messages.' },
    { h: 'Catching errors' },
    { pre: "BEGIN\n  … statements …\nEXCEPTION\n  WHEN unique_violation THEN                  -- by condition name\n    …\n  WHEN SQLSTATE 'P1001' THEN                  -- by code\n    …\n  WHEN OTHERS THEN                            -- anything else (use with care)\n    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;\n    RAISE;                                    -- re-raise the same error\nEND;", lang: 'text' },
    { list: [
      'When an error is caught, <b>everything the block did is rolled back</b> (the block is a savepoint, Session 55); the function continues after the EXCEPTION section.',
      'Each BEGIN … EXCEPTION block costs a subtransaction. Fine around a risky step; slow around every row of a 100,000-row loop.',
      'Catch only what you can handle. Catching WHEN OTHERS and carrying on silently hides bugs; log and re-raise instead.'
    ] },
    { h: 'Dynamic SQL' },
    { p: '<code>EXECUTE</code> runs a SQL string built at run time: a table name passed as a parameter, an optional filter, DDL for a new partition. The string is a program; never paste user input into it. Use <code>format()</code> for identifiers and <code>USING</code> for values:' },
    { pre: "EXECUTE format('SELECT count(*) FROM %I WHERE %I = $1', p_table, p_column)\n  INTO v_count\n  USING p_value;\n\n%I   identifier, quoted if needed:  orders, \"Order Items\"\n%L   literal, quoted and escaped:   'O''Brien'      (prefer USING for values)\n%s   plain text: never for anything that came from a user", lang: 'text' },
    { trap: 'String concatenation is SQL injection: <code>\'… WHERE full_name = \'\'\' || p_name || \'\'\'\'</code> with p_name = <code>x\' OR \'1\'=\'1</code> becomes a query that matches every row (Q7). The same mistake in an application (building SQL strings from request parameters) is still one of the most common security holes on the web.' }
  ],
  questions: [
    { pts: 1, q: 'Create the exception-raising transfer() from the lesson and call it with a negative amount. Which SQLSTATE does the error have?', hint: "transfer(1, 3, -5); in psql, \\echo :LAST_ERROR_SQLSTATE shows the code", steps: [transferEx, 'SELECT transfer(1, 3, -5);', 'SELECT transfer(1, 3, 100);', 'SELECT balance FROM accounts WHERE account_id = 3;'], why: '"amount must be positive, got -5", SQLSTATE 22023 (invalid_parameter_value). The valid call returns nothing (RETURNS void) and Kabir has 100. A void function that raises on failure is a clean API: success is silence.', expectOut: 'amount must be positive, got -5[\\s\\S]*100\\.00' },
    { pts: 1, q: 'Write book_table(p_id int, p_table int, p_slot timestamptz, p_guest text) RETURNS text that inserts a booking and returns \'booked\', or catches the unique violation and returns \'taken\'. Book table 1 at 19:00 on 20 Feb 2026 (taken) and table 3 at 19:00 (free).', hint: "BEGIN INSERT …; RETURN 'booked'; EXCEPTION WHEN unique_violation THEN RETURN 'taken'; END;", steps: [
      "CREATE FUNCTION book_table(p_id int, p_table int, p_slot timestamptz, p_guest text) RETURNS text\nLANGUAGE plpgsql AS $$\nBEGIN\n  INSERT INTO table_bookings VALUES (p_id, p_table, p_slot, p_guest, 2);\n  RETURN 'booked';\nEXCEPTION\n  WHEN unique_violation THEN\n    RETURN 'taken';\nEND;\n$$;",
      "SELECT book_table(6, 1, '2026-02-20 19:00+05:30', 'Vivaan') AS t1, book_table(7, 3, '2026-02-20 19:00+05:30', 'Vivaan') AS t3;"
    ], why: 'taken, booked. The function decides what a duplicate means for the caller. Note that unique_violation also fires for a duplicate booking_id, not only for a taken table: in real code, check which constraint failed (Q4) or use ON CONFLICT ON CONSTRAINT.', expectOut: '\\btaken\\s+\\| booked\\b' },
    { pts: 1, q: 'Show that a caught error rolls back the block: in a DO block, insert job 11, then (inside an inner BEGIN … EXCEPTION block) insert job 12 and divide by zero. After the block, count jobs 11 and 12.', hint: 'The inner block is rolled back when its exception is caught; the outer work stays.', steps: [
      "DO $$\nBEGIN\n  INSERT INTO jobs (job_id, kind, run_after) VALUES (11, 'send_email', now());\n  BEGIN\n    INSERT INTO jobs (job_id, kind, run_after) VALUES (12, 'send_email', now());\n    PERFORM 1 / 0;\n  EXCEPTION WHEN division_by_zero THEN\n    RAISE NOTICE 'inner block failed, its insert is undone';\n  END;\nEND;\n$$;",
      'SELECT job_id FROM jobs WHERE job_id IN (11, 12);'
    ], why: 'Only job 11 remains. The inner block behaved like SAVEPOINT … ROLLBACK TO SAVEPOINT. Handy for "try this step, fall back if it fails" without losing the rest of the work.', expectOut: 'inner block failed[\\s\\S]*\\b11\\n\\(1 row\\)' },
    { pts: 1, q: 'Use GET STACKED DIAGNOSTICS to report which constraint failed: try to insert a booking that duplicates table 2 at 19:00, catch any error, and print the SQLSTATE, the constraint name and the message.', hint: 'GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME, v_msg = MESSAGE_TEXT;', steps: [
      "DO $$\nDECLARE\n  v_state text; v_con text; v_msg text;\nBEGIN\n  INSERT INTO table_bookings VALUES (6, 2, '2026-02-20 19:00+05:30', 'Tara', 2);\nEXCEPTION WHEN OTHERS THEN\n  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME, v_msg = MESSAGE_TEXT;\n  RAISE NOTICE 'state=% constraint=% message=%', v_state, v_con, v_msg;\nEND;\n$$;"
    ], why: 'state=23505 constraint=table_bookings_table_no_slot_key. With the constraint name you can tell "table taken" from "id already used" (Q2) and react differently. Also available: TABLE_NAME, COLUMN_NAME, PG_EXCEPTION_DETAIL, PG_EXCEPTION_CONTEXT (the call stack).', expectOut: 'state=23505 constraint=table_bookings_table_no_slot_key' },
    { pts: 1, q: 'Log and re-raise: write a DO block that tries <code>SELECT transfer(3, 1, 500)</code> (insufficient funds), prints a WARNING with the error message, and then re-raises the original error.', hint: 'EXCEPTION WHEN OTHERS THEN RAISE WARNING …, SQLERRM; RAISE;', steps: [
      transferEx,
      "DO $$\nBEGIN\n  PERFORM transfer(3, 1, 500);\nEXCEPTION WHEN OTHERS THEN\n  RAISE WARNING 'transfer failed: % (%)', SQLERRM, SQLSTATE;\n  RAISE;\nEND;\n$$;"
    ], why: 'A WARNING, then the original ERROR with its code P1001, detail and hint. SQLERRM and SQLSTATE are shortcuts available inside an EXCEPTION section. A bare RAISE re-throws exactly what was caught, so the caller still gets the real error.', expectOut: 'WARNING:  transfer failed: insufficient funds in account 3 \\(P1001\\)[\\s\\S]*ERROR:  insufficient funds in account 3' },
    { pts: 1, q: 'Dynamic SQL with an identifier: write row_count(p_table text) RETURNS bigint using EXECUTE and format(\'%I\'). Count the rows of orders, of jobs, and of a table that does not exist.', hint: "EXECUTE format('SELECT count(*) FROM %I', p_table) INTO v;", steps: [
      "CREATE FUNCTION row_count(p_table text) RETURNS bigint\nLANGUAGE plpgsql AS $$\nDECLARE\n  v bigint;\nBEGIN\n  EXECUTE format('SELECT count(*) FROM %I', p_table) INTO v;\n  RETURN v;\nEND;\n$$;",
      "SELECT row_count('orders') AS orders, row_count('jobs') AS jobs;",
      "SELECT row_count('orders; DROP TABLE jobs');"
    ], why: '36 and 10. The third call is an injection attempt: %I quotes the whole string as one identifier, so Postgres looks for a table literally named "orders; DROP TABLE jobs" and fails. Table and column names can never be passed with USING (only values can), so %I is the tool for identifiers.', expectOut: 'orders \\| jobs[\\s\\S]*36 \\|\\s+10[\\s\\S]*relation "orders; DROP TABLE jobs" does not exist' },
    { pts: 1, q: 'The injection: create the <b>unsafe</b> count_customers_named(p_name) that concatenates the name into the query, and call it with \'Aarav Shah\' and with <code>x\' OR \'1\'=\'1</code>.', hint: "Inside a SQL string literal, a single quote is written ''.", steps: [
      unsafeFind,
      "SELECT count_customers_named('Aarav Shah') AS honest;",
      "SELECT count_customers_named('x'' OR ''1''=''1') AS injected;"
    ], why: '1, then 20: the input closed the string and added <code>OR \'1\'=\'1</code>, so the WHERE matched every customer. With a DELETE instead of a count, an attacker deletes everything. Never build SQL by concatenating input.', expectOut: 'honest\\n-+\\n\\s+1\\n[\\s\\S]*injected\\n-+\\n\\s+20' },
    { pts: 1, q: 'Fix count_customers_named with <code>USING</code> and call it with the same two inputs.', hint: "EXECUTE 'SELECT count(*) FROM customers WHERE full_name = $1' INTO v USING p_name;", steps: [
      "CREATE FUNCTION count_customers_named(p_name text) RETURNS bigint\nLANGUAGE plpgsql AS $$\nDECLARE\n  v bigint;\nBEGIN\n  EXECUTE 'SELECT count(*) FROM customers WHERE full_name = $1' INTO v USING p_name;\n  RETURN v;\nEND;\n$$;",
      "SELECT count_customers_named('Aarav Shah') AS honest, count_customers_named('x'' OR ''1''=''1') AS injected;"
    ], why: '1 and 0: with USING the value is passed separately and is never parsed as SQL, so the "injection" is just a strange name that nobody has. (And here no EXECUTE was needed at all: a plain query with the parameter is safe too. Use EXECUTE only when the SQL text itself must change.)', expectOut: '\\b1 \\|\\s+0\\b' },
    { pts: 2, q: 'A generic, safe filter: count_where(p_table text, p_column text, p_value text) RETURNS bigint that counts rows where a column equals a value. Use %I for the names and USING for the value; compare as text. Count pending orders and Pune customers.', hint: "format('SELECT count(*) FROM %I WHERE %I::text = $1', p_table, p_column) … USING p_value", sql: "CREATE FUNCTION count_where(p_table text, p_column text, p_value text) RETURNS bigint\nLANGUAGE plpgsql STABLE AS $$\nDECLARE\n  v bigint;\nBEGIN\n  EXECUTE format('SELECT count(*) FROM %I WHERE %I::text = $1', p_table, p_column) INTO v USING p_value;\n  RETURN v;\nEND;\n$$;\n\nSELECT count_where('orders', 'status', 'pending') AS pending_orders,\n       count_where('customers', 'city', 'Pune') AS pune_customers;", why: '7 and 3. Identifiers through %I, values through USING: the two rules that make dynamic SQL safe. (The ::text cast makes it generic, but it also stops any index on that column from being used: generic code has a price.)', expectRows: 1 },
    { pts: 2, q: 'Catch your own error code from a caller: in a DO block, call transfer(3, 1, 500) and handle only SQLSTATE P1001 by printing "not enough money"; any other error must still propagate. Then call transfer(1, 99, 10) the same way.', hint: "EXCEPTION WHEN SQLSTATE 'P1001' THEN RAISE NOTICE …;", steps: [
      transferEx,
      "DO $$\nBEGIN\n  PERFORM transfer(3, 1, 500);\nEXCEPTION WHEN SQLSTATE 'P1001' THEN\n  RAISE NOTICE 'not enough money';\nEND;\n$$;",
      "DO $$\nBEGIN\n  PERFORM transfer(1, 99, 10);\nEXCEPTION WHEN SQLSTATE 'P1001' THEN\n  RAISE NOTICE 'not enough money';\nEND;\n$$;"
    ], why: 'The first is handled (NOTICE). The second prints nothing and says DO: transfer(1, 99, 10) does not fail at all in this version. Account 1 exists, and the function never checks the destination, so it updates zero rows for account 99 and the 10 disappears. Session 66\'s version caught this. The errors you raise must cover every rule; Q11 fixes it.', expectOut: 'NOTICE:  not enough money[\\s\\S]*DO$' },
    { pts: 2, q: 'Fix the bug Q10 revealed: make transfer() raise SQLSTATE no_data_found when <b>either</b> account does not exist (check the number of rows locked), and call transfer(1, 99, 10) again. Then check the total.', hint: 'Lock with SELECT count(*) INTO v_found FROM (SELECT … FOR UPDATE) l; IF v_found < 2 THEN RAISE …', steps: [
      "CREATE FUNCTION transfer(p_from int, p_to int, p_amount numeric) RETURNS void\nLANGUAGE plpgsql AS $$\nDECLARE\n  v_found int;\n  v_balance numeric;\nBEGIN\n  IF p_amount <= 0 THEN\n    RAISE EXCEPTION 'amount must be positive' USING ERRCODE = 'invalid_parameter_value';\n  END IF;\n  SELECT count(*) INTO v_found\n  FROM (SELECT 1 FROM accounts WHERE account_id IN (p_from, p_to) ORDER BY account_id FOR UPDATE) l;\n  IF v_found < 2 OR p_from = p_to THEN\n    RAISE EXCEPTION 'transfer needs two existing, different accounts (% → %)', p_from, p_to USING ERRCODE = 'no_data_found';\n  END IF;\n  SELECT balance INTO v_balance FROM accounts WHERE account_id = p_from;\n  IF v_balance < p_amount THEN\n    RAISE EXCEPTION 'insufficient funds in account %', p_from USING ERRCODE = 'P1001';\n  END IF;\n  UPDATE accounts SET balance = balance - p_amount WHERE account_id = p_from;\n  UPDATE accounts SET balance = balance + p_amount WHERE account_id = p_to;\nEND;\n$$;",
      'SELECT transfer(1, 99, 10);',
      'SELECT transfer(1, 1, 10);',
      'SELECT sum(balance) FROM accounts;'
    ], why: 'Both calls fail with a clear message, and the total stays 9,200. Counting the locked rows checks existence and locks in one step. Write the failure cases first: each one is a rule, and each needs its own test.', expectOut: 'two existing, different accounts \\(1 → 99\\)[\\s\\S]*\\(1 → 1\\)[\\s\\S]*9200\\.00' },
    { pts: 2, q: 'ASSERT for "cannot happen" checks: after a transfer in a DO block, assert that the total is still 9,200. Then run a buggy "transfer" that only debits, with the same assert.', hint: "ASSERT (SELECT sum(balance) FROM accounts) = 9200, 'money was created or lost';", steps: [
      "DO $$\nBEGIN\n  UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;\n  UPDATE accounts SET balance = balance + 100 WHERE account_id = 2;\n  ASSERT (SELECT sum(balance) FROM accounts) = 9200, 'money was created or lost';\n  RAISE NOTICE 'transfer ok';\nEND;\n$$;",
      "DO $$\nBEGIN\n  UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;\n  ASSERT (SELECT sum(balance) FROM accounts) = 9200, 'money was created or lost';\nEND;\n$$;",
      'SELECT sum(balance) FROM accounts;'
    ], why: 'The first passes; the second fails with "money was created or lost" (SQLSTATE P0004), and its debit is rolled back. ASSERT documents invariants and catches bugs in testing; it can be switched off with plpgsql.check_asserts = off, so never use it for input validation (use RAISE).', expectOut: 'transfer ok[\\s\\S]*ERROR:  money was created or lost[\\s\\S]*9200\\.00' },
    { pts: 2, q: 'Dynamic DDL: create one archive table per year, orders_2025 and orders_2026 (LIKE orders), with a loop and EXECUTE format(), then copy each year\'s orders into its table and report the counts.', hint: "FOR y IN 2025..2026 LOOP EXECUTE format('CREATE TABLE %I (LIKE orders)', 'orders_' || y); EXECUTE format('INSERT INTO %I SELECT * FROM orders WHERE …', …) USING …", steps: [
      "DO $$\nDECLARE\n  y int;\n  n bigint;\nBEGIN\n  FOR y IN 2025..2026 LOOP\n    EXECUTE format('CREATE TABLE %I (LIKE orders INCLUDING ALL)', 'orders_' || y);\n    EXECUTE format('INSERT INTO %I SELECT * FROM orders WHERE order_date >= $1 AND order_date < $2', 'orders_' || y)\n      USING make_date(y, 1, 1), make_date(y + 1, 1, 1);\n    GET DIAGNOSTICS n = ROW_COUNT;\n    RAISE NOTICE 'orders_%: % rows', y, n;\n  END LOOP;\nEND;\n$$;"
    ], why: 'orders_2025: 32 rows, orders_2026: 4 rows. GET DIAGNOSTICS … ROW_COUNT reads how many rows the last statement touched (also after EXECUTE). This is how scripts create partitions or per-tenant tables (Phase 8 covers partitioning properly).', expectOut: 'orders_2025: 32 rows[\\s\\S]*orders_2026: 4 rows' }
  ],
  hard: {
    q: 'A safe sortable product list for an API: sorted_products(p_sort text, p_desc boolean) RETURNS TABLE (name text, price numeric) where p_sort may only be name or price (anything else raises invalid_parameter_value with a HINT listing the allowed values). Build the ORDER BY with format(). Call it sorted by price descending, and once with p_sort = \'price; DROP TABLE products\'.',
    hint: "IF p_sort NOT IN ('name', 'price') THEN RAISE …; RETURN QUERY EXECUTE format('SELECT name, price FROM products ORDER BY %I %s', p_sort, CASE WHEN p_desc THEN 'DESC' ELSE 'ASC' END);",
    steps: [
      "CREATE FUNCTION sorted_products(p_sort text, p_desc boolean DEFAULT false)\nRETURNS TABLE (name text, price numeric)\nLANGUAGE plpgsql STABLE AS $$\nBEGIN\n  IF p_sort NOT IN ('name', 'price') THEN\n    RAISE EXCEPTION 'cannot sort by %', p_sort\n      USING ERRCODE = 'invalid_parameter_value', HINT = 'Allowed: name, price.';\n  END IF;\n  RETURN QUERY EXECUTE format('SELECT p.name, p.price FROM products p ORDER BY %I %s, p.product_id',\n                              p_sort, CASE WHEN p_desc THEN 'DESC' ELSE 'ASC' END);\nEND;\n$$;",
      "SELECT * FROM sorted_products('price', true) LIMIT 3;",
      "SELECT * FROM sorted_products('price; DROP TABLE products');"
    ],
    why: 'The top 3 by price, then "cannot sort by price; DROP TABLE products" with the hint. Three layers: a whitelist (the only real defence for ORDER BY, which cannot take a $1), %I quoting as a second net, and the direction chosen from a boolean, never from text. The tiebreaker (product_id) keeps the order stable for pagination (Session 51).',
    expectOut: 'Laptop Pro 14[\\s\\S]*\\(3 rows\\)[\\s\\S]*cannot sort by price; DROP TABLE products[\\s\\S]*HINT:  Allowed: name, price\\.'
  }
};
