/**
 * v2.2.1 Stage 1 (Bug 1): passageGenerator 缓存清理测试.
 *
 * 覆盖 test_spec:
 * - T01 [critical]: loadSession 调用 clearPassageCache, 连续两次生成返回不同 passage
 * - T02 [critical]: generatePassage forceRefresh=true 时跳过缓存
 *
 * Mock 策略:
 * - mock generateWithFallback 返回合法 passage JSON (走 LLM 路径, 触发缓存写入)
 * - mock detectGrammarPoints 返回 [] (generatePassage 对此调用无 try-catch)
 * - T01: spy clearPassageCache (默认调用原实现, 真正清缓存), 验证 loadSession 调用它
 * - T02: 直接调用 generatePassage, 对比有无 forceRefresh 的缓存命中行为
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePassage, clearPassageCache } from './passageGenerator';
import * as passageGenModule from './passageGenerator';
import * as routerModule from '../../llm/services/router';
import * as grammarDetectorModule from '../../grammar/services/grammarDetector';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useReadingSessionStore } from '../store/useReadingSessionStore';
import { useReadingHistoryStore } from '../store/useReadingHistoryStore';
import { useStreakStore } from '../../streak/store/useStreakStore';
import { useAchievementStore } from '../../achievements/store/useAchievementStore';
import { clearWordlistCache } from '../../../data/wordlists';

// 合法英文 passage JSON (offsets 已校验, 满足 extractPassageJson slice 校验)
const enPassageText = 'The cat sat on the mat.';
const enPassageJson = JSON.stringify({
  language: 'en',
  difficulty: 2,
  text: enPassageText,
  tokens: [
    { lemma: 'cat', surfaceForm: 'cat', startIndex: 4, endIndex: 7, partOfSpeech: 'noun' },
    { lemma: 'sit', surfaceForm: 'sat', startIndex: 8, endIndex: 11, partOfSpeech: 'verb' },
  ],
});

function resetStoresForLoadSession() {
  useMemoryStore.setState({ cards: new Map() });
  useReadingHistoryStore.setState({ history: [], maxHistory: 50 });
  useStreakStore.setState({ currentStreak: 0, lastStudyDate: null });
  useWordlistStore.setState({
    progress: {},
    linearMode: false,
    schemaVersion: 2,
    dailyGoal: { words: 10, sessions: 1, date: new Date().toDateString() },
  });
  useReadingSessionStore.setState({
    session: null,
    activeOccurrenceId: null,
    hoveredGroupId: null,
    activeGrammarPointId: null,
    hoveredGrammarTypeId: null,
    isLoading: false,
    lastConfig: null,
    currentHistoryId: null,
  });
}

describe('v2.2.1 Stage 1 (Bug 1): loadSession 缓存清理', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    clearPassageCache();
    clearWordlistCache();
    resetStoresForLoadSession();
    useSettingsStore.setState((s) => ({
      llm: {
        ...s.llm,
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.5,
        timeout: 30,
        maxRetries: 2,
        streaming: false,
      },
    }));
    // mock checkAndUnlock 避免成就引擎副作用 (loadSession 末尾会调用)
    vi.spyOn(useAchievementStore, 'getState').mockReturnValue({
      ...useAchievementStore.getState(),
      checkAndUnlock: vi.fn(),
    });
  });

  afterEach(() => {
    clearPassageCache();
    clearWordlistCache();
    vi.restoreAllMocks();
    useWordlistStore.getState().resetAll();
    useMemoryStore.getState().resetAll();
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  it('T01 [critical]: loadSession 调用 clearPassageCache, 连续两次生成返回不同 passage', async () => {
    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({ text: enPassageJson });
    vi.spyOn(grammarDetectorModule, 'detectGrammarPoints').mockResolvedValue([]);
    // spy clearPassageCache: 默认调用原实现 (真正清缓存), 仅记录调用
    const clearSpy = vi.spyOn(passageGenModule, 'clearPassageCache');

    await useReadingSessionStore.getState().loadSession('en', 2);
    const id1 = useReadingSessionStore.getState().session?.passage.id;

    await useReadingSessionStore.getState().loadSession('en', 2);
    const id2 = useReadingSessionStore.getState().session?.passage.id;

    // loadSession 应调用 clearPassageCache (每次 loadSession 开头调用一次)
    expect(clearSpy).toHaveBeenCalled();
    // 连续两次生成应返回不同 passage (loadSession 间有 300ms 等待, id 基于 Date.now 必不同)
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });
});

describe('v2.2.1 Stage 1 (Bug 1): generatePassage forceRefresh', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    clearPassageCache();
    clearWordlistCache();
    useMemoryStore.setState({ cards: new Map() });
    useSettingsStore.setState((s) => ({
      llm: {
        ...s.llm,
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.5,
        timeout: 30,
        maxRetries: 2,
        streaming: false,
      },
    }));
  });

  afterEach(() => {
    clearPassageCache();
    clearWordlistCache();
    vi.restoreAllMocks();
    useWordlistStore.getState().resetAll();
    useMemoryStore.getState().resetAll();
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  it('T02 [critical]: forceRefresh=true 时跳过缓存 (无 forceRefresh 时命中缓存返回同一对象)', async () => {
    // 用计数器让每次 LLM 调用返回不同 text, 确保 forceRefresh 产物可区分 (即使 Date.now 同毫秒)
    let callCount = 0;
    vi.spyOn(routerModule, 'generateWithFallback').mockImplementation(async () => {
      callCount += 1;
      return {
        text: JSON.stringify({
          language: 'en',
          difficulty: 2,
          text: `The cat sat on the mat. #${callCount}`,
          tokens: [
            { lemma: 'cat', surfaceForm: 'cat', startIndex: 4, endIndex: 7, partOfSpeech: 'noun' },
            { lemma: 'sit', surfaceForm: 'sat', startIndex: 8, endIndex: 11, partOfSpeech: 'verb' },
          ],
        }),
      };
    });
    vi.spyOn(grammarDetectorModule, 'detectGrammarPoints').mockResolvedValue([]);

    // 首次: 缓存未命中, 走 LLM 路径 (callCount=1), 写入缓存
    const p1 = await generatePassage('en', 2, []);
    expect(p1.source).toBe('llm');
    expect(p1.text).toBe('The cat sat on the mat. #1');

    // 第二次 (无 forceRefresh): 缓存命中, 返回同一缓存对象 (同一引用, 不调用 LLM)
    const p2 = await generatePassage('en', 2, []);
    expect(p2).toBe(p1);

    // 第三次 (forceRefresh=true): 跳过缓存读取, 重新走 LLM 路径 (callCount=2), 返回新对象
    const p3 = await generatePassage('en', 2, [], undefined, true);
    expect(p3).not.toBe(p1);
    expect(p3.id).not.toBe(p1.id);
    expect(p3.source).toBe('llm');
    // callCount=2 (第二次调用缓存命中未走 LLM, 所以 forceRefresh 是第 2 次 LLM 调用)
    expect(p3.text).toBe('The cat sat on the mat. #2');
  });
});
