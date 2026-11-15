const transferFn = `CREATE FUNCTION transfer(p_from int, p_to int, p_amount numeric) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_balance numeric;
BEGIN
  IF p_amount <= 0 THEN
    RETURN 'amount must be positive';
  END IF;
  -- lock both rows in id order (Session 58), read the source balance
  PERFORM 1 FROM accounts WHERE account_id IN (p_from, p_to) ORDER BY account_id FOR UPDATE;
  SELECT balance INTO v_balance FROM accounts WHERE account_id = p_from;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM accounts WHERE account_id = p_to) THEN
    RETURN 'unknown account';
  ELSIF v_balance < p_amount THEN
    RETURN 'insufficient funds';
  END IF;
  UPDATE accounts SET balance = balance - p_amount WHERE account_id = p_from;
  UPDATE accounts SET balance = balance + p_amount WHERE account_id = p_to;
  RETURN 'ok';
END;
$$;`;
const claimFn = `CREATE FUNCTION claim_next_job(p_worker text) RETURNS jobs
LANGUAGE plpgsql AS $$
DECLARE
  v_job jobs;
BEGIN
  UPDATE jobs
  SET status = 'running', locked_by = p_worker, locked_at = now(), attempts = attempts + 1
  WHERE job_id = (SELECT job_id FROM jobs
                  WHERE status = 'queued' AND run_after <= now()
                  ORDER BY run_after, job_id
                  FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING * INTO v_job;
  RETURN v_job;   -- all NULL when there was nothing to claim
END;
$$;`;

export default {
  n: 66,
  phase: 'p7',
  title: 'PL/pgSQL basics',
  goal: 'Write procedural code inside the database (variables, IF, loops, SELECT INTO, RETURN QUERY), and know when a loop should really be one SQL statement.',
  minutes: 150,
  lesson: [
    { h: 'When SQL is not enough' },
    { p: 'SQL functions are one query. Business logic often needs steps and decisions: "lock both accounts, check the balance, and either refuse with a reason or move the money". <b>PL/pgSQL</b> is Postgres\'s built-in procedural language: SQL statements plus variables, IF, loops and error handling, running inside the server.' },
    { pre: "CREATE FUNCTION name(params) RETURNS type\nLANGUAGE plpgsql AS $$\nDECLARE\n  v_total numeric := 0;          -- variables, with optional initial value\n  v_order orders%ROWTYPE;        -- a whole row of a table\n  v_city  customers.city%TYPE;   -- the same type as a column\nBEGIN\n  SELECT … INTO v_total FROM …;  -- one row into variables (FOUND says whether a row came back)\n  IF … THEN … ELSIF … ELSE … END IF;\n  FOR r IN SELECT … LOOP … END LOOP;\n  RETURN v_total;\nEND;\n$$;", lang: 'text' },
    { p: 'A <code>DO</code> block runs anonymous PL/pgSQL once, without creating a function. <code>RAISE NOTICE</code> prints a message (psql shows it as NOTICE); <code>%</code> placeholders are filled from the arguments:' },
    { steps: [
      "DO $$\nDECLARE\n  v_pending int;\nBEGIN\n  SELECT count(*) INTO v_pending FROM orders WHERE status = 'pending';\n  RAISE NOTICE 'There are % pending orders', v_pending;\n  IF v_pending > 5 THEN\n    RAISE NOTICE 'Too many: check the warehouse';\n  END IF;\nEND;\n$$;"
    ], expectOut: 'NOTICE:  There are 7 pending orders[\\s\\S]*Too many' },
    { h: 'A real function: transfer with checks' },
    { sql: transferFn + "\n\nSELECT transfer(1, 3, 1000) AS first, transfer(3, 1, 5000) AS second, transfer(1, 99, 10) AS third;", run: true },
    { list: [
      '<code>PERFORM</code> runs a query and throws the result away (PL/pgSQL does not allow a bare SELECT without INTO).',
      '<code>FOUND</code> is true after a SELECT INTO / UPDATE / DELETE / INSERT that affected at least one row.',
      'The whole function runs in the caller\'s transaction: if the caller rolls back, the transfer is undone too.',
      'Name variables <code>v_…</code> and parameters <code>p_…</code>. A variable called like a column makes queries ambiguous (Q12).'
    ] },
    { h: 'Returning rows' },
    { pre: "RETURNS TABLE (…) / SETOF …   and inside:\n  RETURN QUERY SELECT …;      append all rows of a query\n  RETURN NEXT;                 append the current values of the OUT columns (in a loop)\n  RETURN;                      finish", lang: 'text' },
    { h: 'Loops vs set-based SQL' },
    { p: 'A loop over 10,000 rows that runs an UPDATE per row does 10,000 statements. One UPDATE with a join does the same work in one statement, usually 10–100× faster. Use loops for orchestration (batches, steps, decisions per batch), and keep the row work in SQL.' },
    { tip: 'PL/pgSQL caches the plan of each query inside a function after the first few calls, like a prepared statement (generic plans, Session 52). Usually good; occasionally a skewed parameter needs <code>EXECUTE</code> (Session 67) to be planned with the real value every time.' }
  ],
  questions: [
    { pts: 1, q: 'Write a DO block that prints how many customers have never ordered, as a NOTICE.', hint: 'SELECT count(*) INTO v FROM customers c WHERE NOT EXISTS (…); RAISE NOTICE \'…%…\', v;', steps: [
      "DO $$\nDECLARE\n  v_count int;\nBEGIN\n  SELECT count(*) INTO v_count FROM customers c\n  WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id);\n  RAISE NOTICE '% customers never ordered', v_count;\nEND;\n$$;"
    ], why: '4 customers (9, 13, 15, 16). DO blocks are handy for one-off scripts that need a variable or an IF; they return nothing, so output goes through RAISE NOTICE.', expectOut: 'NOTICE:  4 customers never ordered' },
    { pts: 1, q: 'Write a PL/pgSQL function status_label(p_status text) RETURNS text that turns pending/shipped/delivered/cancelled into "Waiting", "On the way", "Delivered", "Cancelled" and anything else into "Unknown", using CASE. Show the label for each status in orders with its count.', hint: 'CASE p_status WHEN … THEN RETURN …; … ELSE RETURN \'Unknown\'; END CASE;', sql: "CREATE FUNCTION status_label(p_status text) RETURNS text\nLANGUAGE plpgsql IMMUTABLE AS $$\nBEGIN\n  CASE p_status\n    WHEN 'pending'   THEN RETURN 'Waiting';\n    WHEN 'shipped'   THEN RETURN 'On the way';\n    WHEN 'delivered' THEN RETURN 'Delivered';\n    WHEN 'cancelled' THEN RETURN 'Cancelled';\n    ELSE RETURN 'Unknown';\n  END CASE;\nEND;\n$$;\n\nSELECT status_label(status) AS label, count(*) FROM orders GROUP BY 1 ORDER BY 2 DESC;", why: '4 labels. A CASE statement (with END CASE) is control flow; the SQL CASE expression would have done the same as a SQL function. Use PL/pgSQL when you need steps, not for a single expression.', expectRows: 4 },
    { pts: 1, q: 'Write loyalty_tier(p_customer_id int) RETURNS text: delivered revenue ≥ 100,000 → Gold, ≥ 20,000 → Silver, &gt; 0 → Bronze, otherwise New. Show the tier of customers 1 to 6.', hint: 'SELECT COALESCE(sum(…), 0) INTO v_revenue …; IF … ELSIF … ELSE … END IF;', sql: "CREATE FUNCTION loyalty_tier(p_customer_id int) RETURNS text\nLANGUAGE plpgsql STABLE AS $$\nDECLARE\n  v_revenue numeric;\nBEGIN\n  SELECT COALESCE(sum(oi.quantity * oi.unit_price), 0) INTO v_revenue\n  FROM orders o JOIN order_items oi ON oi.order_id = o.order_id\n  WHERE o.customer_id = p_customer_id AND o.status = 'delivered';\n\n  IF v_revenue >= 100000 THEN RETURN 'Gold';\n  ELSIF v_revenue >= 20000 THEN RETURN 'Silver';\n  ELSIF v_revenue > 0 THEN RETURN 'Bronze';\n  ELSE RETURN 'New';\n  END IF;\nEND;\n$$;\n\nSELECT customer_id, loyalty_tier(customer_id) AS tier FROM customers WHERE customer_id <= 6 ORDER BY customer_id;", why: 'Gold, Gold, Bronze, Bronze, Silver, Bronze. Customer 6 has 19,800 of delivered revenue: 200 short of Silver. Thresholds like this belong in one function (or a tiers table, like discount_tiers) so that the boundary is the same everywhere. The IF chain stops at the first true condition: order the thresholds from highest to lowest.', expectRows: 6 },
    { pts: 1, q: 'Write get_balance(p_account_id int) RETURNS numeric using <code>SELECT … INTO STRICT</code>. Call it for account 1 and for account 99.', hint: 'INTO STRICT raises an error when the query returns no row (or more than one).', steps: [
      "CREATE FUNCTION get_balance(p_account_id int) RETURNS numeric\nLANGUAGE plpgsql STABLE AS $$\nDECLARE\n  v numeric;\nBEGIN\n  SELECT balance INTO STRICT v FROM accounts WHERE account_id = p_account_id;\n  RETURN v;\nEND;\n$$;",
      'SELECT get_balance(1);',
      'SELECT get_balance(99);'
    ], why: '5000.00, then "query returned no rows". Without STRICT, a missing row silently leaves the variable NULL, and the function returns NULL: often a bug that surfaces much later. Use STRICT when exactly one row must exist.', expectOut: '5000\\.00[\\s\\S]*query returned no rows' },
    { pts: 1, q: 'Write deposit(p_account_id int, p_amount numeric) RETURNS boolean that adds the amount and returns whether the account existed, using FOUND. Deposit 100 into account 2 and into account 99.', hint: 'UPDATE …; RETURN FOUND;', sql: "CREATE FUNCTION deposit(p_account_id int, p_amount numeric) RETURNS boolean\nLANGUAGE plpgsql AS $$\nBEGIN\n  UPDATE accounts SET balance = balance + p_amount WHERE account_id = p_account_id;\n  RETURN FOUND;\nEND;\n$$;\n\nSELECT deposit(2, 100) AS acct_2, deposit(99, 100) AS acct_99;", why: 't and f. FOUND is set by the last SQL statement. Checking it right after the UPDATE is the PL/pgSQL version of "check the row count".', expectRows: 1 },
    { pts: 1, q: 'Write top_customers(p_n int) RETURNS TABLE (customer_id int, revenue numeric) with RETURN QUERY, for delivered revenue. Show the top 3.', hint: 'RETURN QUERY SELECT … ORDER BY … LIMIT p_n; Qualify columns: o.customer_id.', sql: "CREATE FUNCTION top_customers(p_n int) RETURNS TABLE (customer_id int, revenue numeric)\nLANGUAGE plpgsql STABLE AS $$\nBEGIN\n  RETURN QUERY\n    SELECT o.customer_id, sum(oi.quantity * oi.unit_price)\n    FROM orders o JOIN order_items oi ON oi.order_id = o.order_id\n    WHERE o.status = 'delivered'\n    GROUP BY o.customer_id\n    ORDER BY 2 DESC\n    LIMIT p_n;\nEND;\n$$;\n\nSELECT * FROM top_customers(3);", why: 'Customers 8, 1 and 10. RETURNS TABLE columns are also variables inside the function, so an unqualified <code>customer_id</code> would be ambiguous (Q12): qualify every column.', expectRows: 3 },
    { pts: 1, q: 'Use %ROWTYPE: write order_line(p_order_id int) RETURNS text that loads the order row and returns "Order 9 · delivered · 2025-03-15 · Bengaluru".', hint: "v orders%ROWTYPE; SELECT * INTO v FROM orders WHERE …; RETURN format('Order % · …', …)", sql: "CREATE FUNCTION order_line(p_order_id int) RETURNS text\nLANGUAGE plpgsql STABLE AS $$\nDECLARE\n  v orders%ROWTYPE;\nBEGIN\n  SELECT * INTO v FROM orders WHERE order_id = p_order_id;\n  IF NOT FOUND THEN\n    RETURN NULL;\n  END IF;\n  RETURN format('Order %s · %s · %s · %s', v.order_id, v.status, v.order_date, COALESCE(v.shipping_city, '?'));\nEND;\n$$;\n\nSELECT order_line(9) AS line_9, order_line(24) AS line_24;", why: '%ROWTYPE follows the table: add a column and the variable has it too. format() with %s is the safe way to build text (and the only safe way to build SQL, Session 67).', expectRows: 1 },
    { pts: 1, q: 'A loop: how many years until 10,000 grows to at least 20,000 at 7% a year? Write years_to_double(p_rate numeric) with a WHILE loop.', hint: 'WHILE v_amount < 20000 LOOP v_amount := v_amount * (1 + p_rate); v_years := v_years + 1; END LOOP;', sql: "CREATE FUNCTION years_to_double(p_rate numeric) RETURNS int\nLANGUAGE plpgsql IMMUTABLE AS $$\nDECLARE\n  v_amount numeric := 10000;\n  v_years  int := 0;\nBEGIN\n  WHILE v_amount < 20000 LOOP\n    v_amount := v_amount * (1 + p_rate);\n    v_years := v_years + 1;\n  END LOOP;\n  RETURN v_years;\nEND;\n$$;\n\nSELECT years_to_double(0.07) AS at_7, years_to_double(0.10) AS at_10;", why: '11 and 8 years. A loop is natural for this; a loop over table rows usually is not (Q9). With rate 0 it would never end: real code guards against that (IF p_rate &lt;= 0 THEN RETURN NULL).', expectRows: 1 },
    { pts: 2, q: 'Row-by-row vs set-based: raise the price of every Kitchen product by 5%, first with a FOR loop in a DO block that updates one product at a time (count the updates with a NOTICE), then show the same change as one UPDATE. Compare the final prices.', hint: 'FOR r IN SELECT product_id FROM … LOOP UPDATE … WHERE product_id = r.product_id; END LOOP;', steps: [
      "DO $$\nDECLARE\n  r record;\n  n int := 0;\nBEGIN\n  FOR r IN SELECT p.product_id FROM products p JOIN categories k ON k.category_id = p.category_id WHERE k.name = 'Kitchen' LOOP\n    UPDATE products SET price = round(price * 1.05, 2) WHERE product_id = r.product_id;\n    n := n + 1;\n  END LOOP;\n  RAISE NOTICE 'updated % products, one statement each', n;\nEND;\n$$;",
      "SELECT name, price FROM products WHERE category_id = 5 ORDER BY product_id;",
      '-- the set-based version of the same change would be one statement:\n-- UPDATE products p SET price = round(price * 1.05, 2) FROM categories k WHERE k.category_id = p.category_id AND k.name = \'Kitchen\';\nSELECT 1 AS done;'
    ], why: '3 updates, 3 statements: Coffee Maker 9,450, Chef Knife 4,200, Air Fryer 11,550. The single UPDATE … FROM gives the same result with one statement. On 3 rows nobody notices; on 300,000 the loop takes minutes and the UPDATE seconds. Reach for a loop only when each step needs a decision SQL cannot express.', expectOut: 'NOTICE:  updated 3 products[\\s\\S]*9450\\.00' },
    { pts: 2, q: 'Create the transfer() function from the lesson and test all its outcomes in order: a valid transfer, too much money, a negative amount, an unknown account. Then check the total.', hint: 'SELECT transfer(…) four times, then sum(balance).', steps: [
      transferFn,
      'SELECT transfer(1, 3, 1000);',
      'SELECT transfer(3, 1, 5000);',
      'SELECT transfer(3, 1, -5);',
      'SELECT transfer(1, 99, 10);',
      'SELECT sum(balance) FROM accounts;'
    ], why: 'ok, insufficient funds, amount must be positive, unknown account; total still 9,200. Returning a status text is one design; Session 67 raises proper exceptions instead, so a caller cannot ignore a failure by accident.', expectOut: '\\bok\\b[\\s\\S]*insufficient funds[\\s\\S]*must be positive[\\s\\S]*unknown account[\\s\\S]*9200\\.00' },
    { pts: 2, q: 'Write order_lines(p_order_id int) RETURNS TABLE (product text, line_total numeric, running_total numeric) using a FOR loop and RETURN NEXT, in product name order. Show order 9. Then write the same with a window function in one SELECT.', hint: 'Assign the OUT columns, then RETURN NEXT; inside the loop.', sql: "CREATE FUNCTION order_lines(p_order_id int)\nRETURNS TABLE (product text, line_total numeric, running_total numeric)\nLANGUAGE plpgsql STABLE AS $$\nDECLARE\n  r record;\nBEGIN\n  running_total := 0;\n  FOR r IN SELECT p.name, oi.quantity * oi.unit_price AS amount\n           FROM order_items oi JOIN products p ON p.product_id = oi.product_id\n           WHERE oi.order_id = p_order_id ORDER BY p.name LOOP\n    product := r.name;\n    line_total := r.amount;\n    running_total := running_total + r.amount;\n    RETURN NEXT;\n  END LOOP;\nEND;\n$$;\n\nSELECT * FROM order_lines(9);\n-- same result: SELECT p.name, oi.quantity * oi.unit_price,\n--   sum(oi.quantity * oi.unit_price) OVER (ORDER BY p.name) FROM … WHERE oi.order_id = 9;", why: '3 lines ending at 89,000. RETURN NEXT appends a row built from the current values of the OUT columns. The window function (Session 25) does it in one declarative line: prefer it, and keep RETURN NEXT for logic that has no SQL equivalent.', expectRows: 3 },
    { pts: 2, q: 'The ambiguity trap: write a PL/pgSQL function orders_of(customer_id int) RETURNS bigint that counts orders <code>WHERE customer_id = customer_id</code>, and call it.', hint: 'The parameter and the column have the same name.', steps: [
      "CREATE FUNCTION orders_of(customer_id int) RETURNS bigint\nLANGUAGE plpgsql STABLE AS $$\nBEGIN\n  RETURN (SELECT count(*) FROM orders WHERE orders.customer_id = customer_id);\nEND;\n$$;",
      'SELECT orders_of(1);'
    ], why: '"column reference customer_id is ambiguous": PL/pgSQL refuses to guess whether you meant the parameter or the column (the default plpgsql.variable_conflict = error). Even qualifying one side is not enough here. Fix it by naming the parameter p_customer_id. SQL functions resolve such names differently (the column wins), which is worse: no error, just wrong results.', expectOut: 'column reference "customer_id" is ambiguous' },
    { pts: 2, q: 'EXIT and CONTINUE: find the first day of February 2025 on which no order was placed, with a FOR loop over the days.', hint: 'FOR d IN SELECT generate_series(…)::date LOOP CONTINUE WHEN EXISTS (…); RETURN d; END LOOP;', sql: "CREATE FUNCTION first_quiet_day(p_from date, p_to date) RETURNS date\nLANGUAGE plpgsql STABLE AS $$\nDECLARE\n  d date;\nBEGIN\n  FOR d IN SELECT g::date FROM generate_series(p_from, p_to, INTERVAL '1 day') AS g LOOP\n    CONTINUE WHEN EXISTS (SELECT 1 FROM orders WHERE order_date = d);\n    RETURN d;\n  END LOOP;\n  RETURN NULL;\nEND;\n$$;\n\nSELECT first_quiet_day('2025-02-01', '2025-02-28') AS quiet, first_quiet_day('2025-02-03', '2025-02-03') AS none;", why: '2025-02-01, and NULL for a range where every day had an order. The set-based answer is a spine + NOT EXISTS + min() (Session 17): one query. Loops read naturally, but always ask whether one query can say it.', expectRows: 1 },
    { pts: 2, q: 'Write account_report() RETURNS TABLE (owner text, balance numeric, share text) that returns every account with its share of the total as a percentage string like "54.3%", computing the total once before the loop.', hint: 'SELECT sum(balance) INTO v_total …; FOR r IN … LOOP … RETURN NEXT; END LOOP;', sql: "CREATE FUNCTION account_report() RETURNS TABLE (owner text, balance numeric, share text)\nLANGUAGE plpgsql STABLE AS $$\nDECLARE\n  v_total numeric;\n  r accounts%ROWTYPE;\nBEGIN\n  SELECT sum(a.balance) INTO v_total FROM accounts a;\n  FOR r IN SELECT * FROM accounts ORDER BY account_id LOOP\n    owner := r.owner;\n    balance := r.balance;\n    share := round(100 * r.balance / NULLIF(v_total, 0), 1) || '%';\n    RETURN NEXT;\n  END LOOP;\nEND;\n$$;\n\nSELECT * FROM account_report();", why: 'Aarav 54.3%, Diya 32.6%, Kabir 0.0%, Ananya 13.0%. Again a window function would do it in one query (balance / sum(balance) OVER ()); here the point is the pattern: compute once, loop, emit rows.', expectRows: 4 }
  ],
  hard: {
    q: 'Wrap the job queue (Session 58) in functions: claim_next_job(p_worker text) RETURNS jobs (claims the oldest due job with SKIP LOCKED and returns it, or a row of NULLs if there is none) and finish_job(p_job_id int, p_worker text) RETURNS boolean (marks it done only if this worker still owns it). Run two workers A and B in parallel: each claims a job inside an open transaction; then A finishes its job, and B tries to finish A\'s job.',
    hint: 'UPDATE … RETURNING * INTO v_job; RETURN v_job; finish: UPDATE … WHERE job_id = p_job_id AND locked_by = p_worker AND status = \'running\'; RETURN FOUND;',
    setup: claimFn + "\nCREATE FUNCTION finish_job(p_job_id int, p_worker text) RETURNS boolean\nLANGUAGE plpgsql AS $$\nBEGIN\n  UPDATE jobs SET status = 'done', locked_by = NULL, locked_at = NULL\n  WHERE job_id = p_job_id AND locked_by = p_worker AND status = 'running';\n  RETURN FOUND;\nEND;\n$$;",
    two: [
      ['A', 'BEGIN;'],
      ['A', "SELECT job_id, kind FROM claim_next_job('worker-A');"],
      ['B', 'BEGIN;'],
      ['B', "SELECT job_id, kind FROM claim_next_job('worker-B');"],
      ['A', 'COMMIT;'], ['B', 'COMMIT;'],
      ['A', "SELECT finish_job(4, 'worker-A') AS a_done;"],
      ['B', "SELECT finish_job(4, 'worker-B') AS b_steals;"],
      ['A', 'SELECT job_id, status, locked_by FROM jobs WHERE job_id IN (4, 5) ORDER BY job_id;']
    ],
    why: 'A gets job 4, B gets job 5, without waiting; A finishes its job (t); B\'s attempt to finish job 4 is refused (f). Workers now call two functions instead of embedding SQL, so the claim logic (SKIP LOCKED, attempts, ordering) lives in one place and can be fixed without redeploying every worker. Session 68 turns the worker loop itself into a procedure.',
    expectOut: '\\b4 \\| send_email[\\s\\S]*\\b5 \\| export_report[\\s\\S]*a_done[\\s\\S]*\\bt\\b[\\s\\S]*b_steals[\\s\\S]*\\bf\\b'
  }
};
