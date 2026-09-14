# tron

Terminal database browser for PostgreSQL. Sidebar of tables, grid of rows, SQL bar on top. Writes are confirmed inside a transaction before commit.

## Install

Node 22 or newer.

```bash
git clone <this repo> && cd tron
npm install && npm run build && npm link
```

## Configure

`~/.config/tron/config.json` (or `$XDG_CONFIG_HOME/tron/config.json`):

```json
{
  "connections": {
    "prod":  { "url": "postgres://app@db.prod.internal:5432/app?password=$TRON_PROD_PW" },
    "local": { "url": "postgres://localhost/app" }
  }
}
```

`$VAR` in a URL is read from the environment. An unset variable is an error, never an empty password.

```bash
tron prod      # named connection
tron           # works without a name when there is exactly one
```

## Keys

| Where | Key | Action |
|-------|-----|--------|
| anywhere | `Tab` | cycle sidebar → grid → search bar |
| sidebar, grid | `/` | focus the search bar |
| sidebar, grid | `q` | quit |
| sidebar, grid | `r` | reload tables / reconnect |
| sidebar | `j` `k` `g` `G` | move |
| sidebar | `Enter` `l` | open table (or toggle schema) |
| sidebar | `h` | collapse schema |
| sidebar | `f` | filter by substring, `Enter` keeps it, `Esc` clears |
| grid | `h` `j` `k` `l` `g` `G` | move |
| grid | `Enter` | show the full cell value, any key closes |
| grid | `s` | toggle structure (columns, pk, fk, indexes) |
| grid | `n` `p` | next / previous page of a sidebar-opened table |
| search bar | `Enter` | run |
| search bar | `↑` `↓` | history |
| search bar | `Ctrl-U` | clear |
| search bar | `Esc` | back to the grid |
| anywhere | `Ctrl-C` | cancel the running query, or quit (rolls back a pending write) |
| write pending | `y` | commit |
| write pending | `q` | roll back and quit |
| write pending | anything else | roll back |

`s`, `n`, `p`, `/`, `q` and `r` also work while the sidebar has focus, not just the grid.

## How writes work

Anything that is not `SELECT`, `WITH`, `VALUES`, `TABLE`, `EXPLAIN` or `SHOW` runs inside `BEGIN …` and stops before `COMMIT`. The status bar shows the real affected-row count and a timer, because locks are held while you decide. Reads run in a `READ ONLY` transaction, so a misclassified write is rejected by Postgres itself.

Reads are one statement at a time; `a; b` in a read is rejected by the server.

Reads return at most 500 rows. Tables opened from the sidebar page 100 at a time.

## Development

```bash
npm test            # tsc + node:test
npm run smoke       # adapter check against a Docker Postgres, see scripts/smoke.ts
```
