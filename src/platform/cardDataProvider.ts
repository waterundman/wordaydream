/**
 * CardDataProvider (v0.2.0-harmony Stage 4) — TypeScript mirror
 *
 * vitest 测试目标 (vitest 无法运行 ArkTS .ets 文件). 与
 * harmony/entry/src/main/ets/widget/CardDataProvider.ets 的安全 fallback 逻辑
 * 一一对应, 保证 Web 端单测守护 ArkTS 侧行为契约.
 *
 * 设计原则: 纯函数, 0 副作用, 0 I/O. 不依赖 ArkTS runtime API
 * (preferences / relationalStore / hilog), 仅镜像异常兜底分支.
 *
 * 镜像方法对应:
 * - formatDueCountText       <-> ArkTS CardDataProvider.formatDueCountText
 *                                 (Stage 6 已有, Stage 4 复用, 此处 mirror)
 * - safeLanguage             <-> ArkTS CardDataProvider.getLanguage
 *                                 (Stage 4 新增, preferences 异常 / 非法值 fallback 'en')
 * - safeTodayStats           <-> ArkTS CardDataProvider.getTodayReviewStatsForWidget
 *                                 (Stage 4 新增, store 异常 fallback {0,0,0})
 * - shouldRenderProgressRing <-> ArkTS ReviewCardWidget.ProgressRing 条件
 *                                 (Stage 4 新增, totalCount=0 不渲染避免除零)
 */

/**
 * 服务卡片支持的语言 (与 ArkTS getLanguage 接受值一致).
 * 非 zh/en/de 一律 fallback 'en'.
 */
export type WidgetLanguage = 'zh' | 'en' | 'de';

/**
 * 今日复习统计 (与 ArkTS TodayReviewStats 字段一一对应).
 * 3 个 number 字段, JSON 序列化无丢失.
 */
export interface TodayReviewStats {
  /** 待复习卡片数 (due <= now). */
  dueCount: number;
  /** 今日已复习卡片数 (lastReviewAt >= todayStart). */
  reviewedCount: number;
  /** 总卡片数 (COUNT(*)). */
  totalCount: number;
}

/**
 * 进度环渲染判定所需的最小输入 (避免除零).
 */
export interface ProgressRingStats {
  /** 总卡片数 (用于除法 reviewedCount / totalCount). */
  totalCount: number;
}

/**
 * 多语言格式化到期数文案.
 *
 * 与 ArkTS CardDataProvider.formatDueCountText 完全一致:
 *   zh: 0 -> '暂无到期', 1 -> '1 个到期', n -> `${n} 个到期`
 *   en: 0 -> 'No cards', 1 -> '1 card due', n -> `${n} cards due`
 *   de: 0 -> 'Keine Karten', 1 -> '1 Karte fällig', n -> `${n} Karten fällig`
 *
 * 默认语言 'en' (与 ArkTS 签名 language: string = 'en' 一致).
 *
 * @param count 到期卡片数
 * @param language 语言代码 (默认 'en')
 */
export function formatDueCountText(
  count: number,
  language: WidgetLanguage = 'en',
): string {
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
  // 默认 en (与 ArkTS getLanguage safe fallback 一致: 非 zh/de 默认 en)
  if (count === 0) {
    return 'No cards';
  }
  if (count === 1) {
    return '1 card due';
  }
  return `${count} cards due`;
}

/**
 * 安全语言 fallback (mirror ArkTS CardDataProvider.getLanguage).
 *
 * ArkTS getLanguage 从 preferences 'app_language' 读取, 异常或未注入 Context 时
 * fallback 'en'. 仅接受 'zh' | 'en' | 'de' 三个值, 其他值 fallback 'en'.
 *
 * 本函数镜像 "仅接受 zh/en/de, 其他 fallback 'en'" 的安全逻辑,
 * 不涉及 preferences I/O (I/O 由 ArkTS 侧处理).
 *
 * @param raw preferences 读取的原始字符串 (可能为 null/undefined/任意字符串)
 * @returns 'zh' | 'en' | 'de'
 */
export function safeLanguage(
  raw: string | null | undefined,
): WidgetLanguage {
  if (raw === 'zh' || raw === 'en' || raw === 'de') {
    return raw;
  }
  return 'en';
}

/**
 * 安全今日复习统计 fallback (mirror ArkTS CardDataProvider.getTodayReviewStatsForWidget).
 *
 * ArkTS getTodayReviewStatsForWidget 调用 MemoryCardStore.getTodayReviewStats,
 * 异常时返回 {dueCount:0, reviewedCount:0, totalCount:0}.
 *
 * 本函数镜像 "null/undefined/字段缺失 fallback {0,0,0}" 的安全逻辑,
 * 输入合法时原样返回 (保留引用, 便于测试 toBe / toEqual 均通过).
 *
 * @param stats store 查询结果 (可能为 null/undefined/字段缺失)
 * @returns 安全的 TodayReviewStats (3 个 number 字段保证存在)
 */
export function safeTodayStats(
  stats: TodayReviewStats | null | undefined,
): TodayReviewStats {
  const defaultStats: TodayReviewStats = {
    dueCount: 0,
    reviewedCount: 0,
    totalCount: 0,
  };
  if (stats === null || stats === undefined) {
    return defaultStats;
  }
  // 防御性: 字段类型校验 (mirror ArkTS BusinessError catch 兜底)
  if (
    typeof stats.dueCount !== 'number' ||
    typeof stats.reviewedCount !== 'number' ||
    typeof stats.totalCount !== 'number' ||
    !Number.isFinite(stats.dueCount) ||
    !Number.isFinite(stats.reviewedCount) ||
    !Number.isFinite(stats.totalCount)
  ) {
    return defaultStats;
  }
  return stats;
}

/**
 * 进度环渲染判定 (mirror ArkTS ReviewCardWidget.ProgressRing 条件).
 *
 * ArkTS ProgressRing 仅在 totalCount > 0 时渲染 (避免 Progress 组件除零).
 *
 * @param stats 进度环所需统计 (至少包含 totalCount)
 * @returns true 表示渲染进度环, false 表示不渲染
 */
export function shouldRenderProgressRing(
  stats: ProgressRingStats,
): boolean {
  return stats.totalCount > 0;
}
