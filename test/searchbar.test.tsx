import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render } from 'ink-testing-library'
import { SearchBar } from '../src/ui/SearchBar.js'

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
