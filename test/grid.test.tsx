import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render } from 'ink-testing-library'
import { Grid, fit, formatCell } from '../src/ui/Grid.js'
import { scrollTo } from '../src/ui/scroll.js'

const tick = () => new Promise((r) => setTimeout(r, 30))
const columns = ['id', 'name']
const rows: unknown[][] = [
  [1, 'a'.repeat(40)],
  [2, 'bob'],
  [3, 'carol'],
]

test('scrollTo keeps the cursor inside the viewport', () => {
  assert.equal(scrollTo(0, 0, 5), 0)
  assert.equal(scrollTo(4, 0, 5), 0)
  assert.equal(scrollTo(5, 0, 5), 1)
  assert.equal(scrollTo(2, 4, 5), 2)
})

test('formatCell renders null, dates and objects', () => {
  assert.equal(formatCell(null), 'NULL')
  assert.equal(formatCell(new Date('2026-09-14T00:00:00Z')), '2026-09-14T00:00:00.000Z')
  assert.equal(formatCell({ a: 1 }), '{"a":1}')
  assert.equal(formatCell('two\nlines'), 'two lines')
})

test('fit truncates with an ellipsis and pads short values', () => {
  assert.equal(fit('abcdef', 4), 'abc…')
  assert.equal(fit('ab', 4), 'ab  ')
})

test('long cells are truncated to the column cap', () => {
  const { lastFrame } = render(<Grid columns={columns} rows={rows} width={60} height={5} active />)
  const frame = lastFrame() ?? ''
  assert.match(frame, /a{29}…/)
  assert.doesNotMatch(frame, /a{31}/)
})

test('j scrolls the selection into view', async () => {
  const { lastFrame, stdin } = render(<Grid columns={columns} rows={rows} width={60} height={3} active />)
  assert.match(lastFrame() ?? '', /bob/)
  assert.doesNotMatch(lastFrame() ?? '', /carol/)
  stdin.write('j')
  await tick()
  stdin.write('j')
  await tick()
  assert.match(lastFrame() ?? '', /carol/)
})

test('Enter opens a popup with the full value and any key closes it', async () => {
  const { lastFrame, stdin } = render(<Grid columns={columns} rows={rows} width={60} height={6} active />)
  stdin.write('l')
  await tick()
  stdin.write('\r')
  await tick()
  assert.match(lastFrame() ?? '', /a{40}/)
  stdin.write('x')
  await tick()
  assert.doesNotMatch(lastFrame() ?? '', /a{40}/)
})
