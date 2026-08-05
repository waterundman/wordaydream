/**
 * v0.2.0-harmony Stage 4: CardDataProvider 单元测试 (TS mirror)
 *
 * 测试对象: src/platform/cardDataProvider.ts (TS mirror)
 * 镜像 ArkTS: harmony/entry/src/main/ets/widget/CardDataProvider.ets +
 *             harmony/entry/src/main/ets/widget/ReviewCardWidget.ets
 *
 * 由于 vitest 无法直接导入 .ets 文件, 通过 TS mirror 守护 ArkTS 侧安全 fallback 逻辑.
 * 同时通过 readFileSync 读取 ArkTS 源文件, 验证 mirror 与源码文本一致 (T01).
 *
 * 覆盖 test_spec (7 cases):
 * - T01 [critical]: formatDueCountText 3 语言不回归 (zh/en/de) + ArkTS 源文本一致性
 * - T02 [critical]: safeTodayStats 合法输入原样返回
 * - T03 [critical]: safeLanguage 'zh' 通过 (合法值)
 * - T04 [critical]: safeLanguage 缺失/null/'fr' fallback 'en' (安全默认值)
 * - T05 [critical]: safeTodayStats null/undefined fallback {0,0,0}
 * - T06 [non-critical]: shouldRenderProgressRing totalCount=0 -> false (避免除零)
 * - T07 [non-critical]: shouldRenderProgressRing totalCount>0 -> true
 *
 * 0 emoji (项目硬约束)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatDueCountText,
  safeLanguage,
  safeTodayStats,
  shouldRenderProgressRing,
  type TodayReviewStats,
} from '../cardDataProvider';

const PROJECT_ROOT: string = process.cwd();
const HARMONY_PROVIDER_PATH: string = join(
  PROJECT_ROOT,
  'harmony',
  'entry',
  'src',
  'main',
  'ets',
  'widget',
  'CardDataProvider.ets',
);
const HARMONY_WIDGET_PATH: string = join(
  PROJECT_ROOT,
  'harmony',
  'entry',
  'src',
  'main',
  'ets',
  'widget',
  'ReviewCardWidget.ets',
);

describe('CardDataProvider (v0.2.0-harmony Stage 4 TS mirror)', () => {
  describe('formatDueCountText', () => {
    it('T01 [critical]: 3 语言不回归 + ArkTS 源文本一致性', () => {
      // 注意: SPEC 示例文案 (zh='有 5 个词汇到期复习' / en='5 cards due for review' /
      // de='5 Karten zur Wiederholung') 与实际 ArkTS CardDataProvider.formatDueCountText
      // 文本不一致. 按 SPEC 注释 "检查实际现有 ArkTS CardDataProvider.formatDueCountText
      // 文本, mirror 输出", 此处 mirror 实际 ArkTS 文本:
      //   zh: '${n} 个到期' / en: '${n} cards due' / de: '${n} Karten fällig'
      // 完整覆盖 0/1/n 三种分支 + 三语言.
      expect(formatDueCountText(0, 'zh')).toBe('暂无到期');
      expect(formatDueCountText(1, 'zh')).toBe('1 个到期');
      expect(formatDueCountText(5, 'zh')).toBe('5 个到期');
      expect(formatDueCountText(10, 'zh')).toBe('10 个到期');

      expect(formatDueCountText(0, 'en')).toBe('No cards');
      expect(formatDueCountText(1, 'en')).toBe('1 card due');
      expect(formatDueCountText(5, 'en')).toBe('5 cards due');
      expect(formatDueCountText(10, 'en')).toBe('10 cards due');

      expect(formatDueCountText(0, 'de')).toBe('Keine Karten');
      expect(formatDueCountText(1, 'de')).toBe('1 Karte fällig');
      expect(formatDueCountText(5, 'de')).toBe('5 Karten fällig');
      expect(formatDueCountText(10, 'de')).toBe('10 Karten fällig');

      // 默认语言 'en' (与 ArkTS 签名 language: string = 'en' 一致)
      expect(formatDueCountText(5)).toBe('5 cards due');

      // ArkTS 源文本一致性: 验证 mirror 与 CardDataProvider.ets 文本完全匹配
      const arkContent: string = readFileSync(HARMONY_PROVIDER_PATH, 'utf-8');
      expect(arkContent).toContain('暂无到期');
      expect(arkContent).toContain('1 个到期');
      expect(arkContent).toContain('No cards');
      expect(arkContent).toContain('1 card due');
      expect(arkContent).toContain('cards due');
      expect(arkContent).toContain('Keine Karten');
      expect(arkContent).toContain('1 Karte fällig');
      expect(arkContent).toContain('Karten fällig');
    });
  });

  describe('safeTodayStats', () => {
    it('T02 [critical]: 合法 stats 原样返回 (mock store 返回 {3,2,10})', () => {
      const input: TodayReviewStats = {
        dueCount: 3,
        reviewedCount: 2,
        totalCount: 10,
      };
      const result: TodayReviewStats = safeTodayStats(input);
      // 字段值一致 (deep equal)
      expect(result).toEqual({
        dueCount: 3,
        reviewedCount: 2,
        totalCount: 10,
      });
      // 合法输入保留引用 (mirror ArkTS try 块内 return stats 行为)
      expect(result).toBe(input);
    });

    it('T05 [critical]: null/undefined/字段缺失 输入 fallback {0,0,0}', () => {
      const expected: TodayReviewStats = {
        dueCount: 0,
        reviewedCount: 0,
        totalCount: 0,
      };
      // null
      expect(safeTodayStats(null)).toEqual(expected);
      // undefined
      expect(safeTodayStats(undefined)).toEqual(expected);
      // 字段类型异常 (mirror ArkTS catch 兜底, 防御性 Number.isFinite 校验)
      // 注意: TS 编译期阻止传 invalid 类型, 此处用 as 断言模拟 ArkTS 运行时收到脏数据
      expect(
        safeTodayStats({
          dueCount: NaN,
          reviewedCount: 2,
          totalCount: 10,
        }),
      ).toEqual(expected);
      expect(
        safeTodayStats({
          dueCount: 3,
          reviewedCount: Infinity,
          totalCount: 10,
        }),
      ).toEqual(expected);
      expect(
        safeTodayStats({
          dueCount: 3,
          reviewedCount: 2,
          totalCount: NaN,
        }),
      ).toEqual(expected);

      // ArkTS 源文本一致性: CardDataProvider.ets 含 getTodayReviewStatsForWidget
      // + defaultStats {0,0,0}
      const arkContent: string = readFileSync(HARMONY_PROVIDER_PATH, 'utf-8');
      expect(arkContent).toContain('getTodayReviewStatsForWidget');
      expect(arkContent).toContain('defaultStats');
      expect(arkContent).toMatch(/dueCount:\s*0/);
      expect(arkContent).toMatch(/reviewedCount:\s*0/);
      expect(arkContent).toMatch(/totalCount:\s*0/);
    });
  });

  describe('safeLanguage', () => {
    it('T03 [critical]: 合法值 zh/en/de 原样返回', () => {
      // 模拟 preferences 'app_language' = 'zh' (其他合法值同)
      expect(safeLanguage('zh')).toBe('zh');
      expect(safeLanguage('en')).toBe('en');
      expect(safeLanguage('de')).toBe('de');
    });

    it('T04 [critical]: 缺失/null/undefined/非白名单 fallback en', () => {
      // preferences 缺失 (ArkTS prefs.has 返回 false -> readPreferences 返回 null)
      expect(safeLanguage(null)).toBe('en');
      // preferences 异常 (ArkTS catch 兜底 return 'en')
      expect(safeLanguage(undefined)).toBe('en');
      // 空字符串 (键存在但值为空)
      expect(safeLanguage('')).toBe('en');
      // 非白名单值 'fr' (SPEC 约束: 非 zh/en/de fallback 'en')
      expect(safeLanguage('fr')).toBe('en');
      // 大小写不敏感测试: 'ZH' / 'En' / 'DE' 不在白名单 (ArkTS 严格 ===)
      expect(safeLanguage('ZH')).toBe('en');
      expect(safeLanguage('En')).toBe('en');
      expect(safeLanguage('DE')).toBe('en');
      // 尾随空格也不接受
      expect(safeLanguage('zh ')).toBe('en');

      // ArkTS 源文本一致性: CardDataProvider.ets getLanguage 含 'zh' | 'en' | 'de' 校验
      const arkContent: string = readFileSync(HARMONY_PROVIDER_PATH, 'utf-8');
      expect(arkContent).toContain('getLanguage');
      expect(arkContent).toMatch(/raw === 'zh'/);
      expect(arkContent).toMatch(/raw === 'en'/);
      expect(arkContent).toMatch(/raw === 'de'/);
      expect(arkContent).toContain("return 'en'");
    });
  });

  describe('shouldRenderProgressRing', () => {
    it('T06 [non-critical]: totalCount=0 -> false (避免除零)', () => {
      expect(shouldRenderProgressRing({ totalCount: 0 })).toBe(false);
      // 负数也不渲染 (防御性, mirror ArkTS totalCount > 0 条件)
      expect(shouldRenderProgressRing({ totalCount: -1 })).toBe(false);
    });

    it('T07 [non-critical]: totalCount>0 -> true (渲染进度环)', () => {
      expect(shouldRenderProgressRing({ totalCount: 1 })).toBe(true);
      expect(shouldRenderProgressRing({ totalCount: 10 })).toBe(true);
      expect(shouldRenderProgressRing({ totalCount: 1000 })).toBe(true);

      // ArkTS 源文本一致性: ReviewCardWidget.ets ProgressRing 含 totalCount > 0 条件
      // + Progress type: ProgressType.Ring
      const arkWidget: string = readFileSync(HARMONY_WIDGET_PATH, 'utf-8');
      expect(arkWidget).toContain('ProgressRing');
      expect(arkWidget).toContain('ProgressType.Ring');
      expect(arkWidget).toMatch(/totalCount > 0/);
    });
  });

  describe('ArkTS 源端契约 (Stage 4 新增方法)', () => {
    it('T08 [critical]: CardDataProvider.ets 含 3 个 Stage 4 新增方法 + setContext', () => {
      // regression guard: 确认 Stage 4 新增方法在 ArkTS 端实际存在
      // (mirror 才有意义; 若 ArkTS 端方法被误删, mirror 测试通过但实际功能缺失)
      const arkContent: string = readFileSync(HARMONY_PROVIDER_PATH, 'utf-8');
      expect(arkContent).toContain('getTodayReviewStatsForWidget');
      expect(arkContent).toContain('getLanguage');
      expect(arkContent).toContain('getRecentlyReviewedCardsForWidget');
      expect(arkContent).toContain('setContext');
      // 已有 Stage 6 方法保留 (不回归)
      expect(arkContent).toContain('static getInstance(): CardDataProvider');
      expect(arkContent).toContain('getDueCardsCountForWidget');
      expect(arkContent).toContain('getNextDueCardForWidget');
      expect(arkContent).toContain('formatDueCountText');
    });

    it('T09 [critical]: ReviewCardWidget.ets 含尺寸分支 + 多语言 + 进度环 + emitter', () => {
      const arkWidget: string = readFileSync(HARMONY_WIDGET_PATH, 'utf-8');
      // 尺寸分支
      expect(arkWidget).toContain('DIMENSION_2_2');
      expect(arkWidget).toContain('DIMENSION_2_4');
      expect(arkWidget).toContain('formBindingData.getDimension');
      // 多语言 state
      expect(arkWidget).toContain("@LocalV2 language");
      expect(arkWidget).toContain('getCtaText');
      expect(arkWidget).toContain('getUpdatedPrefix');
      // CTA 文案三语言
      expect(arkWidget).toContain('开始复习');
      expect(arkWidget).toContain('Start Review');
      expect(arkWidget).toContain('Starten');
      // UpdatedTime 文案三语言
      expect(arkWidget).toContain('更新于');
      expect(arkWidget).toContain('Updated');
      expect(arkWidget).toContain('Aktualisiert');
      // 进度环
      expect(arkWidget).toContain('ProgressRing');
      expect(arkWidget).toContain('ProgressType.Ring');
      // emitter 监听 + 5min 节流
      expect(arkWidget).toContain('emitter.on');
      expect(arkWidget).toContain('handleRefreshEvent');
      expect(arkWidget).toContain('refreshCardData');
      expect(arkWidget).toContain('WIDGET_REFRESH_THROTTLE_MS');
      // 不回归: Stage 6 关键符号保留
      expect(arkWidget).toContain('@ComponentV2');
      expect(arkWidget).toContain('@LocalV2');
      expect(arkWidget).toContain('@Builder');
      expect(arkWidget).toContain('postCardAction');
      expect(arkWidget).toContain('EntryAbility');
      expect(arkWidget).toContain('action=startReview');
    });

    it('T10 [critical]: EntryAbility.ets 含 emitter.emit + 5min 节流', () => {
      const entryPath: string = join(
        PROJECT_ROOT,
        'harmony',
        'entry',
        'src',
        'main',
        'ets',
        'entryability',
        'EntryAbility.ets',
      );
      const arkEntry: string = readFileSync(entryPath, 'utf-8');
      // emitter import + emit 调用
      expect(arkEntry).toContain('emitter');
      expect(arkEntry).toContain('emitter.emit');
      // 5min 节流字段 + 常量
      expect(arkEntry).toContain('lastWidgetRefresh');
      expect(arkEntry).toContain('WIDGET_REFRESH_THROTTLE_MS');
      expect(arkEntry).toContain('publishWidgetRefresh');
      // 触发条件: action=startReview / action=openCard
      expect(arkEntry).toContain("startsWith('action=startReview')");
      expect(arkEntry).toContain("startsWith('action=openCard')");
      // 不回归: 原有 HarmonyBridge 派发保留
      expect(arkEntry).toContain('handleHarmonyLaunch');
    });
  });
});
