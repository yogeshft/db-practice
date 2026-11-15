// Check one session on the private Postgres 18 server and print what each item returns.
//   node check.mjs 55            every item: counts ✓/✗, plans, transcripts, first 3 rows
//   node check.mjs 55 8          more rows per item
//   node check.mjs 55 3 Q4,HARD  only these items (L1.. lesson blocks by position, Q1.., HARD)
import { ensureTemplates, sessionDb, dropDb, runItem, transcript, closeAll } from './pg.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const n = process.argv[2], show = +(process.argv[3] || 3), onlyItems = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
const s = (await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', `s${n.padStart(2, '0')}.mjs`)).href + '?t=' + Date.now())).default;
await ensureTemplates();
const big = !!s.big, dbName = 'c_s' + s.n;
const db = await sessionDb(dbName, big);
const items = [];
let li = 0;
for (const b of s.lesson) { if (b.steps || b.two || (b.sql && b.run)) items.push([`L${++li}`, b]); }
s.questions.forEach((q, i) => items.push([`Q${i + 1}`, q]));
if (s.hard) items.push(['HARD', s.hard]);
let bad = 0;
for (const [label, it] of items) {
  if (onlyItems && !onlyItems.has(label)) continue;
  if (it.verify === false || it.own) { console.log(`${label}: (own / not verified)`); continue; }
  try {
    if (it.steps || it.two) {
      const text = await transcript(`${dbName}_${label.toLowerCase()}`, big, it.two || it.steps.map((x) => ['A', x]), { setup: it.setup, mask: it.mask });
      const ok = it.expectOut ? (new RegExp(it.expectOut).test(text) ? ' ✓' : ` ✗ /${it.expectOut}/`) : ' (no expectOut)';
      if (ok.includes('✗')) bad++;
      console.log(`${label}: transcript${ok}`);
      console.log(text.split('\n').map((l) => '    ' + l).join('\n'));
      continue;
    }
    const out = await runItem(db, it.sql, 1e9);
    const text = out.rows.map((r) => r.map((v) => (v === null ? '∅' : v)).join(' | '));
    let flag = '';
    if (it.expectRows != null) flag += out.rowCount === it.expectRows ? ' ✓' : ` ✗ expected ${it.expectRows}`;
    if (it.expectPlan) flag += new RegExp(it.expectPlan).test(out.rows.map((r) => r[0]).join('\n')) ? ' plan ✓' : ` plan ✗ /${it.expectPlan}/`;
    if (flag.includes('✗')) bad++;
    console.log(`${label}: ${out.rowCount} rows${flag}`);
    for (const l of (out.plan ? text : text.slice(0, show))) console.log('    ' + l.slice(0, 260));
  } catch (e) { bad++; console.log(`${label}: ERROR ${e.message}`); }
}
await db.close();
await dropDb(dbName);
await closeAll();
console.log(bad ? `\n${bad} problem(s)` : '\nall good');
