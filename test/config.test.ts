import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { defaultConfigPath, expandEnv, parseConfig, selectProfile, type Config } from '../src/config.js'

test('defaultConfigPath honours XDG_CONFIG_HOME', () => {
  assert.equal(defaultConfigPath({ XDG_CONFIG_HOME: '/x' }), join('/x', 'tron', 'config.json'))
})

test('expandEnv replaces $VAR from the given env', () => {
  assert.equal(expandEnv('postgres://u@h/db?password=$PW', { PW: 's3cret' }), 'postgres://u@h/db?password=s3cret')
})

test('expandEnv names the missing variable', () => {
  assert.throws(() => expandEnv('x$MISSING_ONE', {}), /MISSING_ONE is not set/)
  assert.throws(() => expandEnv('x$EMPTY', { EMPTY: '' }), /EMPTY is not set/)
})

test('parseConfig rejects bad json with the path', () => {
  assert.throws(() => parseConfig('{', '/p/config.json'), /\/p\/config\.json: invalid JSON/)
})

test('parseConfig rejects a connection without url', () => {
  assert.throws(() => parseConfig('{"connections":{"a":{}}}', '/p'), /connection "a" needs a string "url"/)
})

const two: Config = { connections: { prod: { url: 'postgres://prod' }, local: { url: 'postgres://$H/db' } } }

test('selectProfile picks by name and expands env', () => {
  assert.deepEqual(selectProfile(two, 'local', { H: 'localhost' }), { name: 'local', url: 'postgres://localhost/db' })
})

test('selectProfile defaults when there is exactly one', () => {
  assert.deepEqual(selectProfile({ connections: { only: { url: 'u' } } }, undefined, {}), { name: 'only', url: 'u' })
})

test('selectProfile lists names when ambiguous or unknown', () => {
  assert.throws(() => selectProfile(two, undefined, {}), /one of: prod, local/)
  assert.throws(() => selectProfile(two, 'nope', {}), /unknown connection "nope"/)
})
