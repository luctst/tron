import { useEffect, useRef, useState } from 'react'
import { Text, useInput, usePaste } from 'ink'
import { clamp } from './scroll.js'

interface Props {
  active: boolean
  history: string[]
  width?: number
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

/** The `width` cells around the cursor; the cell after the text is where the next character goes. */
export function visible(l: Line, width: number): { before: string; at: string; after: string } {
  const w = Math.max(1, width)
  const start = Math.max(0, l.cursor - w + 1)
  const cells = (l.text + ' ').slice(start, start + w)
  const at = l.cursor - start
  return { before: cells.slice(0, at), at: cells[at], after: cells.slice(at + 1) }
}

const atEnd = (text: string): Line => ({ text, cursor: text.length })

export function SearchBar({ active, history, width = 80, onRun, onLeave }: Props) {
  const [line, setLine] = useState<Line>(atEnd(''))
  // Ink can deliver several keys before React re-renders; the ref is the line they all see.
  const latest = useRef(line)
  const edit = (f: (l: Line) => Line) => {
    latest.current = f(latest.current)
    setLine(latest.current)
  }
  const [draft, setDraft] = useState('')
  const [idx, setIdx] = useState(-1) // -1 = editing the draft, 0 = newest history entry

  useEffect(() => setIdx(-1), [history.length])

  const recall = (next: number) => {
    if (next < -1 || next >= history.length) return
    if (idx === -1) setDraft(latest.current.text)
    setIdx(next)
    edit(() => atEnd(next === -1 ? draft : history[history.length - 1 - next]))
  }

  useInput(
    (input, key) => {
      if (key.return) {
        const sql = latest.current.text.trim()
        if (sql) onRun(sql)
        return
      }
      if (key.escape) return onLeave()
      if (key.upArrow) return recall(idx + 1)
      if (key.downArrow) return recall(idx - 1)
      // Terminal.app sends ⌥← ⌥→ as ESC b / ESC f; xterm-style terminals send meta+arrow.
      if (key.meta && (key.leftArrow || input === 'b')) return edit((l) => moveTo(l, wordLeft(l.text, l.cursor)))
      if (key.meta && (key.rightArrow || input === 'f')) return edit((l) => moveTo(l, wordRight(l.text, l.cursor)))
      if (key.leftArrow) return edit((l) => moveTo(l, l.cursor - 1))
      if (key.rightArrow) return edit((l) => moveTo(l, l.cursor + 1))
      if (key.home || (key.ctrl && input === 'a')) return edit((l) => moveTo(l, 0))
      if (key.end || (key.ctrl && input === 'e')) return edit((l) => moveTo(l, l.text.length))
      if ((key.meta && key.backspace) || (key.ctrl && input === 'w')) return edit((l) => cut(l, wordLeft(l.text, l.cursor)))
      if (key.backspace) return edit((l) => cut(l, l.cursor - 1))
      if (key.delete) return edit((l) => cut(l, l.cursor + 1))
      if (key.ctrl && input === 'u') return edit((l) => cut(l, 0))
      if (key.ctrl && input === 'k') return edit((l) => cut(l, l.text.length))
      if (key.ctrl || key.meta || key.tab || !input) return
      if (/[\r\n]/.test(input)) {
        // Ink hands coalesced keystrokes to us as one chunk: `text\r` is text followed by Enter.
        const [head] = input.split(/\r|\n/)
        edit((l) => insert(l, head))
        const sql = latest.current.text.trim()
        if (sql) onRun(sql)
        return
      }
      edit((l) => insert(l, input))
    },
    { isActive: active },
  )

  usePaste((text) => edit((l) => insert(l, normalizePaste(text))), { isActive: active })

  const v = visible(line, width - 2) // 2 = the '> ' prompt
  return (
    <Text wrap="truncate-end">
      {'> '}
      {v.before}
      {active ? <Text inverse>{v.at}</Text> : v.at}
      {v.after}
    </Text>
  )
}
