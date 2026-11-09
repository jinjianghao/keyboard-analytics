/**
 * 只读 SQL 白名单校验（纯逻辑，无外部依赖，便于单测）。
 *
 * 用于 Mastra agent 的 SQL 工具：仅放行单条 SELECT / WITH…SELECT 查询，
 * 拦截写操作、多语句拼接、以及通过注释绕过黑名单的攻击。
 */

/**
 * 去掉 SQL 中的注释（`--` 行注释与块注释），保留字符串字面量原样。
 * 仅用于安全校验前的预处理，避免用注释绕过白名单。
 */
export function stripSqlComments(sql: string): string {
  let out = ''
  let i = 0
  let inSingle = false
  let inDouble = false
  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]
    if (inSingle) {
      out += c
      if (c === "'") {
        if (next === "'") {
          out += next
          i++
        } else inSingle = false
      }
      i++
      continue
    }
    if (inDouble) {
      out += c
      if (c === '"') inDouble = false
      i++
      continue
    }
    if (c === "'") {
      inSingle = true
      out += c
      i++
      continue
    }
    if (c === '"') {
      inDouble = true
      out += c
      i++
      continue
    }
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * 把 SQL 归一化为"安全校验专用"形式：去掉注释、并把字符串/标识符字面量替换为占位空串。
 * 这样后续的分号/关键字检查不会误伤 `'a;b'`、`"drop"` 这类合法字面量内容。
 */
function sanitizeForCheck(sql: string): string {
  let out = ''
  let i = 0
  let inSingle = false
  let inDouble = false
  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]
    if (inSingle) {
      if (c === "'") {
        if (next === "'") {
          i += 2
          continue
        }
        inSingle = false
      }
      i++
      continue
    }
    if (inDouble) {
      if (c === '"') inDouble = false
      i++
      continue
    }
    if (c === "'") {
      inSingle = true
      out += "''"
      i++
      continue
    }
    if (c === '"') {
      inDouble = true
      out += '""'
      i++
      continue
    }
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * 只读 SQL 白名单校验：仅允许单条 SELECT / WITH…SELECT 语句。
 * - 先剥注释 + 字符串字面量（防注释绕过，且不误伤含分号/关键字的合法字面量）
 * - 必须以 SELECT 或 WITH 开头
 * - 去尾分号后不得再含分号（禁止多语句拼接）
 * - 拦截内联高危关键字（ATTACH/PRAGMA 等，纵深防御）
 * 校验失败抛错。
 */
export function assertReadOnlySelect(sql: string): void {
  const sanitized = sanitizeForCheck(sql).trim()
  const withoutTrailing = sanitized.replace(/;\s*$/, '')
  if (withoutTrailing.includes(';')) {
    throw new Error('仅允许单条只读 SELECT 查询')
  }
  if (!/^\s*(select|with)\b/i.test(withoutTrailing)) {
    throw new Error('仅允许只读 SELECT 查询')
  }
  if (/\b(attach|detach|pragma|vacuum|reindex|writetoggle|enable_load_extension)\b/i.test(withoutTrailing)) {
    throw new Error('仅允许只读 SELECT 查询')
  }
}
