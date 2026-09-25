import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render } from 'ink-testing-library'
import { Sidebar, buildLines } from '../src/ui/Sidebar.js'
import type { TableRef } from '../src/db/adapter.js'

const tick = () => new Promise((r) => setTimeout(r, 30))
const tables: TableRef[] = [
  { schema: 'audit', name: 'events', kind: 'table' },
  { schema: 'public', name: 'orders', kind: 'table' },
  { schema: 'public', name: 'users', kind: 'view' },
]
const noop = () => {}
const names = (lines: ReturnType<typeof buildLines>) => lines.map((l) => (l.kind === 'schema' ? l.schema : '  ' + l.ref.name))

test('buildLines groups by schema, filters by substring, honours collapse', () => {
  assert.deepEqual(names(buildLines(tables, '', new Set())), ['audit', '  events', 'public', '  orders', '  users'])
  assert.deepEqual(names(buildLines(tables, 'ORD', new Set())), ['public', '  orders'])
  assert.deepEqual(names(buildLines(tables, '', new Set(['public']))), ['audit', '  events', 'public'])
})

test('j then Enter opens the second line', async () => {
  const opened: TableRef[] = []
  const { stdin } = render(
    <Sidebar tables={tables} selected={null} active width={20} height={10} onOpen={(t) => opened.push(t)} onLeave={noop} onCapture={noop} />,
  )
  stdin.write('j')
  await tick()
  stdin.write('\r')
  await tick()
  assert.deepEqual(opened, [tables[0]])
})

test('f enters filter mode and narrows the list', async () => {
  const captured: boolean[] = []
  const { stdin, lastFrame } = render(
    <Sidebar tables={tables} selected={null} active width={20} height={10} onOpen={noop} onLeave={noop} onCapture={(on) => captured.push(on)} />,
  )
  stdin.write('f')
  await tick()
  stdin.write('use')
  await tick()
  assert.match(lastFrame() ?? '', /users/)
  assert.doesNotMatch(lastFrame() ?? '', /orders/)
  assert.deepEqual(captured, [true])
  stdin.write('\r')
  await tick()
  assert.deepEqual(captured, [true, false])
})

test('views are marked', () => {
  const { lastFrame } = render(
    <Sidebar tables={tables} selected={null} active width={20} height={10} onOpen={noop} onLeave={noop} onCapture={noop} />,
  )
  assert.match(lastFrame() ?? '', /users \(v\)/)
})

test('h on a table row collapses its schema and moves the cursor to the header', async () => {
  const opened: TableRef[] = []
  const { stdin, lastFrame } = render(
    <Sidebar tables={tables} selected={null} active width={20} height={10} onOpen={(t) => opened.push(t)} onLeave={noop} onCapture={noop} />,
  )
  stdin.write('j')
  await tick()
  stdin.write('h')
  await tick()
  assert.doesNotMatch(lastFrame() ?? '', /events/)
  stdin.write('\r')
  await tick()
  assert.deepEqual(opened, [])
  assert.match(lastFrame() ?? '', /events/)
})

test('h on an already collapsed schema keeps it collapsed', async () => {
  const { stdin, lastFrame } = render(
    <Sidebar tables={tables} selected={null} active width={20} height={10} onOpen={noop} onLeave={noop} onCapture={noop} />,
  )
  stdin.write('h')
  await tick()
  stdin.write('h')
  await tick()
  assert.doesNotMatch(lastFrame() ?? '', /events/)
})

test('filtering after scrolling deep keeps the top of the shorter list visible', async () => {
  const many: TableRef[] = Array.from({ length: 40 }, (_, i) => ({ schema: 'big', name: `t${String(i).padStart(2, '0')}`, kind: 'table' as const }))
  const { stdin, lastFrame } = render(
    <Sidebar tables={many} selected={null} active width={20} height={10} onOpen={noop} onLeave={noop} onCapture={noop} />,
  )
  stdin.write('G')
  await tick()
  stdin.write('f')
  await tick()
  stdin.write('t00')
  await tick()
  assert.match(lastFrame() ?? '', /big/)
  assert.match(lastFrame() ?? '', /t00/)
})

test('typing a filter selects the first match and Enter opens it', async () => {
  const opened: TableRef[] = []
  const captured: boolean[] = []
  const { stdin } = render(
    <Sidebar tables={tables} selected={null} active width={20} height={10} onOpen={(t) => opened.push(t)} onLeave={noop} onCapture={(on) => captured.push(on)} />,
  )
  stdin.write('f')
  await tick()
  stdin.write('rs')
  await tick()
  stdin.write('\r')
  await tick()
  assert.deepEqual(opened, [tables[1]])
  assert.deepEqual(captured, [true, false])
})

test('↑ and ↓ move between matches while filtering; Enter with no match opens nothing', async () => {
  const opened: TableRef[] = []
  const { stdin } = render(
    <Sidebar tables={tables} selected={null} active width={20} height={10} onOpen={(t) => opened.push(t)} onLeave={noop} onCapture={noop} />,
  )
  stdin.write('f')
  await tick()
  stdin.write('rs')
  await tick()
  stdin.write('\u001B[B')
  await tick()
  stdin.write('\r')
  await tick()
  assert.deepEqual(opened, [tables[2]])
  stdin.write('f')
  await tick()
  stdin.write('zzz')
  await tick()
  stdin.write('\r')
  await tick()
  assert.deepEqual(opened, [tables[2]])
})

test('filter keys written before a re-render all land', async () => {
  const opened: TableRef[] = []
  const { stdin } = render(
    <Sidebar tables={tables} selected={null} active width={20} height={10} onOpen={(t) => opened.push(t)} onLeave={noop} onCapture={noop} />,
  )
  stdin.write('f')
  await tick()
  stdin.write('u')
  stdin.write('s')
  await tick()
  stdin.write('\r')
  await tick()
  assert.deepEqual(opened, [tables[2]])
})
