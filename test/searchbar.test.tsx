import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render } from 'ink-testing-library'
import { SearchBar, cut, insert, moveTo, wordLeft, wordRight } from '../src/ui/SearchBar.js'

const tick = () => new Promise((r) => setTimeout(r, 30))
const ESC = '\u001B'
const UP = `${ESC}[A`
const DOWN = `${ESC}[B`
const CTRL_U = '\u0015'

test('Enter runs the trimmed text and empty input is ignored', async () => {
  const runs: string[] = []
  const { stdin } = render(<SearchBar active history={[]} onRun={(s) => runs.push(s)} onLeave={() => {}} />)
  stdin.write('\r')
  await tick()
  stdin.write('  select 1  ')
  await tick()
  stdin.write('\r')
  await tick()
  assert.deepEqual(runs, ['select 1'])
})

test('Up recalls history newest first, Down returns to the draft', async () => {
  const { stdin, lastFrame } = render(
    <SearchBar active history={['select old', 'select new']} onRun={() => {}} onLeave={() => {}} />,
  )
  stdin.write('draft')
  await tick()
  stdin.write(UP)
  await tick()
  assert.match(lastFrame() ?? '', /select new/)
  stdin.write(UP)
  await tick()
  assert.match(lastFrame() ?? '', /select old/)
  stdin.write(DOWN)
  await tick()
  stdin.write(DOWN)
  await tick()
  assert.match(lastFrame() ?? '', /draft/)
})

test('Escape leaves, Ctrl-U clears', async () => {
  let left = 0
  const { stdin, lastFrame } = render(<SearchBar active history={[]} onRun={() => {}} onLeave={() => left++} />)
  stdin.write('abc')
  await tick()
  stdin.write(CTRL_U)
  await tick()
  assert.doesNotMatch(lastFrame() ?? '', /abc/)
  stdin.write(ESC)
  await tick()
  assert.equal(left, 1)
})

test('a coalesced chunk ending in Enter still runs', async () => {
  const runs: string[] = []
  const { stdin } = render(<SearchBar active history={[]} onRun={(s) => runs.push(s)} onLeave={() => {}} />)
  stdin.write('select 2\r')
  await tick()
  assert.deepEqual(runs, ['select 2'])
})

test('a pasted statement drops -- comments before it is flattened to one line', async () => {
  const { stdin, lastFrame } = render(<SearchBar active history={[]} onRun={() => {}} onLeave={() => {}} />)
  stdin.write('\u001B[200~select id -- pk\nfrom users\u001B[201~')
  await tick()
  assert.match((lastFrame() ?? '').replace(/ +/g, ' '), /select id from users/)
})

test('wordLeft and wordRight skip separators, then one run of word characters', () => {
  const t = 'from users.id'
  assert.equal(wordLeft(t, t.length), 11)
  assert.equal(wordLeft(t, 11), 5)
  assert.equal(wordLeft(t, 5), 0)
  assert.equal(wordLeft(t, 0), 0)
  assert.equal(wordRight(t, 0), 4)
  assert.equal(wordRight(t, 4), 10)
  assert.equal(wordRight(t, 10), 13)
  assert.equal(wordRight(t, 13), 13)
})

test('moveTo clamps, cut deletes toward either side, insert lands at the cursor', () => {
  const l = { text: 'abcd', cursor: 2 }
  assert.deepEqual(moveTo(l, -5), { text: 'abcd', cursor: 0 })
  assert.deepEqual(moveTo(l, 99), { text: 'abcd', cursor: 4 })
  assert.deepEqual(cut(l, 0), { text: 'cd', cursor: 0 })
  assert.deepEqual(cut(l, 4), { text: 'ab', cursor: 2 })
  assert.deepEqual(cut(l, 1), { text: 'acd', cursor: 1 })
  assert.deepEqual(cut({ text: 'ab', cursor: 0 }, -1), { text: 'ab', cursor: 0 })
  assert.deepEqual(cut({ text: 'ab', cursor: 2 }, 3), { text: 'ab', cursor: 2 })
  assert.deepEqual(insert(l, 'XY'), { text: 'abXYcd', cursor: 4 })
})
