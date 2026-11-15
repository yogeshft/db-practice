// Shared with Session 74.
export const legacy = `CREATE TABLE legacy_sales (           -- one row per order line, exported from the old shop system
  line_no    int PRIMARY KEY,
  order_ref  text,
  cust_name  text,
  cust_email text,
  order_date text,                     -- usually DD/MM/YYYY
  status     char(1),                  -- P pending, S shipped, D delivered, C cancelled
  sku        text,
  qty        text,
  amount     text                      -- line total, with thousands separators
);
INSERT INTO legacy_sales VALUES
  (1,  'ORD-1001', 'Riya Kapoor', 'Riya@Mail.test',   '05/01/2026', 'D', 'TSHIRT-M', '2',   '1,198.00'),
  (2,  'ORD-1001', 'Riya Kapoor', 'riya@mail.test ',  '05/01/2026', 'D', 'MUG',      '1',   '349.00'),
  (3,  'ORD-1002', 'Arjun Rao',   'arjun@mail.test',  '07/01/2026', 'S', 'HOODIE-L', '1',   '2,499.00'),
  (4,  'ORD-1003', 'riya kapoor', 'riya@mail.test',   '12/01/2026', 'P', 'MUG',      '3',   '1,047.00'),
  (5,  'ORD-1004', 'Meher Gill',  'meher@mail.test',  '2026-01-15', 'D', 'CAP',      '1',   '599'),
  (6,  'ORD-1005', 'Arjun Rao',   'arjun@mail.test',  '31/02/2026', 'C', 'TSHIRT-M', '1',   '599.00'),
  (7,  'ORD-1006', 'Kabir Das',   '',                 '20/01/2026', 'D', 'MUG',      '2',   '698.00'),
  (8,  'ORD-1007', 'Meher Gill',  'MEHER@mail.test',  '22/01/2026', 'X', 'CAP',      '2',   '1,198.00'),
  (9,  'ORD-1008', 'Arjun Rao',   'arjun@mail.test',  '25/01/2026', 'D', 'HOODIE-L', 'two', '4,998.00'),
  (10, 'ORD-1009', 'Riya Kapoor', 'riya@mail.test',   '28/01/2026', 'S', 'TSHIRT-M', '1',   '599.00'),
  (11, 'ORD-1009', 'Riya Kapoor', 'riya@mail.test',   '28/01/2026', 'S', 'CAP',      '1',   '599.00'),
  (12, 'ORD-1010', 'Arjun Rao',   'arjun@mail.test',  '02/02/2026', 'P', 'MUG',      '1',   '349.00');`;

const dateFn = `CREATE FUNCTION parse_legacy_date(v text) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF v ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN
    RETURN to_date(v, 'DD/MM/YYYY');
  ELSIF v ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN
    RETURN v::date;
  END IF;
  RETURN NULL;
EXCEPTION WHEN data_exception THEN          -- e.g. 31/02/2026
  RETURN NULL;
END;
$$;`;
const otherFns = `CREATE FUNCTION parse_amount(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE
RETURN NULLIF(regexp_replace(v, '[^0-9.]', '', 'g'), '')::numeric(10, 2);

CREATE FUNCTION parse_qty(v text) RETURNS int
LANGUAGE sql IMMUTABLE
RETURN CASE WHEN v ~ '^\\d+$' THEN v::int END;

CREATE FUNCTION norm_email(v text) RETURNS text
LANGUAGE sql IMMUTABLE
RETURN NULLIF(lower(trim(v)), '');

CREATE FUNCTION legacy_status(c char) RETURNS text
LANGUAGE sql IMMUTABLE
RETURN CASE c WHEN 'P' THEN 'pending' WHEN 'S' THEN 'shipped' WHEN 'D' THEN 'delivered' WHEN 'C' THEN 'cancelled' END;`;
const problemsView = `CREATE VIEW legacy_problems AS
SELECT line_no, order_ref, problems
FROM (
  SELECT line_no, order_ref, array_remove(ARRAY[
           CASE WHEN parse_legacy_date(order_date) IS NULL THEN 'bad date' END,
           CASE WHEN norm_email(cust_email) IS NULL THEN 'no email' END,
           CASE WHEN legacy_status(status) IS NULL THEN 'unknown status' END,
           CASE WHEN parse_qty(qty) IS NULL OR parse_qty(qty) = 0 THEN 'bad quantity' END,
           CASE WHEN parse_amount(amount) IS NULL THEN 'bad amount' END
         ], NULL) AS problems
  FROM legacy_sales
) p
WHERE cardinality(problems) > 0;`;
export const fns = dateFn + '\n\n' + otherFns + '\n\n' + problemsView;
export const shop = `CREATE SCHEMA shop;

CREATE TABLE shop.customers (
  customer_id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name   text NOT NULL
);
CREATE TABLE shop.orders (
  order_id    int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legacy_ref  text UNIQUE,                 -- ORD-1001: keeps the link to the old system
  customer_id int NOT NULL REFERENCES shop.customers,
  order_date  date NOT NULL,
  status      text NOT NULL CHECK (status IN ('pending', 'shipped', 'delivered', 'cancelled'))
);
CREATE INDEX ON shop.orders (customer_id);
CREATE TABLE shop.order_lines (
  order_id       int NOT NULL REFERENCES shop.orders,
  sku            text NOT NULL,
  qty            int NOT NULL CHECK (qty > 0),
  amount         numeric(10, 2) NOT NULL CHECK (amount >= 0),
  legacy_line_no int UNIQUE,
  PRIMARY KEY (order_id, sku)
);
CREATE TABLE shop.migration_errors (
  line_no  int PRIMARY KEY,
  problems text[] NOT NULL,
  noted_at timestamptz NOT NULL DEFAULT now()
);`;
export const migrateCustomers = `INSERT INTO shop.customers (email, full_name)
SELECT DISTINCT ON (norm_email(cust_email)) norm_email(cust_email), trim(cust_name)
FROM legacy_sales
WHERE norm_email(cust_email) IS NOT NULL
ORDER BY norm_email(cust_email), line_no
ON CONFLICT (email) DO NOTHING;`;
export const migrateOrders = `INSERT INTO shop.orders (legacy_ref, customer_id, order_date, status)
SELECT DISTINCT ON (l.order_ref) l.order_ref, c.customer_id, parse_legacy_date(l.order_date), legacy_status(l.status)
FROM legacy_sales l
JOIN shop.customers c ON c.email = norm_email(l.cust_email)
WHERE l.order_ref NOT IN (SELECT order_ref FROM legacy_problems)
ORDER BY l.order_ref, l.line_no
ON CONFLICT (legacy_ref) DO NOTHING;`;
export const migrateLines = `INSERT INTO shop.order_lines (order_id, sku, qty, amount, legacy_line_no)
SELECT o.order_id, l.sku, parse_qty(l.qty), parse_amount(l.amount), l.line_no
FROM legacy_sales l
JOIN shop.orders o ON o.legacy_ref = l.order_ref
ON CONFLICT (legacy_line_no) DO NOTHING;`;
export const migrateErrors = `INSERT INTO shop.migration_errors (line_no, problems)
SELECT line_no, problems FROM legacy_problems
ON CONFLICT (line_no) DO NOTHING;`;

export default {
  n: 73,
  phase: 'p7',
  title: 'Capstone: legacy migration, part 1',
  goal: 'Move a messy export from an old system into a clean, constrained schema: profile it, write the cleaning functions, quarantine what cannot be trusted, and prove nothing was lost.',
  minutes: 150,
  lesson: [
    { h: 'The situation' },
    { p: 'A small shop is replacing its old order system. The old system keeps everything in one table, <code>legacy_sales</code>: one row per order line, with the customer typed in again on every line, dates and amounts stored as text, and one-letter status codes. The new schema <code>shop</code> has customers, orders and order lines with real types and constraints. The old app must keep working while you migrate (that is part 2, Session 74).' },
    { pre: legacy },
    { h: 'The plan' },
    { list: [
      '<b>Profile</b> before you write any migration: counts, distinct values, formats. Every surprise you find now is a failed migration you do not have to debug later.',
      '<b>Clean with small IMMUTABLE functions</b> (parse_legacy_date, parse_amount, parse_qty, norm_email, legacy_status) that return NULL for anything they cannot read. They can be tested one by one and reused by the dual-write trigger in part 2.',
      '<b>Quarantine, do not guess.</b> Rows with problems go to <code>shop.migration_errors</code> with the reasons; a person decides. An order migrates only if every one of its lines is clean.',
      '<b>Idempotent:</b> every INSERT has ON CONFLICT … DO NOTHING on a key from the old system (legacy_ref, legacy_line_no), so the migration can be run again after a fix.',
      '<b>Reconcile:</b> migrated + quarantined = everything, and the money adds up.'
    ] },
    { tip: 'Each question below starts from a fresh database, so the answers repeat the setup (legacy table, functions, schema). In your own psql session, run each piece once and keep going.' }
  ],
  questions: [
    { pts: 1, q: 'Profile: how many lines, distinct order references, distinct raw email values and distinct emails after lower(trim()) are in legacy_sales (ignore empty emails)?', hint: "count(DISTINCT …); NULLIF(cust_email, '') to drop the empty one.", sql: legacy + "\n\nSELECT count(*) AS lines,\n       count(DISTINCT order_ref) AS orders,\n       count(DISTINCT NULLIF(cust_email, '')) AS raw_emails,\n       count(DISTINCT NULLIF(lower(trim(cust_email)), '')) AS customers\nFROM legacy_sales;", why: '12 lines, 10 orders, 6 raw email spellings but only 3 real customers. The old system had no unique customer, so the same person appears as Riya@Mail.test and riya@mail.test. Normalising is the first step of every migration of people.', expectRows: 1 },
    { pts: 1, q: 'Which formats does order_date use? Group the dates by a "shape" (digits replaced by 9) and count them.', hint: "regexp_replace(order_date, '\\d', '9', 'g')", sql: legacy + "\n\nSELECT regexp_replace(order_date, '\\d', '9', 'g') AS shape, count(*), min(order_date) AS example\nFROM legacy_sales GROUP BY 1 ORDER BY 2 DESC;", why: 'Two shapes: 99/99/9999 (11 lines) and 9999-99-99 (1 line, ORD-1004). The shape trick works for phone numbers, postcodes and IDs too. A shape that matches can still be wrong (31/02/2026), which Q3 catches.', expectRows: 2 },
    { pts: 1, q: 'Write parse_legacy_date(text) RETURNS date: DD/MM/YYYY or YYYY-MM-DD, NULL for anything else, including impossible dates. Test it on lines 1, 5 and 6.', hint: 'to_date() raises for 31/02/2026; catch data_exception (the whole class 22 of errors) and return NULL.', steps: [legacy, dateFn, 'SELECT line_no, order_date, parse_legacy_date(order_date) AS parsed FROM legacy_sales WHERE line_no IN (1, 5, 6) ORDER BY line_no;'], why: '2026-01-05, 2026-01-15, and NULL for 31/02/2026. The function is IMMUTABLE (the same text always gives the same date), so it may be used in indexes and generated columns. The EXCEPTION block costs a subtransaction per call (Session 67): fine for 12 rows; for millions, check the ranges with regex first.', expectOut: '1 \\| 05/01/2026 \\| 2026-01-05[\\s\\S]*5 \\| 2026-01-15 \\| 2026-01-15[\\s\\S]*6 \\| 31/02/2026 \\| ∅' },
    { pts: 1, q: 'Write parse_amount, parse_qty, norm_email and legacy_status (code in the answer) and use them to show line 9 and line 8 cleaned.', hint: 'Each returns NULL when it cannot read the value.', steps: [legacy, otherFns, 'SELECT line_no, parse_qty(qty) AS qty, parse_amount(amount) AS amount, norm_email(cust_email) AS email, legacy_status(status) AS status\nFROM legacy_sales WHERE line_no IN (8, 9) ORDER BY line_no;'], why: 'Line 8: qty 2, 1198.00, meher@mail.test, status NULL (X is unknown). Line 9: qty NULL ("two"), 4998.00, arjun@mail.test, delivered. Small functions, each testable alone. Note parse_amount would still fail on text like "1.2.3": good enough for this data, and the profile is how you know.', expectOut: '8 \\|\\s+2 \\| 1198\\.00 \\| meher@mail\\.test \\| ∅[\\s\\S]*9 \\|\\s+∅ \\| 4998\\.00 \\| arjun@mail\\.test \\| delivered' },
    { pts: 2, q: 'Create the view legacy_problems (code in the answer) that lists each line with problems and an array of the reasons. Which lines are in it?', hint: "array_remove(ARRAY[CASE WHEN … THEN 'bad date' END, …], NULL) and keep rows with cardinality > 0", steps: [legacy, fns, 'SELECT * FROM legacy_problems ORDER BY line_no;'], why: 'Four lines: 6 bad date, 7 no email, 8 unknown status, 9 bad quantity. One reason column per rule, collected into an array, tells a person exactly what to fix. The view is the single definition of "clean" for the whole migration, and part 2 reuses it.', expectOut: '6 \\| ORD-1005\\s+\\| \\{"bad date"\\}[\\s\\S]*7 \\| ORD-1006\\s+\\| \\{"no email"\\}[\\s\\S]*8 \\| ORD-1007\\s+\\| \\{"unknown status"\\}[\\s\\S]*9 \\| ORD-1008\\s+\\| \\{"bad quantity"\\}\\n\\(4 rows\\)' },
    { pts: 1, q: 'Create the new schema (code in the answer). Then insert directly: a customer with an upper-case email, the same customer in lower case, an order for customer 1, the same order looked up by email, and a line with quantity 0.', hint: 'Predict each result first, including the order for customer 1.', steps: [shop, "INSERT INTO shop.customers (email, full_name) VALUES ('Riya@Mail.test', 'Riya Kapoor');", "INSERT INTO shop.customers (email, full_name) VALUES ('riya@mail.test', 'Riya Kapoor');", "INSERT INTO shop.orders (legacy_ref, customer_id, order_date, status) VALUES ('TEST', 1, '2026-02-01', 'pending');", "INSERT INTO shop.orders (legacy_ref, customer_id, order_date, status)\nSELECT 'TEST', customer_id, '2026-02-01', 'pending' FROM shop.customers WHERE email = 'riya@mail.test';", "INSERT INTO shop.order_lines (order_id, sku, qty, amount) SELECT order_id, 'MUG', 0, 0 FROM shop.orders WHERE legacy_ref = 'TEST';"], why: 'Both bad rows are rejected by CHECK constraints. And a surprise on the way: the order for customer 1 fails, because the good customer got id 2. The rejected insert had already used id 1, and identity values are never given back. Never hard-code generated ids; look them up by a natural key. The constraints are the real migration spec: whatever the cleaning functions miss, the new schema refuses. Write them first, then make the data fit, never the other way round.', expectOut: 'violates check constraint "customers_email_check"[\\s\\S]*INSERT 0 1\\n[\\s\\S]*Key \\(customer_id\\)=\\(1\\) is not present[\\s\\S]*INSERT 0 1\\n[\\s\\S]*violates check constraint "order_lines_qty_check"' },
    { pts: 1, q: 'Migrate the customers: one per normalised email, using the name from the earliest line. Show them.', hint: 'DISTINCT ON (norm_email(cust_email)) … ORDER BY norm_email(cust_email), line_no', steps: [legacy, fns, shop, migrateCustomers, 'SELECT customer_id, email, full_name FROM shop.customers ORDER BY customer_id;'], why: 'Three customers: arjun, meher, riya (in email order, so their ids follow that order). Kabir has no email and is not migrated; his line is in the problems view. "riya kapoor" in lower case on line 4 lost to "Riya Kapoor" from line 1. Write down rules like "the earliest line wins" in the migration notes: someone will ask.', expectOut: '1 \\| arjun@mail\\.test \\| Arjun Rao\\n\\s+2 \\| meher@mail\\.test \\| Meher Gill\\n\\s+3 \\| riya@mail\\.test\\s+\\| Riya Kapoor\\n' },
    { pts: 2, q: 'Migrate orders and order lines (code in the answer): only orders whose lines are all clean. How many orders and lines arrive?', hint: 'WHERE order_ref NOT IN (SELECT order_ref FROM legacy_problems)', steps: [legacy, fns, shop, migrateCustomers, migrateOrders, migrateLines, 'SELECT (SELECT count(*) FROM shop.orders) AS orders, (SELECT count(*) FROM shop.order_lines) AS lines;'], why: '6 orders and 8 lines: ORD-1005 to ORD-1008 stay behind (one bad line each). NOT IN is safe here because legacy_problems.order_ref is never NULL in this data; with NULLs it would return nothing at all (Session 4): NOT EXISTS is the safer habit.', expectOut: 'orders \\| lines\\n-+\\+-+\\n\\s+6 \\|\\s+8\\n' },
    { pts: 2, q: 'Quarantine and reconcile: copy the problem lines into shop.migration_errors. Then prove that migrated lines + quarantined lines = all legacy lines, and that the migrated amounts equal the legacy amounts of the same lines.', hint: 'Join shop.order_lines back to legacy_sales on legacy_line_no.', steps: [legacy, fns, shop, migrateCustomers, migrateOrders, migrateLines, migrateErrors, "SELECT (SELECT count(*) FROM shop.order_lines) AS migrated,\n       (SELECT count(*) FROM shop.migration_errors) AS quarantined,\n       (SELECT count(*) FROM legacy_sales) AS legacy_lines,\n       (SELECT sum(amount) FROM shop.order_lines) AS new_total,\n       (SELECT sum(parse_amount(l.amount)) FROM legacy_sales l JOIN shop.order_lines n ON n.legacy_line_no = l.line_no) AS legacy_total;"], why: '8 + 4 = 12, and 7,239.00 on both sides. Every line is accounted for exactly once and no money appeared or vanished. Run this kind of check after every migration run, and keep the numbers in the migration notes.', expectOut: '\\s+8 \\|\\s+4 \\|\\s+12 \\|\\s+7239\\.00 \\|\\s+7239\\.00\\n' },
    { pts: 2, q: 'Fix and re-run: someone corrects line 6 (the date is really 03/02/2026) and line 8 (status D). Delete their quarantine entries and run the whole migration again. What arrives, and is anything duplicated?', hint: 'The ON CONFLICT clauses make re-running safe.', steps: [legacy, fns, shop, migrateCustomers, migrateOrders, migrateLines, migrateErrors, "UPDATE legacy_sales SET order_date = '03/02/2026' WHERE line_no = 6;", "UPDATE legacy_sales SET status = 'D' WHERE line_no = 8;", 'DELETE FROM shop.migration_errors WHERE line_no IN (6, 8);', migrateCustomers, migrateOrders, migrateLines, migrateErrors, "SELECT (SELECT count(*) FROM shop.orders) AS orders, (SELECT count(*) FROM shop.order_lines) AS lines,\n       (SELECT count(*) FROM shop.migration_errors) AS quarantined,\n       (SELECT count(DISTINCT legacy_line_no) FROM shop.order_lines) AS distinct_lines;"], why: 'ORD-1005 and ORD-1007 arrive: 8 orders, 10 lines, 2 still quarantined (7 and 9), no duplicates (10 distinct legacy line numbers). The second run inserted only what was new. That is what makes a migration something you can run, fix, and run again on the night.', expectOut: 'orders \\| lines \\| quarantined \\| distinct_lines\\n-+\\+-+\\+-+\\+-+\\n\\s+8 \\|\\s+10 \\|\\s+2 \\|\\s+10\\n' }
  ],
  hard: {
    q: 'Package it: write a procedure migrate_legacy() that runs the four migration steps in order, reports the new rows of each step with RAISE NOTICE (GET DIAGNOSTICS), and COMMITs at the end. Run it twice. What does the second run report?',
    hint: 'After each INSERT: GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE …',
    steps: [legacy, fns, shop,
      `CREATE PROCEDURE migrate_legacy()
LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  ${migrateCustomers.replace(/\n/g, '\n  ')}
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'customers: %', n;

  ${migrateOrders.replace(/\n/g, '\n  ')}
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'orders: %', n;

  ${migrateLines.replace(/\n/g, '\n  ')}
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'lines: %', n;

  ${migrateErrors.replace(/\n/g, '\n  ')}
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'quarantined: %', n;

  COMMIT;
END;
$$;`,
      'CALL migrate_legacy();',
      'CALL migrate_legacy();'
    ],
    why: 'First run: customers 3, orders 6, lines 8, quarantined 4. Second run: 0, 0, 0, 0. A migration that reports what it did, and does nothing the second time, can be run by anyone on the night without fear. Part 2 keeps the two systems in step while the old app is still being used.',
    expectOut: 'customers: 3\\nNOTICE:  orders: 6\\nNOTICE:  lines: 8\\nNOTICE:  quarantined: 4\\nCALL[\\s\\S]*customers: 0\\nNOTICE:  orders: 0\\nNOTICE:  lines: 0\\nNOTICE:  quarantined: 0\\nCALL'
  }
};
