/**
 * 跨平台按键标准名 → 中文显示名映射。
 *
 * 使用 node-global-key-listener / uiohook-napi 各平台统一暴露的 standardName
 * （如 A、SPACE、LEFT SHIFT、NUMPAD 1）进行识别，替换原先按 macOS vKey 硬编码的映射表，
 * 从而在 macOS(Intel/AppleSilicon) / Windows / Linux 上键名一致可用。
 */

/** 标准名 -> 中文显示名（按三平台 standardName 全集的空格分隔格式整理） */
export const KEY_NAME_ZH: Record<string, string> = {
  // 字母
  A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'H',
  I: 'I', J: 'J', K: 'K', L: 'L', M: 'M', N: 'N', O: 'O', P: 'P',
  Q: 'Q', R: 'R', S: 'S', T: 'T', U: 'U', V: 'V', W: 'W', X: 'X',
  Y: 'Y', Z: 'Z',
  // 数字
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
  '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  // 符号
  COMMA: '，', DOT: '。', 'FORWARD SLASH': '/', BACKSLASH: '\\', SEMICOLON: '；',
  QUOTE: "'", MINUS: '-', EQUALS: '=', BACKTICK: '`', SECTION: '§',
  'SQUARE BRACKET OPEN': '[', 'SQUARE BRACKET CLOSE': ']',
  // 控制 / 功能
  SPACE: '空格', RETURN: '回车', TAB: 'Tab', BACKSPACE: '退格',
  DELETE: '删除', ESCAPE: 'Esc', INS: '插入', 'CAPS LOCK': '大小写锁定',
  FN: 'Fn',
  // 导航
  'UP ARROW': '↑', 'DOWN ARROW': '↓', 'LEFT ARROW': '←', 'RIGHT ARROW': '→',
  HOME: 'Home', END: 'End', 'PAGE UP': 'PageUp', 'PAGE DOWN': 'PageDown',
  'PRINT SCREEN': '截屏', 'SCROLL LOCK': '滚动锁定', 'NUM LOCK': '数字锁定',
  // 修饰键
  'LEFT SHIFT': 'Shift', 'RIGHT SHIFT': '右Shift',
  'LEFT CTRL': 'Control', 'RIGHT CTRL': '右Control',
  'LEFT ALT': 'Alt', 'RIGHT ALT': '右Alt',
  'LEFT META': 'Command', 'RIGHT META': '右Command',
  // 小键盘
  'NUMPAD 0': '小键盘0', 'NUMPAD 1': '小键盘1', 'NUMPAD 2': '小键盘2',
  'NUMPAD 3': '小键盘3', 'NUMPAD 4': '小键盘4', 'NUMPAD 5': '小键盘5',
  'NUMPAD 6': '小键盘6', 'NUMPAD 7': '小键盘7', 'NUMPAD 8': '小键盘8',
  'NUMPAD 9': '小键盘9', 'NUMPAD DOT': '小键盘.', 'NUMPAD PLUS': '小键盘+',
  'NUMPAD MINUS': '小键盘-', 'NUMPAD MULTIPLY': '小键盘*', 'NUMPAD DIVIDE': '小键盘/',
  'NUMPAD EQUALS': '小键盘=', 'NUMPAD CLEAR': '小键盘清除', 'NUMPAD RETURN': '小键盘回车',
  // 功能键
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
  F13: 'F13', F14: 'F14', F15: 'F15', F16: 'F16', F17: 'F17',
  F18: 'F18', F19: 'F19', F20: 'F20', F21: 'F21', F22: 'F22',
  F23: 'F23', F24: 'F24',
  // 鼠标（经键盘监听路径出现的兜底映射，实际鼠标事件走独立监听器）
  'MOUSE LEFT': '左键', 'MOUSE RIGHT': '右键', 'MOUSE MIDDLE': '中键',
  'MOUSE X1': '侧键1', 'MOUSE X2': '侧键2'
}

/** 将标准名转为中文展示名；未知键名原样返回 */
export function keyDisplayName(standardName: string): string {
  return KEY_NAME_ZH[standardName] ?? standardName
}

/** 是否为修饰/快捷键类按键（用于归入 shortcut 统计） */
export function isShortcutLike(name: string): boolean {
  return (
    name.includes('SHIFT') ||
    name.includes('CTRL') ||
    name.includes('ALT') ||
    name.includes('META') ||
    name === 'FN' ||
    name === 'CAPS LOCK'
  )
}