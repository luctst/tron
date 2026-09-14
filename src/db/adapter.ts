export interface TableRef {
  schema: string
  name: string
  kind: 'table' | 'view'
}

export interface Result {
  columns: string[]
  rows: unknown[][] // arrays, not objects: duplicate column names in joins must not collide
  truncated: boolean
  ms: number
}

export interface TableInfo {
  columns: { name: string; type: string; nullable: boolean; default: string | null }[]
  primaryKey: string[]
  foreignKeys: { columns: string[]; refTable: string; refColumns: string[] }[]
  indexes: { name: string; columns: string[]; unique: boolean }[]
}

export interface PendingWrite {
  affected: number
  commit(): Promise<void>
  rollback(): Promise<void>
}

export interface Adapter {
  listTables(): Promise<TableRef[]>
  describeTable(schema: string, name: string): Promise<TableInfo>
  /** Runs inside a READ ONLY transaction. Returns at most `max` rows; `truncated` is true when more existed. */
  read(sql: string, max: number): Promise<Result>
  /** Executes inside a transaction and returns before commit. Caller must commit() or rollback(). */
  write(sql: string): Promise<PendingWrite>
  /** Cancels the in-flight read or write, if any. */
  cancel(): Promise<void>
  close(): Promise<void>
}

export const READ_MAX = 500
export const PAGE_SIZE = 100

export function isConnectionError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code
  // CONNECT* covers postgres.js's CONNECTION_* codes and CONNECT_TIMEOUT.
  return typeof code === 'string' && (code.startsWith('CONNECT') || code.startsWith('ECONN'))
}

export function describeError(e: unknown): string {
  const err = e as { message?: unknown; position?: unknown } | null
  const message = typeof err?.message === 'string' ? err.message : String(e)
  return typeof err?.position === 'string' && err.position ? `${message} (at char ${err.position})` : message
}
