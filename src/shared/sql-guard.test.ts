import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertReadOnlySelect, stripSqlComments } from './sql-guard.ts'

const ok = (sql: string): void => {
  assert.doesNotThrow(() => assertReadOnlySelect(sql), `应放行: ${sql}`)
}
const blocked = (sql: string): void => {
  assert.throws(() => assertReadOnlySelect(sql), `应拦截: ${sql}`)
}

test('普通 SELECT 放行', () => {
  ok('SELECT key, count FROM normal_keys WHERE date = "2026-11-09" ORDER BY count DESC')
})

test('WITH…SELECT 放行', () => {
  ok('WITH t AS (SELECT key FROM normal_keys) SELECT * FROM t')
})

test('结尾单个分号放行', () => {
  ok('SELECT 1;')
})

test('多语句拼接拦截', () => {
  blocked('SELECT 1; DROP TABLE normal_keys')
})

test('写操作拦截', () => {
  blocked('DELETE FROM normal_keys')
  blocked('UPDATE normal_keys SET count = 0')
  blocked('INSERT INTO normal_keys (key) VALUES ("x")')
  blocked('DROP TABLE normal_keys')
})

test('行首黑名单绕过：PRAGMA 中段仍拦截', () => {
  blocked('SELECT 1; PRAGMA journal_mode')
  blocked('SELECT * FROM normal_keys; ATTACH "x" AS y')
})

test('注释绕过被剥离后正确判定', () => {
  blocked('-- harmless\nDROP TABLE normal_keys')
  blocked('/* SELECT */ DELETE FROM normal_keys')
  ok('SELECT 1 -- trailing comment')
})

test('字符串字面量中的分号/关键字不误伤', () => {
  ok("SELECT * FROM normal_keys WHERE key = 'a;b'")
  ok('SELECT * FROM normal_keys WHERE key = "drop"')
})

test('stripSqlComments 保留字符串内容', () => {
  assert.equal(stripSqlComments("SELECT '-- not a comment'"), "SELECT '-- not a comment'")
})
