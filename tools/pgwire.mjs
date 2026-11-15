// A minimal PostgreSQL client (wire protocol v3, simple query protocol, trust auth only).
// Used to run the site's SQL on a real, private Postgres server with several concurrent connections.
import net from 'node:net';

export const PG = { host: '127.0.0.1', port: +(process.env.PG18PORT || 54329), user: 'postgres' };

function cstr(s) { return Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]); }

export class Conn {
  static connect(database, opts = {}) {
    return new Promise((resolve, reject) => {
      const c = new Conn();
      c.sock = net.createConnection({ host: PG.host, port: PG.port });
      c.buf = Buffer.alloc(0);
      c.queue = [];
      c.status = 'I';
      c.ready = false;
      c.sock.on('error', (e) => { if (!c.ready) reject(e); else c.fail(e); });
      c.sock.on('close', () => c.fail(new Error('connection closed')));
      c.sock.on('connect', () => {
        const params = Buffer.concat([cstr('user'), cstr(opts.user || PG.user), cstr('database'), cstr(database),
          cstr('client_encoding'), cstr('UTF8'), cstr('application_name'), cstr(opts.name || 'site-build'), Buffer.from([0])]);
        const head = Buffer.alloc(8); head.writeInt32BE(params.length + 8, 0); head.writeInt32BE(196608, 4);
        c.sock.write(Buffer.concat([head, params]));
      });
      c.onReady = () => { c.ready = true; resolve(c); };
      c.onStartupError = (m) => reject(new Error(m));
      c.sock.on('data', (d) => { c.buf = Buffer.concat([c.buf, d]); c.pump(); });
    });
  }
  fail(e) { for (const q of this.queue.splice(0)) q.reject(e); }
  pump() {
    while (this.buf.length >= 5) {
      const type = String.fromCharCode(this.buf[0]);
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < 1 + len) return;
      const body = this.buf.subarray(5, 1 + len);
      this.buf = this.buf.subarray(1 + len);
      this.message(type, body);
    }
  }
  fields(body) {
    const f = {}; let i = 0;
    while (body[i] !== 0) { const code = String.fromCharCode(body[i]); const end = body.indexOf(0, i + 1); f[code] = body.toString('utf8', i + 1, end); i = end + 1; }
    return { severity: f.S, code: f.C, message: f.M, detail: f.D, hint: f.H, where: f.W };
  }
  message(type, body) {
    const cur = this.queue[0];
    switch (type) {
      case 'R': { const kind = body.readInt32BE(0); if (kind !== 0) this.onStartupError('only trust authentication is supported'); break; }
      case 'S': case 'K': break;
      case 'A': {   // NotificationResponse (LISTEN / NOTIFY)
        const pid = body.readInt32BE(0); const e1 = body.indexOf(0, 4); const e2 = body.indexOf(0, e1 + 1);
        (this.notifications ||= []).push({ pid, channel: body.toString('utf8', 4, e1), payload: body.toString('utf8', e1 + 1, e2) });
        break;
      }
      case 'T': {
        const n = body.readInt16BE(0); const fields = []; let i = 2;
        for (let k = 0; k < n; k++) { const end = body.indexOf(0, i); const name = body.toString('utf8', i, end); i = end + 1; const typeOid = body.readInt32BE(i + 6); i += 18; fields.push({ name, typeOid }); }
        cur.current = { fields, rows: [], tag: null }; break;
      }
      case 'D': {
        const n = body.readInt16BE(0); const row = []; let i = 2;
        for (let k = 0; k < n; k++) { const l = body.readInt32BE(i); i += 4; if (l === -1) row.push(null); else { row.push(body.toString('utf8', i, i + l)); i += l; } }
        cur.current.rows.push(row); break;
      }
      case 'C': { const tag = body.toString('utf8', 0, body.length - 1); const r = cur.current || { fields: [], rows: [], tag: null }; r.tag = tag; cur.results.push(r); cur.current = null; break; }
      case 'I': cur.results.push({ fields: [], rows: [], tag: '' }); break;
      case 'E': { const e = this.fields(body); if (!this.ready) { this.onStartupError(e.message); break; } if (!cur) break; cur.error = e; cur.current = null; break; }
      case 'N': { const n = this.fields(body); if (cur) cur.notices.push(n); break; }
      case 'Z': {
        this.status = String.fromCharCode(body[0]);
        if (!this.ready) { this.onReady(); break; }
        const q = this.queue.shift();
        q.resolve({ results: q.results, error: q.error || null, notices: q.notices, status: this.status });
        break;
      }
      default: break;
    }
  }
  // Runs one simple-query message (may hold several statements). Never rejects on SQL errors:
  // resolves { results: [{fields, rows, tag}], error, notices, status } (status I idle, T in transaction, E failed transaction).
  exec(sql) {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, results: [], notices: [], error: null, current: null });
      const q = cstr(sql); const head = Buffer.alloc(5); head.write('Q', 0); head.writeInt32BE(q.length + 4, 1);
      this.sock.write(Buffer.concat([head, q]));
    });
  }
  async run(sql) { const r = await this.exec(sql); if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r; }
  close() { return new Promise((res) => { this.sock.removeAllListeners('close'); this.sock.on('close', res); try { const b = Buffer.alloc(5); b.write('X', 0); b.writeInt32BE(4, 1); this.sock.end(b); } catch { res(); } }); }
}
