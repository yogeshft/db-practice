# PostgreSQL Mastery Path

**10 phases · 92 sessions · 6 sessions a week (Sunday off) · start Tue 27 Oct 2026 · planned finish Wed 10 Feb 2027**

**Where you study:** open [`docs/index.html`](docs/index.html) (or the GitHub Pages site). It shows one card per session and the database schema. Each card opens the session's page: topics first, then a numbered list of questions, each with the expected row count and a hidden answer. You solve them in your own psql / VS Code against the **practice** database ([`docs/data/practice.sql`](docs/data/practice.sql)). Sessions 1–74 (Phases 0–7: setup, joins, subqueries and dates, CTEs and window functions, JSONB and modelling, indexes and EXPLAIN, transactions and locking, functions, triggers and security) are ready; more are added in the same format. Reload practice.sql whenever a new phase arrives: it gains tables. Phase 5 and Session 68 also need `docs/data/big.sql` (320,000 generated rows), loaded into the same database.

This file is the summary and the reasoning.

Built from: your Udemy progress (207/629 lectures, sections 1–21 except 16), your answers in `psql/track1.sql`, the two PDFs in this folder, absolutelearners.com *Advanced SQL Techniques*, Use The Index, Luke, and web research on how people get to expert level (roadmap.sh SQL + PostgreSQL DBA roadmaps, Postgres community advice, and learning research on spaced retrieval practice).

---

## 1. How you study: the session loop

Sessions are numbered, not dated. A missed day moves the finish date; it never breaks the plan.

| Step | Time | What |
|---|---|---|
| Learn | 30–45 min | One chunk of video, lesson or book. Type every example, change one thing, re-run. |
| Practice | ~75 min | **20 points.** Easy = 1 pt, medium = 2 pts. Recall redos first. 5-minute timer on every easy question. |
| Hard problem | 30–45 min cap | One "boss" problem per session, extra to the 20 points. Stuck at the cap: read a solution, redo it tomorrow. |
| Log | 10 min | Wrong or slow answers → `mistakes.md`. Commit that day's `psql/sNN.sql`. |

- **Every 7th session is Review + Apply** (S7, S14 … S91): redo the week's mistakes cold, then build the phase's project.
- Early phases ≈ 20 quick questions a session; later phases ≈ 10–12 harder ones plus a design problem. Same effort, rising difficulty.

**Rules**
1. **Predict first.** Write the expected row count as a comment before running.
2. **Park, don't force.** Question needs a later topic → `parked.sql` with the phase that unlocks it.
3. **Phase gate.** Move on only after the exit test: cold, no notes, 80%+.
4. **Keep it hard.** First-try correctness above 85% for a week means the questions are too easy.
5. **Type, never paste.** Video is under a third of a session.

Why this shape: research on study methods rates **practice testing** and **spaced practice** as the most effective techniques, and re-reading/highlighting as the least. Experienced SQL users consistently credit set-based puzzles and writing their own questions on sample databases.

---

## 2. The 10 phases

| Phase | Sessions | Planned dates | Goal |
|---|---|---|---|
| **P0 Setup** | S1 | 27 Oct | Lab, repo, GitHub Pages, fix track1 |
| **P1 Joins** | S2–S12 | 28 Oct → 9 Nov | Any join correct first time; predict row counts |
| **P2 Subqueries + Date/Time** | S13–S18 | 10 → 16 Nov | Subqueries on purpose; dates and time zones without bugs |
| **P3 CTEs + Window functions** | S19–S36 | 17 Nov → 7 Dec | Ranking, running totals, gaps/islands, hierarchies, cohorts |
| **P4 JSONB, arrays + modelling** | S37–S43 | 8 → 15 Dec | Columns vs arrays vs JSONB; schemas that stay correct |
| **P5 Indexes + EXPLAIN** | S44–S54 | 16 → 28 Dec | Read any plan; choose and prove indexes |
| **P6 Transactions + locking** | S55–S63 | 29 Dec → 7 Jan | No lost updates or races; zero-downtime migrations |
| **P7 Functions, triggers + RLS** | S64–S74 | 8 → 20 Jan | Safe server-side code; ship the Q50 migration |
| **P8 Internals + operations** | S75–S86 | 21 Jan → 3 Feb | MVCC, vacuum, WAL, backups/PITR, replication, pooling |
| **P9 Visitly capstone** | S87–S92 | 4 → 10 Feb | Audit and tune your restaurant app's real database |

Levels these map to: **1 Query fluency** (P1–P3) → **2 Modelling** (P4) → **3 Performance** (P5) → **4 Concurrency** (P6) → **5 Server-side** (P7) → **6 Internals + ops** (P8) → **7 Proof** (P9). Levels 6 and 7 are what separate "very good at SQL" from "Postgres master".

Each phase ends with an exit test session and an Apply project.

### Udemy sections by phase
| Phase | Udemy |
|---|---|
| P2 | S25 Subqueries, S16 Date/Time (skipped earlier) |
| P3 | S26 CTE, S28 Window functions, S27 Grouping sets |
| P4 | S21 lectures 228–229, S22 JSON |
| P5 | S23 Indexes |
| P6 | S40 Transactions, S24 Views |
| P7 | S32–S36 Functions, PL/pgSQL, procedures, triggers · S44 Security |
| P8 | S46 Internals, S45 psql, S47 Managing tables, S31 Partitions |
| Later | S29 Regex, S30 Full-text search, S37 Cursors, S38 Crosstab, S39 i18n, S41–S43 sample databases (use as question banks from P1) |

### Where each parked track1 question unlocks
| Question | Session / phase |
|---|---|
| Q31 fix | S1 |
| Q34, Q35, Q36, Q38 | P1 |
| Q23, Q26, Q27 (rest) | P2 |
| Q33 | P3 |
| Q37, Q39 | P4 |
| Q40 | P5 |
| Q41–Q44, Q46, Q48, Q49 | P6 |
| Q45, Q47, Q50 | P7 |

---

## 3. Fix these in track1 first (S1)
1. **Q31:** `UPDATE … FROM departments` is an inner join. Nisha (department 99) matches no department, so she is silently skipped and never gets the 3% `ELSE` raise. Also missing a `;` before `COMMIT`.
2. **Q19:** The FKs fail: `orders.customer_id = 999` and `order_items.order_id = 999` have no parent row. Find them with an anti-join first.
3. **Q26:** Column is `active_text`, not `is_active`. `'₹85,000'` and `' 92,500.75 '` become NULL (reuse Q23 cleaning). `'01/12/2020'::date` depends on `DateStyle`; use Q24's `TO_DATE`.
4. **Q6:** Looks up `'Engineering'`; the question asks for HR.
5. **Q2:** Leading space in `' yogesh@example.com'`.
6. **Q25:** No `FROM`; `::boolean` also accepts `on`/`t`; the question wants an explicit `CASE`.
7. **Q14:** Use `ALTER COLUMN name SET NOT NULL`, not a `CHECK`, and fix rows instead of deleting them.

---

## 4. Resources

| Use | Resource | Cost |
|---|---|---|
| Concepts in order | Udemy PostgreSQL Bootcamp | Owned |
| Advanced patterns (P1, P3–P8) | [absolutelearners Advanced SQL](https://absolutelearners.com/course/advanced-sql): 260 lessons, 63+ free previews | **$9 once, worth buying** |
| Highest-value practice | Your own track files | — |
| Practice volume | [pgexercises](https://pgexercises.com/), LeetCode SQL 50, DataLemur (pick PostgreSQL), Advent of SQL in December | Free |
| Performance | [Use The Index, Luke](https://use-the-index-luke.com/) | Free |
| Thinking in SQL, concurrency | The Art of PostgreSQL (PDF here; Part VII matters most) | Owned |
| Reference | [PostgreSQL docs](https://www.postgresql.org/docs/current/): ch.7 Queries, ch.11 Indexes, ch.13 Concurrency, ch.14 Performance Tips | Free |
| Internals (P8) | [PostgreSQL 14 Internals, Egor Rogov](https://postgrespro.com/community/books/internals) | Free PDF |
| Plans | explain.dalibo.com, explain.depesz.com | Free |
| Commute | [Postgres FM](https://postgres.fm/) podcast | Free |
| Optional | CMU 15-445 lectures (P8), *SQL Antipatterns* by Bill Karwin (P4) | Free / paid |
| Low priority | 800+ SQL Server interview PDF: only Sets 6, 7, 10, 11 as predict-the-output drills, rewritten in Postgres | — |

Shorthand: `U-S28` Udemy section 28 · `AL #12` absolutelearners lesson 12 · `AoP p156` Art of PostgreSQL PDF page · `UTIL` Use The Index, Luke · `Rogov` PostgreSQL 14 Internals · `pgx` pgexercises.

---

## 5. Repo layout and daily commit

```
db-practice/
  LEARNING_PATH.md   mistakes.md   parked.sql
  docs/                       ← GitHub Pages site
    index.html                  THE page: phase cards → session cards → topics + questions; schema at the bottom
    data/practice.sql           the practice database every session uses
  content/plan.mjs            ← the 10 phases and 92 session titles
  content/sNN.mjs             ← session sources: topics, questions, answers
  psql/track1.sql
  psql/s01.sql, s02.sql …     ← your answers, one file per session
  psql/projects/              ← Apply projects
```

**A session, step by step:** open its card → read the topics and type the examples → write each answer in `psql/sNN.sql`, guessing the row count first → compare with **Expected** → open **Answer** only after trying → commit your file.

**How the answers are checked:** before `docs/index.html` is generated, every example and every answer is run on `practice.sql` in real Postgres 17. A query that fails, or returns a different row count than the session claims, stops the build. The "Expected" counts and output tables come from that run.

Keep the two PDFs out of the public repo: the books are copyrighted.

## 6. Mistakes that slow people down
- Watching without typing.
- 20 easy questions a day for a month. Volume without rising difficulty is a plateau; the hard problem is non-negotiable.
- Never redoing failed questions. The recall slots are where most learning happens.
- Learning indexes before your joins and window queries are correct. Correct first, then fast.
- Copying SQL Server answers from the interview PDF without translating them (`'VIKAS' + '1'` is an error in Postgres; use `||`, `COALESCE`, `LIMIT`, `string_agg`).
