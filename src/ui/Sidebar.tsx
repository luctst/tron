import { useState } from 'react'
import { Box, Spacer, Text, useInput } from 'ink'
import type { TableRef } from '../db/adapter.js'
import { clamp, scrollTo } from './scroll.js'

interface Props {
  tables: TableRef[]
  selected: TableRef | null
  active: boolean
  width: number
  height: number
  onOpen(t: TableRef): void
  onLeave(): void
  onCapture(on: boolean): void
}

export type Line = { kind: 'schema'; schema: string } | { kind: 'table'; ref: TableRef }

export function buildLines(tables: TableRef[], filter: string, collapsed: Set<string>): Line[] {
  const f = filter.toLowerCase()
  const bySchema = new Map<string, TableRef[]>()
  for (const t of tables) {
    if (f && !t.name.toLowerCase().includes(f)) continue
    const list = bySchema.get(t.schema) ?? []
    list.push(t)
    bySchema.set(t.schema, list)
  }
  const lines: Line[] = []
  for (const [schema, refs] of bySchema) {
    lines.push({ kind: 'schema', schema })
    if (!f && collapsed.has(schema)) continue
    for (const ref of refs) lines.push({ kind: 'table', ref })
  }
  return lines
}

export function Sidebar({ tables, selected, active, width, height, onOpen, onLeave, onCapture }: Props) {
  const [cursor, setCursor] = useState(0)
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState('')
  const [filtering, setFiltering] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const lines = buildLines(tables, filter, collapsed)
  const listHeight = Math.max(1, height - 1) // last line is the filter prompt
  const cur = clamp(cursor, 0, Math.max(0, lines.length - 1))
  const start = scrollTo(cur, offset, listHeight)

  const jump = (to: number) => {
    const next = clamp(to, 0, Math.max(0, lines.length - 1))
    setCursor(next)
    setOffset(scrollTo(next, start, listHeight))
  }
  const toggle = (schema: string) =>
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(schema)) n.delete(schema)
      else n.add(schema)
      return n
    })

  useInput(
    (input, key) => {
      if (filtering) {
        if (key.escape) {
          setFilter('')
          setFiltering(false)
          onCapture(false)
          return
        }
        if (key.return) {
          setFiltering(false)
          onCapture(false)
          return
        }
        if (key.backspace || key.delete) return setFilter((f) => f.slice(0, -1))
        if (key.ctrl || key.meta || key.tab || !input) return
        setFilter((f) => f + input)
        return
      }
      if (key.escape) return onLeave()
      if (input === 'j' || key.downArrow) return jump(cur + 1)
      if (input === 'k' || key.upArrow) return jump(cur - 1)
      if (input === 'g') return jump(0)
      if (input === 'G') return jump(lines.length - 1)
      if (input === 'f') {
        setFiltering(true)
        onCapture(true)
        return
      }
      const line = lines[cur]
      if (!line) return
      if (key.return || input === 'l') {
        if (line.kind === 'table') onOpen(line.ref)
        else toggle(line.schema)
        return
      }
      if (input === 'h') toggle(line.kind === 'schema' ? line.schema : line.ref.schema)
    },
    { isActive: active },
  )

  const isSelected = (ref: TableRef) => selected?.schema === ref.schema && selected?.name === ref.name

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {lines.slice(start, start + listHeight).map((line, i) => {
        const idx = start + i
        const text =
          line.kind === 'schema'
            ? `${collapsed.has(line.schema) && !filter ? '▸' : '▾'} ${line.schema}`
            : `  ${line.ref.name}${line.ref.kind === 'view' ? ' (v)' : ''}${isSelected(line.ref) ? ' ◂' : ''}`
        return (
          <Text key={idx} wrap="truncate-end" bold={line.kind === 'schema'} inverse={active && idx === cur}>
            {text.padEnd(width)}
          </Text>
        )
      })}
      <Spacer />
      <Text dimColor={!filtering} wrap="truncate-end">
        {filtering ? `f: ${filter}▌` : filter ? `f: ${filter}` : `${tables.length} tables`}
      </Text>
    </Box>
  )
}
