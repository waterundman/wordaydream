/**
 * CardTextFormatter (v0.5.0-harmony 技术债修复 M4)
 *
 * 服务卡片文案的单一事实来源: 卡片提供方进程 (CardDataProvider) 与卡片渲染
 * 进程 (ReviewCardWidget) 共用同一份实现, 消除历史上逐行复制的多语言文案分支.
 *
 * 刻意零依赖 (不 import Kit / RDB / preferences), 保证可被卡片渲染进程安全引用.
 *
 * ArkTS 适配: 仅函数 + 基础类型, 无 any / 无对象字面量类型 / 无 var.
 */

/**
 * 多语言格式化到期数文案.
 *
 * @param count 到期卡片数
 * @param language 语言代码: 'zh' | 'en' | 'de' (默认 'en', 其他值 fallback 'en')
 * @returns 格式化后的文案
 *
 * 文案规则:
 *   zh: 0 -> '暂无到期', 1 -> '1 个到期', n -> '${n} 个到期'
 *   en: 0 -> 'No cards', 1 -> '1 card due', n -> '${n} cards due'
 *   de: 0 -> 'Keine Karten', 1 -> '1 Karte fällig', n -> '${n} Karten fällig'
 */
export function formatDueCountText(count: number, language: string = 'en'): string {
  if (language === 'zh') {
    if (count === 0) {
      return '暂无到期';
    }
    if (count === 1) {
      return '1 个到期';
    }
    return `${count} 个到期`;
  }
  if (language === 'de') {
    if (count === 0) {
      return 'Keine Karten';
    }
    if (count === 1) {
      return '1 Karte fällig';
    }
    return `${count} Karten fällig`;
  }
  // 默认 en (含未匹配语言 fallback)
  if (count === 0) {
    return 'No cards';
  }
  if (count === 1) {
    return '1 card due';
  }
  return `${count} cards due`;
}
