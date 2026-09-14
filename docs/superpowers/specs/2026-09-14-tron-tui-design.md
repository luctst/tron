# tron — terminal database browser

Design spec, 2026-09-14. Status: approved.

## Purpose

Replace DBeaver for day-to-day data browsing with a keyboard-driven TUI that
lives alongside nvim and claude-code. Sidebar of tables on the left, rows on
the right, SQL bar on top.

## Decisions

| Topic        | Decision                                                             |
|--------------|----------------------------------------------------------------------|
| Engine v1    | PostgreSQL only. Adapter boundary designed so MySQL/SQLite/Mongo slot in later. |
| Language     | TypeScript on Node 22+. No bundler, `tsc` to `dist/`.                |
| TUI          | Ink (React renderer) + React.                                        |
| Driver       | postgres.js (`postgres`). Chosen for built-in `cancel()` and cursor API. |
| Writes       | Allowed, always inside a transaction, confirmed against real affected count before commit. |
| Config       | `~/.config/tron/config.json`, named profiles, `$ENV` expansion in URLs. |
| Runtime deps | `ink`, `react`, `postgres`. Nothing else.                            |

## Layout and keys

```
┌ tron · prod (postgres) ──────────────────────────────────────────────┐
│ > select * from orders where status = 'paid' limit 50               │
├────────────────┬─────────────────────────────────────────────────────┤
│ public         │ id     │ user_id │ status │ total   │ created_at   │
│  ▸ orders    ◂ │ 1041   │ 88      │ paid   │ 129.00  │ 2026-09-01…  │
│    users       │ 1042   │ 12      │ paid   │ 40.50   │ 2026-09-01…  │
│    invoices    │ 1043   │ 88      │ paid   │ 9.99    │ 2026-09-02…  │
│ audit          │ …                                                   │
│    events      │                                                     │
├────────────────┴─────────────────────────────────────────────────────┤
│ 50 rows · 12ms · [/] query [Tab] pane [s] structure [n/p] page [q]  │
└──────────────────────────────────────────────────────────────────────┘
```

Three panes, one focused at a time. Focus ring: sidebar → grid → search bar.

Single-letter keys (`q`, `r`, `s`, `f`, `n`, `p`, `g`, `G`, `h/j/k/l`) are
only active when the sidebar or grid is focused. When the search bar is
focused every printable key is text input; only `Tab`, `Esc`, `Enter`,
`↑/↓` and `Ctrl-C` are special.

Global:
- `Tab` cycle focus. `/` focus search bar from anywhere. `Esc` return to grid.
- `q` quit. While a write awaits confirmation, `q` rolls back and exits.
- `r` reload sidebar (re-run information_schema query) / reconnect if dropped.
- `Ctrl-C` cancel running query. Second `Ctrl-C` with nothing running quits.

Sidebar:
- Schemas as collapsible groups, tables and views under them. Functions excluded.
- `j/k` move, `Enter` or `l` open table: runs `SELECT * FROM "s"."t" LIMIT 100 OFFSET 0`.
- `f` substring filter on table names. `Esc` clears filter.

Grid:
- `j/k` rows, `h/l` columns, `g/G` top/bottom.
- `n/p` next/prev page. Only active for sidebar-opened tables (we own the LIMIT/OFFSET).
- Cells truncated to column width with `…`. `Enter` on a cell opens a popup with the full value (needed for JSON/text columns). Any key closes it.
- `s` toggles structure view: columns (name, type, nullable, default), primary key, foreign keys, indexes. Fetched lazily on first `s` per table.

Search bar:
- Single line. `Enter` runs. `↑/↓` walk in-session history (array in memory, not persisted).
- Paste works. Multi-line editing is out of scope.
- On error the text is kept so it can be fixed.

Status bar:
- Row count (with `500+ (truncated)` when capped), elapsed ms, key hints for focused pane.
- `✎ uncommitted` marker plus a running timer while a write awaits confirmation.
- Goes red with the error when the connection drops.

## Query execution

Classification is one regex on the leading keyword after stripping `--` and
`/* */` comments:

- `SELECT | WITH | VALUES | TABLE | EXPLAIN | SHOW` → read
- anything else → write

Reads:
- Sent verbatim through a postgres.js cursor, stopped after 500 rows. User's own
  `LIMIT` is respected because nothing is rewritten.
- Exactly 500 rows back → `truncated: true`.
- Belt-and-braces: reads run inside `BEGIN READ ONLY`. A misclassified write
  (e.g. a data-modifying CTE) is rejected by Postgres itself with
  `cannot execute DELETE in a read-only transaction`. No parsing needed.

Writes:
- `BEGIN` → execute → status bar shows `UPDATE affected 42 rows · commit? [y/N]`.
- `y` → `COMMIT`. Any other key → `ROLLBACK`.
- Postgres DDL is transactional so `ALTER TABLE` etc. get the same treatment.
- Locks are held while the prompt is up; the status bar timer makes this visible.
- Cancel mid-transaction → `ROLLBACK`.

Multi-statement input (`a; b`) is not split. If any statement is a write the
whole batch goes through the confirm path.

## Code structure

```
tron/
  package.json          bin: { tron: "dist/cli.js" }
  tsconfig.json
  src/
    cli.ts              parseArgs → load config → open adapter → render <App/>
    config.ts           read config.json, pick profile, expand $ENV
    sql.ts              classify(sql) → 'read' | 'write'   (pure, tested)
    db/
      adapter.ts        the interface
      postgres.ts       v1 implementation
    ui/
      App.tsx           layout, focus ring, global keys, owns query state
      Sidebar.tsx
      SearchBar.tsx
      Grid.tsx
      Structure.tsx
      StatusBar.tsx
  test/
    sql.test.ts
    config.test.ts
    grid.test.tsx
```

Adapter interface:

```ts
interface Adapter {
  listTables(): Promise<{ schema: string; name: string; kind: 'table' | 'view' }[]>
  describeTable(schema: string, name: string): Promise<TableInfo>
  read(sql: string, max: number): Promise<Result>
  write(sql: string): Promise<{ affected: number; commit(): Promise<void>; rollback(): Promise<void> }>
  cancel(): Promise<void>
  close(): Promise<void>
}

interface Result {
  columns: string[]
  rows: unknown[][]      // arrays, not objects: duplicate column names in joins must not collide
  truncated: boolean
  ms: number
}

interface TableInfo {
  columns: { name: string; type: string; nullable: boolean; default: string | null }[]
  primaryKey: string[]
  foreignKeys: { columns: string[]; refTable: string; refColumns: string[] }[]
  indexes: { name: string; columns: string[]; unique: boolean }[]
}
```

State lives in `App.tsx` via `useState`/`useReducer`. No store library. Child
components are props-in, callbacks-out and never touch the adapter.

Sidebar data comes from one `information_schema` query at startup and on `r`.

## Config

`~/.config/tron/config.json`:

```json
{
  "connections": {
    "prod":  { "url": "postgres://app@db.prod.internal:5432/app?password=$TRON_PROD_PW" },
    "local": { "url": "postgres://localhost/app" }
  }
}
```

- `$VAR` anywhere in `url` is expanded from `process.env` at load time.
- Unset variable → hard error naming the variable. Never an empty password.
- `tron <profile>` selects. No arg and exactly one connection → use it.
  Otherwise print profile names and exit 1.
- Missing or malformed file → error with the expected path, exit 1.

CLI args parsed with `node:util.parseArgs`. No arg-parsing dependency.

## Error handling

- Connection failure at startup: print driver message, exit 1, no TUI.
- Query error: shown in the grid pane in red with Postgres' position hint.
  Search bar text is preserved. App never crashes on a query error.
- Connection dropped mid-session: status bar red, `r` reconnects.
- Uncommitted write on quit: `q` (or `Ctrl-C`) rolls back, then exits.

## Testing

- `node --test` on `sql.ts` (classification, comment stripping, ~10 cases) and
  `config.ts` (env expansion, missing var, missing profile, single-profile default).
- One `ink-testing-library` render test on `Grid` covering truncation and scroll offset.
- Adapter verified by hand against a local Postgres. No Docker harness in v1.

## Distribution

`tsc` → `dist/`. `npm link` locally. `npm i -g github:luctst/tron` for others.
Node 22+.

## Non-goals for v1

Cell editing, CSV export, autocomplete, persisted query history, multiple tabs,
saved queries, MySQL/SQLite/MongoDB adapters. Each is a clean follow-up behind
the adapter interface or a single UI component.
