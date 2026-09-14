#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { render } from 'ink'
import { defaultConfigPath, loadConfig, selectProfile } from './config.js'
import { openPostgres } from './db/postgres.js'
import { App } from './ui/App.js'

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' } },
  })
  if (values.help) {
    console.log(`usage: tron [connection]\n\nconnections are read from ${defaultConfigPath()}`)
    process.exit(0)
  }
  const { name, url } = selectProfile(loadConfig(), positionals[0])
  const db = await openPostgres(url)
  process.stdout.write('\x1b[?1049h') // alternate screen
  try {
    await render(<App db={db} profile={name} />, { exitOnCtrlC: false }).waitUntilExit()
  } finally {
    process.stdout.write('\x1b[?1049l')
    await db.close()
  }
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}
