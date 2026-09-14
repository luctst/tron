import { useEffect, useState } from 'react'
import { Text, useInput, usePaste } from 'ink'

interface Props {
  active: boolean
  history: string[]
  onRun(sql: string): void
  onLeave(): void
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

  usePaste((text) => setValue((v) => v + text.replace(/\s*\r?\n\s*/g, ' ')), { isActive: active })

  return (
    <Text wrap="truncate-start">
      {'> '}
      {value}
      {active ? <Text inverse> </Text> : null}
    </Text>
  )
}
