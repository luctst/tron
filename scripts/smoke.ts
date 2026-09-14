import { openPostgres } from '../src/db/postgres.js'

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5499/postgres'
const db = await openPostgres(url)
const ok = (label: string, cond: boolean) => console.log(cond ? 'ok  ' : 'FAIL', label)

const tables = await db.listTables()
ok('listTables finds smoke_users', tables.some((t) => t.name === 'smoke_users' && t.schema === 'public'))

const info = await db.describeTable('public', 'smoke_orders')
ok('describeTable columns', info.columns.map((c) => c.name).join(',') === 'id,user_id,total')
ok('describeTable pk', info.primaryKey.join(',') === 'id')
ok('describeTable fk', info.foreignKeys[0]?.refTable === 'public.smoke_users' && info.foreignKeys[0]?.columns[0] === 'user_id')
ok('describeTable index', info.indexes.some((i) => i.name === 'smoke_orders_user_idx' && !i.unique))

const big = await db.read('select generate_series(1, 1000) as n', 500)
ok('read caps at 500 and flags truncated', big.rows.length === 500 && big.truncated && big.columns[0] === 'n')

const small = await db.read('select 1 as a, 2 as a', 500)
ok('read keeps duplicate column names positional', small.columns.join(',') === 'a,a' && small.rows[0]?.join(',') === '1,2')

await db.read('delete from smoke_users', 500).then(
  () => ok('read-only transaction blocks a delete', false),
  (e: Error) => ok('read-only transaction blocks a delete', /read-only transaction/.test(e.message)),
)

const w = await db.write("insert into smoke_users(name) values ('a'), ('b'); update smoke_users set name = 'z'")
ok('write reports affected rows across statements', w.affected === 2 + 3)
await w.rollback()
const after = await db.read('select count(*)::int from smoke_users', 1)
ok('rollback leaves the table untouched', after.rows[0]?.[0] === 1)

const w2 = await db.write("insert into smoke_users(name) values ('kept')")
await w2.commit()
const after2 = await db.read('select count(*)::int from smoke_users', 1)
ok('commit persists', after2.rows[0]?.[0] === 2)

const slow = db.read('select pg_sleep(5)', 1)
setTimeout(() => void db.cancel(), 200)
await slow.then(
  () => ok('cancel interrupts a running read', false),
  (e: Error) => ok('cancel interrupts a running read', /cancel/i.test(e.message)),
)

await db.write('create temp table tron_probe(a int); commit').then(
  () => ok('write rejects a batch that ends its own transaction', false),
  (e: Error) => ok('write rejects a batch that ends its own transaction', /ended the transaction/.test(e.message)),
)

await db.close()
