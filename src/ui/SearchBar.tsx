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

export function SearchBar({ active, history, onRun, onLeave }: Props) {
  const [value, setValue] = useState('')
  const [draft, setDraft] = useState('')
  const [idx, setIdx] = useState(-1) // -1 = editing the draft, 0 = newest history entry

  useEffect(() => setIdx(-1), [history.length])

  const recall = (next: number) => {
    if (next < -1 || next >= history.length) return
    if (idx === -1) setDraft(value)
    setIdx(next)
    setValue(next === -1 ? draft : history[history.length - 1 - next])
  }

  useInput(
    (input, key) => {
      if (key.return) {
        const sql = value.trim()
        if (sql) onRun(sql)
        return
      }
      if (key.escape) return onLeave()
      if (key.upArrow) return recall(idx + 1)
      if (key.downArrow) return recall(idx - 1)
      if (key.backspace || key.delete) return setValue((v) => v.slice(0, -1))
      if (key.ctrl && input === 'u') return setValue('')
      if (key.ctrl || key.meta || key.tab || key.leftArrow || key.rightArrow || !input) return
      if (/[\r\n]/.test(input)) {
        // Ink hands coalesced keystrokes to us as one chunk: `text\r` is text followed by Enter.
        const [head] = input.split(/\r|\n/)
        const sql = (value + head).trim()
        setValue(value + head)
        if (sql) onRun(sql)
        return
      }
      setValue((v) => v + input)
    },
    { isActive: active },
  )

  usePaste((text) => setValue((v) => v + normalizePaste(text)), { isActive: active })

  return (
    <Text wrap="truncate-start">
      {'> '}
      {value}
      {active ? <Text inverse> </Text> : null}
    </Text>
  )
}
