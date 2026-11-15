const enqueue = "CREATE PROCEDURE enqueue_job(p_kind text, p_payload jsonb DEFAULT '{}')\nLANGUAGE plpgsql AS $$\nBEGIN\n  INSERT INTO jobs (job_id, kind, payload, run_after)\n  SELECT max(job_id) + 1, p_kind, p_payload, now() FROM jobs;\nEND;\n$$;";
const archiveTable = 'CREATE TABLE big_orders_archive (LIKE big_orders);';
const archiveProc = `CREATE PROCEDURE archive_cancelled(p_before timestamptz, p_batch int DEFAULT 1000)
LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
  total bigint := 0;
BEGIN
  LOOP
    WITH moved AS (
      DELETE FROM big_orders
      WHERE order_id IN (SELECT order_id FROM big_orders
                         WHERE status = 'cancelled' AND created_at < p_before
                         ORDER BY order_id LIMIT p_batch)
      RETURNING *
    )
    INSERT INTO big_orders_archive SELECT * FROM moved;
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0;
    total := total + n;
    COMMIT;                                   -- this batch is saved, its locks are released
    RAISE NOTICE 'batch of %, % archived so far', n, total;
  END LOOP;
END;
$$;`;

export default {
  n: 68,
  phase: 'p7',
  big: true,
  title: 'Procedures',
  goal: 'Write procedures that commit as they go, run large batch jobs in small transactions, and know exactly where transaction control is and is not allowed.',
  minutes: 150,
  lesson: [
    { h: 'Function or procedure?' },
    { pre: "                     FUNCTION                       PROCEDURE\ncalled with          SELECT f(…), inside any query  CALL p(…), on its own\nreturns              a value, a row or a set        nothing (or INOUT / OUT parameters)\nCOMMIT / ROLLBACK    never                          yes, when called outside BEGIN … COMMIT\nuse for              calculations, lookups, rules   batch jobs, maintenance, multi-step work", lang: 'text' },
    { p: 'A function always runs inside the caller\'s transaction: everything it does commits or rolls back together. A procedure can end the transaction it runs in and start a new one: <code>COMMIT</code> inside the body saves the work so far, and the next statement automatically runs in a fresh transaction.' },
    { steps: [enqueue, "CALL enqueue_job('send_email', '{\"to\": \"tara@mail.test\", \"template\": \"welcome\"}');", 'SELECT job_id, kind, status FROM jobs WHERE job_id = 11;'], expectOut: '11 \\| send_email \\| queued' },
    { h: 'Big jobs in small transactions' },
    { p: 'Moving 100,000 old rows in one DELETE holds row locks on all of them for the whole run, blocks VACUUM from cleaning up, builds a huge amount of WAL at once, and if it fails after 40 minutes, all of it rolls back. In batches, each transaction is short and each finished batch stays done:' },
    { pre: "LOOP\n  move up to 1,000 rows\n  EXIT WHEN nothing was moved\n  COMMIT;              -- saved; locks released; other sessions carry on\nEND LOOP;", lang: 'text' },
    { h: 'Where COMMIT is not allowed' },
    { list: [
      'When the CALL is inside an explicit transaction (<code>BEGIN; CALL p(); …</code>): the procedure cannot commit the caller\'s transaction. Error: <code>invalid transaction termination</code>.',
      'Inside a BEGIN … EXCEPTION block (it is a subtransaction). Put the EXCEPTION block <i>inside</i> the loop and the COMMIT outside it (Q8).',
      'In a procedure with a <code>SET</code> clause or SECURITY DEFINER, and when the procedure is called from a function (SELECT f() → CALL p()).',
      'Drivers often wrap everything in a transaction by default; run a committing procedure with autocommit on.'
    ] },
    { trap: 'A procedure that commits is no longer all-or-nothing. If it fails in batch 7, batches 1–6 are saved. That is the point, but the job must be safe to run again (it picks up what is left), and nothing else may depend on "all or none" happening.' }
  ],
  questions: [
    { pts: 1, q: 'Try to call enqueue_job like a function: <code>SELECT enqueue_job(\'send_email\');</code>', hint: 'Read the HINT.', steps: [enqueue, "SELECT enqueue_job('send_email');"], why: '"enqueue_job(unknown) is a procedure", with HINT "To call a procedure, use CALL." A procedure cannot be used inside a query. And CALL cannot be used for a function either. (max(job_id) + 1 is fine for practice but races when two sessions enqueue at once; a real table uses an identity column.)', expectOut: 'is a procedure[\\s\\S]*HINT:  To call a procedure, use CALL\\.' },
    { pts: 1, q: 'Return a value from a procedure: write count_queued(INOUT n bigint DEFAULT NULL) that sets n to the number of queued jobs, and CALL it.', hint: 'CALL returns one row with the INOUT/OUT parameters.', steps: ["CREATE PROCEDURE count_queued(INOUT n bigint DEFAULT NULL)\nLANGUAGE plpgsql AS $$\nBEGIN\n  SELECT count(*) INTO n FROM jobs WHERE status = 'queued';\nEND;\n$$;", 'CALL count_queued();'], why: '6 (jobs 4, 5, 6, 7, 8, 10). CALL shows the INOUT and OUT parameters as one row. Inside another procedure: <code>CALL count_queued(v)</code> puts the result in the variable v. If you need the value in a query, it should be a function.', expectOut: '\\bn\\n-+\\n\\s+6\\n' },
    { pts: 1, q: 'Create big_orders_archive and the batch procedure archive_cancelled() from the lesson, then archive cancelled orders created before 2025.', hint: "CALL archive_cancelled('2025-01-01');", steps: [archiveTable, archiveProc, "CALL archive_cancelled('2025-01-01');", "SELECT (SELECT count(*) FROM big_orders_archive) AS archived,\n       (SELECT count(*) FROM big_orders WHERE status = 'cancelled') AS still_cancelled;"], why: 'Three batches of 1,000 and one of 162: 3,162 archived, 2,748 cancelled orders from 2025 remain. Each NOTICE comes after a COMMIT, so if you had stopped the procedure after the second notice, 2,000 rows would already be archived for good.', expectOut: 'batch of 1000, 1000[\\s\\S]*batch of 162, 3162[\\s\\S]*3162 \\|\\s+2748' },
    { pts: 1, q: 'Now call the procedure inside an explicit transaction: BEGIN; CALL archive_cancelled(\'2025-06-01\'); and see what happens.', hint: 'The procedure cannot commit a transaction that it did not start.', steps: [archiveTable, archiveProc, 'BEGIN;', "CALL archive_cancelled('2025-06-01');", 'ROLLBACK;'], why: '"invalid transaction termination", raised at the COMMIT line, and the whole transaction is aborted (practice=!#). The caller who wrote BEGIN owns the transaction. In application code, check that the connection is in autocommit mode before calling a committing procedure.', expectOut: 'ERROR:  invalid transaction termination' },
    { pts: 1, q: 'All-or-nothing vs commit-as-you-go: book three tables in a DO block where the third booking is a duplicate (table 1 at 19:00). Do it once without COMMIT and once with COMMIT after each insert. Count the bookings after each.', hint: 'A DO block run on its own can COMMIT, like a procedure.', steps: [
      "DO $$\nBEGIN\n  INSERT INTO table_bookings VALUES (6, 4, '2026-02-20 19:00+05:30', 'Vivaan', 2);\n  INSERT INTO table_bookings VALUES (7, 5, '2026-02-20 19:00+05:30', 'Tara', 4);\n  INSERT INTO table_bookings VALUES (8, 1, '2026-02-20 19:00+05:30', 'Neel', 2);\nEND;\n$$;",
      'SELECT count(*) FROM table_bookings;',
      "DO $$\nBEGIN\n  INSERT INTO table_bookings VALUES (6, 4, '2026-02-20 19:00+05:30', 'Vivaan', 2);\n  COMMIT;\n  INSERT INTO table_bookings VALUES (7, 5, '2026-02-20 19:00+05:30', 'Tara', 4);\n  COMMIT;\n  INSERT INTO table_bookings VALUES (8, 1, '2026-02-20 19:00+05:30', 'Neel', 2);\nEND;\n$$;",
      'SELECT count(*) FROM table_bookings;'
    ], why: 'First 5 (the error undid all three inserts), then 7 (the first two were committed before the error). Both behaviours are useful; choose deliberately. For a group booking that must be all or nothing, never commit in the middle.', expectOut: 'count\\n-+\\n\\s+5\\n[\\s\\S]*count\\n-+\\n\\s+7\\n' },
    { pts: 1, q: 'Put a COMMIT inside a block that has an EXCEPTION section and call it.', hint: 'The block is a subtransaction.', steps: ["DO $$\nBEGIN\n  UPDATE jobs SET status = 'done' WHERE job_id = 4;\n  COMMIT;\nEXCEPTION WHEN OTHERS THEN\n  RAISE NOTICE 'failed: %', SQLERRM;\nEND;\n$$;", 'SELECT status FROM jobs WHERE job_id = 4;'], why: 'The handler catches "cannot commit while a subtransaction is active", and job 4 is still queued. You cannot end the outer transaction from inside a savepoint. Q8 shows the right structure.', expectOut: 'cannot commit while a subtransaction is active[\\s\\S]*queued' },
    { pts: 1, q: 'A procedure with a SET clause: create the batch procedure with <code>SET work_mem = \'64MB\'</code> added after LANGUAGE plpgsql and call it.', hint: 'Settings attached to a procedure are restored when it returns, which cannot cross a COMMIT.', steps: [archiveTable, archiveProc.replace('LANGUAGE plpgsql AS', "LANGUAGE plpgsql SET work_mem = '64MB' AS"), "CALL archive_cancelled('2025-01-01');"], why: '"invalid transaction termination" again. To change a setting for a committing procedure, use SET LOCAL inside each transaction, or SET for the session before the CALL. The same rule applies to SECURITY DEFINER (Session 72).', expectOut: 'ERROR:  invalid transaction termination' },
    { pts: 2, q: 'Process each due job in its own transaction: write process_due_jobs() that loops over queued jobs with run_after &lt;= now(), marks each one done, but treats resize_image as a failure (raise inside an inner BEGIN … EXCEPTION block; in the handler add 1 to attempts and fail the job at 3 attempts). COMMIT after each job. Show all jobs that were due.', hint: 'Inside the loop: BEGIN … EXCEPTION … END; then COMMIT outside that inner block.', steps: [
      "CREATE PROCEDURE process_due_jobs()\nLANGUAGE plpgsql AS $$\nDECLARE\n  j record;\nBEGIN\n  FOR j IN SELECT job_id, kind FROM jobs WHERE status = 'queued' AND run_after <= now() ORDER BY job_id LOOP\n    BEGIN\n      IF j.kind = 'resize_image' THEN\n        RAISE EXCEPTION 'image service down';\n      END IF;\n      UPDATE jobs SET status = 'done', attempts = attempts + 1 WHERE job_id = j.job_id;\n    EXCEPTION WHEN OTHERS THEN\n      UPDATE jobs SET attempts = attempts + 1,\n                      status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'queued' END\n      WHERE job_id = j.job_id;\n      RAISE NOTICE 'job % failed: %', j.job_id, SQLERRM;\n    END;\n    COMMIT;\n  END LOOP;\nEND;\n$$;",
      'CALL process_due_jobs();',
      "SELECT job_id, kind, status, attempts FROM jobs WHERE job_id IN (4, 5, 6, 7, 10) ORDER BY job_id;"
    ], why: 'Jobs 4, 5, 6 and 10 are done; job 7 failed once more (attempts 2) and stays queued for a retry. One bad job does not undo the others, and each committed job is safe even if the procedure is killed. The exception block is per job (a savepoint), the COMMIT is outside it: the pattern from the lesson.', expectOut: 'job 7 failed: image service down[\\s\\S]*7 \\| resize_image\\s+\\| queued \\|\\s+2[\\s\\S]*10 \\| send_email\\s+\\| done\\s+\\|\\s+1' },
    { pts: 2, q: 'Prove that COMMIT starts a new transaction: in a DO block, save now() in v1, sleep 0.05 s, save now() in v2, COMMIT, save now() in v3. Print whether v1 = v2 and whether v1 = v3.', hint: 'now() is the start time of the current transaction.', steps: ["DO $$\nDECLARE\n  v1 timestamptz; v2 timestamptz; v3 timestamptz;\nBEGIN\n  v1 := now();\n  PERFORM pg_sleep(0.05);\n  v2 := now();\n  COMMIT;\n  v3 := now();\n  RAISE NOTICE 'same transaction: %, after commit: %', v1 = v2, v1 = v3;\nEND;\n$$;"], why: 'true, then false. Within a transaction now() never moves; after COMMIT the procedure is in a new transaction with a new start time. A long batch procedure that stamps rows with now() therefore gets a different time per batch. Use clock_timestamp() for the real time, or pass one fixed timestamp as a parameter.', expectOut: 'same transaction: t, after commit: f' },
    { pts: 2, q: 'A procedure that calls a procedure: write archive_all() that calls archive_cancelled() for 2024 and then again for orders before 2025-07-01, and reports the archive count with RAISE NOTICE. Do the inner COMMITs still work?', hint: 'A CALL chain started at top level keeps transaction control; a SELECT in the chain breaks it.', steps: [archiveTable, archiveProc, "CREATE PROCEDURE archive_all()\nLANGUAGE plpgsql AS $$\nBEGIN\n  CALL archive_cancelled('2025-01-01', 2000);\n  CALL archive_cancelled('2025-07-01', 2000);\n  RAISE NOTICE 'archive now holds % rows', (SELECT count(*) FROM big_orders_archive);\nEND;\n$$;", 'CALL archive_all();'], why: 'Yes: batches of 2,000 and 1,162, then one batch of 1,563 for the first half of 2025: 4,725 rows in the archive. As long as every step from the top is CALL or DO, the innermost procedure may commit. If anything in between is a function call, the COMMIT fails with "invalid transaction termination".', expectOut: 'batch of 2000, 2000[\\s\\S]*batch of 1162, 3162[\\s\\S]*batch of 1563, 1563[\\s\\S]*archive now holds 4725 rows' },
    { pts: 2, q: 'Run it again: CALL archive_cancelled(\'2025-01-01\') a second time after the first run. What happens, and why does that matter?', hint: 'The procedure only looks for rows that are still in big_orders.', steps: [archiveTable, archiveProc, "CALL archive_cancelled('2025-01-01');", "CALL archive_cancelled('2025-01-01');", 'SELECT count(*) AS archived, count(DISTINCT order_id) AS distinct_ids FROM big_orders_archive;'], why: 'The second call finds nothing, prints no notice and does nothing: 3,162 rows, no duplicates. Because each batch moves rows in one statement (DELETE … RETURNING into INSERT), a row is either still in big_orders or already in the archive, never both and never neither. That makes the job safe to restart after a crash: just run it again.', expectOut: 'archived \\| distinct_ids\\n-+\\+-+\\n\\s+3162 \\|\\s+3162' }
  ],
  hard: {
    q: 'A resumable job with a progress table: create archive_progress (job text PRIMARY KEY, last_id int, rows_moved bigint) and archive_resumable(p_max_batches int) that walks big_orders by order_id (keyset, batches of 1,000 ids), archives cancelled orders before 2025 in each id range, and saves its position with each COMMIT. Call it with 50 batches (as if it were stopped), look at the progress, then call it again with 1000 batches to finish.',
    hint: 'Read last_id at the start; each batch: move rows with order_id > last_id AND order_id <= last_id + 1000; UPDATE archive_progress; COMMIT. Stop when last_id passes max(order_id).',
    steps: [
      archiveTable,
      "CREATE TABLE archive_progress (job text PRIMARY KEY, last_id int NOT NULL, rows_moved bigint NOT NULL);",
      "CREATE PROCEDURE archive_resumable(p_max_batches int)\nLANGUAGE plpgsql AS $$\nDECLARE\n  v_last int;\n  v_max int;\n  n bigint;\nBEGIN\n  INSERT INTO archive_progress VALUES ('cancelled_2024', 0, 0) ON CONFLICT (job) DO NOTHING;\n  SELECT last_id INTO v_last FROM archive_progress WHERE job = 'cancelled_2024';\n  SELECT max(order_id) INTO v_max FROM big_orders;\n  FOR i IN 1..p_max_batches LOOP\n    EXIT WHEN v_last >= v_max;\n    WITH moved AS (\n      DELETE FROM big_orders\n      WHERE order_id > v_last AND order_id <= v_last + 1000\n        AND status = 'cancelled' AND created_at < '2025-01-01'\n      RETURNING *\n    )\n    INSERT INTO big_orders_archive SELECT * FROM moved;\n    GET DIAGNOSTICS n = ROW_COUNT;\n    v_last := v_last + 1000;\n    UPDATE archive_progress SET last_id = v_last, rows_moved = rows_moved + n WHERE job = 'cancelled_2024';\n    COMMIT;\n  END LOOP;\nEND;\n$$;",
      'CALL archive_resumable(50);',
      'SELECT * FROM archive_progress;',
      'CALL archive_resumable(1000);',
      "SELECT p.last_id, p.rows_moved, (SELECT count(*) FROM big_orders_archive) AS archived FROM archive_progress p;"
    ],
    why: 'After 50 batches: last_id 50,000 with 1,500 rows moved. The second call starts at 50,001 (not at 1) and finishes: 3,162 rows. The position and the moved rows are committed together, so they can never disagree. Keyset batches by primary key use the index and never rescan rows that were already checked, unlike the "LIMIT 1000 of what is left" loop, which scans from the start each time.',
    expectOut: 'cancelled_2024 \\|\\s+50000 \\|\\s+1500[\\s\\S]*last_id \\| rows_moved \\| archived\\n-+\\+-+\\+-+\\n\\s+\\d+ \\|\\s+3162 \\|\\s+3162'
  }
};
