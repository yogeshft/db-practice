// node q.mjs "<sql>" [big]  — run one item (BEGIN … ROLLBACK) on a fresh practice database and print the last result
import { ensureTemplates, sessionDb, dropDb, runItem, closeAll } from './pg.mjs';
await ensureTemplates();
const db = await sessionDb('q_adhoc', process.argv[3] === 'big');
try { const r = await runItem(db, process.argv[2], 1e9); console.log(r.cols.join(' | ')); for (const x of r.rows) console.log(x.map((v) => v ?? '∅').join(' | ')); }
catch (e) { console.log('ERROR', e.message); }
await db.close(); await dropDb('q_adhoc'); await closeAll();
