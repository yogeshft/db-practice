import { legacy, fns, shop, migrateCustomers, migrateOrders, migrateLines, migrateErrors } from './s73.mjs';

const migrated = [legacy, fns, shop, migrateCustomers, migrateOrders, migrateLines, migrateErrors].join('\n\n');

const syncFn = `CREATE FUNCTION sync_legacy() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_problems text[];
BEGIN
  SELECT problems INTO v_problems FROM legacy_problems WHERE line_no = NEW.line_no;
  IF FOUND THEN                                     -- not clean: quarantine, do not migrate
    INSERT INTO shop.migration_errors (line_no, problems) VALUES (NEW.line_no, v_problems)
    ON CONFLICT (line_no) DO UPDATE SET problems = EXCLUDED.problems, noted_at = now();
    RETURN NULL;
  END IF;
  BEGIN
    INSERT INTO shop.customers (email, full_name) VALUES (norm_email(NEW.cust_email), trim(NEW.cust_name))
    ON CONFLICT (email) DO NOTHING;
    INSERT INTO shop.orders (legacy_ref, customer_id, order_date, status)
    SELECT NEW.order_ref, customer_id, parse_legacy_date(NEW.order_date), legacy_status(NEW.status)
    FROM shop.customers WHERE email = norm_email(NEW.cust_email)
    ON CONFLICT (legacy_ref) DO UPDATE SET order_date = EXCLUDED.order_date, status = EXCLUDED.status;
    INSERT INTO shop.order_lines (order_id, sku, qty, amount, legacy_line_no)
    SELECT order_id, NEW.sku, parse_qty(NEW.qty), parse_amount(NEW.amount), NEW.line_no
    FROM shop.orders WHERE legacy_ref = NEW.order_ref
    ON CONFLICT (legacy_line_no) DO UPDATE SET sku = EXCLUDED.sku, qty = EXCLUDED.qty, amount = EXCLUDED.amount;
    DELETE FROM shop.migration_errors WHERE line_no = NEW.line_no;
  EXCEPTION WHEN OTHERS THEN                        -- never break the old app: quarantine instead
    INSERT INTO shop.migration_errors (line_no, problems) VALUES (NEW.line_no, ARRAY[SQLERRM])
    ON CONFLICT (line_no) DO UPDATE SET problems = EXCLUDED.problems, noted_at = now();
  END;
  RETURN NULL;
END;
$$;

CREATE TRIGGER legacy_sync AFTER INSERT OR UPDATE ON legacy_sales
  FOR EACH ROW EXECUTE FUNCTION sync_legacy();`;

const compatView = `CREATE VIEW shop.legacy_sales_v AS
SELECT l.legacy_line_no                         AS line_no,
       o.legacy_ref                             AS order_ref,
       c.full_name                              AS cust_name,
       c.email                                  AS cust_email,
       to_char(o.order_date, 'DD/MM/YYYY')      AS order_date,
       (CASE o.status WHEN 'pending' THEN 'P' WHEN 'shipped' THEN 'S'
                      WHEN 'delivered' THEN 'D' WHEN 'cancelled' THEN 'C' END)::char(1) AS status,
       l.sku,
       l.qty::text                              AS qty,
       to_char(l.amount, 'FM9,999,990.00')      AS amount
FROM shop.order_lines l
JOIN shop.orders o    ON o.order_id = l.order_id
JOIN shop.customers c ON c.customer_id = o.customer_id;`;

const viewInsertFn = `CREATE FUNCTION legacy_view_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF parse_legacy_date(NEW.order_date) IS NULL OR legacy_status(NEW.status) IS NULL
     OR parse_qty(NEW.qty) IS NULL OR parse_amount(NEW.amount) IS NULL OR norm_email(NEW.cust_email) IS NULL THEN
    RAISE EXCEPTION 'order line % rejected', NEW.line_no USING ERRCODE = 'check_violation',
      DETAIL = format('date %L, status %L, qty %L, amount %L, email %L',
                      NEW.order_date, NEW.status, NEW.qty, NEW.amount, NEW.cust_email);
  END IF;
  INSERT INTO shop.customers (email, full_name) VALUES (norm_email(NEW.cust_email), trim(NEW.cust_name))
  ON CONFLICT (email) DO NOTHING;
  INSERT INTO shop.orders (legacy_ref, customer_id, order_date, status)
  SELECT NEW.order_ref, customer_id, parse_legacy_date(NEW.order_date), legacy_status(NEW.status)
  FROM shop.customers WHERE email = norm_email(NEW.cust_email)
  ON CONFLICT (legacy_ref) DO NOTHING;
  INSERT INTO shop.order_lines (order_id, sku, qty, amount, legacy_line_no)
  SELECT order_id, NEW.sku, parse_qty(NEW.qty), parse_amount(NEW.amount), NEW.line_no
  FROM shop.orders WHERE legacy_ref = NEW.order_ref;
  RETURN NEW;
END;
$$;

CREATE TRIGGER legacy_view_insert INSTEAD OF INSERT ON shop.legacy_sales_v
  FOR EACH ROW EXECUTE FUNCTION legacy_view_insert();`;

const cutover = `BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE legacy_sales RENAME TO legacy_sales_archive;
DROP TRIGGER legacy_sync ON legacy_sales_archive;
ALTER VIEW shop.legacy_sales_v SET SCHEMA public;
ALTER VIEW legacy_sales_v RENAME TO legacy_sales;
COMMIT;`;

const newLine = "INSERT INTO legacy_sales (line_no, order_ref, cust_name, cust_email, order_date, status, sku, qty, amount)\nVALUES (16, 'ORD-1012', 'Tara Sen', 'tara@mail.test', '10/02/2026', 'P', 'HOODIE-L', '1', '2,499.00');";

export default {
  n: 74,
  phase: 'p7',
  title: 'Capstone: legacy migration, part 2',
  goal: 'Keep the old and the new schema in step while the old app is still in use, give the old app a compatible view, switch over in one short transaction, and know how to switch back.',
  minutes: 150,
  lesson: [
    { h: 'Where we are' },
    { p: 'Session 73 left a clean shop schema with 6 orders and 8 lines, 4 lines in quarantine, and an idempotent migration. Every question below starts from that state (the answers run Session 73\'s migration as a hidden setup step; in your own psql, just continue from Session 73\'s challenge).' },
    { h: 'The cut-over plan' },
    { pre: "1. Dual write     a trigger on legacy_sales copies every new or changed line into shop     (Q2–Q4)\n2. Compatibility  a view with the old columns, built on shop, writable via INSTEAD OF  (Q5–Q6)\n3. Switch         one short transaction: rename the table away, the view in its place  (Q7)\n4. Lock down      the old app may only use the view                                    (Q8)\n5. Way back       a tested script that copies new rows back and swaps the names       (challenge)", lang: 'text' },
    { p: 'The old app never changes: it keeps sending <code>INSERT INTO legacy_sales …</code>. Before the switch that hits the table (and the trigger copies it); after the switch it hits the view (and the INSTEAD OF trigger writes to shop). That is the "expand, migrate, contract" pattern from Session 61, applied to a whole table.' },
    { trap: 'During dual write, the old system is still the truth, so the trigger must never make an old-app write fail: a bad line goes to quarantine instead (Q3). After the switch, the new schema is the truth, and bad data is rejected outright (Q6). Decide which side is the truth at every step, and write it down.' }
  ],
  questions: [
    { pts: 1, q: 'Reconcile per order: compare each migrated order\'s total in shop with the total of the same order\'s lines in legacy_sales. List the orders that differ.', hint: 'Two grouped subqueries joined on legacy_ref = order_ref, then WHERE the totals are distinct.', setup: migrated, steps: ["WITH old AS (\n  SELECT order_ref, sum(parse_amount(amount)) AS total FROM legacy_sales GROUP BY order_ref\n), new AS (\n  SELECT o.legacy_ref, sum(l.amount) AS total\n  FROM shop.orders o JOIN shop.order_lines l ON l.order_id = o.order_id GROUP BY o.legacy_ref\n)\nSELECT new.legacy_ref, old.total AS legacy_total, new.total AS shop_total\nFROM new JOIN old ON old.order_ref = new.legacy_ref\nWHERE old.total IS DISTINCT FROM new.total;", "SELECT count(*) AS orders_checked FROM shop.orders;"], why: 'No order differs (0 rows), and 6 orders were checked. Session 73 compared the grand total; per-order checks catch a line attached to the wrong order, which a grand total cannot. Keep this query: it runs again after the switch.', expectOut: '\\(0 rows\\)[\\s\\S]*orders_checked\\n-+\\n\\s+6\\n' },
    { pts: 1, q: 'Dual write: create the sync_legacy() trigger on legacy_sales (code in the answer). The old app then inserts a line for a new customer: line 13, ORD-1011, Tara Sen, tara@mail.test, 08/02/2026, P, CAP, 1, 599.00. Does it appear in shop?', hint: 'The trigger reuses the cleaning functions and the problems view from Session 73.', setup: migrated, steps: [syncFn, "INSERT INTO legacy_sales VALUES (13, 'ORD-1011', 'Tara Sen', 'tara@mail.test', '08/02/2026', 'P', 'CAP', '1', '599.00');", "SELECT o.legacy_ref, c.email, o.order_date, o.status, l.sku, l.amount\nFROM shop.orders o JOIN shop.customers c USING (customer_id) JOIN shop.order_lines l USING (order_id)\nWHERE o.legacy_ref = 'ORD-1011';"], why: 'Yes: a new customer, the order (2026-02-08, pending) and its line, all in the same transaction as the old app\'s INSERT. The upserts make the trigger safe for lines of an order that already exists, and for the backfill and the trigger touching the same row.', expectOut: 'ORD-1011\\s+\\| tara@mail\\.test \\| 2026-02-08 \\| pending \\| CAP\\s+\\| 599\\.00' },
    { pts: 2, q: 'The old app must never break: with the trigger in place, insert line 14 (ORD-1010, a second MUG line in an order that already has one) and line 15 (ORD-1013, date 30/02/2026). Do the legacy inserts succeed? What is in quarantine for them?', hint: 'shop.order_lines has PRIMARY KEY (order_id, sku); the legacy table has no such rule.', setup: migrated, steps: [syncFn, "INSERT INTO legacy_sales VALUES (14, 'ORD-1010', 'Arjun Rao', 'arjun@mail.test', '02/02/2026', 'P', 'MUG', '1', '349.00');", "INSERT INTO legacy_sales VALUES (15, 'ORD-1013', 'Meher Gill', 'meher@mail.test', '30/02/2026', 'P', 'CAP', '1', '599.00');", 'SELECT line_no, problems FROM shop.migration_errors WHERE line_no IN (14, 15) ORDER BY line_no;'], why: 'Both inserts succeed (INSERT 0 1). Line 14 is quarantined with the duplicate-key message, line 15 with {"bad date"}. The new schema found a rule the old data breaks (one row per product per order): a decision for the business (merge the lines? allow it?), not something the trigger should guess. The inner BEGIN … EXCEPTION is what keeps the old app running.', expectOut: 'INSERT 0 1[\\s\\S]*INSERT 0 1[\\s\\S]*14 \\| \\{"duplicate key value violates unique constraint \\\\"order_lines_pkey\\\\""\\}\\n\\s+15 \\| \\{"bad date"\\}' },
    { pts: 2, q: 'Changes flow too: with the trigger in place, the old app ships ORD-1010 (status S) and someone fixes line 9\'s quantity to \'2\'. Check ORD-1010 and ORD-1008 in shop, and whether line 9 is still quarantined.', hint: 'The trigger fires on UPDATE as well, and its upserts update existing rows.', setup: migrated, steps: [syncFn, "UPDATE legacy_sales SET status = 'S' WHERE order_ref = 'ORD-1010';", "UPDATE legacy_sales SET qty = '2' WHERE line_no = 9;", "SELECT legacy_ref, status FROM shop.orders WHERE legacy_ref IN ('ORD-1008', 'ORD-1010') ORDER BY legacy_ref;", 'SELECT count(*) AS line_9_quarantined FROM shop.migration_errors WHERE line_no = 9;'], why: 'ORD-1010 is shipped, ORD-1008 has arrived (delivered), and line 9 has left quarantine. Fixing data in the old system is now enough; the trigger carries the fix over. (An order whose lines are only partly fixed arrives line by line; the per-order reconciliation from Q1 shows it.)', expectOut: 'ORD-1008\\s+\\| delivered\\n\\s+ORD-1010\\s+\\| shipped[\\s\\S]*line_9_quarantined\\n-+\\n\\s+0\\n' },
    { pts: 2, q: 'The compatibility view: create shop.legacy_sales_v (code in the answer), which shows the shop data with the old columns and formats. Compare it with legacy_sales: which migrated lines look different, and why?', hint: '(SELECT * FROM legacy_sales WHERE line_no IN (SELECT line_no FROM shop.legacy_sales_v)) EXCEPT (SELECT * FROM shop.legacy_sales_v)', setup: migrated, steps: [compatView, "SELECT line_no, cust_name, cust_email, order_date, amount\nFROM ((SELECT * FROM legacy_sales WHERE line_no IN (SELECT line_no FROM shop.legacy_sales_v))\n      EXCEPT\n      (SELECT * FROM shop.legacy_sales_v)) d\nORDER BY line_no;"], why: 'Four lines show their old values: 1 and 2 (email case and a trailing space), 4 (name in lower case: the customer now has one name) and 5 (an ISO date and "599" without decimals). These are exactly the clean-ups, so the differences are wanted. Before the switch, check that the old app does not depend on any of them (for example, searching by the exact old email string).', expectOut: '1 \\| Riya Kapoor \\| Riya@Mail\\.test[\\s\\S]*2 \\| Riya Kapoor \\| riya@mail\\.test [\\s\\S]*4 \\| riya kapoor[\\s\\S]*5 \\| Meher Gill\\s+\\| meher@mail\\.test \\| 2026-01-15 \\| 599\\n\\(4 rows\\)' },
    { pts: 2, q: 'Make the view writable for the old app: add the INSTEAD OF INSERT trigger legacy_view_insert (code in the answer; after the switch, bad lines are rejected, not quarantined). Insert a good line and a line with quantity \'0x\' through the view.', hint: 'An INSTEAD OF trigger function returns NEW for "1 row inserted".', setup: migrated, steps: [compatView, viewInsertFn, newLine.replace('INSERT INTO legacy_sales', 'INSERT INTO shop.legacy_sales_v'), "INSERT INTO shop.legacy_sales_v (line_no, order_ref, cust_name, cust_email, order_date, status, sku, qty, amount)\nVALUES (17, 'ORD-1013', 'Tara Sen', 'tara@mail.test', '10/02/2026', 'P', 'CAP', '0x', '599.00');", "SELECT * FROM shop.legacy_sales_v WHERE line_no = 16;"], why: 'Line 16 goes in and reads back in the old format; line 17 is rejected with a DETAIL that shows every value. The function is SECURITY DEFINER with a fixed search_path because after the lock-down (Q8) the old app may write only to the view, not to the shop tables the trigger writes.', expectOut: 'INSERT 0 1[\\s\\S]*ERROR:  order line 17 rejected\\nDETAIL:  date \'10/02/2026\', status \'P\', qty \'0x\'[\\s\\S]*16 \\| ORD-1012\\s+\\| Tara Sen\\s+\\| tara@mail\\.test \\| 10/02/2026 \\| P\\s+\\| HOODIE-L \\| 1\\s+\\| 2,499\\.00' },
    { pts: 2, q: 'The switch: in one transaction with a short lock_timeout, rename legacy_sales to legacy_sales_archive, drop its sync trigger, move the view to public and rename it to legacy_sales. Then run the old app\'s usual INSERT INTO legacy_sales (line 16) and see where it lands.', hint: 'DDL is transactional in Postgres: all renames become visible at COMMIT, together.', setup: migrated + '\n\n' + syncFn + '\n\n' + compatView + '\n\n' + viewInsertFn, steps: [cutover, newLine, "SELECT relname, relkind FROM pg_class WHERE relname IN ('legacy_sales', 'legacy_sales_archive') ORDER BY relname;", "SELECT (SELECT count(*) FROM shop.order_lines WHERE legacy_line_no = 16) AS in_shop,\n       (SELECT count(*) FROM legacy_sales_archive WHERE line_no = 16) AS in_archive;"], why: 'legacy_sales is now a view (relkind v) and the archive a table (r); line 16 is in shop, not in the archive. The old app noticed nothing: same name, same columns, same INSERT. The transaction takes ACCESS EXCLUSIVE locks for milliseconds; lock_timeout makes it give up (and leave everything as it was) instead of queueing the whole app behind a long query (Session 61).', expectOut: 'COMMIT[\\s\\S]*INSERT 0 1[\\s\\S]*legacy_sales\\s+\\| v\\n\\s+legacy_sales_archive \\| r[\\s\\S]*in_shop \\| in_archive\\n-+\\+-+\\n\\s+1 \\|\\s+0\\n' },
    { pts: 2, q: 'Lock down: create a role legacy_app that may only SELECT and INSERT on the legacy_sales view. As legacy_app, insert line 16, read shop.customers directly, and read the view.', hint: 'GRANT SELECT, INSERT ON legacy_sales TO legacy_app; SET ROLE legacy_app;', setup: migrated + '\n\n' + syncFn + '\n\n' + compatView + '\n\n' + viewInsertFn, steps: [cutover, 'CREATE ROLE legacy_app NOLOGIN;', 'GRANT SELECT, INSERT ON legacy_sales TO legacy_app;', 'SET ROLE legacy_app;', newLine, 'SELECT count(*) FROM shop.customers;', 'SELECT count(*) AS lines_via_view FROM legacy_sales;', 'RESET ROLE;'], why: 'The insert works and the view returns 9 lines, but shop.customers is "permission denied for schema shop". The view reads shop with its owner\'s rights, and the trigger function writes with its owner\'s rights (SECURITY DEFINER): the old app gets exactly the old interface and nothing more. Remove the SECURITY DEFINER and the insert fails too.', expectOut: 'INSERT 0 1[\\s\\S]*permission denied for schema shop[\\s\\S]*lines_via_view\\n-+\\n\\s+9\\n' }
  ],
  hard: {
    q: 'The way back: after the switch and one new line (16) through the view, something goes wrong and you must return to the old table. Write the rollback in one transaction: copy the lines that exist only in the view into the archive, move the view back to shop under its old name, rename the archive back to legacy_sales, and recreate the sync trigger. Then check the old table has line 16 and the number of lines.',
    hint: 'INSERT INTO legacy_sales_archive SELECT * FROM legacy_sales v WHERE NOT EXISTS (…); then the renames in reverse order.',
    setup: migrated + '\n\n' + syncFn + '\n\n' + compatView + '\n\n' + viewInsertFn,
    steps: [
      cutover,
      newLine,
      "BEGIN;\nSET LOCAL lock_timeout = '2s';\nINSERT INTO legacy_sales_archive\nSELECT * FROM legacy_sales v\nWHERE NOT EXISTS (SELECT 1 FROM legacy_sales_archive a WHERE a.line_no = v.line_no);\nALTER VIEW legacy_sales RENAME TO legacy_sales_v;\nALTER VIEW legacy_sales_v SET SCHEMA shop;\nALTER TABLE legacy_sales_archive RENAME TO legacy_sales;\nCREATE TRIGGER legacy_sync AFTER INSERT OR UPDATE ON legacy_sales\n  FOR EACH ROW EXECUTE FUNCTION sync_legacy();\nCOMMIT;",
      "SELECT line_no, order_ref, cust_name, order_date, amount FROM legacy_sales WHERE line_no = 16;",
      "SELECT (SELECT count(*) FROM legacy_sales) AS legacy_lines,\n       (SELECT count(*) FROM shop.order_lines) AS shop_lines,\n       (SELECT count(*) FROM shop.migration_errors) AS quarantined;"
    ],
    why: 'Line 16 is back in the old table in the old format (copied from the view), with 13 lines in total; shop still has 9 lines and 4 are quarantined, so 9 + 4 = 13 and the two sides still agree. The INSERT copies one row because it is the only line the archive lacks. Rehearse this on a copy of production before the real switch: a way back you have never run is not a way back. This completes the migration: profile, clean, quarantine, reconcile, dual write, compatibility view, switch, lock down, and a tested rollback.',
    expectOut: 'INSERT 0 1\\nALTER VIEW\\nALTER VIEW\\nALTER TABLE\\nCREATE TRIGGER\\nCOMMIT[\\s\\S]*16 \\| ORD-1012\\s+\\| Tara Sen\\s+\\| 10/02/2026 \\| 2,499\\.00[\\s\\S]*legacy_lines \\| shop_lines \\| quarantined\\n-+\\+-+\\+-+\\n\\s+13 \\|\\s+9 \\|\\s+4\\n'
  }
};
