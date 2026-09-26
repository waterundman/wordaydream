/**
 * v0.2.0-harmony Stage 4: CardDataProvider 单元测试 (TS mirror)
 *
 * 测试对象: src/platform/cardDataProvider.ts (TS mirror)
 * 镜像 ArkTS: harmony/entry/src/main/ets/widget/CardDataProvider.ets +
 *             harmony/entry/src/main/ets/widget/CardTextFormatter.ets +
 *             harmony/entry/src/main/ets/widget/ReviewCardWidget.ets
 *
 * 由于 vitest 无法直接导入 .ets 文件, 通过 TS mirror 守护 ArkTS 侧安全 fallback 逻辑.
 * 同时通过 readFileSync 读取 ArkTS 源文件, 验证 mirror 与源码文本一致 (T01).
 *
 * 覆盖 test_spec (7 cases):
 * - T01 [critical]: formatDueCountText 3 语言不回归 (zh/en/de) + ArkTS 源文本一致性
 *                   (文案真源 = CardTextFormatter.ets, 提供方/渲染进程零复制)
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
// v0.5.0-harmony 技术债修复 M4: 卡片多语言文案抽到 CardTextFormatter.ets, 成为
// 卡片提供方进程 (CardDataProvider) 与卡片渲染进程 (ReviewCardWidget) 的共用真源.
const HARMONY_TEXT_FORMATTER_PATH: string = join(
  PROJECT_ROOT,
  'harmony',
  'entry',
  'src',
  'main',
  'ets',
  'widget',
  'CardTextFormatter.ets',
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

      // ArkTS 源文本一致性: 文案真源已迁到 CardTextFormatter.ets (v0.5.0 技术债 M4),
      // 验证 mirror 与真源文本完全匹配, 且 CardDataProvider / ReviewCardWidget 均只引用
      // 该真源 (零复制), 保证两侧进程不会再次漂移.
      const arkText: string = readFileSync(HARMONY_TEXT_FORMATTER_PATH, 'utf-8');
      expect(arkText).toContain('暂无到期');
      expect(arkText).toContain('1 个到期');
      expect(arkText).toContain('No cards');
      expect(arkText).toContain('1 card due');
      expect(arkText).toContain('cards due');
      expect(arkText).toContain('Keine Karten');
      expect(arkText).toContain('1 Karte fällig');
      expect(arkText).toContain('Karten fällig');
      // 真源签名与默认语言 (mirror 的 language 默认 'en' 依赖此行)
      expect(arkText).toContain(
        "export function formatDueCountText(count: number, language: string = 'en'): string",
      );

      // 卡片提供方: 转发到真源, 自身不再持有文案字面量.
      const arkProvider: string = readFileSync(HARMONY_PROVIDER_PATH, 'utf-8');
      expect(arkProvider).toContain("from './CardTextFormatter'");
      expect(arkProvider).toContain('buildDueCountText(count, language)');
      expect(arkProvider).not.toContain('暂无到期');
      expect(arkProvider).not.toContain('No cards');
      expect(arkProvider).not.toContain('Keine Karten');

      // 卡片渲染进程: 与提供方共用同一真源.
      const arkWidget: string = readFileSync(HARMONY_WIDGET_PATH, 'utf-8');
      expect(arkWidget).toContain("from './CardTextFormatter'");
      expect(arkWidget).not.toContain('暂无到期');
      expect(arkWidget).not.toContain('Keine Karten');
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
      expect(arkContent).toMatch(/=== 'zh'/);
      expect(arkContent).toMatch(/=== 'en'/);
      expect(arkContent).toMatch(/=== 'de'/);
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

    it('T09 [critical]: ReviewCardWidget 使用 BindingData 尺寸分支、多语言和进度环', () => {
      const arkWidget: string = readFileSync(HARMONY_WIDGET_PATH, 'utf-8');
      // 尺寸分支
      expect(arkWidget).toContain('DIMENSION_2_2');
      expect(arkWidget).toContain('DIMENSION_2_4');
      expect(arkWidget).toContain("@LocalStorageProp('formDimension')");
      expect(arkWidget).not.toContain('formBindingData.getDimension');
      expect(arkWidget).not.toContain('getContext(this)');
      // 多语言 state
      expect(arkWidget).toContain("@LocalStorageProp('language')");
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
      // 卡片入口与绑定状态
      expect(arkWidget).toContain('@Entry');
      expect(arkWidget).toContain('@Component');
      expect(arkWidget).toContain('@LocalStorageProp');
      expect(arkWidget).toContain('@Builder');
      expect(arkWidget).toContain('postCardAction');
      expect(arkWidget).toContain('EntryAbility');
      expect(arkWidget).toContain('action=startReview');
    });

    it('T10 [critical]: EntryAbility.ets emitter 刷新死链已移除, 卡片刷新走 FormRefresher 真实链路', () => {
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
      // 语义反转 (v0.5.0-harmony 技术债修复 M1): emitter(10001) 无订阅者, 且卡片渲染
      // 进程与主 Ability 进程隔离, 事件根本不可达 —— 该死链连同节流字段一并删除.
      expect(arkEntry).not.toContain('emitter.emit');
      expect(arkEntry).not.toContain('WIDGET_REFRESH_EVENT_ID');
      expect(arkEntry).not.toContain('WIDGET_REFRESH_THROTTLE_MS');
      expect(arkEntry).not.toContain('lastWidgetRefresh');
      expect(arkEntry).not.toContain('publishWidgetRefresh');
      expect(arkEntry).not.toContain('10001');
      // 死链不得以 import 形式回流 (注释中允许出现 "emitter" 说明跨进程限制).
      expect(arkEntry).not.toMatch(/import\s*\{[^}]*\bemitter\b[^}]*\}\s*from/);

      // 顶部注释必须指向真实刷新链路, 避免后人重新接回死链:
      //   notifyReviewCompleted -> FormRefresher.refreshAllForms -> formProvider.updateForm
      const commentBlock: string = arkEntry.slice(
        0,
        arkEntry.indexOf('export default class EntryAbility'),
      );
      expect(commentBlock).toContain('emitter');
      expect(commentBlock).toContain('notifyReviewCompleted');
      expect(commentBlock).toContain('FormRefresher.refreshAllForms');
      expect(commentBlock).toContain('formProvider.updateForm');

      // 真实链路实现侧: FormRefresher 确实回写卡片 (updateForm), 而非发事件.
      const refresherPath: string = join(
        PROJECT_ROOT,
        'harmony',
        'entry',
        'src',
        'main',
        'ets',
        'widget',
        'FormRefresher.ets',
      );
      const arkRefresher: string = readFileSync(refresherPath, 'utf-8');
      expect(arkRefresher).toContain('async refreshAllForms(context: common.Context)');
      expect(arkRefresher).toContain('await formProvider.updateForm(');
      expect(arkRefresher).not.toContain('emitter');

      // 桥接侧入口 (复习完成 -> 主动刷新所有卡片) 保留且被 EntryAbility 之外的链路调用.
      const bridgePath: string = join(
        PROJECT_ROOT,
        'harmony',
        'entry',
        'src',
        'main',
        'ets',
        'bridge',
        'HarmonyBridge.ets',
      );
      const arkBridge: string = readFileSync(bridgePath, 'utf-8');
      expect(arkBridge).toContain('async notifyReviewCompleted(');
      expect(arkBridge).toContain('FormRefresher.getInstance().refreshAllForms(');

      // 不回归: 卡片点击 -> EntryAbility -> HarmonyBridge 派发链路仍在.
      expect(arkEntry).toContain('handleHarmonyLaunch');
      expect(arkEntry).toContain('bridge.handleHarmonyLaunch(query);');
      expect(arkEntry).toContain("'action=startReview'");
      expect(arkEntry).toContain("'action=openCard&cardId=xxx'");
    });
  });
});
