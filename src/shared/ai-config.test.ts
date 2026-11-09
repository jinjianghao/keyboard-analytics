import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = path.join(os.tmpdir(), `kb-ai-cfg-${process.pid}.json`)
process.env.KEYBOARD_CONFIG_PATH = tmp

const { saveAiConfig, loadAiConfig, setConfigCipher, aiConfigStatus } = await import('./ai-config.ts')

const cfg = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-secret-123' }

test.after(() => {
  try {
    fs.unlinkSync(tmp)
  } catch {
    /* ignore */
  }
})

test('未注入加解密器：明文落盘，apiKeyEncrypted=false', () => {
  saveAiConfig(cfg)
  const raw = JSON.parse(fs.readFileSync(tmp, 'utf8'))
  assert.equal(raw.apiKey, 'sk-secret-123')
  assert.equal(raw.apiKeyEncrypted, false)
  assert.equal(loadAiConfig()?.apiKey, 'sk-secret-123')
})

test('注入加解密器：密文落盘，读取时自动解密还原', () => {
  // 简单可逆假加密器（base64 + 前缀），仅验证接线逻辑
  setConfigCipher({
    encrypt: s => 'enc:' + Buffer.from(s).toString('base64'),
    decrypt: s => Buffer.from(s.replace(/^enc:/, ''), 'base64').toString('utf8')
  })
  saveAiConfig(cfg)
  const raw = JSON.parse(fs.readFileSync(tmp, 'utf8'))
  assert.equal(raw.apiKeyEncrypted, true)
  assert.notEqual(raw.apiKey, 'sk-secret-123')
  assert.ok(raw.apiKey.startsWith('enc:'))
  // 运行时读到明文
  assert.equal(loadAiConfig()?.apiKey, 'sk-secret-123')
  // 状态接口不泄露明文，只报告是否已配置
  assert.equal(aiConfigStatus(loadAiConfig()).configured, true)
  assert.equal(aiConfigStatus(loadAiConfig()).hasApiKey, true)
})
