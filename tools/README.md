# Build tools

These scripts turn `content/sNN.mjs` into `docs/index.html`. Every answer is run on a real
Postgres 18 server first: wrong row counts, plans or transcripts stop the build.

Needs Node 20+ and PostgreSQL 18 installed in `C:/Program Files/PostgreSQL/18`
(or set `PG_BIN` to its `bin` folder).

```bash
node build.mjs            # check every session and write docs/index.html
node build.mjs 66 67      # check only these sessions (does not write the site)
node check.mjs 67         # print what each item of one session returns, with ✓/✗
node check.mjs 67 8 Q4,HARD   # more rows, only some items
node q.mjs "SELECT count(*) FROM orders" [big]   # one ad-hoc query on a fresh practice database
```

## The private server

The scripts start their own Postgres server on `localhost:54329` (trust auth, nothing else
uses it). Its data folder is `%LOCALAPPDATA%\db-practice-pg18` (set `PGM_SERVER_DIR` to move
it). It is created on first use. The template databases are rebuilt automatically whenever
`docs/data/practice.sql` or `docs/data/big.sql` changes. To stop it:

```bash
"/c/Program Files/PostgreSQL/18/bin/pg_ctl.exe" -D "$LOCALAPPDATA/db-practice-pg18/data" stop
```

## Files

- `build.mjs`: runs every item and renders the page (`style.css` is inlined into it).
- `pg.mjs`: the server, templates, one database per session or transcript, psql-like transcripts.
- `pgwire.mjs`: a small Postgres protocol client, so several "terminals" can run at once.
- `check.mjs`, `q.mjs`: helpers for writing sessions.
- `frozen.json`, `frozen_html.json`: saved outputs for the few items that need `pg_trgm` or
  `btree_gist`, which Windows Application Control blocks on this machine. They are used only
  when the extension fails to load; with the extensions allowed, those items run normally.
