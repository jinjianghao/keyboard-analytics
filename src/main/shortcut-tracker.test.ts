import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ShortcutTracker } from './shortcut-tracker.ts'

test('单独按下的修饰键：不被计为组合（ignore）', () => {
  const t = new ShortcutTracker()
  t.down('LEFT CTRL')
  assert.equal(t.up('LEFT CTRL'), 'ignore')
})

test('普通键单独按下：计为 normal', () => {
  const t = new ShortcutTracker()
  t.down('A')
  assert.equal(t.up('A'), 'normal')
})

test('修饰键先按 + 普通键后按：普通键 normal，修饰键 combo', () => {
  const t = new ShortcutTracker()
  t.down('LEFT CTRL')
  t.down('C')
  assert.equal(t.up('C'), 'normal')
  assert.equal(t.up('LEFT CTRL'), 'combo')
})

test('先按普通键再按修饰键：修饰键仍算 combo', () => {
  const t = new ShortcutTracker()
  t.down('C')
  t.down('LEFT META')
  assert.equal(t.up('LEFT META'), 'combo')
  assert.equal(t.up('C'), 'normal')
})

test('普通键先抬起、修饰键后抬起：修饰键仍算 combo', () => {
  const t = new ShortcutTracker()
  t.down('LEFT CTRL')
  t.down('V')
  assert.equal(t.up('V'), 'normal')
  assert.equal(t.up('LEFT CTRL'), 'combo')
})

test('修饰键先抬起、普通键后抬起：两者分别 combo / normal', () => {
  const t = new ShortcutTracker()
  t.down('LEFT CTRL')
  t.down('V')
  assert.equal(t.up('LEFT CTRL'), 'combo')
  assert.equal(t.up('V'), 'normal')
})

test('两个修饰键 + 一个普通键：全部配对，均按各自类型计入', () => {
  const t = new ShortcutTracker()
  t.down('LEFT CTRL')
  t.down('LEFT SHIFT')
  t.down('C')
  assert.equal(t.up('C'), 'normal')
  assert.equal(t.up('LEFT SHIFT'), 'combo')
  assert.equal(t.up('LEFT CTRL'), 'combo')
})

test('连续两次单独按同一个修饰键：都不计（独立按下无配对）', () => {
  const t = new ShortcutTracker()
  t.down('LEFT CTRL')
  assert.equal(t.up('LEFT CTRL'), 'ignore')
  t.down('LEFT CTRL')
  assert.equal(t.up('LEFT CTRL'), 'ignore')
})

test('配对状态在下一次按下前已清空（不会跨组合残留）', () => {
  const t = new ShortcutTracker()
  t.down('LEFT CTRL')
  t.down('C')
  t.up('C')
  assert.equal(t.up('LEFT CTRL'), 'combo')
  // 组合结束后单独按修饰键，不应再被上次的配对"污染"
  t.down('LEFT CTRL')
  assert.equal(t.up('LEFT CTRL'), 'ignore')
})
