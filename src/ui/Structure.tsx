import { Box, Text } from 'ink'
import type { TableInfo, TableRef } from '../db/adapter.js'
import { Grid } from './Grid.js'

interface Props {
  table: TableRef
  info: TableInfo
  width: number
  height: number
  active: boolean
  onCapture(on: boolean): void
}

export function Structure({ table, info, width, height, active, onCapture }: Props) {
  const rows = info.columns.map((c) => [c.name, c.type, c.nullable ? 'yes' : 'no', c.default])
  const fks =
    info.foreignKeys.map((f) => `${f.columns.join(',')} → ${f.refTable}(${f.refColumns.join(',')})`).join('   ') || 'none'
  const idx = info.indexes.map((i) => `${i.name}(${i.columns.join(',')})${i.unique ? ' unique' : ''}`).join('   ') || 'none'
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text bold>
        {table.schema}.{table.name}
      </Text>
      <Grid
        columns={['column', 'type', 'nullable', 'default']}
        rows={rows}
        width={width}
        height={Math.max(2, height - 4)}
        active={active}
        onCapture={onCapture}
      />
      <Text wrap="truncate-end">
        <Text bold>pk </Text>
        {info.primaryKey.join(', ') || 'none'}
      </Text>
      <Text wrap="truncate-end">
        <Text bold>fk </Text>
        {fks}
      </Text>
      <Text wrap="truncate-end">
        <Text bold>idx </Text>
        {idx}
      </Text>
    </Box>
  )
}
