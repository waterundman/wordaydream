/**
 * v2.2.1 Stage 1 (Bug 2): useReadingSessionStore 竞态 + isReplay 测试.
 *
 * 覆盖 test_spec:
 * - T03 [critical]: loadFromHistory 取消 in-flight loadSession (abort signal 触发)
 * - T05 [non-critical]: loadFromHistory resetResolved=true → isReplay=false
 *
 * Mock 策略:
 * - T03: spy generatePassage (loadSession 应在 300ms 等待后 abort 检查处提前 return,
 *        不调用 generatePassage). 同步触发 loadFromHistory 中断 in-flight loadSession.
 * - T05: 直接调用 loadFromHistory, 不涉及 LLM, 无需 mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReadingSessionStore } from './useReadingSessionStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useReadingHistoryStore } from './useReadingHistoryStore';
import { useStreakStore } from '../../streak/store/useStreakStore';
import { useAchievementStore } from '../../achievements/store/useAchievementStore';
import * as passageGenModule from '../services/passageGenerator';
import type { Passage, TokenOccurrence } from '../../../types';

function makePassageWithTokens(resolvedFlags: boolean[]): Passage {
  const tokens: TokenOccurrence[] = resolvedFlags.map((isResolved, i) => ({
    id: `tok-${i}`,
    lexemeGroupId: `grp-${i}`,
    surfaceForm: `word${i}`,
    lemma: `word${i}`,
    objectiveDifficulty: 2,
    startIndex: i * 6,
    endIndex: i * 6 + 5,
    isResolved,
    isActive: false,
    kind: 'normal' as const,
    isCompound: false,
    alignmentStatus: 'perfect',
    originalOffset: 0,
  }));
  return {
    id: `test-passage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    language: 'en',
    difficulty: 2,
    text: tokens.map((t) => t.surfaceForm).join(' '),
    tokens,
    lexemeGroups: [],
    grammarPoints: [],
  };
}

function resetAllStores() {
  useMemoryStore.setState({ cards: new Map() });
  useReadingHistoryStore.setState({ history: [], maxHistory: 50 });
  useStreakStore.setState({ currentStreak: 0, lastStudyDate: null });
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

beforeEach(() => {
  resetAllStores();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAllStores();
});

describe('v2.2.1 Stage 1 (Bug 2 P0): loadFromHistory 取消 in-flight loadSession', () => {
  it('T03 [critical]: loadFromHistory 触发 abort, loadSession 不调用 generatePassage', async () => {
    // Mock generatePassage — 不应被调用 (loadSession 在 300ms 等待后 abort 检查处提前 return).
    // 即使被调用也返回一个可识别的 passage, 便于断言 session 未被 loadSession 覆盖.
    const generateMockPassage = makePassageWithTokens([false, false]);
    const generateSpy = vi
      .spyOn(passageGenModule, 'generatePassage')
      .mockResolvedValue(generateMockPassage);
    // Mock checkAndUnlock 避免成就引擎副作用 (loadSession 正常路径末尾会调用,
    // 但 abort 提前 return 时不会调用, 此 mock 仅作保护).
    vi.spyOn(useAchievementStore, 'getState').mockReturnValue({
      ...useAchievementStore.getState(),
      checkAndUnlock: vi.fn(),
    });

    // 1. 触发 loadSession (返回 Promise, 内部进入 300ms 等待)
    const loadSessionPromise = useReadingSessionStore.getState().loadSession('en', 2);

    // 2. 同步调用 loadFromHistory (在 loadSession 的 300ms 等待期间中断)
    const historyPassage = makePassageWithTokens([true, false]);
    useReadingSessionStore.getState().loadFromHistory(historyPassage, 'en', 2);

    // 3. 等待 loadSession 完成 (应在 abort 检查后提前 return)
    await loadSessionPromise;

    // 4. 断言: generatePassage 未被调用 (abort 在 300ms 等待后触发提前 return)
    expect(generateSpy).not.toHaveBeenCalled();

    // 5. 断言: session 是 loadFromHistory 的 passage, 未被 loadSession 覆盖
    const state = useReadingSessionStore.getState();
    expect(state.session).not.toBeNull();
    expect(state.session!.passage).toBe(historyPassage);
    expect(state.session!.passage.id).toBe(historyPassage.id);
  });
});

describe('v2.2.1 Stage 1 (Bug 2 P1): loadFromHistory resetResolved + isReplay', () => {
  it('T05 [non-critical]: resetResolved=true → isReplay=false (允许用户作答)', () => {
    const passage = makePassageWithTokens([true, false, true]);
    useReadingSessionStore
      .getState()
      .loadFromHistory(passage, 'en', 2, { resetResolved: true });

    const state = useReadingSessionStore.getState();
    expect(state.session).not.toBeNull();
    // resetResolved=true → isReplay=false, 让用户能真正作答 (非只读模式)
    expect(state.session!.isReplay).toBe(false);
    // resetResolved=true → resolvedTokens 清空
    expect(state.session!.resolvedTokens.size).toBe(0);
    // resetResolved=true → 所有 token.isResolved 置 false
    expect(state.session!.passage.tokens.every((t) => !t.isResolved)).toBe(true);
  });
});
