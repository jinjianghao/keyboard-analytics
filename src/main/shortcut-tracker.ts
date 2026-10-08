/**
 * 组合键配对判定（纯逻辑，无数据库依赖，便于单元测试）。
 *
 * 语义：
 * - 非修饰键始终算"正常"按键（按下时把当前按住的修饰键标记为已配对）；
 * - 修饰键（Shift/Ctrl/Alt/Cmd/Fn/大小写锁定）只有与某个非修饰键同时按住时，
 *   才算"组合"；单独按下并抬起（无配对）的修饰键忽略（返回 'ignore'）。
 */
import { isShortcutLike } from './key-name-map.ts'

export type UpResult = 'normal' | 'combo' | 'ignore'

export class ShortcutTracker {
  /** 当前按住的修饰键 -> 是否已与非修饰键配对 */
  private heldModifiers = new Map<string, boolean>()
  /** 当前按住的非修饰键数量（用于"先按普通键、后按修饰键"的倒序成弦配对） */
  private companionCount = 0

  /** 按键按下 */
  down(std: string): void {
    if (isShortcutLike(std)) {
      // 若已有普通键按住（倒序成弦），此修饰键立即视为已配对
      this.heldModifiers.set(std, this.companionCount > 0)
      return
    }
    this.companionCount++
    // 非修饰键按下：把当前所有未配对的修饰键标记为已配对
    if (this.heldModifiers.size > 0) {
      for (const name of this.heldModifiers.keys()) this.heldModifiers.set(name, true)
    }
  }

  /**
   * 按键抬起，返回本次抬起的键应如何计数。
   * - 'normal'：非修饰键，计为普通键
   * - 'combo' ：已配对的修饰键，计为组合键
   * - 'ignore'：未配对的修饰键（单独按下），不计
   */
  up(std: string): UpResult {
    if (isShortcutLike(std)) {
      const paired = this.heldModifiers.get(std) ?? false
      this.heldModifiers.delete(std)
      return paired ? 'combo' : 'ignore'
    }
    this.companionCount = Math.max(0, this.companionCount - 1)
    return 'normal'
  }
}
