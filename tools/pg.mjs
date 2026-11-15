// Shared by build.mjs and the check scripts. Everything runs on a private Postgres 18 server
// (data folder in %LOCALAPPDATA%/db-practice-pg18, trust auth, localhost:54329). It is started automatically.
//   - template databases tpl_practice (practice.sql) and tpl_big (practice.sql + big.sql)
//   - one fresh database per session, and one per transcript item
import { Conn, PG } from './pgwire.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const BIN = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'docs', 'data');
// The server's data folder lives outside the repo (it is large and machine-specific).
const serverDir = process.env.PGM_SERVER_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'db-practice-pg18');
const pgData = path.join(serverDir, 'data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Make sure the private server exists and is running.
export async function ensureServer() {
  try { const c = await Conn.connect('postgres'); await c.close(); return; } catch { /* start it */ }
  fs.mkdirSync(serverDir, { recursive: true });
  if (!fs.existsSync(path.join(pgData, 'PG_VERSION'))) execFileSync(`${BIN}/initdb.exe`, ['-D', pgData, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8'], { stdio: 'ignore' });
  execFileSync(`${BIN}/pg_ctl.exe`, ['-D', pgData, '-o', `-p ${PG.port} -c listen_addresses=localhost -c deadlock_timeout=1s`, '-l', path.join(serverDir, 'pg18.log'), '-w', 'start'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { const c = await Conn.connect('postgres'); await c.close(); return; } catch { await sleep(200); } }
  throw new Error('private Postgres 18 server did not start');
}

let adminConn = null;
export async function admin() { if (!adminConn) { await ensureServer(); adminConn = await Conn.connect('postgres'); } return adminConn; }
export async function closeAll() { if (adminConn) { await adminConn.close(); adminConn = null; } }

function psqlFile(db, file) {
  execFileSync(`${BIN}/psql.exe`, ['-X', '-q', '-h', PG.host, '-p', String(PG.port), '-U', PG.user, '-d', db, '-v', 'ON_ERROR_STOP=1', '-f', file], { stdio: ['ignore', 'pipe', 'pipe'] });
}
// (Re)build the templates only when practice.sql or big.sql changed.
export async function ensureTemplates() {
  const a = await admin();
  const hash = crypto.createHash('sha1').update(fs.readFileSync(`${dataDir}/practice.sql`)).update(fs.readFileSync(`${dataDir}/big.sql`)).digest('hex');
  const have = await a.exec(`SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = 'tpl_big'`);
  if (have.results[0]?.rows[0]?.[0] === hash) return false;
  for (const t of ['tpl_practice', 'tpl_big']) { await a.run(`DROP DATABASE IF EXISTS ${t} WITH (FORCE)`); await a.run(`CREATE DATABASE ${t}`); }
  psqlFile('tpl_practice', `${dataDir}/practice.sql`);
  psqlFile('tpl_big', `${dataDir}/practice.sql`);
  psqlFile('tpl_big', `${dataDir}/big.sql`);
  await a.run(`COMMENT ON DATABASE tpl_big IS '${hash}'`);
  return true;
}
export async function createDb(name, big) {
  const a = await admin();
  await a.run(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await a.run(`CREATE DATABASE ${name} TEMPLATE ${big ? 'tpl_big' : 'tpl_practice'}`);
  // Per-database settings are not copied from a template: apply what practice.sql and big.sql set.
  await a.run(`ALTER DATABASE ${name} SET timezone TO 'Asia/Kolkata'`);
  if (big) { await a.run(`ALTER DATABASE ${name} SET max_parallel_workers_per_gather = 0`); await a.run(`ALTER DATABASE ${name} SET jit = off`); }
}
export async function dropDb(name) { const a = await admin(); await a.run(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); }
export async function sessionDb(name, big) { await createDb(name, big); return Conn.connect(name); }

// A normal item: BEGIN; <sql>; ROLLBACK. The last result set that has columns is the answer.
export async function runItem(db, sql, max = 12) {
  await db.exec('BEGIN');
  const r = await db.exec(sql);
  await db.exec('ROLLBACK');
  if (r.error) throw new Error(r.error.message + (r.error.detail ? ' | ' + r.error.detail : ''));
  let last = null;
  for (const x of r.results) if (x.fields.length) last = x;
  if (!last) return { cols: [], rowCount: 0, rows: [], plan: false };
  const cols = last.fields.map((f) => f.name);
  const isPlan = cols.length === 1 && cols[0] === 'QUERY PLAN';
  return { cols, rowCount: last.rows.length, rows: isPlan ? last.rows : last.rows.slice(0, max), plan: isPlan };
}

// ---- transcripts: what psql would print, for one or more terminals ----------------------------------
const NUMERIC = new Set([20, 21, 23, 26, 700, 701, 1700]);
function table(res) {
  const cols = res.fields.map((f) => f.name);
  const cells = res.rows.map((r) => r.map((v) => (v === null ? '∅' : String(v).replace(/\n/g, ' ⏎ '))));
  const w = cols.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i].length)));
  const center = (s, n) => { const l = Math.floor((n - s.length) / 2); return ' '.repeat(l) + s + ' '.repeat(n - s.length - l); };
  const lines = [(' ' + cols.map((c, i) => center(c, w[i])).join(' | ')).trimEnd(), w.map((n) => '-'.repeat(n + 2)).join('+')];
  for (const r of cells) lines.push((' ' + r.map((v, i) => (NUMERIC.has(res.fields[i].typeOid) ? v.padStart(w[i]) : v.padEnd(w[i]))).join(' | ')).trimEnd());
  lines.push(`(${cells.length} ${cells.length === 1 ? 'row' : 'rows'})`);
  return lines;
}
function resultLines(r, conn) {
  const lines = [];
  for (const n of r.notices) lines.push(`${n.severity}:  ${n.message}`);
  for (const x of r.results) { if (x.fields.length) lines.push(...table(x)); else if (x.tag) lines.push(x.tag); }
  if (r.error) {
    lines.push(`${r.error.severity}:  ${r.error.message}`);
    if (r.error.detail) lines.push(`DETAIL:  ${r.error.detail}`);
    if (r.error.hint) lines.push(`HINT:  ${r.error.hint}`);
  }
  for (const n of (conn?.notifications || []).splice(0)) lines.push(`Asynchronous notification "${n.channel}"${n.payload ? ` with payload "${n.payload}"` : ''} received from server process with PID <pid>.`);
  return lines;
}
const DEFAULT_MASKS = [
  [/Process \d+ waits for (\w+) on transaction \d+; blocked by process \d+\./g, 'Process <pid> waits for $1 on transaction <xid>; blocked by process <pid>.'],
  [/Process \d+ waits for (\w+) on (relation|tuple|advisory lock) [^;]+; blocked by process \d+\./g, 'Process <pid> waits for $1 on $2 …; blocked by process <pid>.'],
  [/Reason code: [^\n]*/g, 'Reason code: …']
];

// steps: [terminal, sql] | ['wait', terminal] | ['--', note]. Terminals are any labels ('A', 'B', …).
// Each item runs in its own fresh database, so it may COMMIT freely.
export async function transcript(dbName, big, steps, opts = {}) {
  await createDb(dbName, big);
  const a = await admin();
  const rolesBefore = new Set((await a.exec('SELECT rolname FROM pg_roles')).results[0].rows.map((r) => r[0]));
  const labels = [...new Set(steps.filter((s) => s[0] !== '--' && s[0] !== 'wait').map((s) => s[0]))];
  const single = labels.length === 1;
  const term = {};
  const out = [];
  try {
    if (opts.setup) { const c = await Conn.connect(dbName); await c.run(opts.setup); await c.close(); }
    for (const l of labels) term[l] = { conn: await Conn.connect(dbName, { name: 'terminal ' + l }), pending: null, indent: single ? '' : ' '.repeat(labels.indexOf(l) * 12) };
    for (const l of labels) term[l].pid = +(await term[l].conn.exec('SELECT pg_backend_pid()')).results[0].rows[0][0];
    const prompt = (l) => { const st = term[l].conn.status; return `${single ? 'practice' : l}=${st === 'T' ? '*' : st === 'E' ? '!' : ''}# `; };
    const emit = (l, lines) => { for (const x of lines) for (const part of String(x).split('\n')) out.push((term[l].indent + part).trimEnd()); };
    const isLockWait = async (l) => (await a.exec(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${term[l].pid}`)).results[0].rows[0]?.[0] === 'Lock';
    // Start a statement; its result is recorded with the time it arrived, so finishes are shown in real order.
    const start = (l, text) => {
      const t = term[l]; t.result = null; t.doneAt = null;
      t.pending = t.conn.exec(text);
      t.pending.then((r) => { t.result = r; t.doneAt = performance.now(); }, () => {});
    };
    // Wait for the statement just started in terminal l: until it finishes, or it is confirmed to wait for a lock.
    const settle = async (l) => {
      const t = term[l]; const t0 = Date.now();
      for (;;) {
        await sleep(25);
        if (t.doneAt != null) { t.pending = null; return t.result; }
        if (Date.now() - t0 > 150 && await isLockWait(l)) return null;
        if (Date.now() - t0 > 60000) throw new Error(`terminal ${l}: statement still running after 60 s`);
      }
    };
    // Show blocked statements that have finished, in the order they finished. Keep waiting while there is progress,
    // up to idleMs without any; with `until`, wait (up to 20 s) until that terminal has finished.
    const finishBlocked = async (idleMs, until = null) => {
      let last = Date.now();
      for (;;) {
        const done = labels.filter((x) => term[x].pending && term[x].doneAt != null).sort((x, y) => term[x].doneAt - term[y].doneAt);
        for (const x of done) { term[x].pending = null; emit(x, [`⏳ … ${single ? 'the' : x + "'s"} statement finishes:`, ...resultLines(term[x].result, term[x].conn)]); last = Date.now(); }
        if (!labels.some((x) => term[x].pending)) return;
        if (until ? !term[until].pending : Date.now() - last > idleMs) return;
        if (until && Date.now() - last > 20000) throw new Error(`wait ${until}: still blocked after 20 s`);
        await sleep(25);
      }
    };
    for (const step of steps) {
      const [l, text] = step;
      if (l === '--') { out.push(`-- ${text}`); continue; }
      if (l === 'wait') {
        if (!term[text].pending) throw new Error(`wait ${text}: nothing is pending`);
        await finishBlocked(0, text);
        continue;
      }
      const t = term[l];
      if (t.pending) throw new Error(`terminal ${l} is still blocked; cannot run: ${text}`);
      const p = prompt(l);
      const sqlLines = text.split('\n');
      emit(l, [p + sqlLines[0], ...sqlLines.slice(1).map((x) => ' '.repeat(p.length) + x)]);
      start(l, text);
      const r = await settle(l);
      if (r) emit(l, resultLines(r, t.conn)); else emit(l, ['⏳ blocked: waiting for a lock …']);
      const blocked = labels.filter((x) => term[x].pending);
      if (blocked.length) await finishBlocked(blocked.length > 1 ? 2500 : 400);
    }
    await finishBlocked(3000);
    const stuck = labels.filter((x) => term[x].pending);
    if (stuck.length) throw new Error(`transcript ended with terminal ${stuck.join(', ')} still blocked`);
  } finally {
    for (const l of labels) { try { term[l]?.conn.sock.destroy(); } catch { /* ignore */ } }
    await sleep(30);
    if (!opts.keep) await dropDb(dbName);
    for (const [r] of (await a.exec('SELECT rolname FROM pg_roles')).results[0].rows) if (!rolesBefore.has(r)) await a.run(`DROP ROLE "${r}"`);
  }
  let text = out.join('\n');
  for (const [re, to] of [...DEFAULT_MASKS, ...(opts.mask || []).map(([re, to]) => [new RegExp(re, 'g'), to])]) text = text.replace(re, to);
  return text;
}
