import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Config {
  connections: Record<string, { url: string }>
}

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'tron', 'config.json')
}

export function expandEnv(s: string, env: NodeJS.ProcessEnv = process.env): string {
  return s.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    const v = env[name]
    if (!v) throw new Error(`environment variable ${name} is not set`)
    return v
  })
}

export function parseConfig(text: string, path: string): Config {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error(`${path}: invalid JSON: ${(e as Error).message}`)
  }
  const c = raw as Partial<Config> | null
  if (!c || typeof c !== 'object' || !c.connections || typeof c.connections !== 'object') {
    throw new Error(`${path}: expected { "connections": { "<name>": { "url": "postgres://..." } } }`)
  }
  for (const [name, p] of Object.entries(c.connections)) {
    if (!p || typeof p.url !== 'string') throw new Error(`${path}: connection "${name}" needs a string "url"`)
  }
  return c as Config
}

export function loadConfig(path = defaultConfigPath()): Config {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    throw new Error(`cannot read config at ${path}: ${(e as Error).message}`)
  }
  return parseConfig(text, path)
}

export function selectProfile(
  config: Config,
  name: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { name: string; url: string } {
  const names = Object.keys(config.connections)
  if (names.length === 0) throw new Error('config has no connections')
  const chosen = name ?? (names.length === 1 ? names[0] : undefined)
  if (chosen === undefined) throw new Error(`which connection? one of: ${names.join(', ')}`)
  const profile = config.connections[chosen]
  if (!profile) throw new Error(`unknown connection "${chosen}"; one of: ${names.join(', ')}`)
  return { name: chosen, url: expandEnv(profile.url, env) }
}
