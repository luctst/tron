import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import {
  PAGE_SIZE,
  READ_MAX,
  describeError,
  isConnectionError,
  type Adapter,
  type PendingWrite,
  type Result,
  type TableInfo,
  type TableRef,
} from '../db/adapter.js'
import { classify, stripComments, tableQuery } from '../sql.js'
import { Grid } from './Grid.js'
import { SearchBar } from './SearchBar.js'
import { Sidebar } from './Sidebar.js'
import { StatusBar } from './StatusBar.js'
import { Structure } from './Structure.js'

const SIDEBAR_W = 26

type Focus = 'sidebar' | 'grid' | 'search'
type View =
  | { kind: 'empty' }
  | { kind: 'rows'; result: Result; table: TableRef | null; page: number }
  | { kind: 'error'; message: string }
interface Pending extends PendingWrite {
  label: string
  startedAt: number
}

const NEXT: Record<Focus, Focus> = { sidebar: 'grid', grid: 'search', search: 'sidebar' }

export function App({ db, profile }: { db: Adapter; profile: string }) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [size, setSize] = useState({ cols: stdout.columns || 80, rows: stdout.rows || 24 })
  const [tables, setTables] = useState<TableRef[]>([])
  const [focus, setFocus] = useState<Focus>('sidebar')
  const [capture, setCapture] = useState(false)
  const [view, setView] = useState<View>({ kind: 'empty' })
  const [running, setRunning] = useState<number | null>(null) // startedAt
  const [pending, setPending] = useState<Pending | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [disconnected, setDisconnected] = useState<string | null>(null)
  const [showStructure, setShowStructure] = useState(false)
  const [info, setInfo] = useState<{ key: string; info: TableInfo } | null>(null)
  const [now, setNow] = useState(Date.now())
  const settling = useRef(false)

  useEffect(() => {
    const onResize = () => setSize({ cols: stdout.columns || 80, rows: stdout.rows || 24 })
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [stdout])

  useEffect(() => {
    if (running === null && pending === null) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [running, pending])

  const fail = useCallback((e: unknown) => {
    setCapture(false) // the pane that captured may unmount below without releasing
    const message = describeError(e)
    if (isConnectionError(e)) setDisconnected(message)
    setView({ kind: 'error', message })
  }, [])

  const loadTables = useCallback(async () => {
    try {
      setTables(await db.listTables())
      setDisconnected(null)
      setInfo(null)
    } catch (e) {
      fail(e)
    }
  }, [db, fail])

  useEffect(() => {
    void loadTables()
  }, [loadTables])

  const openTable = useCallback(
    async (table: TableRef, page: number) => {
      if (running !== null || pending) return
      setNotice(null)
      setShowStructure(false)
      setRunning(Date.now())
      try {
        const result = await db.read(tableQuery(table.schema, table.name, page, PAGE_SIZE), READ_MAX)
        setView({ kind: 'rows', result, table, page })
        setFocus('grid')
      } catch (e) {
        fail(e)
      } finally {
        setRunning(null)
      }
    },
    [db, running, pending, fail],
  )

  const runSql = useCallback(
    async (text: string) => {
      if (running !== null || pending) return
      setHistory((h) => (h[h.length - 1] === text ? h : [...h, text]))
      setNotice(null)
      setShowStructure(false)
      setRunning(Date.now())
      try {
        if (classify(text) === 'read') {
          const result = await db.read(text, READ_MAX)
          setView({ kind: 'rows', result, table: null, page: 0 })
          setFocus('grid')
        } else {
          const w = await db.write(text)
          const label = stripComments(text).trim().split(/\s+/)[0].toUpperCase()
          setPending({ ...w, label, startedAt: Date.now() })
        }
      } catch (e) {
        fail(e)
      } finally {
        setRunning(null)
      }
    },
    [db, running, pending, fail],
  )

  const settle = useCallback(
    async (commit: boolean, thenQuit = false) => {
      if (!pending || settling.current) return
      settling.current = true
      const p = pending
      setPending(null)
      setFocus('grid')
      try {
        await (commit ? p.commit() : p.rollback())
        setNotice(commit ? `${p.label} committed, ${p.affected} rows` : `${p.label} rolled back`)
      } catch (e) {
        fail(e)
      } finally {
        settling.current = false
      }
      if (thenQuit) exit()
    },
    [pending, exit, fail],
  )

  const toggleStructure = useCallback(async () => {
    if (view.kind !== 'rows' || !view.table) return
    if (showStructure) return setShowStructure(false)
    const key = `${view.table.schema}.${view.table.name}`
    if (info?.key !== key) {
      try {
        setInfo({ key, info: await db.describeTable(view.table.schema, view.table.name) })
      } catch (e) {
        return fail(e)
      }
    }
    setShowStructure(true)
  }, [view, showStructure, info, db, fail])

  const quit = useCallback(() => {
    if (pending) void settle(false, true)
    else exit()
  }, [pending, settle, exit])

  // Write confirmation: y commits, q or Ctrl-C rolls back and quits, anything else rolls back.
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') return void settle(false, true)
      if (input === 'y') void settle(true)
      else if (input === 'q') void settle(false, true)
      else void settle(false)
    },
    { isActive: pending !== null },
  )

  // Ctrl-C: cancel a running query, otherwise quit.
  useInput(
    (input, key) => {
      if (!(key.ctrl && input === 'c')) return
      if (running !== null) void db.cancel()
      else quit()
    },
    { isActive: pending === null },
  )

  // Tab cycles focus from any pane, unless a component is capturing text.
  useInput(
    (_input, key) => {
      if (key.tab) setFocus((f) => NEXT[f])
    },
    { isActive: !capture && pending === null },
  )

  // Single-letter navigation keys: never while typing.
  useInput(
    (input) => {
      if (input === '/') return setFocus('search')
      if (input === 'q') return quit()
      if (input === 'r') return void loadTables()
      if (input === 's') return void toggleStructure()
      if ((input === 'n' || input === 'p') && view.kind === 'rows' && view.table) {
        const page = view.page + (input === 'n' ? 1 : -1)
        const canNext = view.result.rows.length === PAGE_SIZE
        if (page >= 0 && (input === 'p' || canNext)) void openTable(view.table, page)
      }
    },
    { isActive: !capture && focus !== 'search' && pending === null },
  )

  const mainH = size.rows - 4 // 3 for the bordered search bar, 1 for the status bar
  const paneH = Math.max(1, mainH - 2)
  const gridW = Math.max(10, size.cols - SIDEBAR_W - 2)
  // `now` is only refreshed by the interval, so the first frame after a start can be behind it: clamp.
  const elapsed =
    running !== null
      ? `${Math.max(0, now - running)}ms`
      : pending
        ? `${Math.max(0, Math.round((now - pending.startedAt) / 1000))}s`
        : ''

  const status: { text: string; color?: string } = disconnected
    ? { text: `disconnected: ${disconnected} · r to reconnect`, color: 'red' }
    : pending
      ? {
          text: `${pending.label} affected ${pending.affected} rows · commit? [y/N] · q rolls back and quits · ${elapsed} (locks held)`,
          color: 'yellow',
        }
      : running !== null
        ? { text: `running… ${elapsed} · Ctrl-C cancels`, color: 'cyan' }
        : notice
          ? { text: notice, color: 'green' }
          : view.kind === 'error'
            ? { text: view.message, color: 'red' }
            : view.kind === 'rows'
              ? {
                  text: `${view.result.rows.length}${view.result.truncated ? '+ (truncated)' : ''} rows · ${view.result.ms}ms${
                    view.table ? ` · page ${view.page + 1}` : ''
                  }`,
                }
              : { text: `tron · ${profile} · ${tables.length} tables` }

  const hints =
    focus === 'search'
      ? '[Enter] run  [↑↓] history  [Esc] back  [Ctrl-C] cancel'
      : focus === 'sidebar'
        ? '[j/k] move  [Enter] open  [f] filter  [Tab] pane  [/] query  [q] quit'
        : '[hjkl] move  [Enter] cell  [s] structure  [n/p] page  [/] query  [q] quit'

  const gridActive = focus === 'grid' && pending === null && running === null
  const main =
    view.kind === 'error' ? (
      <Text color="red" wrap="wrap">
        {view.message}
      </Text>
    ) : view.kind === 'empty' ? (
      <Text dimColor>Pick a table, or press / to write a query.</Text>
    ) : showStructure && view.table && info ? (
      <Structure table={view.table} info={info.info} width={gridW} height={paneH} active={gridActive} onCapture={setCapture} />
    ) : (
      <Grid
        columns={view.result.columns}
        rows={view.result.rows}
        width={gridW}
        height={paneH}
        active={gridActive}
        onCapture={setCapture}
      />
    )

  const border = (pane: Focus) => (focus === pane ? 'cyan' : 'gray')

  return (
    <Box flexDirection="column" width={size.cols} height={size.rows}>
      <Box borderStyle="single" borderColor={border('search')} height={3} paddingX={1}>
        <SearchBar active={focus === 'search' && pending === null} history={history} width={size.cols - 4} onRun={(s) => void runSql(s)} onLeave={() => setFocus('grid')} />
      </Box>
      <Box height={mainH}>
        <Box width={SIDEBAR_W} flexShrink={0} borderStyle="single" borderColor={border('sidebar')} overflow="hidden">
          <Sidebar
            tables={tables}
            selected={view.kind === 'rows' ? view.table : null}
            active={focus === 'sidebar' && pending === null}
            width={SIDEBAR_W - 2}
            height={paneH}
            onOpen={(t) => void openTable(t, 0)}
            onLeave={() => setFocus('grid')}
            onCapture={setCapture}
          />
        </Box>
        <Box flexGrow={1} borderStyle="single" borderColor={border('grid')} overflow="hidden">
          {main}
        </Box>
      </Box>
      <StatusBar left={status.text} right={hints} color={status.color} />
    </Box>
  )
}
