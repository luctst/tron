import postgres from 'postgres'
import type { Adapter, PendingWrite, Result, TableInfo, TableRef } from './adapter.js'

type Cancellable = { cancel(): void }

export async function openPostgres(url: string): Promise<Adapter> {
  // max 2: one for reads while a reserved write connection waits for confirmation.
  // onnotice: swallow NOTICE output, it would corrupt the TUI.
  const sql = postgres(url, { max: 2, connect_timeout: 10, onnotice: () => {} })
  await sql`select 1` // fail fast with the driver's own message

  let current: Cancellable | null = null

  return {
    async listTables() {
      return sql<TableRef[]>`
        select table_schema as schema, table_name as name,
               case table_type when 'VIEW' then 'view' else 'table' end as kind
        from information_schema.tables
        where table_schema not in ('pg_catalog', 'information_schema')
        order by table_schema, table_name`
    },

    async describeTable(schema, name): Promise<TableInfo> {
      const [columns, pk, foreignKeys, indexes] = await Promise.all([
        sql<TableInfo['columns']>`
          select a.attname as name,
                 format_type(a.atttypid, a.atttypmod) as type,
                 not a.attnotnull as nullable,
                 pg_get_expr(d.adbin, d.adrelid) as "default"
          from pg_attribute a
          join pg_class c on c.oid = a.attrelid
          join pg_namespace n on n.oid = c.relnamespace
          left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where n.nspname = ${schema} and c.relname = ${name} and a.attnum > 0 and not a.attisdropped
          order by a.attnum`,
        sql<{ columns: string[] }[]>`
          select coalesce(array_agg(a.attname::text order by k.ord), '{}'::text[]) as columns
          from pg_index i
          join pg_class c on c.oid = i.indrelid
          join pg_namespace n on n.oid = c.relnamespace
          cross join unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
          where n.nspname = ${schema} and c.relname = ${name} and i.indisprimary`,
        sql<TableInfo['foreignKeys']>`
          select
            (select array_agg(a.attname::text order by k.ord)
               from unnest(con.conkey) with ordinality as k(attnum, ord)
               join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns,
            fn.nspname || '.' || fc.relname as "refTable",
            (select array_agg(a.attname::text order by k.ord)
               from unnest(con.confkey) with ordinality as k(attnum, ord)
               join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as "refColumns"
          from pg_constraint con
          join pg_class c on c.oid = con.conrelid
          join pg_namespace n on n.oid = c.relnamespace
          join pg_class fc on fc.oid = con.confrelid
          join pg_namespace fn on fn.oid = fc.relnamespace
          where con.contype = 'f' and n.nspname = ${schema} and c.relname = ${name}
          order by con.conname`,
        sql<TableInfo['indexes']>`
          select i.relname as name, ix.indisunique as "unique",
            coalesce((select array_agg(a.attname::text order by k.ord)
               from unnest(ix.indkey::int2[]) with ordinality as k(attnum, ord)
               join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k.attnum), '{}'::text[]) as columns
          from pg_index ix
          join pg_class i on i.oid = ix.indexrelid
          join pg_class c on c.oid = ix.indrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = ${schema} and c.relname = ${name}
          order by i.relname`,
      ])
      return { columns, primaryKey: pk[0]?.columns ?? [], foreignKeys, indexes }
    },

    async read(text, max): Promise<Result> {
      const started = performance.now()
      let columns: string[] = []
      let rows: unknown[][] = []
      let truncated = false
      await sql.begin('read only', async (tx) => {
        const q = tx.unsafe(text).values()
        current = q
        try {
          // Ask for max+1 so we can tell "exactly max" from "more than max" without a second fetch.
          for await (const batch of q.cursor(max + 1)) {
            const meta = batch as unknown as { columns?: { name: string }[] }
            columns = (meta.columns ?? []).map((c) => c.name)
            rows = batch as unknown as unknown[][]
            truncated = rows.length > max
            if (truncated) rows = rows.slice(0, max)
            break // closes the portal; the read-only transaction then commits
          }
        } finally {
          current = null
        }
      })
      // ponytail: a result with zero rows carries no column names (postgres.js only yields batches
      // that contain rows). Upgrade path: q.describe() before the cursor if headers on empty results matter.
      return { columns, rows, truncated, ms: Math.round(performance.now() - started) }
    },

    async write(text): Promise<PendingWrite> {
      const r = await sql.reserve()
      try {
        await r.unsafe('begin')
        const before = await touched(r)
        const q = r.unsafe(text) // no params → simple protocol → multi-statement input works
        current = q
        await q
        current = null
        const affected = Math.max(0, (await touched(r)) - before)
        let done = false
        const finish = async (verb: 'commit' | 'rollback') => {
          if (done) return
          done = true
          try {
            await r.unsafe(verb)
          } finally {
            r.release()
          }
        }
        return { affected, commit: () => finish('commit'), rollback: () => finish('rollback') }
      } catch (e) {
        current = null
        await r.unsafe('rollback').catch(() => {})
        r.release()
        throw e
      }
    },

    async cancel() {
      current?.cancel()
    },

    async close() {
      await sql.end({ timeout: 1 })
    },
  }
}

// postgres.js folds a multi-statement simple query into one Result that keeps only the first
// statement's count, so ask the server: rows inserted/updated/deleted so far in this transaction.
// The counter also carries this backend's not-yet-flushed stats from earlier transactions, hence
// the before/after diff in write(). Counts trigger and cascade side effects; 0 if track_counts is off.
async function touched(r: postgres.ReservedSql): Promise<number> {
  const [row] = await r.unsafe<{ n: number }[]>(
    'select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::int as n from pg_stat_xact_user_tables',
  )
  return row?.n ?? 0
}
