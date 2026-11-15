// Builds ONE file, docs/index.html, from the repo's content/sNN.mjs.
// Every example and answer is run on a private, real Postgres 18 server (see pg.mjs):
// the build stops if a query fails, returns a different row count than stated, or a plan/transcript check fails.
//   node build.mjs           check everything and write docs/index.html
//   node build.mjs 55 57     check only these sessions, write nothing
import { ensureTemplates, sessionDb, dropDb, runItem, transcript, closeAll } from './pg.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const contentDir = path.join(repo, 'content');
const docs = path.join(repo, 'docs');
const css = fs.readFileSync(path.join(here, 'style.css'), 'utf8');

function checkPlan(out, re, where) {
  if (!re) return;
  const text = out.rows.map((r) => r[0]).join('\n');
  if (!new RegExp(re).test(text)) throw new Error(`${where}: plan does not match /${re}/\n${text}`);
}
// Items with `steps` (one terminal) or `two` (several terminals) are run statement by statement and shown as a psql transcript.
// Outputs saved from an earlier verified run, used only when Windows Application Control blocks an
// extension library (pg_trgm.dll) on this machine. Keyed by the item label.
const frozen = JSON.parse(fs.readFileSync(path.join(here, 'frozen.json'), 'utf8'));
// Rendered outputs (HTML) from the last build in which btree_gist.dll was still allowed.
const frozenHtml = JSON.parse(fs.readFileSync(path.join(here, 'frozen_html.json'), 'utf8'));
const blocked = (e) => /Application Control policy/.test(e.message);
async function runOrFrozen(db, sql, max, where) {
  try { return await runItem(db, sql, max); } catch (e) {
    if (/Application Control policy/.test(e.message) && frozen[where]) {
      console.warn(`   ${where}: extension blocked by Windows; using the saved Postgres 18 output`);
      return { cols: ['QUERY PLAN'], rowCount: frozen[where].length, rows: frozen[where], plan: true };
    }
    if (blocked(e) && frozenHtml[where]) {
      console.warn(`   ${where}: extension blocked by Windows; using the saved Postgres 18 output`);
      const m = frozenHtml[where].match(/<p class="rows">\((\d+) row/);
      return { html: frozenHtml[where], rowCount: m ? +m[1] : 0, cols: [], rows: [] };
    }
    throw new Error(`${where}: ${e.message}`);
  }
}
const stepsOf = (it) => it.two || (it.steps ? it.steps.map((x) => ['A', x]) : null);
async function runTranscript(it, dbName, big, where) {
  let text;
  try { text = await transcript(dbName, big, stepsOf(it), { setup: it.setup, mask: it.mask }); } catch (e) {
    if (blocked(e) && frozenHtml[where]) {
      console.warn(`   ${where}: extension blocked by Windows; using the saved Postgres 18 output`);
      return { transcript: true, html: frozenHtml[where], cols: [], rows: [], rowCount: 0 };
    }
    throw new Error(`${where}: ${e.message}`);
  }
  if (it.expectOut && !new RegExp(it.expectOut).test(text)) throw new Error(`${where}: transcript does not match /${it.expectOut}/\n${text}`);
  return { transcript: true, text, cols: [], rows: [], rowCount: 0 };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const KW = new Set(('select from where join left right full inner outer cross lateral on using and or not exists in is null group by order having limit offset distinct as case when then else end ' +
  'update set delete insert into values returning begin rollback commit create table temp temporary index unique with explain analyze asc desc between true false filter ' +
  'nulls last first union all intersect except primary key references default drop if cascade check alter add column constraint over partition rows range date interval ' +
  'timestamp numeric integer int text boolean recursive materialized costs timing summary off buffers natural').split(' '));
function highlight(sql) {
  const re = /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g;
  let out = '', m;
  while ((m = re.exec(sql))) {
    if (m[1]) out += `<span class="c">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="s">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="n">${esc(m[3])}</span>`;
    else if (m[4]) out += KW.has(m[4].toLowerCase()) ? `<span class="k">${esc(m[4])}</span>` : esc(m[4]);
    else out += esc(m[5]);
  }
  return out;
}
function output(out) {
  if (!out) return '';
  if (out.html) return out.html;
  if (out.transcript) return `<pre class="term">${esc(out.text)}</pre>`;
  if (out.plan) return `<pre class="out">${esc(out.rows.map((r) => r[0]).join('\n'))}</pre>`;
  if (!out.cols.length) return '';
  const head = out.cols.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = out.rows.map((r) => '<tr>' + r.map((v) => (v === null ? '<td class="null">∅</td>' : `<td>${esc(v)}</td>`)).join('') + '</tr>').join('');
  const more = out.rowCount > out.rows.length ? `, first ${out.rows.length} shown` : '';
  return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div><p class="rows">(${out.rowCount} ${out.rowCount === 1 ? 'row' : 'rows'}${more})</p>`;
}
const code = (sql, lang) => `<pre class="code">${lang && lang !== 'sql' ? esc(sql) : highlight(sql)}</pre>`;
function expected(q) {
  if (q.own) return 'Run this one on your own Postgres: the site cannot check it';
  if (q.verify === false) return 'Runs on your track1 database';
  if (!q.out) return '';
  if (q.out.transcript) return q.two ? 'Two terminals: compare your output with the answer' : 'Compare your output with the answer';
  if (q.out.plan) return 'Compare your plan with the answer';
  return `Expected: ${q.out.rowCount} ${q.out.rowCount === 1 ? 'row' : 'rows'}`;
}

function sessionSection(s, prev, next, phase) {
  let topics = '';
  for (const b of s.lesson) {
    if (b.h) topics += `<h3>${esc(b.h)}</h3>\n`;
    else if (b.p) topics += `<p>${b.p}</p>\n`;
    else if (b.steps || b.two) topics += output(b.out) + '\n';
    else if (b.sql) topics += code(b.sql, b.lang) + output(b.out) + '\n';
    else if (b.pre) topics += `<pre class="plain">${esc(b.pre)}</pre>\n`;
    else if (b.list) topics += '<ul>' + b.list.map((x) => `<li>${x}</li>`).join('') + '</ul>\n';
    else if (b.tip) topics += `<p class="note">${b.tip}</p>\n`;
    else if (b.trap) topics += `<p class="note warn">${b.trap}</p>\n`;
  }
  const answerCode = (q) => (q.showSetup && q.setup ? '<p>Setup, run first:</p>' + code(q.setup) : '') + (q.two ? '' : code(q.sql || q.steps.join('\n')));
  const item = (q, label) => `<li>
<div class="q">${label ? `<b>${label}</b> ` : ''}${q.q}</div>
<p class="exp">${esc(expected(q))}</p>
<details><summary>Answer</summary>${answerCode(q)}${output(q.out)}<p>${q.why}</p></details>
</li>`;
  const questions = s.questions.map((q) => item(q)).join('\n') + (s.hard ? '\n' + item(s.hard, 'Challenge:') : '');
  const pager = `<nav class="pager">${prev ? `<a href="#s${pad(prev.n)}">← Session ${prev.n}</a>` : '<span></span>'}${next ? `<a href="#s${pad(next.n)}">Session ${next.n} →</a>` : ''}</nav>`;
  return `<section class="view" id="s${pad(s.n)}">
<nav class="top"><a href="#p${phase.i}">← Phase ${phase.i}: ${esc(phase.title)}</a><a href="#top">All phases</a><a href="#schema">Schema</a></nav>
<main>
<p class="kicker">Phase ${phase.i} · Session ${s.n}</p>
<h1>${esc(s.title)}</h1>
<p class="lead">${esc(s.goal)}</p>

<h2>Topics</h2>
${topics}
<h2>Questions</h2>
<p>Write your answers in <code>psql/s${pad(s.n)}.sql</code> and run them on the <code>practice</code> database. Open an answer only after you have tried.</p>
<ol class="questions">
${questions}
</ol>
${pager}
</main>
</section>`;
}

const TABLE_ORDER = ['customers', 'orders', 'order_items', 'products', 'categories', 'payments', 'deliveries', 'reviews',
  'page_views', 'routes', 'suppliers', 'product_suppliers', 'employees', 'departments', 'shipping_zones', 'discount_tiers', 'sizes', 'colors',
  'product_details', 'events', 'inventory', 'stock_feed', 'product_attributes', 'price_history',
  'accounts', 'jobs', 'table_bookings',
  'big_customers', 'big_orders', 'big_events'];
const TABLE_NOTES = {
  customers: 'Customers 9, 13, 15, 16 never ordered. Customer 18 is a duplicate of 2. Some cities are NULL.',
  orders: 'Order 30 has no items. Order 24 has no shipping city.',
  order_items: 'unit_price is the price at the time of the order.',
  products: 'Products 13 and 15 were never ordered. Gift Card has no category.',
  categories: 'parent_id points to another category. Books has no products.',
  payments: 'No foreign key. Has payments for orders 40 and 9999 (do not exist), a refund (order 4), a double charge (order 2).',
  deliveries: 'One row per shipped order. Timestamps carry real time-zone offsets (India, Dubai, London). 4 orders are still in transit (delivered_at is NULL).',
  reviews: 'Some reviews are by customers who never bought that product.',
  page_views: 'Website clicks in March 2025 by customers 1, 2, 5 and 9. Used for sessions (gaps over 30 minutes) and streaks of active days.',
  routes: 'One-way shipping routes with distances. Delhi → Kolkata → Delhi is a cycle.',
  suppliers: 'GlobalParts supplies nothing.',
  employees: 'manager_id points to another employee. Asha and Dev have no department.',
  departments: 'Legal has no employees.',
  product_details: 'Phase 4. Tags as an array, specs as JSONB. Desk Lamp has no tags; Earbuds Lite has the tag "Wireless" (capital W) and battery_hours stored as a string; Desk Lamp\'s warranty_years is a JSON null. Products 13 and 14 have no row.',
  events: 'Phase 4. Raw app events; the type is inside payload. The checkout for order 35 disagrees with order_items. Event 9 has qty as a string; event 24 has no device.',
  inventory: 'Phase 4. Stock per warehouse (Pune, Delhi), all counted on 10 Feb 2026 18:00.',
  stock_feed: 'Phase 4. Incoming stock counts, no foreign key: (Pune, 3) arrives twice, product 99 does not exist, feed 8 is older than the stock row, feed 10 changes nothing, feed 12 has qty −2.',
  product_attributes: 'Phase 4. The EAV anti-pattern: every value is text. Has a "colour" typo, "Black" vs "black", weight "light" and warranty "2 years".',
  price_history: 'Phase 4. List price as date ranges [from, to); an open upper bound is the current price. Product 3 has overlapping ranges; product 12 has no price in January 2025.',
  accounts: 'Phase 6. Four wallets, 9,200 in total. A CHECK keeps every balance at zero or above.',
  jobs: 'Phase 6. A work queue. Jobs 4, 5, 6, 7 and 10 are queued and due; job 8 is scheduled for 2099; job 9 is stuck in "running" (its worker died); 1 and 2 are done; 3 failed.',
  table_bookings: 'Phase 6. Restaurant tables 1–4 on 20 Feb 2026 in one-hour slots. UNIQUE (table_no, slot): a table cannot be booked twice for the same slot.',
  big_customers: 'Phase 5 (load big.sql). Generated customers: 400 in Dubai (UAE) and 400 in London (UK), so city and country depend on each other. Every 5th email has upper-case letters.',
  big_orders: 'Phase 5 (big.sql). One order every ~5 minutes from 1 Jan 2024, stored in time order. Customer 42 has 5,010 orders; customer 1 has none. The newest 1,000 are pending and the 2,000 before them shipped. customer_id has a foreign key but no index.',
  big_events: 'Phase 5 (big.sql). App events as JSONB: 70% page_view, 15% search, 10% add_to_cart, 4% checkout, 1% app_error.'
};
async function schemaHtml() {
  const db = await sessionDb('b_schema', true);
  const q = async (sql) => { const r = await db.run(sql); const f = r.results[0].fields.map((x) => x.name); return r.results[0].rows.map((row) => Object.fromEntries(row.map((v, k) => [f[k], v]))); };
  const cols = await q(`
    SELECT cl.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type,
           EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = cl.oid AND c.contype = 'p' AND a.attnum = ANY (c.conkey)) AS pk,
           (SELECT rc.relname FROM pg_constraint c JOIN pg_class rc ON rc.oid = c.confrelid
             WHERE c.conrelid = cl.oid AND c.contype = 'f' AND a.attnum = ANY (c.conkey) LIMIT 1) AS ref
    FROM pg_class cl
    JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE cl.relkind = 'r'
    ORDER BY cl.relname, a.attnum`);
  let html = '';
  for (const t of TABLE_ORDER) {
    const n = (await q(`SELECT count(*)::int AS n FROM ${t}`))[0].n;
    const rows = cols.filter((c) => c.tbl === t).map((c) => {
      const pk = c.pk === true || c.pk === 't';
      const type = c.type.replace('timestamp without time zone', 'timestamp').replace('character varying', 'varchar');
      const tag = [pk ? 'PK' : '', c.ref ? '→ ' + esc(c.ref) : ''].filter(Boolean).join(' ');
      return `<tr><td>${pk ? '<b>' + esc(c.col) + '</b>' : esc(c.col)}</td><td>${esc(type)}</td><td>${tag}</td></tr>`;
    }).join('');
    html += `<div class="tbl"><h3>${esc(t)} <span>${n} rows</span></h3><table>${rows}</table>${TABLE_NOTES[t] ? `<p>${esc(TABLE_NOTES[t])}</p>` : ''}</div>\n`;
  }
  await db.close();
  await dropDb('b_schema');
  return html;
}

// Number all 92 sessions from the plan: every 7th one is a Review belonging to the phase before it.
async function loadPlan(written) {
  const plan = (await import(pathToFileURL(path.join(contentDir, 'plan.mjs')).href + '?t=' + Date.now())).default;
  const byN = new Map(written.map((s) => [s.n, s]));
  const phases = plan.phases.map((p, i) => ({ i, title: p.title, goal: p.goal, sessions: [] }));
  const queue = [];
  phases.forEach((p, i) => plan.phases[i].sessions.forEach((t) => queue.push({ phase: p, title: t })));
  let n = 0, qi = 0;
  while (qi < queue.length) {
    n++;
    const review = n % plan.reviewEvery === 0;
    const item = review ? { phase: queue[qi - 1].phase, title: 'Review: redo your mistakes and earlier questions' } : queue[qi++];
    const s = { n, title: item.title, review, content: byN.get(n) || null };
    item.phase.sessions.push(s);
  }
  return phases;
}

function site(written, phases, schema) {
  const count = (s) => s.questions.length + (s.hard ? 1 : 0);
  const range = (p) => p.sessions.length > 1 ? `Sessions ${p.sessions[0].n}–${p.sessions[p.sessions.length - 1].n}` : `Session ${p.sessions[0].n}`;

  const phaseCards = phases.map((p) => {
    const ready = p.sessions.filter((s) => s.content).length;
    return `<a class="card" href="#p${p.i}">
<span class="num">Phase ${p.i}</span>
<span class="title">${esc(p.title)}</span>
<span class="desc">${esc(p.goal)}</span>
<span class="count">${range(p)} · ${ready ? `${ready} of ${p.sessions.length} ready` : 'not written yet'}</span>
</a>`;
  }).join('\n');

  const phaseViews = phases.map((p) => {
    const cards = p.sessions.map((s) => s.content
      ? `<a class="card" href="#s${pad(s.n)}">
<span class="num">Session ${s.n}</span>
<span class="title">${esc(s.content.title)}</span>
<span class="desc">${esc(s.content.goal)}</span>
<span class="count">${count(s.content)} questions</span>
</a>`
      : `<div class="card soon">
<span class="num">Session ${s.n}</span>
<span class="title">${esc(s.title)}</span>
<span class="count">Not written yet</span>
</div>`).join('\n');
    return `<section class="view" id="p${p.i}">
<nav class="top"><a href="#top">← All phases</a><a href="#schema">Schema</a></nav>
<main class="home">
<p class="kicker">Phase ${p.i} · ${range(p)}</p>
<h1>${esc(p.title)}</h1>
<p class="lead">${esc(p.goal)}</p>
<div class="cards">
${cards}
</div>
</main>
</section>`;
  }).join('\n\n');

  const phaseOf = new Map();
  phases.forEach((p) => p.sessions.forEach((s) => phaseOf.set(s.n, p)));
  const sessionViews = written.map((s, i) => sessionSection(s, written[i - 1], written[i + 1], phaseOf.get(s.n))).join('\n\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PostgreSQL Practice</title>
<style>
${css}
</style>
</head>
<body>
<main class="home" id="top">
<h1>PostgreSQL Practice</h1>
<p class="lead">10 phases, 92 sessions. Open a phase, then a session: topics to read, then questions to solve on the practice database.</p>

<div class="cards">
${phaseCards}
</div>

<h2 id="schema">Schema</h2>
<p>All questions use one database. Download <a href="data/practice.sql" download>practice.sql</a> and load it:</p>
<pre class="plain">psql -U postgres -c "CREATE DATABASE practice"
psql -U postgres -d practice -f practice.sql</pre>
<pre class="plain">customers ──&lt; orders ──&lt; order_items &gt;── products &gt;── categories
    │            │                             │
    │            ├── payments (no FK)          └──&lt; product_suppliers &gt;── suppliers
    │            └── deliveries
    ├── referred_by → customers
    ├──&lt; page_views
    └──&lt; reviews &gt;── products

departments ──&lt; employees ── manager_id → employees

routes: one-way shipping routes between cities

──&lt;  one to many      PK primary key      → foreign key</pre>
<div class="schema">
${schema}
</div>
</main>

${phaseViews}

${sessionViews}
</body>
</html>
`;
}

async function buildSession(file) {
  const s = (await import(pathToFileURL(path.join(contentDir, file)).href + '?t=' + Date.now())).default;
  const tag = 'S' + s.n, big = !!s.big, dbName = 'b_s' + s.n;
  const db = await sessionDb(dbName, big);
  for (const [i, b] of s.lesson.entries()) {
    const where = `${tag} topic block ${i + 1}`;
    if (b.steps || b.two) { b.out = await runTranscript(b, `${dbName}_l${i + 1}`, big, where); continue; }
    if (!(b.sql && b.run)) continue;
    const out = await runOrFrozen(db, b.sql, b.max || 12, where);
    if (b.expectRows != null && out.rowCount !== b.expectRows) throw new Error(`${where}: expected ${b.expectRows}, got ${out.rowCount}`);
    checkPlan(out, b.expectPlan, where);
    b.out = out;
  }
  const items = s.questions.map((q, i) => [q, `${tag} Q${i + 1}`, `q${i + 1}`]);
  if (s.hard) items.push([s.hard, `${tag} challenge`, 'hard']);
  for (const [q, label, key] of items) {
    if (q.verify === false || q.own) continue;
    if (q.steps || q.two) { q.out = await runTranscript(q, `${dbName}_${key}`, big, label); continue; }
    const out = await runOrFrozen(db, q.sql, q.max || 12, label);
    if (q.expectRows != null && out.rowCount !== q.expectRows) throw new Error(`${label}: expected ${q.expectRows}, got ${out.rowCount}`);
    checkPlan(out, q.expectPlan, label);
    q.out = out;
  }
  await db.close();
  await dropDb(dbName);
  console.log(`${tag.padEnd(4)} ok`);
  return s;
}

const only = process.argv[2] ? new Set(process.argv.slice(2).map(Number)) : null;
if (await ensureTemplates()) console.log('templates rebuilt from practice.sql + big.sql');
const files = fs.readdirSync(contentDir).filter((f) => /^s\d+\.mjs$/.test(f)).sort().filter((f) => !only || only.has(+f.match(/\d+/)[0]));
const sessions = [];
for (const f of files) sessions.push(await buildSession(f));
if (!only) {
  sessions.sort((a, b) => a.n - b.n);
  const phases = await loadPlan(sessions);
  const total = phases.reduce((a, p) => a + p.sessions.length, 0);
  fs.writeFileSync(path.join(docs, 'index.html'), site(sessions, phases, await schemaHtml()));
  console.log(`Wrote docs/index.html: ${phases.length} phases, ${total} sessions, ${sessions.length} written.`);
}
await closeAll();
