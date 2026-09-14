import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, stripComments, quoteIdent, tableQuery } from '../src/sql.js'

test('select is read', () => {
  assert.equal(classify('select 1'), 'read')
})

test('leading whitespace and upper case are fine', () => {
  assert.equal(classify('  \n\tSELECT * from t'), 'read')
})

test('cte, values, table, explain, show are reads', () => {
  assert.equal(classify('with x as (select 1) select * from x'), 'read')
  assert.equal(classify('values (1)'), 'read')
  assert.equal(classify('table users'), 'read')
  assert.equal(classify('explain select 1'), 'read')
  assert.equal(classify('show search_path'), 'read')
})

test('dml and ddl are writes', () => {
  assert.equal(classify('update t set a = 1'), 'write')
  assert.equal(classify('delete from t'), 'write')
  assert.equal(classify('insert into t values (1)'), 'write')
  assert.equal(classify('alter table t add c int'), 'write')
  assert.equal(classify('truncate t'), 'write')
})

test('comments before the statement are ignored', () => {
  assert.equal(classify('-- careful\nupdate t set a = 1'), 'write')
  assert.equal(classify('/* multi\nline */ select 1'), 'read')
})

test('prefix match needs a word boundary', () => {
  assert.equal(classify('selectx'), 'write')
})

test('stripComments leaves the statement intact', () => {
  assert.equal(stripComments('select 1 -- one\n/* two */ + 2').replace(/\s+/g, ' ').trim(), 'select 1 + 2')
})

test('quoteIdent doubles embedded quotes', () => {
  assert.equal(quoteIdent('plain'), '"plain"')
  assert.equal(quoteIdent('we"ird'), '"we""ird"')
})

test('tableQuery pages with limit/offset', () => {
  assert.equal(
    tableQuery('public', 'orders', 2, 100),
    'select * from "public"."orders" limit 100 offset 200',
  )
})
