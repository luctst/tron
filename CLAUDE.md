# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What tron is

A keyboard-driven terminal database browser, built to replace DBeaver for someone who lives in nvim and the terminal. Sidebar of schemas/tables on the left, row grid on the right, SQL bar on top, status bar at the bottom. v1 targets PostgreSQL only; MySQL/MariaDB, SQLite and MongoDB are planned behind the adapter boundary. The one product promise that must never regress: **a write is never committed until the user presses `y`**, and the count shown before that prompt is the real affected-row count.

Stack: TypeScript on Node 22+, Ink 7 (React for terminals), postgres.js 3.4. Runtime dependencies are exactly `ink`, `react`, `postgres`; do not add others. ESM only, relative imports carry the `.js` extension even from `.tsx`.

## Commands

```bash
npm test                                   # tsc, then node:test over dist/test/*.test.js
npm run build && node --test dist/test/grid.test.js        # one test file
npm run build && node --test --test-name-pattern='popup' dist/test/grid.test.js   # one test by name
npm run smoke                              # adapter check against a Docker Postgres (see below)
npm run build && python3 scripts/pty-smoke.py               # 22-assertion end-to-end TUI run in a pseudo-terminal
npm link                                   # installs the `tron` binary from dist/src/cli.js
```

Tests run from compiled output, so every test cycle starts with `tsc`; there is no watch mode and no test-runner dependency. UI tests are `.tsx` because they render components, and Node cannot strip JSX on its own.

`npm run smoke` and the pty harness need the throwaway database:

```bash
docker run --rm -d --name tron-pg -e POSTGRES_PASSWORD=postgres -p 5499:5432 postgres:16
sleep 3
docker exec tron-pg psql -U postgres -c "
  create table smoke_users(id serial primary key, name text not null);
  create table smoke_orders(id serial primary key, user_id int references smoke_users(id), total numeric(10,2));
  create index smoke_orders_user_idx on smoke_orders(user_id);
  insert into smoke_users(name) values ('seed');"
```

The smoke script asserts absolute row counts and commits a row, so re-seed before re-running it. The pty harness expects a `smoke` profile in `~/.config/tron/config.json` and `TRON_SMOKE_PW=postgres`. The container was started with `--rm`, so `docker stop` deletes it.

## Architecture

**Three layers, one direction of dependency:** `src/ui/*` → `src/db/adapter.ts` (interface + types, no I/O) ← `src/db/postgres.ts` (the only implementation). `src/sql.ts` and `src/config.ts` are pure and fully unit-tested; they are the only modules with logic that does not need a terminal or a database.

**Read/write safety is enforced by Postgres, not by parsing.** `classify()` in `src/sql.ts` is a leading-keyword regex and only decides UX: whether to show the confirm prompt. The real guards live in `src/db/postgres.ts`:
- Every read runs inside `sql.begin('read only', …)` through a cursor asking for `max + 1` rows; a misclassified write (writable CTE, `EXPLAIN ANALYZE UPDATE`, `a; b`) is rejected by the server. User SQL is sent verbatim, never rewritten.
- Every write takes a reserved connection, runs `begin; set local tron.in_write = '1'`, executes the batch, then reads `pg_stat_xact_user_tables` and the sentinel in one query. The `pg_stat_xact` diff is the affected count (postgres.js folds multi-statement command tags into one, so tags cannot be trusted). A missing sentinel means the batch committed or rolled back itself and the write is rejected. `commit()`/`rollback()` are deferred to the caller; an `onclose` counter refuses to send the verb if any connection dropped while the prompt was up.
- Pool size is 2 on purpose: one connection is held by a pending write while the other serves sidebar reads.

**All state lives in `src/ui/App.tsx`.** Children are props-in, callbacks-out and never touch the adapter. Three pieces of state gate App's four `useInput` handlers and must stay consistent when adding keys:
- `focus` (`sidebar | grid | search`): single-letter keys (`q r s n p /`) only fire when focus is not the search bar.
- `capture`: set by a child that is consuming text (sidebar filter mode, grid cell popup); suspends Tab and the letter handler.
- `pending`: a write awaiting `y`; suspends every handler except the confirm handler (`y` commits, `q`/Ctrl-C roll back and quit, anything else rolls back).
`running` (a start timestamp or null) blocks a second query and makes the grid inert while a fetch is in flight. If a key seems to reach two handlers or none, check these gates before touching the components.

**Grid and Sidebar derive their scroll offsets on every render** (`scrollTo`/`clamp` in `src/ui/scroll.ts`) rather than syncing in effects, so a shrinking list or a smaller terminal cannot leave a stale selection. `Structure` reuses `Grid` for the columns table.

**Config** is `~/.config/tron/config.json` (or `$XDG_CONFIG_HOME`), named profiles, `$VAR` expanded from the environment at load; an unset variable is a hard error so a password can never silently become empty.

## Conventions

- **Micro commits.** One logical change per commit: a failing test and the code that makes it pass, a single fix, a doc update. Never bundle unrelated edits. Commit messages say why, not what.
- Match the existing minimal style: stdlib over a dependency, no interface with one implementation unless the spec calls for it (the adapter is the sanctioned exception), no scaffolding for later. When a deliberate shortcut has a known ceiling, mark it with a `// ponytail:` comment naming the ceiling and the upgrade path, as the existing code does.
- Behavior changes come with a test in `test/`; UI tests drive real stdin bytes through `ink-testing-library` and assert on `lastFrame()`, never on internal state.

## Workflow for features

Use the superpowers plugin flow, in this order, and keep every artifact under `docs/`:

1. `/superpowers:brainstorming` to turn the idea into a design. The approved spec goes to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
2. `/superpowers:writing-plans` to turn the spec into a task-by-task plan at `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
3. Execute the plan with `/superpowers:subagent-driven-development` (fresh subagent per task, review after each) or `/superpowers:executing-plans` (inline). Work on a branch; merge only after the final review is clean.

Existing references: the v1 spec and plan under `docs/superpowers/`, and `docs/superpowers/plans/2026-09-14-tron-tui-followups.md`, which lists every deferred review finding from the v1 build. Start there before proposing new work; the spec's non-goals (other engines, CSV export, autocomplete, persisted history, cell editing) are the intended next features.
