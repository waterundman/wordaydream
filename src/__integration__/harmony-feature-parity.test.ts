/**
 * Wordaydream Harmony Stage 4 — T02 14 Feature 模块功能对等测试
 *
 * 测试对象: src/features/ 下 14 个核心 feature 模块在模拟 ArkWeb 内的可加载性
 *
 * 测试策略 (与 FEATURE_PARITY_CHECKLIST.md §1-§2 对齐):
 * - 静态导入每个模块的 entry point (key symbols), 验证符号存在 + 类型正确
 * - 不触发真实 LLM / 网络 / IndexedDB 调用, 仅验证模块结构对等
 * - 每个 describe 块对应一个 feature 模块, 验收点编号与 checklist §2.x 一致
 * - jsdom + fake-indexeddb 模拟 ArkWeb 容器 (DOM + IndexedDB API 可用)
 * - matchMedia stub (ArkWeb 支持 prefers-reduced-motion 媒体查询)
 *
 * 14 Feature 模块 (与 FEATURE_PARITY_CHECKLIST.md §1 一致):
 *  1. reading       2. review        3. grammar       4. analytics
 *  5. achievements  6. course        7. wordlist      8. settings
 *  9. dictionary   10. evaluation   11. graduation   12. home
 * 13. streak       14. llm
 *
 * 0 emoji (项目硬约束)
 * 0 改动: 不修改任何源文件, 仅新增测试; Web 端 vitest 656/656 基线不破坏
 */
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';

// 14 feature 模块 entry points
// 1. reading
import { ReadingSessionPage } from '../features/reading/ReadingSessionPage';
import { InteractivePassage } from '../features/reading/components/InteractivePassage';
import { useReadingSessionStore } from '../features/reading/store/useReadingSessionStore';
import { useReadingHistoryStore } from '../features/reading/store/useReadingHistoryStore';
import { generatePassage, buildPassageFromLLM, clearPassageCache } from '../features/reading/services/passageGenerator';

// 2. review
import { ReviewSessionPage } from '../features/review/components/ReviewSessionPage';
import { RatingBar } from '../features/review/components/RatingBar';
import { MemoryTray } from '../features/review/components/MemoryTray';
import { ExportButton } from '../features/review/components/ExportButton';
import { useMemoryStore } from '../features/review/store/useMemoryStore';
import { useReviewSessionStore } from '../features/review/store/useReviewSessionStore';
import { scheduleNextReview, createInitialMemoryCard, DEFAULT_FSRS_WEIGHTS } from '../features/review/services/schedulerAdapter';
import { ExportService } from '../features/review/services/exportService';

// 3. grammar
import { GrammarPanel } from '../features/grammar/components/GrammarPanel';
import { GrammarHighlight } from '../features/grammar/components/GrammarHighlight';
import { CompoundWordDisplay } from '../features/grammar/components/CompoundWordDisplay';
import { detectGrammarPoints } from '../features/grammar/services/grammarDetector';
import { splitCompound } from '../features/grammar/services/compoundSplitter';

// 4. analytics
import { AnalyticsPanel } from '../features/analytics/components/AnalyticsPanel';
import { AnalyticsChart } from '../features/analytics/components/AnalyticsChart';
import { useAnalyticsStore } from '../features/analytics/store/useAnalyticsStore';
import { useHomeAnalytics } from '../features/analytics/hooks/useHomeAnalytics';

// 5. achievements
import { AchievementListModal } from '../features/achievements/components/AchievementListModal';
import { AchievementToast } from '../features/achievements/components/AchievementToast';
import { useAchievementStore } from '../features/achievements/store/useAchievementStore';
import { ALL_ACHIEVEMENTS, evaluate as evaluateAchievements } from '../features/achievements/services/achievementEngine';

// 6. course
import { CoursePathPage } from '../features/course/components/CoursePathPage';
import { LessonCard } from '../features/course/components/LessonCard';
import { LessonCompleteModal } from '../features/course/components/LessonCompleteModal';
import { ModuleSection } from '../features/course/components/ModuleSection';
import { useCourseStore } from '../features/course/store/useCourseStore';

// 7. wordlist
import { WordlistPage } from '../features/wordlist/WordlistPage';
import { WordlistRow } from '../features/wordlist/components/WordlistRow';
import { useWordlistStore } from '../features/wordlist/store/useWordlistStore';

// 8. settings
import { SettingsPanel } from '../features/settings/components/SettingsPanel';
import { useSettingsStore } from '../features/settings/store/useSettingsStore';

// 9. dictionary
import { WiktextractAdapter, getDictionaryAdapter, resetDictionaryAdapter } from '../features/dictionary/services/wiktextractAdapter';
import { getCachedGloss, setCachedGloss, clearAllCachedGlosses, getCachedGlossCount, pruneExpiredEntries } from '../features/dictionary/services/glossPersistentCache';
import { LRUCache } from '../features/dictionary/services/cache';

// 10. evaluation
import { evaluateAnswer } from '../features/evaluation/services/evaluateAnswer';
import { getGloss, computeSourceHash, clearGlossCache } from '../features/evaluation/services/glossAdapter';
import { RemedyPanel } from '../features/evaluation/components/RemedyPanel';

// 11. graduation
import { GraduationModal } from '../features/graduation/components/GraduationModal';

// 12. home
import { HomePage } from '../features/home/HomePage';
import { HeroSection } from '../features/home/components/HeroSection';
import { TodayCard } from '../features/home/components/TodayCard';
import { TodayReviewCard } from '../features/home/components/TodayReviewCard';
import { AchievementWall } from '../features/home/components/AchievementWall';
import { ProgressRing } from '../features/home/components/ProgressRing';
import { StreakBadge } from '../features/home/components/StreakBadge';
import { CurrentLessonCard } from '../features/home/CurrentLessonCard';
import { BotanicalDivider, TornPaperDivider } from '../features/home/components/Dividers';

// 13. streak
import { useStreakStore } from '../features/streak/store/useStreakStore';

// 14. llm
import { generateWithFallback, testProviderConnection, resetProviderCache } from '../features/llm/services/router';
import { getProvider, getProviderName, selectByWeight, parseGrayscale } from '../features/llm/services/providerFactory';
import { MockLLMProvider } from '../features/llm/services/mockProvider';
import { streamingGenerate } from '../features/llm/services/streamingProvider';
import { useOfflineModeStore } from '../features/llm/store/offlineMode';
import { parseLLMResponse, PassagePayloadSchema } from '../features/llm/services/jsonParser';
import { validateAndAlignPassagePayload, normalizePassagePayload } from '../features/llm/services/llmAdapter';
import { levenshtein } from '../features/llm/utils/levenshtein';
import { normalizeText } from '../features/llm/utils/textNormalize';

// ======================== ArkWeb 环境模拟 ========================

/**
 * matchMedia stub: ArkWeb 支持 prefers-reduced-motion 媒体查询.
 * jsdom 默认不实现 matchMedia, 这里注入最小实现, 让组件 hook 不崩.
 */
beforeAll(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }
  // IntersectionObserver stub (LinkedOccurrenceHighlight / 滚动相关 hooks 依赖)
  if (typeof window !== 'undefined' && typeof window.IntersectionObserver === 'undefined') {
    class IntersectionObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IntersectionObserverStub;
  }
  // ResizeObserver stub
  if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
});

// ======================== 工具: 验证 React 组件可加载 ========================

/**
 * 验证一个值是合法的 React 组件 (函数组件或被 memo 包装的组件).
 * 在 jsdom 环境下不实际渲染, 仅验证符号存在 + 类型.
 */
function expectIsReactComponent(component: unknown, name: string): void {
  expect(component, `${name} 应被导出`).toBeDefined();
  // React 函数组件是 function; memo 包装的组件是 object 含 $$typeof.
  const isFunction = typeof component === 'function';
  const isMemoObject =
    typeof component === 'object' &&
    component !== null &&
    '$$typeof' in component;
  expect(
    isFunction || isMemoObject,
    `${name} 应为 React 函数组件或 memo 包装组件, 实际类型: ${typeof component}`
  ).toBe(true);
}

/**
 * 验证一个值是 function (用于 services / store actions).
 */
function expectIsFunction(fn: unknown, name: string): void {
  expect(fn, `${name} 应被导出`).toBeDefined();
  expect(typeof fn, `${name} 应为 function, 实际类型: ${typeof fn}`).toBe('function');
}

/**
 * 验证 Zustand store: 有 getState / setState / subscribe 方法.
 *
 * Zustand store 由 create() 返回, 是一个函数 (React hook) 同时挂载 getState/setState/subscribe.
 * 因此 typeof store === 'function' (而非 'object').
 */
function expectIsZustandStore(store: unknown, name: string): void {
  expect(store, `${name} 应被导出`).toBeDefined();
  // Zustand store 是函数 (hook), 不是 object
  expect(typeof store === 'function' || typeof store === 'object', `${name} 应为 function 或 object, 实际: ${typeof store}`).toBe(true);
  expect(typeof (store as { getState: unknown }).getState, `${name}.getState 应为 function`).toBe('function');
  expect(typeof (store as { setState: unknown }).setState, `${name}.setState 应为 function`).toBe('function');
  expect(typeof (store as { subscribe: unknown }).subscribe, `${name}.subscribe 应为 function`).toBe('function');
}

// ======================== T02.1: reading 模块 ========================

describe('[T02.1] reading 模块在模拟 ArkWeb 内可加载 (验收点 R1/R3/R4/R5)', () => {
  it('R1: ReadingSessionPage 是有效 React 组件', () => {
    expectIsReactComponent(ReadingSessionPage, 'ReadingSessionPage');
  });

  it('R3: InteractivePassage 是有效 React 组件', () => {
    expectIsReactComponent(InteractivePassage, 'InteractivePassage');
  });

  it('R4: useReadingSessionStore 是有效 Zustand store + 含 loadSession action', () => {
    expectIsZustandStore(useReadingSessionStore, 'useReadingSessionStore');
    const state = useReadingSessionStore.getState();
    expect(typeof state.loadSession, 'loadSession 应为 function').toBe('function');
    expect(typeof state.markOccurrenceResolved, 'markOccurrenceResolved 应为 function').toBe('function');
    expect(typeof state.clearSession, 'clearSession 应为 function').toBe('function');
  });

  it('R5: useReadingHistoryStore 是有效 Zustand store + 含 addEntry action', () => {
    expectIsZustandStore(useReadingHistoryStore, 'useReadingHistoryStore');
    const state = useReadingHistoryStore.getState();
    expect(typeof state.addEntry, 'addEntry 应为 function').toBe('function');
    expect(typeof state.clearHistory, 'clearHistory 应为 function').toBe('function');
  });

  it('R2: passageGenerator 导出 generatePassage / buildPassageFromLLM / clearPassageCache', () => {
    expectIsFunction(generatePassage, 'generatePassage');
    expectIsFunction(buildPassageFromLLM, 'buildPassageFromLLM');
    expectIsFunction(clearPassageCache, 'clearPassageCache');
  });
});

// ======================== T02.2: review 模块 ========================

describe('[T02.2] review 模块在模拟 ArkWeb 内可加载 (验收点 RV1/RV2/RV3/RV8/RV9/RV10)', () => {
  it('RV1: ReviewSessionPage 是有效 React 组件', () => {
    expectIsReactComponent(ReviewSessionPage, 'ReviewSessionPage');
  });

  it('RV8: RatingBar 是有效 React 组件', () => {
    expectIsReactComponent(RatingBar, 'RatingBar');
  });

  it('RV9: MemoryTray 是有效 React 组件', () => {
    expectIsReactComponent(MemoryTray, 'MemoryTray');
  });

  it('RV10: ExportButton 是有效 React 组件', () => {
    expectIsReactComponent(ExportButton, 'ExportButton');
  });

  it('RV2/RV3: useMemoryStore 是有效 Zustand store + 含 addCardFromToken / rateCard / getDueCards', () => {
    expectIsZustandStore(useMemoryStore, 'useMemoryStore');
    const state = useMemoryStore.getState();
    expect(typeof state.addCardFromToken, 'addCardFromToken 应为 function').toBe('function');
    expect(typeof state.rateCard, 'rateCard 应为 function').toBe('function');
    expect(typeof state.getDueCards, 'getDueCards 应为 function').toBe('function');
    expect(typeof state.resetAll, 'resetAll 应为 function').toBe('function');
  });

  it('RV5/RV7: useReviewSessionStore 是有效 Zustand store + 含 startReview / completeReview', () => {
    expectIsZustandStore(useReviewSessionStore, 'useReviewSessionStore');
    const state = useReviewSessionStore.getState();
    expect(typeof state.startReview, 'startReview 应为 function').toBe('function');
    expect(typeof state.completeReview, 'completeReview 应为 function').toBe('function');
    expect(typeof state.exitReview, 'exitReview 应为 function').toBe('function');
  });

  it('RV3: schedulerAdapter 导出 scheduleNextReview / createInitialMemoryCard + DEFAULT_FSRS_WEIGHTS', () => {
    expectIsFunction(scheduleNextReview, 'scheduleNextReview');
    expectIsFunction(createInitialMemoryCard, 'createInitialMemoryCard');
    expect(Array.isArray(DEFAULT_FSRS_WEIGHTS), 'DEFAULT_FSRS_WEIGHTS 应为数组').toBe(true);
    expect(DEFAULT_FSRS_WEIGHTS.length, 'DEFAULT_FSRS_WEIGHTS 非空').toBeGreaterThan(0);
  });

  it('RV10: ExportService 是 class (含静态导出方法 exportCards / exportAndDownload)', () => {
    expect(ExportService, 'ExportService 应被导出').toBeDefined();
    expect(typeof ExportService, 'ExportService 应为 class/function').toBe('function');
    // 验证静态方法 (ExportService 是静态工具类, 不需实例化)
    expect(typeof ExportService.exportCards, 'ExportService.exportCards 应为 function').toBe('function');
    expect(typeof ExportService.exportAndDownload, 'ExportService.exportAndDownload 应为 function').toBe('function');
    expect(typeof ExportService.downloadFile, 'ExportService.downloadFile 应为 function').toBe('function');
  });
});

// ======================== T02.3: grammar 模块 ========================

describe('[T02.3] grammar 模块在模拟 ArkWeb 内可加载 (验收点 G1/G2/G3/G4/G5)', () => {
  it('G1: GrammarPanel 是有效 React 组件', () => {
    expectIsReactComponent(GrammarPanel, 'GrammarPanel');
  });

  it('G5: GrammarHighlight 是有效 React 组件 (memo 包装)', () => {
    expectIsReactComponent(GrammarHighlight, 'GrammarHighlight');
  });

  it('G3: CompoundWordDisplay 是有效 React 组件 (memo 包装)', () => {
    expectIsReactComponent(CompoundWordDisplay, 'CompoundWordDisplay');
  });

  it('G2: grammarDetector.detectGrammarPoints 是 function', () => {
    expectIsFunction(detectGrammarPoints, 'detectGrammarPoints');
  });

  it('G4: compoundSplitter.splitCompound 是 function', () => {
    expectIsFunction(splitCompound, 'splitCompound');
  });
});

// ======================== T02.4: analytics 模块 ========================

describe('[T02.4] analytics 模块在模拟 ArkWeb 内可加载 (验收点 A1/A2/A3/A4)', () => {
  it('A1: AnalyticsPanel 是有效 React 组件', () => {
    expectIsReactComponent(AnalyticsPanel, 'AnalyticsPanel');
  });

  it('A4: AnalyticsChart 是有效 React 组件', () => {
    expectIsReactComponent(AnalyticsChart, 'AnalyticsChart');
  });

  it('A2: useAnalyticsStore 是有效 Zustand store + 含 addLearningRecord / addAnswerRecord', () => {
    expectIsZustandStore(useAnalyticsStore, 'useAnalyticsStore');
    const state = useAnalyticsStore.getState();
    expect(typeof state.addLearningRecord, 'addLearningRecord 应为 function').toBe('function');
    expect(typeof state.addAnswerRecord, 'addAnswerRecord 应为 function').toBe('function');
    expect(typeof state.incrementLLMRepair, 'incrementLLMRepair 应为 function').toBe('function');
  });

  it('A3: useHomeAnalytics 是有效 React hook (function)', () => {
    expectIsFunction(useHomeAnalytics, 'useHomeAnalytics');
  });
});

// ======================== T02.5: achievements 模块 ========================

describe('[T02.5] achievements 模块在模拟 ArkWeb 内可加载 (验收点 AC1/AC2/AC4/AC5/AC6/AC8)', () => {
  it('AC1: AchievementListModal 是有效 React 组件', () => {
    expectIsReactComponent(AchievementListModal, 'AchievementListModal');
  });

  it('AC3: AchievementToast 是有效 React 组件', () => {
    expectIsReactComponent(AchievementToast, 'AchievementToast');
  });

  it('AC2/AC4: useAchievementStore 是有效 Zustand store + 含 checkAndUnlock / dismissToast', () => {
    expectIsZustandStore(useAchievementStore, 'useAchievementStore');
    const state = useAchievementStore.getState();
    expect(typeof state.checkAndUnlock, 'checkAndUnlock 应为 function').toBe('function');
    expect(typeof state.dismissToast, 'dismissToast 应为 function').toBe('function');
    expect(typeof state.reset, 'reset 应为 function').toBe('function');
  });

  it('AC5: ALL_ACHIEVEMENTS 是非空数组 (13 个成就快照)', () => {
    expect(Array.isArray(ALL_ACHIEVEMENTS), 'ALL_ACHIEVEMENTS 应为数组').toBe(true);
    expect(ALL_ACHIEVEMENTS.length, 'ALL_ACHIEVEMENTS 应有 13 个成就').toBe(13);
  });

  it('AC6: achievementEngine.evaluate 是 function', () => {
    expectIsFunction(evaluateAchievements, 'achievementEngine.evaluate');
  });

  it('AC8: AchievementWall 是有效 React 组件 (在 home 模块导出, 与 achievements 联动)', () => {
    expectIsReactComponent(AchievementWall, 'AchievementWall');
  });
});

// ======================== T02.6: course 模块 ========================

describe('[T02.6] course 模块在模拟 ArkWeb 内可加载 (验收点 C1/C2/C3/C5/C6)', () => {
  it('C1: CoursePathPage 是有效 React 组件', () => {
    expectIsReactComponent(CoursePathPage, 'CoursePathPage');
  });

  it('C3: LessonCard 是有效 React 组件', () => {
    expectIsReactComponent(LessonCard, 'LessonCard');
  });

  it('C5: LessonCompleteModal 是有效 React 组件', () => {
    expectIsReactComponent(LessonCompleteModal, 'LessonCompleteModal');
  });

  it('C6: ModuleSection 是有效 React 组件', () => {
    expectIsReactComponent(ModuleSection, 'ModuleSection');
  });

  it('C2/C7: useCourseStore 是有效 Zustand store (含 persist)', () => {
    expectIsZustandStore(useCourseStore, 'useCourseStore');
    const state = useCourseStore.getState();
    expect(state.lessonProgress, 'lessonProgress 字段存在').toBeDefined();
    expect(state.enrolledCourseIds, 'enrolledCourseIds 字段存在').toBeDefined();
    expect(typeof state.enrollCourse, 'enrollCourse 应为 function').toBe('function');
    expect(typeof state.startLesson, 'startLesson 应为 function').toBe('function');
    expect(typeof state.resetProgress, 'resetProgress 应为 function').toBe('function');
  });
});

// ======================== T02.7: wordlist 模块 ========================

describe('[T02.7] wordlist 模块在模拟 ArkWeb 内可加载 (验收点 W1/W2/W3/W4/W5/W9)', () => {
  it('W1: WordlistPage 是有效 React 组件', () => {
    expectIsReactComponent(WordlistPage, 'WordlistPage');
  });

  it('WordlistRow 是有效 React 组件', () => {
    expectIsReactComponent(WordlistRow, 'WordlistRow');
  });

  it('W2/W3/W4/W5/W9: useWordlistStore 是有效 Zustand store + 含全部关键 actions', () => {
    expectIsZustandStore(useWordlistStore, 'useWordlistStore');
    const state = useWordlistStore.getState();
    expect(typeof state.markWordLearning, 'markWordLearning 应为 function').toBe('function');
    expect(typeof state.markWordMastered, 'markWordMastered 应为 function').toBe('function');
    expect(typeof state.recordEncounter, 'recordEncounter 应为 function').toBe('function');
    expect(typeof state.syncFromMemoryCards, 'syncFromMemoryCards 应为 function').toBe('function');
    expect(typeof state.setLinearMode, 'setLinearMode 应为 function').toBe('function');
    expect(typeof state.resetAll, 'resetAll 应为 function').toBe('function');
  });
});

// ======================== T02.8: settings 模块 ========================

describe('[T02.8] settings 模块在模拟 ArkWeb 内可加载 (验收点 S1/S2/S3/S4/S5/S6/S7)', () => {
  it('S1: SettingsPanel 是有效 React 组件', () => {
    expectIsReactComponent(SettingsPanel, 'SettingsPanel');
  });

  it('S2/S3/S4/S5/S6/S7: useSettingsStore 是有效 Zustand store + 含全部关键 actions', () => {
    expectIsZustandStore(useSettingsStore, 'useSettingsStore');
    const state = useSettingsStore.getState();
    expect(typeof state.setProvider, 'setProvider 应为 function').toBe('function');
    expect(typeof state.setTheme, 'setTheme 应为 function').toBe('function');
    expect(typeof state.setDifficulty, 'setDifficulty 应为 function').toBe('function');
    expect(typeof state.testConnection, 'testConnection 应为 function').toBe('function');
    expect(typeof state.exportSettings, 'exportSettings 应为 function').toBe('function');
    expect(typeof state.importSettings, 'importSettings 应为 function').toBe('function');
    expect(typeof state.incrementReadingSeconds, 'incrementReadingSeconds 应为 function').toBe('function');
    expect(typeof state.resetTodayIfNewDay, 'resetTodayIfNewDay 应为 function').toBe('function');
    expect(typeof state.resetAll, 'resetAll 应为 function').toBe('function');
  });

  it('S3: useSettingsStore.setTheme 支持 light / dark / sepia 三主题', () => {
    const { setTheme } = useSettingsStore.getState();
    setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
    setTheme('sepia');
    expect(useSettingsStore.getState().theme).toBe('sepia');
    setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('S4: useSettingsStore.setDifficulty clamp 1-5', () => {
    const { setDifficulty } = useSettingsStore.getState();
    setDifficulty(1);
    expect(useSettingsStore.getState().difficulty).toBe(1);
    setDifficulty(5);
    expect(useSettingsStore.getState().difficulty).toBe(5);
    setDifficulty(0); // clamp 到 1
    expect(useSettingsStore.getState().difficulty).toBe(1);
    setDifficulty(99); // clamp 到 5
    expect(useSettingsStore.getState().difficulty).toBe(5);
  });
});

// ======================== T02.9: dictionary 模块 ========================

describe('[T02.9] dictionary 模块在模拟 ArkWeb 内可加载 (验收点 D1/D2/D3/D8/D9)', () => {
  it('D1: WiktextractAdapter 是可构造 class + getDictionaryAdapter / resetDictionaryAdapter 工厂', () => {
    expect(WiktextractAdapter, 'WiktextractAdapter 应被导出').toBeDefined();
    expect(typeof WiktextractAdapter, 'WiktextractAdapter 应为 class/function').toBe('function');
    expectIsFunction(getDictionaryAdapter, 'getDictionaryAdapter');
    expectIsFunction(resetDictionaryAdapter, 'resetDictionaryAdapter');
  });

  it('D2/D3/D8: glossPersistentCache 导出 getCachedGloss / setCachedGloss / clearAllCachedGlosses / pruneExpiredEntries', () => {
    expectIsFunction(getCachedGloss, 'getCachedGloss');
    expectIsFunction(setCachedGloss, 'setCachedGloss');
    expectIsFunction(clearAllCachedGlosses, 'clearAllCachedGlosses');
    expectIsFunction(pruneExpiredEntries, 'pruneExpiredEntries');
  });

  it('D9: glossPersistentCache.getCachedGlossCount 是 function', () => {
    expectIsFunction(getCachedGlossCount, 'getCachedGlossCount');
  });

  it('LRUCache 是可构造 class (内存层缓存)', () => {
    expect(LRUCache, 'LRUCache 应被导出').toBeDefined();
    expect(typeof LRUCache, 'LRUCache 应为 class/function').toBe('function');
    const cache = new LRUCache<string>({ capacity: 100 });
    expect(cache, 'LRUCache 可实例化').toBeDefined();
  });
});

// ======================== T02.10: evaluation 模块 ========================

describe('[T02.10] evaluation 模块在模拟 ArkWeb 内可加载 (验收点 E1/E2/E5/E7)', () => {
  it('E1: evaluateAnswer 是 function', () => {
    expectIsFunction(evaluateAnswer, 'evaluateAnswer');
  });

  it('E2: glossAdapter.getGloss 是 function', () => {
    expectIsFunction(getGloss, 'getGloss');
  });

  it('E7: glossAdapter.computeSourceHash 是 function', () => {
    expectIsFunction(computeSourceHash, 'computeSourceHash');
  });

  it('glossAdapter.clearGlossCache 是 function (缓存维护)', () => {
    expectIsFunction(clearGlossCache, 'clearGlossCache');
  });

  it('E5: RemedyPanel 是有效 React 组件', () => {
    expectIsReactComponent(RemedyPanel, 'RemedyPanel');
  });
});

// ======================== T02.11: graduation 模块 ========================

describe('[T02.11] graduation 模块在模拟 ArkWeb 内可加载 (验收点 GR1)', () => {
  it('GR1: GraduationModal 是有效 React 组件', () => {
    expectIsReactComponent(GraduationModal, 'GraduationModal');
  });
});

// ======================== T02.12: home 模块 ========================

describe('[T02.12] home 模块在模拟 ArkWeb 内可加载 (验收点 H1/H2/H3/H4/H5/H6/H7/H8/H9)', () => {
  it('H1: HomePage 是有效 React 组件', () => {
    expectIsReactComponent(HomePage, 'HomePage');
  });

  it('H2: HeroSection 是有效 React 组件', () => {
    expectIsReactComponent(HeroSection, 'HeroSection');
  });

  it('H3: TodayCard 是有效 React 组件', () => {
    expectIsReactComponent(TodayCard, 'TodayCard');
  });

  it('H4: TodayReviewCard 是有效 React 组件', () => {
    expectIsReactComponent(TodayReviewCard, 'TodayReviewCard');
  });

  it('H5: CurrentLessonCard 是有效 React 组件', () => {
    expectIsReactComponent(CurrentLessonCard, 'CurrentLessonCard');
  });

  it('H6: AchievementWall 是有效 React 组件', () => {
    expectIsReactComponent(AchievementWall, 'AchievementWall');
  });

  it('H7: ProgressRing 是有效 React 组件', () => {
    expectIsReactComponent(ProgressRing, 'ProgressRing');
  });

  it('H8: StreakBadge 是有效 React 组件', () => {
    expectIsReactComponent(StreakBadge, 'StreakBadge');
  });

  it('H9: Dividers (BotanicalDivider + TornPaperDivider) 是有效 React 组件', () => {
    expectIsReactComponent(BotanicalDivider, 'BotanicalDivider');
    expectIsReactComponent(TornPaperDivider, 'TornPaperDivider');
  });
});

// ======================== T02.13: streak 模块 ========================

describe('[T02.13] streak 模块在模拟 ArkWeb 内可加载 (验收点 ST1/ST4/ST7)', () => {
  it('ST1/ST4/ST7: useStreakStore 是有效 Zustand store + 含 recordDay / reset', () => {
    expectIsZustandStore(useStreakStore, 'useStreakStore');
    const state = useStreakStore.getState();
    expect(typeof state.recordDay, 'recordDay 应为 function').toBe('function');
    expect(typeof state.reset, 'reset 应为 function').toBe('function');
    expect(typeof state.currentStreak, 'currentStreak 字段存在').toBe('number');
    expect(typeof state.longestStreak, 'longestStreak 字段存在').toBe('number');
  });
});

// ======================== T02.14: llm 模块 ========================

describe('[T02.14] llm 模块在模拟 ArkWeb 内可加载 (验收点 L1/L2/L3/L4/L5/L6/L7/L8/L9/L10)', () => {
  it('L1: router.generateWithFallback / testProviderConnection / resetProviderCache 是 function', () => {
    expectIsFunction(generateWithFallback, 'generateWithFallback');
    expectIsFunction(testProviderConnection, 'testProviderConnection');
    expectIsFunction(resetProviderCache, 'resetProviderCache');
  });

  it('L2: providerFactory.getProvider / getProviderName 是 function', () => {
    expectIsFunction(getProvider, 'getProvider');
    expectIsFunction(getProviderName, 'getProviderName');
  });

  it('L3: providerFactory.selectByWeight / parseGrayscale 是 function (灰度发布)', () => {
    expectIsFunction(selectByWeight, 'selectByWeight');
    expectIsFunction(parseGrayscale, 'parseGrayscale');
    // 验证 parseGrayscale 行为 (静态, 不调 LLM)
    expect(parseGrayscale(undefined)).toBe(100); // 默认 100% 灰度
    expect(parseGrayscale('0')).toBe(0);
    expect(parseGrayscale('50')).toBe(50);
  });

  it('L4: MockLLMProvider 是可构造 class (mock 模式)', () => {
    expect(MockLLMProvider, 'MockLLMProvider 应被导出').toBeDefined();
    expect(typeof MockLLMProvider, 'MockLLMProvider 应为 class/function').toBe('function');
  });

  it('L5: streamingProvider.streamingGenerate 是 function (SSE 流式生成)', () => {
    expectIsFunction(streamingGenerate, 'streamingGenerate');
  });

  it('L6: useOfflineModeStore 是有效 Zustand store + 含 setOffline / recordProviderWhenOffline / reset', () => {
    expectIsZustandStore(useOfflineModeStore, 'useOfflineModeStore');
    const state = useOfflineModeStore.getState();
    expect(typeof state.setOffline, 'setOffline 应为 function').toBe('function');
    expect(typeof state.recordProviderWhenOffline, 'recordProviderWhenOffline 应为 function').toBe('function');
    expect(typeof state.reset, 'reset 应为 function').toBe('function');
  });

  it('L7: jsonParser.parseLLMResponse / PassagePayloadSchema 是 function/object (jsonrepair + zod)', () => {
    expectIsFunction(parseLLMResponse, 'parseLLMResponse');
    expect(PassagePayloadSchema, 'PassagePayloadSchema 应被导出').toBeDefined();
    expect(typeof PassagePayloadSchema, 'PassagePayloadSchema 应为 zod schema object').toBe('object');
  });

  it('L8: llmAdapter.validateAndAlignPassagePayload / normalizePassagePayload 是 function', () => {
    expectIsFunction(validateAndAlignPassagePayload, 'validateAndAlignPassagePayload');
    expectIsFunction(normalizePassagePayload, 'normalizePassagePayload');
  });

  it('L9: levenshtein 是 function (模糊匹配距离计算)', () => {
    expectIsFunction(levenshtein, 'levenshtein');
    // 静态行为验证
    expect(levenshtein('apple', 'apple')).toBe(0);
    expect(levenshtein('apple', 'aple')).toBe(1);
  });

  it('L10: textNormalize.normalizeText 是 function (文本规范化)', () => {
    expectIsFunction(normalizeText, 'normalizeText');
  });
});

// ======================== T02 综合: 14 模块导出计数 ========================

describe('[T02 综合] 14 feature 模块在模拟 ArkWeb 内全部可加载 (无降级)', () => {
  it('14 个模块的代表性 entry point 全部非空 (一次性静态扫描)', () => {
    // 收集 14 个模块的代表性符号, 验证全部被成功 import (非 undefined)
    const moduleEntryPoints: Record<string, unknown> = {
      reading: ReadingSessionPage,
      review: ReviewSessionPage,
      grammar: GrammarPanel,
      analytics: AnalyticsPanel,
      achievements: AchievementListModal,
      course: CoursePathPage,
      wordlist: WordlistPage,
      settings: SettingsPanel,
      dictionary: WiktextractAdapter,
      evaluation: evaluateAnswer,
      graduation: GraduationModal,
      home: HomePage,
      streak: useStreakStore,
      llm: generateWithFallback,
    };

    const moduleNames = Object.keys(moduleEntryPoints);
    expect(moduleNames, '应收集 14 个模块').toHaveLength(14);

    for (const name of moduleNames) {
      expect(
        moduleEntryPoints[name],
        `模块 ${name} 的 entry point 不应为 undefined (ArkWeb 内可加载)`
      ).toBeDefined();
    }
  });

  it('14 个模块的 Zustand store 全部可 getState (无初始化错误)', () => {
    const stores: Record<string, { getState: () => unknown }> = {
      settings: useSettingsStore,
      readingSession: useReadingSessionStore,
      readingHistory: useReadingHistoryStore,
      memory: useMemoryStore,
      reviewSession: useReviewSessionStore,
      analytics: useAnalyticsStore,
      wordlist: useWordlistStore,
      achievements: useAchievementStore,
      streak: useStreakStore,
      offlineMode: useOfflineModeStore,
    };

    // 10 个 persist store + course store = 11 个 (checklist §4.1 列出 10 个, course 是额外的)
    const storeNames = Object.keys(stores);
    expect(storeNames.length, '应收集至少 10 个 persist store').toBeGreaterThanOrEqual(10);

    for (const name of storeNames) {
      const state = stores[name].getState();
      expect(
        state,
        `${name} store.getState() 不应抛错, 返回值不应为 undefined`
      ).toBeDefined();
    }
  });
});
