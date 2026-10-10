/**
 * v1.6.5 S2 / S4 — store 层行为测试 (SPEC §5 判据 4/6)
 *
 * S2: 每日新词目标可调, 且跨日重置只清零计数、不吞掉用户设定值 —— 后者是这次改动
 *     唯一容易做错的地方 (makeFreshDailyGoal 原本硬编码 10)。
 * S4: 批量删除一次 set 完成, 空集合与不存在的 id 都不应造成副作用。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  NEW_WORDS_TARGET_MAX,
  NEW_WORDS_TARGET_MIN,
  useWordlistStore,
} from './useWordlistStore';
import { useWrongWordsStore } from '../../review/store/useWrongWordsStore';
import type { WrongWordEntry } from '../../review/store/useWrongWordsStore';

function wrongEntry(cardId: string): WrongWordEntry {
  return {
    cardId,
    lemma: `w-${cardId}`,
    language: 'en',
    wrongCount: 2,
    lastWrongAt: 1_700_000_000_000,
  } as WrongWordEntry;
}

describe('v1.6.5 S2 每日新词目标', () => {
  beforeEach(() => {
    useWordlistStore.getState().setNewWordsTarget(10);
  });

  it('可设为区间内的任意整数', () => {
    useWordlistStore.getState().setNewWordsTarget(20);
    expect(useWordlistStore.getState().dailyGoal.newWordsTarget).toBe(20);
  });

  it('clamp 到区间并取整, 非有限值被忽略', () => {
    const { setNewWordsTarget } = useWordlistStore.getState();
    setNewWordsTarget(0);
    expect(useWordlistStore.getState().dailyGoal.newWordsTarget).toBe(
      NEW_WORDS_TARGET_MIN
    );
    setNewWordsTarget(9999);
    expect(useWordlistStore.getState().dailyGoal.newWordsTarget).toBe(
      NEW_WORDS_TARGET_MAX
    );
    setNewWordsTarget(7.6);
    expect(useWordlistStore.getState().dailyGoal.newWordsTarget).toBe(8);
    setNewWordsTarget(20);
    setNewWordsTarget(Number.NaN);
    expect(useWordlistStore.getState().dailyGoal.newWordsTarget).toBe(20);
  });

  it('跨日重置只清零 newWordsDone, 保留用户设定的目标', () => {
    useWordlistStore.getState().setNewWordsTarget(25);
    const store = useWordlistStore.getState();
    store.markWordLearning('en', 'apple');
    expect(useWordlistStore.getState().dailyGoal.newWordsDone).toBeGreaterThan(0);

    useWordlistStore.getState().resetDailyGoalIfNewDay('1999-01-01');

    const goal = useWordlistStore.getState().dailyGoal;
    expect(goal.date).toBe('1999-01-01');
    expect(goal.newWordsDone).toBe(0);
    expect(goal.newWordsTarget).toBe(25);
  });
});

describe('v1.6.5 S4 错词批量删除', () => {
  beforeEach(() => {
    useWrongWordsStore.setState({
      entries: [wrongEntry('a'), wrongEntry('b'), wrongEntry('c')],
    });
  });

  it('一次删除多条, 剩余集合正确', () => {
    useWrongWordsStore.getState().removeEntries(['a', 'c']);
    expect(useWrongWordsStore.getState().entries.map((e) => e.cardId)).toEqual(['b']);
  });

  it('空集合与未知 id 均不产生副作用', () => {
    useWrongWordsStore.getState().removeEntries([]);
    expect(useWrongWordsStore.getState().entries).toHaveLength(3);
    useWrongWordsStore.getState().removeEntries(['nope']);
    expect(useWrongWordsStore.getState().entries).toHaveLength(3);
  });
});
