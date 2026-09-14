import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render } from 'ink-testing-library'
import type { Adapter, TableInfo } from '../src/db/adapter.js'
import { App } from '../src/ui/App.js'

const tick = () => new Promise((r) => setTimeout(r, 60))
const CTRL_C = ''

const EMPTY_INFO: TableInfo = { columns: [], primaryKey: [], foreignKeys: [], indexes: [] }

/** Records every commit/rollback the confirm gate sends, so a test can assert on the exact verb. */
function fakeAdapter() {
  const calls: string[] = []
  const db: Adapter = {
    listTables: async () => [],
    describeTable: async () => EMPTY_INFO,
    read: async () => ({ columns: [], rows: [], truncated: false, ms: 0 }),
    write: async () => ({
      affected: 3,
      commit: async () => void calls.push('commit'),
      rollback: async () => void calls.push('rollback'),
    }),
    cancel: async () => {},
    close: async () => {},
  }
  return { db, calls }
}

/** Renders App, runs a write from the search bar and waits for the confirm gate. */
async function pendingWrite() {
  const { db, calls } = fakeAdapter()
  const r = render(<App db={db} profile="t" />)
  await tick()
  r.stdin.write('/')
  await tick()
  r.stdin.write('update t set a = 1\r')
  await tick()
  return { ...r, calls }
}

// Every test unmounts: a pending write keeps App's elapsed-timer interval alive, which would
// otherwise hold the test runner open.
test('a write stops at the confirm gate before committing', async () => {
  const { lastFrame, calls, unmount } = await pendingWrite()
  assert.match(lastFrame() ?? '', /commit\?/)
  assert.deepEqual(calls, [])
  unmount()
})

test('y commits', async () => {
  const { stdin, lastFrame, calls, unmount } = await pendingWrite()
  stdin.write('y')
  await tick()
  assert.deepEqual(calls, ['commit'])
  assert.match(lastFrame() ?? '', /committed/)
  unmount()
})

test('n rolls back', async () => {
  const { stdin, lastFrame, calls, unmount } = await pendingWrite()
  stdin.write('n')
  await tick()
  assert.deepEqual(calls, ['rollback'])
  assert.match(lastFrame() ?? '', /rolled back/)
  unmount()
})

test('q rolls back and quits', async () => {
  const { stdin, calls, unmount } = await pendingWrite()
  stdin.write('q')
  await tick()
  assert.deepEqual(calls, ['rollback'])
  unmount()
})

test('Ctrl-C rolls back and quits', async () => {
  const { stdin, calls, unmount } = await pendingWrite()
  stdin.write(CTRL_C)
  await tick()
  assert.deepEqual(calls, ['rollback'])
  unmount()
})
