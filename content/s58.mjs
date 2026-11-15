const claim = (w) => `UPDATE jobs\nSET status = 'running', locked_by = '${w}', locked_at = now(), attempts = attempts + 1\nWHERE job_id = (\n  SELECT job_id FROM jobs\n  WHERE status = 'queued' AND run_after <= now()\n  ORDER BY run_after, job_id\n  FOR UPDATE SKIP LOCKED\n  LIMIT 1\n)\nRETURNING job_id, kind;`;
const activity = "SELECT application_name AS who, wait_event_type, cardinality(pg_blocking_pids(pid)) AS blocked_by, left(query, 45) AS query\nFROM pg_stat_activity\nWHERE datname = current_database() AND pid <> pg_backend_pid()\nORDER BY application_name;";

export default {
  n: 58,
  phase: 'p6',
  title: 'Row locks and job queues',
  goal: 'Lock exactly the rows you need with FOR UPDATE and its variants, build a job queue that many workers can share, and find, avoid and survive lock waits and deadlocks.',
  minutes: 150,
  lesson: [
    { h: 'Row locks' },
    { p: 'Every UPDATE and DELETE locks the rows it changes until the transaction ends; a second writer of the same row waits (Session 57). A SELECT can take the same locks <b>before</b> changing anything, to reserve rows for a decision:' },
    { pre: 'Lock                       taken by                                  blocks\n-------------------------  ----------------------------------------  -------------------------------------------\nFOR UPDATE                 DELETE, UPDATE of a key column, SELECT …  every other lock below\nFOR NO KEY UPDATE          UPDATE of non-key columns                 FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE\nFOR SHARE                  SELECT … FOR SHARE                        FOR UPDATE, FOR NO KEY UPDATE\nFOR KEY SHARE              foreign-key checks (inserting a child)    FOR UPDATE only\n\nPlain SELECT takes no row lock and is never blocked by row locks (MVCC).', lang: 'text' },
    { two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT job_id, status FROM jobs WHERE job_id = 4 FOR UPDATE;'],
      ['B', 'SELECT job_id, status FROM jobs WHERE job_id = 4;'],
      ['B', 'SELECT job_id, status FROM jobs WHERE job_id = 4 FOR UPDATE;'],
      ['A', "UPDATE jobs SET status = 'running' WHERE job_id = 4;"],
      ['A', 'COMMIT;']
    ], expectOut: 'blocked[\\s\\S]*finishes[\\s\\S]*running' },
    { p: 'B\'s plain SELECT ran at once; its FOR UPDATE waited, and when A committed it returned the <b>new</b> row (running). Three ways not to wait: <code>NOWAIT</code> (error immediately), <code>SKIP LOCKED</code> (pretend the locked rows are not there), <code>SET lock_timeout = \'2s\'</code> (error after waiting that long).' },
    { h: 'A job queue with SKIP LOCKED' },
    { p: 'The <code>jobs</code> table is a work queue. Each worker repeatedly claims the oldest due job that nobody else is working on. <code>FOR UPDATE SKIP LOCKED</code> makes concurrent workers take <b>different</b> jobs instead of queueing behind each other:' },
    { two: [
      ['A', 'BEGIN;'], ['A', claim('worker-A')],
      ['B', 'BEGIN;'], ['B', claim('worker-B')],
      ['A', 'COMMIT;'], ['B', 'COMMIT;'],
      ['A', "SELECT job_id, status, locked_by, attempts FROM jobs WHERE status = 'running' ORDER BY job_id;"]
    ], expectOut: 'job_id \\| +kind[\\s\\S]*\\b4 \\| send_email[\\s\\S]*\\b5 \\| export_report' },
    { list: [
      'The subquery finds and locks one row, skipping rows locked by other workers; the UPDATE marks it as taken; RETURNING hands it to the worker. One statement, no race.',
      'Here each worker commits the claim right away (status = running is the "lease"), does the work outside the transaction, then sets status = done. If it dies, the job stays "running": a reaper requeues jobs whose <code>locked_at</code> is too old (Q8).',
      'The alternative is to keep the transaction open while working: if the worker dies, its connection drops and the lock disappears, so no reaper is needed. But long transactions hurt VACUUM and hold connections; prefer the lease for jobs that take more than a second or two.',
      'Index the queue for the claim query: <code>CREATE INDEX ON jobs (run_after, job_id) WHERE status = \'queued\'</code> (a partial index, Session 47).'
    ] },
    { h: 'Deadlocks' },
    { p: 'A deadlock is two transactions each waiting for a lock the other holds. Postgres checks for one after <code>deadlock_timeout</code> (1 second) and cancels one of the two with SQLSTATE <b>40P01</b>; the other continues:' },
    { two: [
      ['A', 'BEGIN;'], ['B', 'BEGIN;'],
      ['A', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;'],
      ['B', 'UPDATE accounts SET balance = balance - 100 WHERE account_id = 2;'],
      ['A', 'UPDATE accounts SET balance = balance + 100 WHERE account_id = 2;'],
      ['B', 'UPDATE accounts SET balance = balance + 100 WHERE account_id = 1;'],
      ['A', 'COMMIT;'], ['B', 'COMMIT;']
    ], expectOut: 'deadlock detected' },
    { list: [
      'Avoid them by taking locks in one global order: lock both accounts with <code>… ORDER BY account_id FOR UPDATE</code> first (Session 57 Q13), or always update the lower id first.',
      'Keep transactions short so locks are held briefly.',
      'Survive the rest: deadlocks can still happen (for example through foreign keys and triggers), so the retry loop from Session 57 handles 40P01 like 40001.'
    ] },
    { h: 'Who is blocking whom' },
    { p: '<code>pg_stat_activity</code> shows every session and what it waits for; <code>pg_blocking_pids(pid)</code> returns the sessions blocking it. In production, the blocker is often an idle transaction that someone forgot to commit (<code>state = \'idle in transaction\'</code>). <code>pg_cancel_backend(pid)</code> cancels its current query; <code>pg_terminate_backend(pid)</code> ends the session and rolls back its transaction.' },
    { two: [
      ['A', 'BEGIN;'],
      ['A', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 4;'],
      ['B', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 4;'],
      ['C', activity],
      ['A', 'ROLLBACK;']
    ], expectOut: 'terminal A[\\s\\S]*terminal B \\| Lock\\s+\\|\\s+1' },
    { tip: 'Foreign keys lock too. Inserting an order for customer 3 takes FOR KEY SHARE on customer 3, so deleting customer 3 (or changing its key) waits for that transaction, while updating the customer\'s name does not (Q10, Q11).' }
  ],
  questions: [
    { pts: 1, q: 'A locks job 4 with FOR UPDATE. B tries to lock it with <code>NOWAIT</code>. What happens to B?', hint: 'SELECT … FOR UPDATE NOWAIT', two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT job_id FROM jobs WHERE job_id = 4 FOR UPDATE;'],
      ['B', 'SELECT job_id FROM jobs WHERE job_id = 4 FOR UPDATE NOWAIT;'],
      ['A', 'COMMIT;']
    ], why: '"could not obtain lock on row in relation jobs" immediately (SQLSTATE 55P03). Use NOWAIT when waiting makes no sense, for example a user clicking "edit" on a record someone else is editing: tell them now.', expectOut: 'could not obtain lock on row in relation "jobs"' },
    { pts: 1, q: 'Same situation, but B uses <code>SKIP LOCKED</code> to read the first 3 queued jobs (by job_id) it can lock.', hint: "WHERE status = 'queued' ORDER BY job_id FOR UPDATE SKIP LOCKED LIMIT 3", two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT job_id FROM jobs WHERE job_id = 4 FOR UPDATE;'],
      ['B', "SELECT job_id FROM jobs WHERE status = 'queued' ORDER BY job_id FOR UPDATE SKIP LOCKED LIMIT 3;"],
      ['A', 'COMMIT;']
    ], why: '5, 6, 7: job 4 is silently skipped. SKIP LOCKED gives an inconsistent view on purpose, which is exactly right for queues and wrong for almost everything else (never use it in reports).', expectOut: '\\b5\\n\\s+6\\n\\s+7' },
    { pts: 1, q: 'B waits at most 1 second for a lock: A locks Diya\'s account; B sets <code>lock_timeout</code> and tries to update it.', hint: "SET lock_timeout = '1s'; in B", two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT * FROM accounts WHERE account_id = 2 FOR UPDATE;'],
      ['B', "SET lock_timeout = '1s';"],
      ['B', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 2;'],
      ['wait', 'B'],
      ['A', 'COMMIT;']
    ], why: '"canceling statement due to lock timeout" (55P03) after a second. lock_timeout bounds lock waits only; statement_timeout (Session 53) bounds the whole statement. Migrations use lock_timeout so that a waiting ALTER TABLE cannot freeze the application (Session 61).', expectOut: 'canceling statement due to lock timeout' },
    { pts: 1, q: 'Which jobs can a worker claim right now? List the queued jobs that are due (run_after ≤ now()), oldest first.', hint: "WHERE status = 'queued' AND run_after <= now()", sql: "SELECT job_id, kind, run_after\nFROM jobs\nWHERE status = 'queued' AND run_after <= now()\nORDER BY run_after, job_id;", why: '5 jobs (4, 5, 6, 7, 10). Job 8 is queued but scheduled for 2099, so it is not due; job 9 is stuck in running.', expectRows: 5 },
    { pts: 1, q: 'One worker claims a job (the lesson\'s UPDATE … WHERE job_id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING …), as worker-1.', hint: 'Copy the claim statement from the lesson.', sql: claim('worker-1'), why: 'Job 4, the oldest due job. attempts goes from 0 to 1, so a job that keeps failing can be given up after N attempts.', expectRows: 1 },
    { pts: 1, q: 'The worker finished job 4 successfully. Mark it done, but only if it is still this worker\'s job (it may have been requeued by the reaper and taken by someone else meanwhile). Return the row count via RETURNING.', hint: "UPDATE … SET status = 'done' WHERE job_id = 4 AND locked_by = 'worker-1' RETURNING job_id", sql: "WITH claimed AS (\n  UPDATE jobs SET status = 'running', locked_by = 'worker-1', locked_at = now()\n  WHERE job_id = 4 RETURNING job_id\n)\nSELECT 1 FROM claimed;  -- setup: worker-1 holds job 4\n\nUPDATE jobs SET status = 'done', locked_by = NULL, locked_at = NULL\nWHERE job_id = 4 AND locked_by = 'worker-1' AND status = 'running'\nRETURNING job_id, status;", why: 'One row: the worker still owned the job. If the reaper had handed it to worker-2, the WHERE would match nothing and worker-1 would know its result is stale. Checking ownership in the WHERE clause is a "fencing" condition, cheap insurance for leases.', expectRows: 1 },
    { pts: 1, q: 'Give up on jobs that failed 3 or more times: list the jobs with attempts ≥ 3 and their status.', hint: 'WHERE attempts >= 3', sql: 'SELECT job_id, kind, status, attempts FROM jobs WHERE attempts >= 3;', why: 'Job 3, already failed. A real worker sets status = \'failed\' instead of requeueing when attempts reaches the limit, so a "poison" job cannot block the queue forever.', expectRows: 1 },
    { pts: 1, q: 'The reaper: requeue every job that has been "running" for more than 15 minutes (its worker probably died). Return job_id and locked_by.', hint: "WHERE status = 'running' AND locked_at < now() - interval '15 minutes'", sql: "UPDATE jobs\nSET status = 'queued', locked_by = NULL, locked_at = NULL\nWHERE status = 'running' AND locked_at < now() - INTERVAL '15 minutes'\nRETURNING job_id, kind;", why: 'Job 9 (worker-2 took it at 07:00 on 15 Feb and never finished). It goes back to the queue; attempts stays at 1 and grows when it is claimed again. Run the reaper every minute from a scheduler (pg_cron, Phase 7, or the application).', expectRows: 1 },
    { pts: 2, q: 'Three workers at once: A, B and C each claim a job inside open transactions. Which jobs do they get?', hint: 'The same claim statement in all three terminals before anyone commits.', two: [
      ['A', 'BEGIN;'], ['A', claim('worker-A')],
      ['B', 'BEGIN;'], ['B', claim('worker-B')],
      ['C', 'BEGIN;'], ['C', claim('worker-C')],
      ['A', 'COMMIT;'], ['B', 'COMMIT;'], ['C', 'COMMIT;']
    ], why: 'Jobs 4, 5 and 6, one each, and nobody waited. Without SKIP LOCKED, B and C would queue behind A\'s lock on job 4, and after A committed they would find job 4 no longer queued and get UPDATE 0: workers stepping on each other.', expectOut: '\\b4 \\| send_email[\\s\\S]*\\b5 \\| export_report[\\s\\S]*\\b6 \\| send_email' },
    { pts: 2, q: 'A creates an order for customer 3 and keeps its transaction open. Meanwhile B (a) changes customer 3\'s city, then (b) tries to delete customer 3. Which one waits?', hint: 'The foreign key check takes FOR KEY SHARE on customer 3.', two: [
      ['A', 'BEGIN;'],
      ['A', "INSERT INTO orders VALUES (37, 3, '2026-02-15', 'pending', 'Delhi');"],
      ['B', "UPDATE customers SET city = 'Noida' WHERE customer_id = 3;"],
      ['B', 'DELETE FROM customers WHERE customer_id = 3;'],
      ['A', 'COMMIT;']
    ], why: 'The city update runs at once: it needs FOR NO KEY UPDATE, which is compatible with A\'s FOR KEY SHARE. The DELETE needs FOR UPDATE, so it waits until A commits, and then fails: customer 3 is still referenced (by customer 10\'s referred_by, and by orders). It could never have succeeded, but it had to wait to find out. Lock levels exist so that foreign keys block as little as possible.', expectOut: 'UPDATE 1[\\s\\S]*blocked[\\s\\S]*violates foreign key constraint' },
    { pts: 2, q: 'The FK lock in the other direction: A updates customer 3\'s <b>key</b> column is not allowed here, so instead A locks customer 3 with <code>FOR UPDATE</code> (as a careful delete would). Can B insert an order for customer 3?', hint: 'FOR UPDATE conflicts with FOR KEY SHARE.', two: [
      ['A', 'BEGIN;'],
      ['A', 'SELECT customer_id FROM customers WHERE customer_id = 3 FOR UPDATE;'],
      ['B', "INSERT INTO orders VALUES (37, 3, '2026-02-15', 'pending', 'Delhi');"],
      ['A', 'COMMIT;']
    ], why: 'B waits: its foreign-key check needs FOR KEY SHARE on customer 3, which FOR UPDATE blocks. When A commits, B\'s insert goes through. If A only needed to stop changes to the customer\'s other columns, <code>FOR NO KEY UPDATE</code> would have let B insert immediately: use the weakest lock that does the job.', expectOut: 'blocked[\\s\\S]*finishes[\\s\\S]*INSERT 0 1' },
    { pts: 2, q: 'Find the blocker: A updates Ananya\'s account and goes idle without committing; B tries to update the same row and waits. From a third terminal C, list each session\'s application_name, state, wait_event_type and how many sessions block it. (Set application_name in A and B first so you can tell them apart.)', hint: "SET application_name = 'A'; pg_stat_activity, pg_blocking_pids(pid)", two: [
      ['A', "SET application_name = 'app-A';"],
      ['A', 'BEGIN;'],
      ['A', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 4;'],
      ['B', "SET application_name = 'app-B';"],
      ['B', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 4;'],
      ['C', "SELECT application_name, state, wait_event_type, cardinality(pg_blocking_pids(pid)) AS blocked_by\nFROM pg_stat_activity\nWHERE application_name IN ('app-A', 'app-B')\nORDER BY application_name;"],
      ['A', 'ROLLBACK;']
    ], why: 'app-A: <b>idle in transaction</b>, waiting for nothing (it is waiting for a human or a buggy app). app-B: active, wait_event_type Lock, blocked by 1 session. In production you would look up app-A\'s pid and, if it is stuck, <code>SELECT pg_terminate_backend(pid)</code>. Setting <code>idle_in_transaction_session_timeout</code> makes Postgres do this automatically.', expectOut: 'app-A\\s+\\| idle in transaction[\\s\\S]*app-B\\s+\\| active\\s+\\| Lock\\s+\\|\\s+1' },
    { pts: 2, q: 'A deadlock involving three sessions: A updates account 1, B account 2, C account 3; then A wants 2, B wants 3, C wants 1. What does Postgres do?', hint: 'Each terminal holds one row and wants the next one.', two: [
      ['A', 'BEGIN;'], ['B', 'BEGIN;'], ['C', 'BEGIN;'],
      ['A', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 1;'],
      ['B', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 2;'],
      ['C', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 3;'],
      ['A', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 2;'],
      ['B', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 3;'],
      ['C', 'UPDATE accounts SET balance = balance + 1 WHERE account_id = 1;'],
      ['C', 'ROLLBACK;'], ['B', 'ROLLBACK;'], ['A', 'ROLLBACK;']
    ], why: 'The detector finds the cycle A → B → C → A and cancels one transaction (here C, the one that closed the cycle). C\'s locks are released at once, so B gets account 3; A still waits for B and continues only when B ends. Deadlocks are not limited to pairs, and the fix is the same: a global lock order (always lower account_id first) would make the cycle impossible.', expectOut: 'deadlock detected' }
  ],
  hard: {
    q: 'Make the queue safe for jobs that must not run twice even if a worker is slow: claim with a lease of 15 minutes, and finish with a fencing check. Write it as a full worker cycle across two terminals: worker A claims a job and stalls; the reaper (terminal R) requeues jobs whose lease expired (simulate by moving A\'s locked_at back 20 minutes); worker B claims the same job; then A wakes up and tries to mark it done. Show that A\'s late completion is rejected and B\'s accepted.',
    hint: "Finish with UPDATE … WHERE job_id = … AND locked_by = 'worker-A' AND status = 'running' RETURNING …; check the row count.",
    two: [
      ['A', claim('worker-A')],
      ['--', 'worker A stalls; pretend 20 minutes pass'],
      ['R', "UPDATE jobs SET locked_at = locked_at - INTERVAL '20 minutes' WHERE job_id = 4;"],
      ['R', "UPDATE jobs SET status = 'queued', locked_by = NULL, locked_at = NULL\nWHERE status = 'running' AND locked_at < now() - INTERVAL '15 minutes'\nRETURNING job_id;"],
      ['B', claim('worker-B')],
      ['B', claim('worker-B')],
      ['A', "UPDATE jobs SET status = 'done' WHERE job_id = 4 AND locked_by = 'worker-A' AND status = 'running' RETURNING job_id;"],
      ['B', "UPDATE jobs SET status = 'done' WHERE job_id = 4 AND locked_by = 'worker-B' AND status = 'running' RETURNING job_id;"],
      ['A', 'SELECT job_id, status, locked_by, attempts FROM jobs WHERE job_id IN (4, 9) ORDER BY job_id;']
    ],
    why: 'The reaper requeues jobs 4 and 9 (job 9 was stuck from the start). B claims job 9 first (it is older), then job 4, now at attempts 2, and A\'s late "done" matches 0 rows because the job is no longer A\'s. A must treat 0 rows as "my lease expired, discard my result". The job may still have <i>run</i> twice (A did the work), so jobs must be idempotent: sending the same email twice is bad, so real email jobs record a "sent" marker or use an idempotency key (Session 59). Leases bound how long a dead worker blocks a job; idempotency makes the inevitable second run harmless.',
    expectOut: '\\(2 rows\\)[\\s\\S]*\\b9 \\| export_report[\\s\\S]*\\b4 \\| send_email[\\s\\S]*\\(0 rows\\)[\\s\\S]*\\(1 row\\)'
  }
};
