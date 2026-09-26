/**
 * assertion-keywords.mjs — 鸿蒙运行验证的日志断言关键词真源 (M6/契约测试用)
 *
 * 从 scripts/harmony/seed-and-verify.mjs 抽出, 供 seed-and-verify / 未来的
 * 「原生 + Web 日志字符串 ↔ 断言」契约测试共同 import.
 *
 * 硬约束: 这里的 keyword 必须与运行时日志源串**逐字一致** —— 本文件只做搬迁,
 * 不改任何一条日志子串; 改关键词等于改断言, 必须同步改日志源并实机验证.
 *
 * level 语义 (v0.7.0-harmony Stage 1): 缺省 = critical (向后兼容);
 * critical 失败 => 整体 FAIL; soft 失败 => 只留 evidence, 不阻塞.
 */

/**
 * 断言关键词 (运行日志证据链, 顺序即验证链顺序). level 缺省 = critical (向后兼容).
 *
 * 关键词与 v1.5.0 实机日志对齐 (2026-09-16 模拟器 127.0.0.1:5555 实测):
 * - A4: HarmonyBridge.ets 实际输出 'getAllCards done: count=N' (旧 'getAllCards=' 已漂移);
 * - A5: debugSeed 在 EntryAbility.handleLaunchWant 被原生拦截 (不进 HarmonyBridge FIFO),
 *   seed 阶段不存在 'handleHarmonyLaunch queued' 日志; 改为验证 notifyWebReady 就绪握手
 *   'Web launch handler ready: generation=N' (FIFO 派发通道武装完成的实证).
 *   'queued' 关键词由 openCard 阶段覆盖 (onNewWant -> handleHarmonyLaunch -> queued).
 */
export const ASSERTION_KEYWORDS = [
  { id: 'A1', keyword: 'seedDebugCards done', desc: '原生 RDB 预置 5 张到期卡完成', level: 'critical' },
  { id: 'A2', keyword: 'Page begin', desc: 'ArkWeb 虚拟 HTTPS 入口开始加载', level: 'critical' },
  { id: 'A3', keyword: 'Web content ready', desc: 'React content-ready ACK 到达', level: 'critical' },
  { id: 'A4', keyword: 'getAllCards done: count=', desc: 'RDB 恢复链路执行 (getAllCards done: count=N)', level: 'critical' },
  { id: 'A5', keyword: 'Web launch handler ready: generation=', desc: 'Web 启动处理器就绪握手 (FIFO 派发通道就绪)', level: 'critical' },
];

/**
 * openCard 阶段断言 (seed 冷启动链全命中后独立执行与评估).
 * A6 来自原生 EntryAbility hilog; A7 来自 Web 域层 (soft: 三条分支任一命中即过).
 */
export const OPEN_CARD_ASSERTIONS = [
  {
    id: 'A6',
    keyword: 'dispatching query=action=openCard',
    desc: '原生 onNewWant 派发 openCard (来自 EntryAbility hilog)',
    level: 'critical',
  },
  {
    id: 'A7',
    keyword: '[harmonyLaunch] openCard',
    desc: 'Web 域层 openCard 处理日志 (located/fallback/keep-session 任一命中即过)',
    level: 'soft',
  },
];

/** 验证链全部断言 (seed 段 + openCard 段), 供契约测试一次性比对日志源. */
export const ALL_ASSERTIONS = [...ASSERTION_KEYWORDS, ...OPEN_CARD_ASSERTIONS];

/** 断言是否为 critical (level 缺省 = critical, 向后兼容). */
export function isCritical(assertion) {
  return assertion.level !== 'soft';
}
