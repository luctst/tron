import { useEffect, useState } from 'react'
import { Text, useInput, usePaste } from 'ink'
import { clamp } from './scroll.js'

interface Props {
  active: boolean
  history: string[]
  onRun(sql: string): void
  onLeave(): void
}

/** A pasted statement becomes one line, so `-- …` comments must go first or they swallow the rest. */
function normalizePaste(text: string): string {
  return text.replace(/--[^\n]*/g, '').replace(/\s*\r?\n\s*/g, ' ')
}

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
      if ((key.meta && key.backspace) || (key.ctrl && input === 'w')) return setLine((l) => cut(l, wordLeft(l.text, l.cursor)))
      if (key.backspace) return setLine((l) => cut(l, l.cursor - 1))
      if (key.delete) return setLine((l) => cut(l, l.cursor + 1))
      if (key.ctrl && input === 'u') return setLine((l) => cut(l, 0))
      if (key.ctrl && input === 'k') return setLine((l) => cut(l, l.text.length))
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
