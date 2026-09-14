import { useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { clamp, scrollTo } from './scroll.js'

interface Props {
  columns: string[]
  rows: unknown[][]
  width: number
  height: number
  active: boolean
  onCapture?(on: boolean): void
}

const MAX_COL = 30

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v).replace(/\r?\n/g, ' ')
}

function formatFull(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'string') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  return String(v)
}

// ponytail: counts UTF-16 code units, not display width; CJK and emoji misalign. Use `string-width` if it bites.
export function fit(s: string, w: number): string {
  return s.length > w ? s.slice(0, Math.max(0, w - 1)) + '…' : s.padEnd(w)
}

export function columnWidths(cells: string[][], columns: string[]): number[] {
  return columns.map((c, i) => {
    let w = Math.max(3, c.length)
    for (const row of cells) w = Math.max(w, row[i]?.length ?? 0)
    return Math.min(MAX_COL, w)
  })
}

/** Column indexes that fit in `width` starting at `start`, always at least one. */
function visibleCols(widths: number[], width: number, start: number): number[] {
  const out: number[] = []
  let used = 0
  for (let i = start; i < widths.length; i++) {
    if (out.length > 0 && used + widths[i] + 1 > width) break
    out.push(i)
    used += widths[i] + 1
  }
  return out
}

function colScroll(widths: number[], width: number, target: number, start: number): number {
  if (target < start) return target
  let s = start
  while (!visibleCols(widths, width, s).includes(target)) s++
  return s
}

export function Grid({ columns, rows, width, height, active, onCapture }: Props) {
  const [row, setRow] = useState(0)
  const [col, setCol] = useState(0)
  const [rowOffset, setRowOffset] = useState(0)
  const [colOffset, setColOffset] = useState(0)
  const [popup, setPopup] = useState(false)

  const cells = useMemo(() => rows.map((r) => r.map(formatCell)), [rows])
  const widths = useMemo(() => columnWidths(cells, columns), [cells, columns])

  const bodyHeight = Math.max(1, height - 1)
  const curRow = clamp(row, 0, Math.max(0, rows.length - 1))
  const curCol = clamp(col, 0, Math.max(0, columns.length - 1))
  const rowStart = scrollTo(curRow, rowOffset, bodyHeight)
  const colStart = colScroll(widths, width, curCol, colOffset)
  const vis = visibleCols(widths, width, colStart)

  const moveRow = (d: number) => {
    const next = clamp(curRow + d, 0, Math.max(0, rows.length - 1))
    setRow(next)
    setRowOffset(scrollTo(next, rowStart, bodyHeight))
  }
  const moveCol = (d: number) => {
    const next = clamp(curCol + d, 0, Math.max(0, columns.length - 1))
    setCol(next)
    setColOffset(colScroll(widths, width, next, colStart))
  }

  useInput(
    (input, key) => {
      if (popup) {
        setPopup(false)
        onCapture?.(false)
        return
      }
      if (rows.length === 0) return
      if (input === 'j' || key.downArrow) return moveRow(1)
      if (input === 'k' || key.upArrow) return moveRow(-1)
      if (input === 'l' || key.rightArrow) return moveCol(1)
      if (input === 'h' || key.leftArrow) return moveCol(-1)
      if (input === 'g') return moveRow(-Infinity)
      if (input === 'G') return moveRow(Infinity)
      if (key.return) {
        setPopup(true)
        onCapture?.(true)
      }
    },
    { isActive: active },
  )

  if (popup) {
    return (
      <Box flexDirection="column" width={width} height={height} borderStyle="round" overflow="hidden">
        <Text bold>{columns[curCol]}</Text>
        <Text>{formatFull(rows[curRow]?.[curCol])}</Text>
      </Box>
    )
  }

  const line = (ci: number, j: number, text: string) => fit(text, widths[ci]) + (j < vis.length - 1 ? ' ' : '')

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text bold underline wrap="truncate-end">
        {vis.map((ci, j) => line(ci, j, columns[ci])).join('')}
      </Text>
      {rows.length === 0 ? (
        <Text dimColor>0 rows</Text>
      ) : (
        cells.slice(rowStart, rowStart + bodyHeight).map((r, i) => {
          const ri = rowStart + i
          return (
            <Box key={ri}>
              {vis.map((ci, j) => (
                <Text
                  key={ci}
                  wrap="truncate-end"
                  inverse={active && ri === curRow && ci === curCol}
                  dimColor={rows[ri][ci] === null || rows[ri][ci] === undefined}
                >
                  {line(ci, j, r[ci] ?? '')}
                </Text>
              ))}
            </Box>
          )
        })
      )}
    </Box>
  )
}
