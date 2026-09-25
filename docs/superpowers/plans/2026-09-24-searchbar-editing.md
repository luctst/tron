# Search Bar Line Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the SQL search bar a movable cursor and the editing keys macOS users expect (arrows, ⌥-word jumps, line start/end, word and line deletion), as Terminal.app actually delivers them.

**Architecture:** `src/ui/SearchBar.tsx` switches from an append-only string to a `Line` (`{ text, cursor }`). Editing is done by small pure exported functions in the same file (`wordLeft`, `wordRight`, `moveTo`, `cut`, `insert`, `visible`), unit-tested directly; the `useInput` handler only maps keys to those functions. Rendering shows a window of the line that always contains the cursor, sized by a new `width` prop that `App.tsx` supplies.

**Tech Stack:** TypeScript, Ink 7.1.1 (`useInput`, `usePaste`), `node:test`, `ink-testing-library`.

**Spec:** none on disk. This is a bounded change whose design was approved in chat on 2026-09-24; the design is restated in "Design" below and this plan is the only artifact.

## Global Constraints

- Runtime dependencies stay exactly `ink`, `react`, `postgres`. No new dev dependencies either.
- pnpm only (`pnpm test`, `pnpm build`); never `npm install`.
- ESM; relative imports carry `.js` even from `.tsx`.
- Tests run from compiled output: `pnpm build && node --test dist/test/searchbar.test.js`.
- UI tests drive real stdin bytes and assert on `lastFrame()` or on callbacks, never internal state.
- Micro commits, one logical change each; the message says why.
- Work on branch `searchbar-editing`; merge to `main` only after the final review.
- Non-goals: undo, selection, copy, multi-line editing, grapheme-aware cursor movement.

## Design

Key bytes, verified by probing Ink 7.1.1's parser in this repo (`input` / `key` flags):

| Key (Terminal.app) | Bytes | Ink reports | Action |
|---|---|---|---|
| ← / → | `ESC[D` / `ESC[C` | `leftArrow` / `rightArrow` | one character |
| ⌥← / ⌥→ | `ESC b` / `ESC f` | `meta`, input `b` / `f` | one word |
| ⌥← / ⌥→ (xterm-style terminals) | `ESC[1;3D` / `ESC[1;3C` | `meta` + `leftArrow` / `rightArrow` | one word |
| Ctrl-A / Ctrl-E | `\x01` / `\x05` | `ctrl`, input `a` / `e` | line start / end |
| Home / End | `ESC[H`, `ESC[1~` / `ESC[F`, `ESC[4~` | `home` / `end` | line start / end |
| Backspace | `\x7f` | `backspace` | delete char before cursor |
| fn-Delete | `ESC[3~` | `delete` | delete char after cursor |
| ⌥Backspace | `ESC \x7f` | `meta` + `backspace` | delete word before cursor |
| Ctrl-W | `\x17` | `ctrl`, input `w` | delete word before cursor |
| Ctrl-U | `\x15` | `ctrl`, input `u` | delete to line start |
| Ctrl-K | `\x0b` | `ctrl`, input `k` | delete to line end |

A "word" is a run of `\w` characters, so `users.id` is two words, matching macOS ⌥← and readline `backward-word`. ⌘ combinations never reach the program in Terminal.app; the README points to Ctrl-A / Ctrl-E instead.

`lastFrame()` in tests carries no ANSI codes (verified: `<Text inverse>` renders as plain text), so cursor position is tested by where typed text lands, and the visible window by frame text.

## Review Focus

1. A query longer than the bar, with the cursor moved to the start: the start of the query and the cursor must be on screen (today's `truncate-start` would hide it). Test in Task 4.
2. Keys that arrive before React re-renders (a burst like `←` then `b` in one tick) must apply in order against the latest line, not a stale closure. Test in Task 2.
3. Movement and deletion at the edges (← at 0, → at end, Backspace at 0, fn-Delete at end) are no-ops, never corrupt the text. Tests in Tasks 2 and 3.
4. `ESC b` / `ESC f` must be word jumps, not "Esc leaves the search bar" followed by typing `b`. Test in Task 2.
5. On a French/AZERTY Mac, ⌥ types `| [ ] { }` as plain characters (no `meta` flag); they must still insert. Test in Task 2; the README warns that turning on "Use Option as Meta key" would break those symbols.

---

### Task 0: Branch

- [ ] **Step 1: Create the branch and commit this plan**

```bash
git switch -c searchbar-editing
git add docs/superpowers/plans/2026-09-24-searchbar-editing.md
git commit -m "Plan cursor editing for the search bar before touching it"
```

---

### Task 1: Pure line-editing helpers

**Files:**
- Modify: `src/ui/SearchBar.tsx` (add exports above `SearchBar`)
- Test: `test/searchbar.test.tsx`

**Interfaces:**
- Consumes: `clamp(n, lo, hi)` from `src/ui/scroll.ts`.
- Produces (all exported from `src/ui/SearchBar.tsx`):
  - `interface Line { text: string; cursor: number }`
  - `wordLeft(text: string, i: number): number`
  - `wordRight(text: string, i: number): number`
  - `moveTo(l: Line, to: number): Line` (clamps `to` to `[0, text.length]`)
  - `cut(l: Line, to: number): Line` (deletes between cursor and clamped `to`, either side; cursor lands at the lower end)
  - `insert(l: Line, s: string): Line`

- [ ] **Step 1: Write the failing tests**

Change the import at the top of `test/searchbar.test.tsx`:

```tsx
import { SearchBar, cut, insert, moveTo, wordLeft, wordRight } from '../src/ui/SearchBar.js'
```

Append:

```tsx
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build`
Expected: tsc fails with `TS2305: Module '"../src/ui/SearchBar.js"' has no exported member 'cut'` (and the other four names).

- [ ] **Step 3: Implement**

In `src/ui/SearchBar.tsx`, add the import and the helpers after `normalizePaste`:

```tsx
import { clamp } from './scroll.js'
```

```tsx
export interface Line {
  text: string
  cursor: number
}

// ponytail: indexes are UTF-16 code units, so an emoji takes two ← presses; use Intl.Segmenter if non-BMP text shows up in SQL.
const WORD = /\w/

/** Start of the word left of `i`, skipping separators first, as ⌥← does. */
export function wordLeft(text: string, i: number): number {
  while (i > 0 && !WORD.test(text[i - 1])) i--
  while (i > 0 && WORD.test(text[i - 1])) i--
  return i
}

/** End of the word right of `i`, as ⌥→ does. */
export function wordRight(text: string, i: number): number {
  while (i < text.length && !WORD.test(text[i])) i++
  while (i < text.length && WORD.test(text[i])) i++
  return i
}

export function moveTo(l: Line, to: number): Line {
  return { text: l.text, cursor: clamp(to, 0, l.text.length) }
}

/** Deletes between the cursor and `to`, on either side; the cursor lands where the gap starts. */
export function cut(l: Line, to: number): Line {
  const t = clamp(to, 0, l.text.length)
  const [a, b] = t < l.cursor ? [t, l.cursor] : [l.cursor, t]
  return { text: l.text.slice(0, a) + l.text.slice(b), cursor: a }
}

export function insert(l: Line, s: string): Line {
  return { text: l.text.slice(0, l.cursor) + s + l.text.slice(l.cursor), cursor: l.cursor + s.length }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm build && node --test dist/test/searchbar.test.js`
Expected: all tests pass, including the 5 existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/ui/SearchBar.tsx test/searchbar.test.tsx
git commit -m "Add pure line-editing helpers so cursor keys can be tested without a terminal"
```

---

### Task 2: Cursor state and movement keys

**Files:**
- Modify: `src/ui/SearchBar.tsx` (the `SearchBar` component)
- Test: `test/searchbar.test.tsx`

**Interfaces:**
- Consumes: `Line`, `wordLeft`, `wordRight`, `moveTo`, `cut`, `insert` from Task 1.
- Produces: `SearchBar` keeps its props (`active`, `history`, `onRun`, `onLeave`); internal state becomes `line: Line`. Task 3 adds key branches to the same `useInput` handler; Task 4 changes only the returned JSX.

- [ ] **Step 1: Write the failing tests**

Add constants next to the existing ones at the top of `test/searchbar.test.tsx`:

```tsx
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
```

Append:

```tsx
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build && node --test dist/test/searchbar.test.js`
Expected: the new movement tests fail, e.g. `'acb' !== 'abc'` for the first one (arrows are ignored today). The AZERTY test and the "before a re-render" test may already pass; that is fine, they pin behavior this task must keep.

- [ ] **Step 3: Implement**

Replace the `SearchBar` function in `src/ui/SearchBar.tsx` with:

```tsx
const atEnd = (text: string): Line => ({ text, cursor: text.length })

export function SearchBar({ active, history, onRun, onLeave }: Props) {
  const [line, setLine] = useState<Line>(atEnd(''))
  const [draft, setDraft] = useState('')
  const [idx, setIdx] = useState(-1) // -1 = editing the draft, 0 = newest history entry

  useEffect(() => setIdx(-1), [history.length])

  const recall = (next: number) => {
    if (next < -1 || next >= history.length) return
    if (idx === -1) setDraft(line.text)
    setIdx(next)
    setLine(atEnd(next === -1 ? draft : history[history.length - 1 - next]))
  }

  useInput(
    (input, key) => {
      if (key.return) {
        const sql = line.text.trim()
        if (sql) onRun(sql)
        return
      }
      if (key.escape) return onLeave()
      if (key.upArrow) return recall(idx + 1)
      if (key.downArrow) return recall(idx - 1)
      // Terminal.app sends ⌥← ⌥→ as ESC b / ESC f; xterm-style terminals send meta+arrow.
      if (key.meta && (key.leftArrow || input === 'b')) return setLine((l) => moveTo(l, wordLeft(l.text, l.cursor)))
      if (key.meta && (key.rightArrow || input === 'f')) return setLine((l) => moveTo(l, wordRight(l.text, l.cursor)))
      if (key.leftArrow) return setLine((l) => moveTo(l, l.cursor - 1))
      if (key.rightArrow) return setLine((l) => moveTo(l, l.cursor + 1))
      if (key.home || (key.ctrl && input === 'a')) return setLine((l) => moveTo(l, 0))
      if (key.end || (key.ctrl && input === 'e')) return setLine((l) => moveTo(l, l.text.length))
      if (key.backspace || key.delete) return setLine((l) => cut(l, l.cursor - 1))
      if (key.ctrl && input === 'u') return setLine(atEnd(''))
      if (key.ctrl || key.meta || key.tab || !input) return
      if (/[\r\n]/.test(input)) {
        // Ink hands coalesced keystrokes to us as one chunk: `text\r` is text followed by Enter.
        const [head] = input.split(/\r|\n/)
        const next = insert(line, head)
        setLine(next)
        const sql = next.text.trim()
        if (sql) onRun(sql)
        return
      }
      setLine((l) => insert(l, input))
    },
    { isActive: active },
  )

  usePaste((text) => setLine((l) => insert(l, normalizePaste(text))), { isActive: active })

  return (
    <Text wrap="truncate-start">
      {'> '}
      {line.text}
      {active ? <Text inverse> </Text> : null}
    </Text>
  )
}
```

Backspace and Ctrl-U keep today's behavior here; Task 3 makes them cursor-aware. The render is unchanged until Task 4.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm build && node --test dist/test/searchbar.test.js`
Expected: all tests pass, including the 5 original ones.

- [ ] **Step 5: Commit**

```bash
git add src/ui/SearchBar.tsx test/searchbar.test.tsx
git commit -m "Let the search bar cursor move by character, word and line so queries can be fixed in place"
```

---

### Task 3: Deletion keys

**Files:**
- Modify: `src/ui/SearchBar.tsx` (the `useInput` handler only)
- Test: `test/searchbar.test.tsx`

**Interfaces:**
- Consumes: `cut`, `wordLeft` (Task 1); `typed`, `LEFT`, `CTRL_A`, `OPT_LEFT` (Task 2 test helpers).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

Add constants at the top of `test/searchbar.test.tsx`:

```tsx
const BS = '\u007F'
const FN_DEL = `${ESC}[3~`
const OPT_BS = `${ESC}\u007F`
const CTRL_W = '\u0017'
const CTRL_K = '\u000B'
```

Append:

```tsx
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build && node --test dist/test/searchbar.test.js`
Expected: the fn-Delete, ⌥Backspace, Ctrl-W, Ctrl-U and Ctrl-K cases fail (e.g. fn-Delete gives `'aXc'`, Ctrl-U gives `''` so no run and `'' !== 'users'`).

- [ ] **Step 3: Implement**

In the `useInput` handler, replace these two lines:

```tsx
      if (key.backspace || key.delete) return setLine((l) => cut(l, l.cursor - 1))
      if (key.ctrl && input === 'u') return setLine(atEnd(''))
```

with:

```tsx
      if ((key.meta && key.backspace) || (key.ctrl && input === 'w')) return setLine((l) => cut(l, wordLeft(l.text, l.cursor)))
      if (key.backspace) return setLine((l) => cut(l, l.cursor - 1))
      if (key.delete) return setLine((l) => cut(l, l.cursor + 1))
      if (key.ctrl && input === 'u') return setLine((l) => cut(l, 0))
      if (key.ctrl && input === 'k') return setLine((l) => cut(l, l.text.length))
```

The meta+backspace line must stay above the plain backspace line.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm build && node --test dist/test/searchbar.test.js`
Expected: all pass. The original "Escape leaves, Ctrl-U clears" still passes because the cursor is at the end there.

- [ ] **Step 5: Commit**

```bash
git add src/ui/SearchBar.tsx test/searchbar.test.tsx
git commit -m "Make search bar deletion cursor-aware and add word and kill-line keys"
```

---

### Task 4: Cursor rendering, width, README

**Files:**
- Modify: `src/ui/SearchBar.tsx` (`Props`, add `visible`, returned JSX)
- Modify: `src/ui/App.tsx:281` (pass `width`)
- Modify: `README.md:56-59` (search bar key rows)
- Test: `test/searchbar.test.tsx`

**Interfaces:**
- Consumes: `Line` (Task 1), `line` state (Task 2).
- Produces: `visible(l: Line, width: number): { before: string; at: string; after: string }`; `SearchBar` prop `width?: number` (default 80), the columns available inside the bar including the `> ` prompt.

- [ ] **Step 1: Write the failing tests**

Add `visible` to the import from `'../src/ui/SearchBar.js'` and append:

```tsx
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build`
Expected: tsc fails with `TS2305: ... has no exported member 'visible'` and `Property 'width' does not exist on type 'IntrinsicAttributes & Props'`.

- [ ] **Step 3: Implement**

In `src/ui/SearchBar.tsx`, add `width` to `Props`:

```tsx
interface Props {
  active: boolean
  history: string[]
  width?: number
  onRun(sql: string): void
  onLeave(): void
}
```

Add after `insert`:

```tsx
/** The `width` cells around the cursor; the cell after the text is where the next character goes. */
export function visible(l: Line, width: number): { before: string; at: string; after: string } {
  const w = Math.max(1, width)
  const start = Math.max(0, l.cursor - w + 1)
  const cells = (l.text + ' ').slice(start, start + w)
  const at = l.cursor - start
  return { before: cells.slice(0, at), at: cells[at], after: cells.slice(at + 1) }
}
```

Change the signature to `export function SearchBar({ active, history, width = 80, onRun, onLeave }: Props)` and replace the returned JSX with:

```tsx
  const v = visible(line, width - 2) // 2 = the '> ' prompt
  return (
    <Text wrap="truncate-end">
      {'> '}
      {v.before}
      {active ? <Text inverse>{v.at}</Text> : v.at}
      {v.after}
    </Text>
  )
```

In `src/ui/App.tsx`, line 281, add `width={size.cols - 4}` (single border 2 + `paddingX={1}` 2):

```tsx
        <SearchBar active={focus === 'search' && pending === null} history={history} width={size.cols - 4} onRun={(s) => void runSql(s)} onLeave={() => setFocus('grid')} />
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: every test file passes (the app tests render `App`, so they cover the new prop wiring).

- [ ] **Step 5: Commit the code**

```bash
git add src/ui/SearchBar.tsx src/ui/App.tsx test/searchbar.test.tsx
git commit -m "Scroll the search bar around the cursor so long queries stay editable"
```

- [ ] **Step 6: Update the README key table**

In `README.md`, replace the rows

```
| search bar | `Ctrl-U` | clear |
```

with:

```
| search bar | `←` `→` | move one character |
| search bar | `⌥←` `⌥→` | move one word |
| search bar | `Ctrl-A` `Ctrl-E`, `Home` `End` | start / end of line |
| search bar | `Backspace`, `fn-Delete` | delete before / after the cursor |
| search bar | `⌥Backspace`, `Ctrl-W` | delete the word before the cursor |
| search bar | `Ctrl-U` / `Ctrl-K` | delete to start / end of line |
```

and add directly below the table:

```markdown
Terminal.app does not pass `⌘` keys to programs, so `⌘←` / `⌘→` do nothing; use `Ctrl-A` / `Ctrl-E`. `⌥Backspace` needs "Use Option as Meta key" (Settings → Profiles → Keyboard); leave it off if your layout types `| [ ] { }` with `⌥` (AZERTY does) and use `Ctrl-W` instead.
```

- [ ] **Step 7: Manual check in Terminal.app**

Run: `pnpm build && pnpm add --global .`, open Terminal.app, `tron <profile>`, press `/`, and try every row of the new table on a line like `select id from users where id = 1`. If a key does nothing, find its bytes with `od -c` (type the key, then Enter, then Ctrl-D) and correct the README sentence to match. The unit tests fix the byte-to-action mapping; only this step confirms what Terminal.app sends.

- [ ] **Step 8: Commit the docs**

```bash
git add README.md
git commit -m "Document the search bar editing keys and what Terminal.app withholds"
```
