/**
 * useWordlistStore 单元测试 (v1.6.0)
 *
 * 覆盖:
 * - 词表加载 (getLevelTotal)
 * - 进度派生 (syncFromMemoryCards → deriveStatus)
 * - 解锁逻辑 (isLevelUnlocked: 闯关 / 自由模式)
 * - markWordLearning / markWordMastered (含不降级)
 * - getUnlearnedWords / getLearningWords
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCard, DifficultyLevel } from '../../../types';

function makeCard(
  partial: Partial<MemoryCard> &
    Pick<MemoryCard, 'lexemeGroupId' | 'lemma' | 'objectiveDifficulty'>,
): MemoryCard {
  return {
    id: partial.id ?? `card-${partial.lexemeGroupId}`,
    lexemeGroupId: partial.lexemeGroupId,
    lemma: partial.lemma,
    objectiveDifficulty: partial.objectiveDifficulty,
    firstLearnedAt: partial.firstLearnedAt ?? 1_700_000_000_000,
    lastReviewAt: partial.lastReviewAt ?? partial.firstLearnedAt ?? 1_700_000_000_000,
    learningSteps: partial.learningSteps ?? 0,
    due: partial.due ?? 0,
    stability: partial.stability ?? 0,
    difficulty: partial.difficulty ?? 0,
    elapsedDays: partial.elapsedDays ?? 0,
    scheduledDays: partial.scheduledDays ?? 0,
    reps: partial.reps ?? 0,
    lapses: partial.lapses ?? 0,
    status: partial.status ?? 'new',
    language: partial.language,
  };
}

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  vi.resetModules();
});

afterEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  vi.resetModules();
});

describe('useWordlistStore — 词表加载', () => {
  it('getLevelTotal 返回英语 A1 词表总词数 (80)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const total = await useWordlistStore.getState().getLevelTotal('en', 1);
    expect(total).toBe(80);
  });

  it('getLevelTotal 对 C1 (难度 5) 返回 0 (无内置词表)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const total = await useWordlistStore.getState().getLevelTotal('en', 5);
    expect(total).toBe(0);
  });

  it('getLevelTotalSync 在词表未加载时返回 0', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    expect(useWordlistStore.getState().getLevelTotalSync('en', 1)).toBe(0);
  });

  it('getLevelTotalSync 在词表加载后返回正确数量', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    await useWordlistStore.getState().getLevelTotal('en', 1);
    expect(useWordlistStore.getState().getLevelTotalSync('en', 1)).toBe(80);
  });
});

describe('useWordlistStore — 进度派生 (syncFromMemoryCards)', () => {
  it('new 卡片 → unseen', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const cards = new Map([
      ['g1', makeCard({
        lexemeGroupId: 'g1',
        lemma: 'be',
        objectiveDifficulty: 1,
        language: 'en',
        status: 'new',
        reps: 0,
      })],
    ]);
    useWordlistStore.getState().syncFromMemoryCards(cards);
    expect(useWordlistStore.getState().getWordStatus('en', 'be')).toBe('unseen');
  });

  it('review && reps>=2 && encounterCount>=2 → mastered (v2 语境闭环)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    // 先让 'be' 进入 progress (markWordLearning 创建记录)
    useWordlistStore.getState().markWordLearning('en', 'be');
    // 在 2 个不同 passage 中相遇
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-a');
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-b');
    const cards = new Map([
      ['g1', makeCard({
        lexemeGroupId: 'g1',
        lemma: 'be',
        objectiveDifficulty: 1,
        language: 'en',
        status: 'review',
        reps: 2,
        // v1.6.1 Stage 1: 高 stability + 刚复习 → retrievability >= 0.9 → mastered
        stability: 100,
        lastReviewAt: Date.now(),
      })],
    ]);
    useWordlistStore.getState().syncFromMemoryCards(cards);
    expect(useWordlistStore.getState().getWordStatus('en', 'be')).toBe('mastered');
  });

  it('review && reps>=2 && enc>=2 但 retrievability<0.9 → learning (v1.6.1 Stage 1 衰减降级)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordLearning('en', 'be');
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-a');
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-b');
    const cards = new Map([
      ['g1', makeCard({
        lexemeGroupId: 'g1',
        lemma: 'be',
        objectiveDifficulty: 1,
        language: 'en',
        status: 'review',
        reps: 2,
        // v1.6.1 Stage 1: 低 stability + 远期 lastReviewAt → retrievability < 0.9 → 降级 learning
        stability: 0.5,
        lastReviewAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      })],
    ]);
    useWordlistStore.getState().syncFromMemoryCards(cards);
    expect(useWordlistStore.getState().getWordStatus('en', 'be')).toBe('learning');
  });

  it('review && reps>=2 但 encounterCount<2 → learning (未达语境闭环)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordLearning('en', 'be');
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-a'); // 只 1 次
    const cards = new Map([
      ['g1', makeCard({
        lexemeGroupId: 'g1',
        lemma: 'be',
        objectiveDifficulty: 1,
        language: 'en',
        status: 'review',
        reps: 2,
      })],
    ]);
    useWordlistStore.getState().syncFromMemoryCards(cards);
    expect(useWordlistStore.getState().getWordStatus('en', 'be')).toBe('learning');
  });

  it('recordEncounter 按 passageId 去重: 同一篇多次答对只算一次', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordLearning('en', 'be');
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-a');
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-a');
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-a');
    const progress = useWordlistStore.getState().progress['en:be'];
    expect(progress.encounterCount).toBe(1);
    expect(progress.lastEncounterPassageId).toBe('passage-a');
  });

  it('review && reps<2 → learning', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const cards = new Map([
      ['g1', makeCard({
        lexemeGroupId: 'g1',
        lemma: 'be',
        objectiveDifficulty: 1,
        language: 'en',
        status: 'review',
        reps: 1,
      })],
    ]);
    useWordlistStore.getState().syncFromMemoryCards(cards);
    expect(useWordlistStore.getState().getWordStatus('en', 'be')).toBe('learning');
  });

  it('learning → learning', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const cards = new Map([
      ['g1', makeCard({
        lexemeGroupId: 'g1',
        lemma: 'be',
        objectiveDifficulty: 1,
        language: 'en',
        status: 'learning',
        reps: 1,
      })],
    ]);
    useWordlistStore.getState().syncFromMemoryCards(cards);
    expect(useWordlistStore.getState().getWordStatus('en', 'be')).toBe('learning');
  });

  it('无 language 的卡片被跳过', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const cards = new Map([
      ['g1', makeCard({
        lexemeGroupId: 'g1',
        lemma: 'unknown',
        objectiveDifficulty: 1,
        language: undefined,
        status: 'new',
      })],
    ]);
    useWordlistStore.getState().syncFromMemoryCards(cards);
    expect(useWordlistStore.getState().getWordStatus('en', 'unknown')).toBe('unseen');
  });
});

describe('useWordlistStore — 解锁逻辑 (isLevelUnlocked)', () => {
  it('A1 (难度 1) 默认解锁', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    expect(useWordlistStore.getState().isLevelUnlocked('en', 1)).toBe(true);
  });

  it('自由模式: 所有等级全解锁', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().setLinearMode(false);
    for (let lvl = 1; lvl <= 5; lvl++) {
      expect(
        useWordlistStore.getState().isLevelUnlocked('en', lvl as DifficultyLevel)
      ).toBe(true);
    }
  });

  it('闯关模式: 上一级词表未加载 → 容错放行 (返回 true)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    // A1 词表未加载, isLevelUnlocked('en', 2) 应容错放行
    expect(useWordlistStore.getState().isLevelUnlocked('en', 2)).toBe(true);
  });

  it('闯关模式: 上一级 0% mastered → 下一级锁定', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    // 加载 A1 词表 (80 词), 不标记任何 mastered
    await useWordlistStore.getState().getLevelTotal('en', 1);
    expect(useWordlistStore.getState().isLevelUnlocked('en', 2)).toBe(false);
  });

  it('闯关模式: 上一级 ≥80% mastered → 下一级解锁', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    // 加载 A1 词表 (80 词)
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    // 标记 64 词 (80%) 为 mastered
    if (wordlist) {
      for (let i = 0; i < 64; i++) {
        useWordlistStore.getState().markWordMastered('en', wordlist.words[i].lemma);
      }
    }
    expect(useWordlistStore.getState().isLevelUnlocked('en', 2)).toBe(true);
  });

  it('闯关模式: 上一级 79% mastered → 下一级仍锁定', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    // 标记 63 词 (78.75%) 为 mastered — 差 1 词不到 80%
    if (wordlist) {
      for (let i = 0; i < 63; i++) {
        useWordlistStore.getState().markWordMastered('en', wordlist.words[i].lemma);
      }
    }
    expect(useWordlistStore.getState().isLevelUnlocked('en', 2)).toBe(false);
  });
});

describe('useWordlistStore — markWordLearning / markWordMastered', () => {
  it('markWordLearning 标记词为 learning', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordLearning('en', 'test');
    expect(useWordlistStore.getState().getWordStatus('en', 'test')).toBe('learning');
  });

  it('markWordMastered 标记词为 mastered', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordMastered('en', 'test');
    expect(useWordlistStore.getState().getWordStatus('en', 'test')).toBe('mastered');
  });

  it('markWordLearning 不降级: 已 mastered 不回退到 learning', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordMastered('en', 'test');
    useWordlistStore.getState().markWordLearning('en', 'test');
    expect(useWordlistStore.getState().getWordStatus('en', 'test')).toBe('mastered');
  });

  it('大小写不敏感: BE 和 be 视为同一词', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordMastered('en', 'BE');
    expect(useWordlistStore.getState().getWordStatus('en', 'be')).toBe('mastered');
    expect(useWordlistStore.getState().getWordStatus('en', 'BE')).toBe('mastered');
  });
});

describe('useWordlistStore — getUnlearnedWords / getLearningWords', () => {
  it('getUnlearnedWordsSync 排除 learning 和 mastered 词', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (wordlist) {
      useWordlistStore.getState().markWordLearning('en', wordlist.words[0].lemma);
      useWordlistStore.getState().markWordMastered('en', wordlist.words[1].lemma);
    }
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('en', 1, 100);
    expect(unlearned).not.toContain(wordlist?.words[0].lemma);
    expect(unlearned).not.toContain(wordlist?.words[1].lemma);
    expect(unlearned.length).toBe(78); // 80 - 2
  });

  it('getLearningWordsSync 只返回 learning 词', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    if (wordlist) {
      useWordlistStore.getState().markWordLearning('en', wordlist.words[0].lemma);
      useWordlistStore.getState().markWordMastered('en', wordlist.words[1].lemma);
    }
    const learning = useWordlistStore.getState().getLearningWordsSync('en', 1, 100);
    expect(learning).toContain(wordlist?.words[0].lemma);
    expect(learning).not.toContain(wordlist?.words[1].lemma);
    expect(learning.length).toBe(1);
  });

  it('getUnlearnedWordsSync 尊重 limit 参数', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('en', 1, 5);
    expect(unlearned.length).toBe(5);
  });

  it('getMasteredCount / getLearnedCount 正确统计', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    if (wordlist) {
      useWordlistStore.getState().markWordMastered('en', wordlist.words[0].lemma);
      useWordlistStore.getState().markWordLearning('en', wordlist.words[1].lemma);
    }
    expect(useWordlistStore.getState().getMasteredCount('en', 1)).toBe(1);
    expect(useWordlistStore.getState().getLearnedCount('en', 1)).toBe(2); // learning + mastered
  });
});

describe('useWordlistStore — resetAll', () => {
  it('resetAll 清空 progress 并重置 linearMode', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordMastered('en', 'test');
    useWordlistStore.getState().setLinearMode(false);
    useWordlistStore.getState().resetAll();
    expect(useWordlistStore.getState().getWordStatus('en', 'test')).toBe('unseen');
    expect(useWordlistStore.getState().linearMode).toBe(true);
  });
});

// === v1.6.0 Stage 3.5-6: dailyGoal 测试 ===
describe('useWordlistStore — dailyGoal (v1.6.0 Stage 3.5-6)', () => {
  it('初始 dailyGoal: newWordsDone=0, reviewsDone=0, newWordsTarget=10', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const goal = useWordlistStore.getState().dailyGoal;
    expect(goal.newWordsDone).toBe(0);
    expect(goal.reviewsDone).toBe(0);
    expect(goal.newWordsTarget).toBe(10);
  });

  it('markWordLearning unseen→learning 时 newWordsDone++', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const before = useWordlistStore.getState().dailyGoal.newWordsDone;
    useWordlistStore.getState().markWordLearning('en', 'newword1');
    expect(useWordlistStore.getState().dailyGoal.newWordsDone).toBe(before + 1);
  });

  it('markWordLearning 已 learning 时不重复计数 newWordsDone', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordLearning('en', 'learningword');
    const afterFirst = useWordlistStore.getState().dailyGoal.newWordsDone;
    useWordlistStore.getState().markWordLearning('en', 'learningword');
    expect(useWordlistStore.getState().dailyGoal.newWordsDone).toBe(afterFirst);
  });

  it('markWordLearning 已 mastered 时不计数 (不降级)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordMastered('en', 'masteredword');
    const before = useWordlistStore.getState().dailyGoal.newWordsDone;
    useWordlistStore.getState().markWordLearning('en', 'masteredword');
    expect(useWordlistStore.getState().dailyGoal.newWordsDone).toBe(before);
  });

  it('recordReview 时 reviewsDone++', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const before = useWordlistStore.getState().dailyGoal.reviewsDone;
    useWordlistStore.getState().recordReview();
    expect(useWordlistStore.getState().dailyGoal.reviewsDone).toBe(before + 1);
  });

  it('resetDailyGoalIfNewDay 同日不重置', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().recordReview();
    const before = useWordlistStore.getState().dailyGoal;
    useWordlistStore.getState().resetDailyGoalIfNewDay();
    expect(useWordlistStore.getState().dailyGoal).toEqual(before);
  });

  it('resetDailyGoalIfNewDay 跨日重置 done 计数', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().recordReview();
    useWordlistStore.getState().markWordLearning('en', 'word1');
    expect(useWordlistStore.getState().dailyGoal.reviewsDone).toBe(1);
    expect(useWordlistStore.getState().dailyGoal.newWordsDone).toBe(1);
    useWordlistStore.getState().resetDailyGoalIfNewDay('2020-01-01');
    const goal = useWordlistStore.getState().dailyGoal;
    expect(goal.date).toBe('2020-01-01');
    expect(goal.newWordsDone).toBe(0);
    expect(goal.reviewsDone).toBe(0);
    expect(goal.newWordsTarget).toBe(10);
  });

  it('recordReview 跨日自动重置再计数', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    // 模拟昨天的 dailyGoal
    useWordlistStore.setState({
      dailyGoal: { date: '2020-01-01', newWordsTarget: 10, newWordsDone: 5, reviewsTarget: 0, reviewsDone: 3 },
    });
    useWordlistStore.getState().recordReview();
    const goal = useWordlistStore.getState().dailyGoal;
    expect(goal.date).not.toBe('2020-01-01');
    expect(goal.reviewsDone).toBe(1);
    expect(goal.newWordsDone).toBe(0);
  });

  it('resetAll 重置 dailyGoal', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().recordReview();
    useWordlistStore.getState().markWordLearning('en', 'word1');
    useWordlistStore.getState().resetAll();
    expect(useWordlistStore.getState().dailyGoal.newWordsDone).toBe(0);
    expect(useWordlistStore.getState().dailyGoal.reviewsDone).toBe(0);
    expect(useWordlistStore.getState().dailyGoal.newWordsTarget).toBe(10);
  });
});

// === v1.6.0 Stage 3.5-3: getUnlearnedWordsSync priority+topic 排序测试 ===
describe('useWordlistStore — getUnlearnedWordsSync priority+topic 排序 (v1.6.0 Stage 3.5-3)', () => {
  it('按 priority 升序排序 (priority=1 优先于默认 2)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (wordlist) {
      // 给前 3 个词加不同 priority (打乱原频率顺序)
      wordlist.words[0] = { ...wordlist.words[0], priority: 3 };
      wordlist.words[1] = { ...wordlist.words[1], priority: 1 };
      wordlist.words[2] = { ...wordlist.words[2], priority: 1 };
    }
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('en', 1, 5);
    // priority=1 的两个词排最前
    expect(unlearned[0]).toBe(wordlist!.words[1].lemma);
    expect(unlearned[1]).toBe(wordlist!.words[2].lemma);
    // priority=3 的 words[0] 排到最后 (limit=5 只取前 5, 不含 words[0])
    expect(unlearned).not.toContain(wordlist!.words[0].lemma);
  });

  it('同 priority 按 topic 聚簇 (localeCompare 排序)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (wordlist) {
      // 同 priority=1, 不同 topic
      wordlist.words[0] = { ...wordlist.words[0], priority: 1, topic: 'food' };
      wordlist.words[1] = { ...wordlist.words[1], priority: 1, topic: 'core' };
      wordlist.words[2] = { ...wordlist.words[2], priority: 1, topic: 'family' };
    }
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('en', 1, 3);
    // topic 按 localeCompare: core < family < food
    expect(unlearned[0]).toBe(wordlist!.words[1].lemma); // core
    expect(unlearned[1]).toBe(wordlist!.words[2].lemma); // family
    expect(unlearned[2]).toBe(wordlist!.words[0].lemma); // food
  });

  it('无 priority/topic 的词表保持原顺序 (默认 priority=2, topic="")', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    // 不添加任何 priority/topic, 验证默认顺序 = JSON 原顺序
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('en', 1, 5);
    expect(unlearned[0]).toBe(wordlist!.words[0].lemma);
    expect(unlearned[1]).toBe(wordlist!.words[1].lemma);
    expect(unlearned[4]).toBe(wordlist!.words[4].lemma);
  });
});

// === v1.6.0 Stage 1: 毕业机制 (checkLevelCompletion / checkCourseCompletion) ===
describe('useWordlistStore — 毕业机制 (v1.6.0 Stage 1)', () => {
  it('T01: checkLevelCompletion: 当前等级 100% mastered 返回 true', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    // 加载 A1 词表 (80 词)
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    // 标记全部词为 mastered
    if (wordlist) {
      for (const entry of wordlist.words) {
        useWordlistStore.getState().markWordMastered('en', entry.lemma);
      }
    }
    expect(useWordlistStore.getState().checkLevelCompletion('en', 1)).toBe(true);
  });

  it('T02: checkLevelCompletion: 80% mastered (解锁但未毕业) 返回 false', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    // 加载 A1 词表 (80 词)
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    // 标记 64 词 (80%) 为 mastered — 满足 isLevelUnlocked 80% 阈值但不满足 100% 毕业
    if (wordlist) {
      for (let i = 0; i < 64; i++) {
        useWordlistStore.getState().markWordMastered('en', wordlist.words[i].lemma);
      }
    }
    expect(useWordlistStore.getState().checkLevelCompletion('en', 1)).toBe(false);
  });

  it('T03: checkLevelCompletion: C1 (难度5无词表) 返回 false, 不误触发', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    // C1 (难度5) 无词表, 永远不触发毕业
    expect(useWordlistStore.getState().checkLevelCompletion('en', 5)).toBe(false);
  });

  it('T04: checkCourseCompletion: A1-B2 全部 100% 返回 true', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    // 加载并标记难度 1-4 (A1-B2) 全部 mastered
    for (let d = 1; d <= 4; d++) {
      await useWordlistStore.getState().getLevelTotal('en', d as DifficultyLevel);
      const wordlist = getCachedWordlist('en', d as DifficultyLevel);
      expect(wordlist).not.toBeNull();
      if (wordlist) {
        for (const entry of wordlist.words) {
          useWordlistStore.getState().markWordMastered('en', entry.lemma);
        }
      }
    }
    expect(useWordlistStore.getState().checkCourseCompletion('en')).toBe(true);
  });

  it('T05: levelComplete 闭环: 100% mastered 时下一等级 isLevelUnlocked 返回 true', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    // 加载 A1 词表并全部标记 mastered (100% 毕业)
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (wordlist) {
      for (const entry of wordlist.words) {
        useWordlistStore.getState().markWordMastered('en', entry.lemma);
      }
    }
    // 验证 A1 100% 毕业
    expect(useWordlistStore.getState().checkLevelCompletion('en', 1)).toBe(true);
    // 验证下一等级 A2 已解锁 (100% > 80% 阈值, 由 isLevelUnlocked 自然保证)
    expect(useWordlistStore.getState().isLevelUnlocked('en', 2)).toBe(true);
  });
});

// === v1.6.0 Stage 3.6-C: 复习编排 (reviewsTarget + persist migration v4) ===
describe('useWordlistStore — 复习编排 (v1.6.0 Stage 3.6-C)', () => {
  it('T11: setReviewsTarget 设置 dailyGoal.reviewsTarget = dueCards.length', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    // 初始 reviewsTarget 应为 0 (makeFreshDailyGoal 默认)
    expect(useWordlistStore.getState().dailyGoal.reviewsTarget).toBe(0);
    // 模拟 App.tsx 从 dueCards.length 计算并设置
    useWordlistStore.getState().setReviewsTarget(5);
    expect(useWordlistStore.getState().dailyGoal.reviewsTarget).toBe(5);
    // 其他字段不受影响
    expect(useWordlistStore.getState().dailyGoal.reviewsDone).toBe(0);
    expect(useWordlistStore.getState().dailyGoal.newWordsTarget).toBe(10);
  });

  it('T12: persist migration v3→v4: 旧 dailyGoal 补 reviewsTarget: 0', async () => {
    // 模拟 v3 持久化状态 (dailyGoal 无 reviewsTarget 字段)
    const v3Persisted = {
      state: {
        progress: {},
        linearMode: true,
        schemaVersion: 3,
        dailyGoal: {
          date: '2020-01-01',
          newWordsTarget: 10,
          newWordsDone: 3,
          reviewsDone: 2,
          // 注意: 无 reviewsTarget 字段 (v3 schema)
        },
      },
      version: 3,
    };
    window.localStorage.setItem(
      'wordaydream:wordlist',
      JSON.stringify(v3Persisted),
    );

    // 重新 import 触发 hydrate + migrate (v3→v4)
    const { useWordlistStore } = await import('./useWordlistStore');
    const goal = useWordlistStore.getState().dailyGoal;
    // migrate 应补 reviewsTarget: 0
    expect(goal.reviewsTarget).toBe(0);
    // 原有字段保留
    expect(goal.reviewsDone).toBe(2);
    expect(goal.newWordsDone).toBe(3);
    expect(goal.date).toBe('2020-01-01');
    // schemaVersion 升级到 4
    expect(useWordlistStore.getState().schemaVersion).toBe(4);
  });
});

// === v1.6.1 Stage 1: retrievability 衰减判定 (替代 30 天窗口) ===
describe('useWordlistStore — v1.6.1 Stage 1: retrievability 衰减判定', () => {
  it('T01: getRetrievability 返回 [0,1] 范围, 复用 fsrsCard 构造逻辑', async () => {
    const { getRetrievability } = await import('../../review/services/schedulerAdapter');
    const card = makeCard({
      lexemeGroupId: 'g1',
      lemma: 'be',
      objectiveDifficulty: 1,
      language: 'en',
      status: 'review',
      reps: 3,
      stability: 10,
      lastReviewAt: Date.now() - 24 * 60 * 60 * 1000,
    });
    const r = getRetrievability(card);
    expect(typeof r).toBe('number');
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });

  it('T02: retrievability >= 0.9 && reps>=2 && enc>=2 → mastered', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordLearning('en', 'be');
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-a');
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-b');
    // 高 stability + 刚复习 → retrievability ≈ 1.0 >= 0.9
    const cards = new Map([
      ['g1', makeCard({
        lexemeGroupId: 'g1',
        lemma: 'be',
        objectiveDifficulty: 1,
        language: 'en',
        status: 'review',
        reps: 2,
        stability: 100,
        lastReviewAt: Date.now(),
      })],
    ]);
    useWordlistStore.getState().syncFromMemoryCards(cards);
    expect(useWordlistStore.getState().getWordStatus('en', 'be')).toBe('mastered');
  });

  it('T03: retrievability < 0.9 && reps>=2 && enc>=2 → learning (替代原 30 天窗口)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    useWordlistStore.getState().markWordLearning('en', 'be');
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-a');
    useWordlistStore.getState().recordEncounter('en', 'be', 'passage-b');
    // 低 stability + 60 天前复习 → retrievability < 0.9
    const cards = new Map([
      ['g1', makeCard({
        lexemeGroupId: 'g1',
        lemma: 'be',
        objectiveDifficulty: 1,
        language: 'en',
        status: 'review',
        reps: 2,
        stability: 0.5,
        lastReviewAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      })],
    ]);
    useWordlistStore.getState().syncFromMemoryCards(cards);
    expect(useWordlistStore.getState().getWordStatus('en', 'be')).toBe('learning');
  });

  it('T04: reps<2 或 enc<2 → learning (接触次数护栏保留)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    // 子情况 a: reps<2 (enc>=2 但 reps=1)
    useWordlistStore.getState().markWordLearning('en', 'repsLow');
    useWordlistStore.getState().recordEncounter('en', 'repsLow', 'passage-a');
    useWordlistStore.getState().recordEncounter('en', 'repsLow', 'passage-b');
    const cardsRepsLow = new Map([
      ['g1', makeCard({
        lexemeGroupId: 'g1',
        lemma: 'repsLow',
        objectiveDifficulty: 1,
        language: 'en',
        status: 'review',
        reps: 1,
        stability: 100,
        lastReviewAt: Date.now(),
      })],
    ]);
    useWordlistStore.getState().syncFromMemoryCards(cardsRepsLow);
    expect(useWordlistStore.getState().getWordStatus('en', 'repsLow')).toBe('learning');

    // 子情况 b: enc<2 (reps>=2 但 enc=1)
    useWordlistStore.getState().markWordLearning('en', 'encLow');
    useWordlistStore.getState().recordEncounter('en', 'encLow', 'passage-a');
    const cardsEncLow = new Map([
      ['g2', makeCard({
        lexemeGroupId: 'g2',
        lemma: 'encLow',
        objectiveDifficulty: 1,
        language: 'en',
        status: 'review',
        reps: 3,
        stability: 100,
        lastReviewAt: Date.now(),
      })],
    ]);
    useWordlistStore.getState().syncFromMemoryCards(cardsEncLow);
    expect(useWordlistStore.getState().getWordStatus('en', 'encLow')).toBe('learning');
  });
});

// === v1.6.1 Stage 2: 语义混淆避让调度层 ===
describe('useWordlistStore — v1.6.1 Stage 2: 语义混淆避让', () => {
  it('T05: learning 含 affect → getUnlearnedWordsSync 排除 effect (语义冲突避让)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    // 加载 A2 词表 (含 affect→["effect"] 标注)
    await useWordlistStore.getState().getLevelTotal('en', 2);
    const wordlist = getCachedWordlist('en', 2);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;
    // effect 不在 a2.json 中, 临时注入以验证过滤逻辑
    wordlist.words.push({ lemma: 'effect', pos: 'noun', translation: '效果', cefr: 'A2' });
    // 标记 affect 为 learning
    useWordlistStore.getState().markWordLearning('en', 'affect');
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('en', 2, 200);
    // effect 应被排除 (affect 正在 learning, affect.semanticConflicts 含 effect)
    expect(unlearned).not.toContain('effect');
    // affect 自身也排除 (learning 状态)
    expect(unlearned).not.toContain('affect');
    // 其他词不受影响
    expect(unlearned).toContain('accept');
  });

  it('T06: 词表无 semanticConflicts 字段 (v1 词表) → 过滤逻辑跳过, 行为不变', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    // A1 词表无 semanticConflicts 字段 (v1 词表)
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;
    // 确认 A1 词表无 semanticConflicts 字段
    expect(wordlist.words[0].semanticConflicts).toBeUndefined();
    // 标记 2 个词为 learning
    useWordlistStore.getState().markWordLearning('en', wordlist.words[0].lemma);
    useWordlistStore.getState().markWordLearning('en', wordlist.words[1].lemma);
    // getUnlearnedWordsSync 应仅排除 learning/mastered 词, 无语义冲突过滤
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('en', 1, 200);
    expect(unlearned.length).toBe(78); // 80 - 2 learning, 无额外过滤
    expect(unlearned).not.toContain(wordlist.words[0].lemma);
    expect(unlearned).not.toContain(wordlist.words[1].lemma);
  });

  it('T07: 双向标注一致性 — affect→effect 且 effect→affect (互斥过滤)', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    await useWordlistStore.getState().getLevelTotal('en', 2);
    const wordlist = getCachedWordlist('en', 2);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;
    // 验证 a2.json 中 affect 标注 semanticConflicts: ["effect"]
    const affectEntry = wordlist.words.find((w) => w.lemma === 'affect');
    expect(affectEntry).toBeDefined();
    expect(affectEntry!.semanticConflicts).toEqual(['effect']);
    // effect 不在 a2.json 中, 临时注入并双向标注
    wordlist.words.push({ lemma: 'effect', pos: 'noun', translation: '效果', cefr: 'A2', semanticConflicts: ['affect'] });
    // 反向验证: effect 为 learning → affect 被排除
    useWordlistStore.getState().markWordLearning('en', 'effect');
    const unlearnedReverse = useWordlistStore.getState().getUnlearnedWordsSync('en', 2, 200);
    expect(unlearnedReverse).not.toContain('affect');
    expect(unlearnedReverse).not.toContain('effect');
  });

  it('T08: 过滤后剩余词数 < limit 不回填, 保持优先级顺序', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    const { getCachedWordlist } = await import('../../../data/wordlists');
    // 使用 A1 词表 (无 semanticConflicts, 手动注入冲突对)
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;
    // 给 words[0] 加 semanticConflicts 指向 words[1..3]
    const conflictTargets = [wordlist.words[1].lemma, wordlist.words[2].lemma, wordlist.words[3].lemma];
    wordlist.words[0] = { ...wordlist.words[0], semanticConflicts: conflictTargets };
    // 标记 words[0] 为 learning (触发冲突过滤)
    useWordlistStore.getState().markWordLearning('en', wordlist.words[0].lemma);
    // limit=100 远大于剩余词数, 验证不回填
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('en', 1, 100);
    // 80 - 1 (learning) = 79 unlearned; 冲突过滤再排除 3 (words[1..3]) = 76
    expect(unlearned.length).toBe(76);
    expect(unlearned.length).toBeLessThan(100); // 不回填至 limit
    // 验证冲突词被排除
    expect(unlearned).not.toContain(wordlist.words[1].lemma);
    expect(unlearned).not.toContain(wordlist.words[2].lemma);
    expect(unlearned).not.toContain(wordlist.words[3].lemma);
  });
});

// === v1.6.1 Stage 3: 德语 A1 词表落地 ===
describe('useWordlistStore — v1.6.1 Stage 3: 德语 A1 词表', () => {
  it('T09: loadWordlist("de", 1) 返回非 null, words.length > 0', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 1);
    expect(wordlist).not.toBeNull();
    expect(wordlist!.language).toBe('de');
    expect(wordlist!.level).toBe('A1');
    expect(wordlist!.difficulty).toBe(1);
    expect(wordlist!.version).toBe('2.0.0');
    expect(wordlist!.words.length).toBeGreaterThan(0);
    // total 字段与 words.length 一致
    expect(wordlist!.words.length).toBe(wordlist!.total);
  });

  it('T10: loadWordlist("de", 5) 返回 null (C1 不落地, B2 已落地)', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 5);
    expect(wordlist).toBeNull();
  });

  it('T11: getUnlearnedWordsSync("de", 1, 8) 返回 <=8 个德语 lemma', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    // 先加载德语 A1 词表
    await useWordlistStore.getState().getLevelTotal('de', 1);
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('de', 1, 8);
    expect(unlearned.length).toBeLessThanOrEqual(8);
    expect(unlearned.length).toBeGreaterThan(0);
  });

  it('T12: 德语名词 lemma 首字母大写 (Bahnhof, 不是 bahnhof)', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;
    const nouns = wordlist.words.filter((w) => w.pos === 'noun');
    expect(nouns.length).toBeGreaterThan(0);
    for (const noun of nouns) {
      // 德语名词首字母必须大写 (A-Z, Ä, Ö, Ü)
      expect(noun.lemma[0]).toMatch(/[A-ZÄÖÜ]/);
    }
  });
});

// === v1.9.0 Stage 1: 德语 A2 词表落地 ===
describe('useWordlistStore — v1.9.0 Stage 1: 德语 A2 词表', () => {
  it('T13: loadWordlist("de", 2) 返回非 null, level=A2, difficulty=2, version=2.0.0, words>=700', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 2);
    expect(wordlist).not.toBeNull();
    expect(wordlist!.language).toBe('de');
    expect(wordlist!.level).toBe('A2');
    expect(wordlist!.difficulty).toBe(2);
    expect(wordlist!.version).toBe('2.0.0');
    expect(wordlist!.words.length).toBeGreaterThanOrEqual(700);
    // total 字段与 words.length 一致
    expect(wordlist!.words.length).toBe(wordlist!.total);
  });

  it('T14: loadWordlist("de", 5) 返回 null (仅 C1 未落地, B2 已在 Stage 3 落地)', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 5);
    expect(wordlist).toBeNull();
  });

  it('T15: getUnlearnedWordsSync("de", 2, 8) 返回 <=8 且 >0 个德语 lemma', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    // 先加载德语 A2 词表
    await useWordlistStore.getState().getLevelTotal('de', 2);
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('de', 2, 8);
    expect(unlearned.length).toBeLessThanOrEqual(8);
    expect(unlearned.length).toBeGreaterThan(0);
  });

  it('T16: 德语 A2 名词 lemma 首字母大写', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 2);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;
    const nouns = wordlist.words.filter((w) => w.pos === 'noun');
    expect(nouns.length).toBeGreaterThan(0);
    for (const noun of nouns) {
      // 德语名词首字母必须大写 (A-Z, Ä, Ö, Ü)
      expect(noun.lemma[0]).toMatch(/[A-ZÄÖÜ]/);
    }
  });
});

// === v1.9.0 Stage 2: 德语 B1 词表落地 ===
describe('useWordlistStore — v1.9.0 Stage 2: 德语 B1 词表', () => {
  it('T17: loadWordlist("de", 3) 返回非 null, level=B1, difficulty=3, version=2.0.0, words>=900', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 3);
    expect(wordlist).not.toBeNull();
    expect(wordlist!.language).toBe('de');
    expect(wordlist!.level).toBe('B1');
    expect(wordlist!.difficulty).toBe(3);
    expect(wordlist!.version).toBe('2.0.0');
    expect(wordlist!.words.length).toBeGreaterThanOrEqual(900);
    // total 字段与 words.length 一致
    expect(wordlist!.words.length).toBe(wordlist!.total);
  });

  it('T18: loadWordlist("de", 5) 返回 null (B2 已在 Stage 3 落地, 仅 C1 未落地)', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 5);
    expect(wordlist).toBeNull();
  });

  it('T19: getUnlearnedWordsSync("de", 3, 8) 返回 <=8 且 >0 个德语 lemma', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    // 先加载德语 B1 词表
    await useWordlistStore.getState().getLevelTotal('de', 3);
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('de', 3, 8);
    expect(unlearned.length).toBeLessThanOrEqual(8);
    expect(unlearned.length).toBeGreaterThan(0);
  });

  it('T20: 德语 B1 名词 lemma 首字母大写', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 3);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;
    const nouns = wordlist.words.filter((w) => w.pos === 'noun');
    expect(nouns.length).toBeGreaterThan(0);
    for (const noun of nouns) {
      // 德语名词首字母必须大写 (A-Z, Ä, Ö, Ü)
      expect(noun.lemma[0]).toMatch(/[A-ZÄÖÜ]/);
    }
  });
});

// === v1.9.0 Stage 3: 德语 B2 词表落地 ===
describe('useWordlistStore — v1.9.0 Stage 3: 德语 B2 词表', () => {
  it('T21: loadWordlist("de", 4) 返回非 null, level=B2, difficulty=4, version=2.0.0, words>=1100', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 4);
    expect(wordlist).not.toBeNull();
    expect(wordlist!.language).toBe('de');
    expect(wordlist!.level).toBe('B2');
    expect(wordlist!.difficulty).toBe(4);
    expect(wordlist!.version).toBe('2.0.0');
    expect(wordlist!.words.length).toBeGreaterThanOrEqual(1100);
    // total 字段与 words.length 一致
    expect(wordlist!.words.length).toBe(wordlist!.total);
  });

  it('T22: loadWordlist("de", 5) 返回 null (C1 未落地)', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 5);
    expect(wordlist).toBeNull();
  });

  it('T23: getUnlearnedWordsSync("de", 4, 8) 返回 <=8 且 >0 个德语 lemma', async () => {
    const { useWordlistStore } = await import('./useWordlistStore');
    // 先加载德语 B2 词表
    await useWordlistStore.getState().getLevelTotal('de', 4);
    const unlearned = useWordlistStore.getState().getUnlearnedWordsSync('de', 4, 8);
    expect(unlearned.length).toBeLessThanOrEqual(8);
    expect(unlearned.length).toBeGreaterThan(0);
  });

  it('T24: 德语 B2 名词 lemma 首字母大写', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const wordlist = await loadWordlist('de', 4);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;
    const nouns = wordlist.words.filter((w) => w.pos === 'noun');
    expect(nouns.length).toBeGreaterThan(0);
    for (const noun of nouns) {
      // 德语名词首字母必须大写 (A-Z, Ä, Ö, Ü)
      expect(noun.lemma[0]).toMatch(/[A-ZÄÖÜ]/);
    }
  });
});

// T25 [critical]: cross-level 去重 — A1/A2/B1/B2 lemma 交集应为空 (允许 <=5 词跨级重复)
describe('T25: cross-level deduplication (de)', () => {
  it('A1/A2/B1/B2 lemma intersection is empty (allow <=5 cross-level repeats)', async () => {
    const { loadWordlist } = await import('../../../data/wordlists');
    const a1 = await loadWordlist('de', 1);
    const a2 = await loadWordlist('de', 2);
    const b1 = await loadWordlist('de', 3);
    const b2 = await loadWordlist('de', 4);

    const a1Lemmas = new Set(a1!.words.map(w => w.lemma.toLowerCase()));
    const a2Lemmas = new Set(a2!.words.map(w => w.lemma.toLowerCase()));
    const b1Lemmas = new Set(b1!.words.map(w => w.lemma.toLowerCase()));
    const b2Lemmas = new Set(b2!.words.map(w => w.lemma.toLowerCase()));

    // A1 vs A2 交集
    const a1a2 = [...a1Lemmas].filter(x => a2Lemmas.has(x));
    // A2 vs B1 交集
    const a2b1 = [...a2Lemmas].filter(x => b1Lemmas.has(x));
    // B1 vs B2 交集
    const b1b2 = [...b1Lemmas].filter(x => b2Lemmas.has(x));
    // A1 vs B1 交集 (跨 2 级)
    const a1b1 = [...a1Lemmas].filter(x => b1Lemmas.has(x));
    // A2 vs B2 交集 (跨 2 级)
    const a2b2 = [...a2Lemmas].filter(x => b2Lemmas.has(x));
    // A1 vs B2 交集 (跨 3 级)
    const a1b2 = [...a1Lemmas].filter(x => b2Lemmas.has(x));

    // 允许 <=5 词跨级重复 (CEFR 边界模糊), 但应为 0 或极少
    expect(a1a2.length).toBeLessThanOrEqual(5);
    expect(a2b1.length).toBeLessThanOrEqual(5);
    expect(b1b2.length).toBeLessThanOrEqual(5);
    expect(a1b1.length).toBeLessThanOrEqual(5);
    expect(a2b2.length).toBeLessThanOrEqual(5);
    expect(a1b2.length).toBeLessThanOrEqual(5);

    // 打印实际重复词 (便于调试)
    if (a1a2.length > 0) console.log('A1∩A2:', a1a2);
    if (a2b1.length > 0) console.log('A2∩B1:', a2b1);
    if (b1b2.length > 0) console.log('B1∩B2:', b1b2);
  });
});
