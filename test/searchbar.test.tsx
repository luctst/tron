import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render } from 'ink-testing-library'
import { SearchBar, cut, insert, moveTo, visible, wordLeft, wordRight } from '../src/ui/SearchBar.js'

const tick = () => new Promise((r) => setTimeout(r, 30))
const ESC = '\u001B'
const UP = `${ESC}[A`
const DOWN = `${ESC}[B`
const CTRL_U = '\u0015'
const LEFT = `${ESC}[D`
const RIGHT = `${ESC}[C`
const OPT_LEFT = `${ESC}b` // Terminal.app ⌥←
const OPT_RIGHT = `${ESC}f` // Terminal.app ⌥→
const META_LEFT = `${ESC}[1;3D` // xterm-style ⌥←
const META_RIGHT = `${ESC}[1;3C`
const CTRL_A = '\u0001'
const CTRL_E = '\u0005'
const HOME = `${ESC}[H`
const END = `${ESC}[F`
const BS = '\u007F'
const FN_DEL = `${ESC}[3~`
const OPT_BS = `${ESC}\u007F`
const CTRL_W = '\u0017'
const CTRL_K = '\u000B'
const paste = (s: string) => `${ESC}[200~${s}${ESC}[201~`

/** Writes each chunk in its own tick, presses Enter, returns what ran. */
async function typed(chunks: string[], history: string[] = []): Promise<string> {
  const runs: string[] = []
  const { stdin } = render(<SearchBar active history={history} onRun={(s) => runs.push(s)} onLeave={() => {}} />)
  for (const c of chunks) {
    stdin.write(c)
    await tick()
  }
  stdin.write('\r')
  await tick()
  return runs[0] ?? ''
}

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

test('← and → move one character and typing inserts at the cursor', async () => {
  assert.equal(await typed(['ac', LEFT, 'b']), 'abc')
  assert.equal(await typed(['abc', LEFT, LEFT, RIGHT, 'X']), 'abXc')
})

test('← at the start and → at the end are no-ops', async () => {
  assert.equal(await typed(['b', LEFT, LEFT, LEFT, 'a']), 'ab')
  assert.equal(await typed(['a', RIGHT, RIGHT, 'b']), 'ab')
})

test('⌥← and ⌥→ jump words in both Terminal.app and xterm encodings', async () => {
  assert.equal(await typed(['select users', OPT_LEFT, 'x']), 'select xusers')
  assert.equal(await typed(['select users', META_LEFT, 'x']), 'select xusers')
  assert.equal(await typed(['from users.id', OPT_LEFT, OPT_LEFT, 'x']), 'from xusers.id')
  assert.equal(await typed(['select users', CTRL_A, OPT_RIGHT, '!']), 'select! users')
  assert.equal(await typed(['select users', CTRL_A, META_RIGHT, '!']), 'select! users')
})

test('ESC b is a word jump, not Esc followed by b', async () => {
  let left = 0
  const { stdin, lastFrame } = render(<SearchBar active history={[]} onRun={() => {}} onLeave={() => left++} />)
  stdin.write('select')
  await tick()
  stdin.write(OPT_LEFT)
  await tick()
  assert.equal(left, 0)
  assert.doesNotMatch(lastFrame() ?? '', /b/)
})

test('Ctrl-A / Home go to the start, Ctrl-E / End to the end', async () => {
  assert.equal(await typed(['elect', CTRL_A, 's']), 'select')
  assert.equal(await typed(['elect', HOME, 's']), 'select')
  assert.equal(await typed(['selec', CTRL_A, CTRL_E, 't']), 'select')
  assert.equal(await typed(['selec', HOME, END, 't']), 'select')
})

test('paste inserts at the cursor', async () => {
  assert.equal(await typed(['select  from t', ...Array(7).fill(LEFT), paste('*')]), 'select * from t')
})

test('a recalled history entry puts the cursor at its end', async () => {
  assert.equal(await typed(['x', LEFT, UP, '0'], ['select 1']), 'select 10')
})

test('keys written before a re-render apply in order', async () => {
  const runs: string[] = []
  const { stdin } = render(<SearchBar active history={[]} onRun={(s) => runs.push(s)} onLeave={() => {}} />)
  stdin.write('ac')
  await tick()
  stdin.write(LEFT)
  stdin.write('b')
  await tick()
  stdin.write('\r')
  await tick()
  assert.deepEqual(runs, ['abc'])
})

test('characters typed with ⌥ on AZERTY insert like any other', async () => {
  assert.equal(await typed(['a', '|', '[', '{']), 'a|[{')
})

test('Backspace deletes before the cursor, fn-Delete after it', async () => {
  assert.equal(await typed(['abXc', LEFT, BS]), 'abc')
  assert.equal(await typed(['abXc', LEFT, LEFT, FN_DEL]), 'abc')
})

test('Backspace at the start and fn-Delete at the end are no-ops', async () => {
  assert.equal(await typed(['abc', CTRL_A, BS]), 'abc')
  assert.equal(await typed(['abc', FN_DEL]), 'abc')
})

test('⌥Backspace and Ctrl-W delete the word before the cursor', async () => {
  assert.equal(await typed(['select users.id', OPT_BS]), 'select users.')
  assert.equal(await typed(['select users', CTRL_W, 'orders']), 'select orders')
})

test('Ctrl-U deletes to the start and Ctrl-K to the end of the line', async () => {
  assert.equal(await typed(['select users', OPT_LEFT, CTRL_U]), 'users')
  assert.equal(await typed(['select users', OPT_LEFT, CTRL_K, 'orders']), 'select orders')
})

test('visible keeps the cursor cell on screen and marks the cell after the text', () => {
  assert.deepEqual(visible({ text: 'abc', cursor: 1 }, 10), { before: 'a', at: 'b', after: 'c ' })
  assert.deepEqual(visible({ text: 'abc', cursor: 3 }, 10), { before: 'abc', at: ' ', after: '' })
  assert.deepEqual(visible({ text: 'abcdef', cursor: 6 }, 3), { before: 'ef', at: ' ', after: '' })
  assert.deepEqual(visible({ text: 'abcdef', cursor: 0 }, 3), { before: '', at: 'a', after: 'bc' })
})

test('a long query shows its start when the cursor goes home and its end when it comes back', async () => {
  const { stdin, lastFrame } = render(<SearchBar active history={[]} width={12} onRun={() => {}} onLeave={() => {}} />)
  stdin.write('abcdefghijklmnop')
  await tick()
  assert.equal((lastFrame() ?? '').trimEnd(), '> hijklmnop')
  stdin.write(CTRL_A)
  await tick()
  assert.equal((lastFrame() ?? '').trimEnd(), '> abcdefghij')
})

test('Enter in the same burst as earlier keys runs the line those keys produced', async () => {
  const runs: string[] = []
  const { stdin } = render(<SearchBar active history={[]} onRun={(s) => runs.push(s)} onLeave={() => {}} />)
  stdin.write('ac')
  await tick()
  stdin.write(LEFT)
  stdin.write('x\r')
  await tick()
  stdin.write('b')
  stdin.write('\r')
  await tick()
  assert.deepEqual(runs, ['axc', 'axbc'])
})

test('mid-line the window shows text on both sides of the cursor', async () => {
  assert.deepEqual(visible({ text: 'abcdefghij', cursor: 5 }, 4), { before: 'de', at: 'f', after: 'g' })
  const { stdin, lastFrame } = render(<SearchBar active history={[]} width={12} onRun={() => {}} onLeave={() => {}} />)
  stdin.write('abcdefghijklmnop')
  await tick()
  stdin.write(LEFT + LEFT + LEFT)
  await tick()
  assert.equal((lastFrame() ?? '').trimEnd(), '> hijklmnop')
})
