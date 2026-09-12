/**
 * startWrongWordsReview 定向复习测试 (v1.0.0 Stage 3: 错词定向复习)
 *
 * 覆盖 test_spec:
 * - T01 [critical]: 正常定向会话 — 2 条错词条目 + 对应卡片 → mode='reviewing',
 *   queue.length=2, startedAt>0, recordPreviousMode / streak recordDay 副作用生效
 * - T02 [critical]: 已删卡过滤 — 错词含已删除卡 → queue 只含存在的卡;
 *   全部已删除 → mode='idle' 不进会话 (空态分支)
 * - T03 [critical]: 会话语义等同 — 断言集合与 startReview 对齐
 *   (mode/language/queue/currentIndex/userAnswer/evaluation/isEvaluating/isPaused/
 *    showRatingBar/results/startedAt/recordPreviousMode/streak)
 * - T05 [critical]: 定向会话评分回归 — completeReview 走主链路 (results 记录),
 *   grade=wrong 时错词本 wrongCount+1
 *
 * 注意 (v0.9.0 教训沿用): 不 spy zustand 单例 (跨测试污染),
 * 用状态副作用断言 (useAppModeStore.previousMode / useStreakStore.lastStudyDate /
 * useWrongWordsStore.entries.wrongCount).
 *
 * 查卡口径: cards Map 以 lexemeGroupId 为键 → 用 getCardByLexemeGroup 反查,
 * 查不到 (已删除) 返回 undefined → 丢弃.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCard } from '../../../types';
import { useReviewSessionStore } from './useReviewSessionStore';
import { useMemoryStore } from './useMemoryStore';
import { useWrongWordsStore, type WrongWordEntry } from './useWrongWordsStore';
import { useAppModeStore } from '../../../hooks/useAppModeStore';
import { useStreakStore } from '../../streak/store/useStreakStore';

function makeCard(id: string, lemma: string, language: 'en' | 'de'): MemoryCard {
  return {
    id,
    lexemeGroupId: id,
    lemma,
    objectiveDifficulty: 2,
    language,
    firstLearnedAt: 0,
    lastReviewAt: 0,
    due: 0,
    stability: 1,
    difficulty: 1,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 0,
    lapses: 0,
    status: 'review',
    learningSteps: 0,
  };
}

function makeEntry(
  cardId: string,
  lemma: string,
  language: 'en' | 'de',
  lastWrongAt: number,
  wrongCount = 1
): WrongWordEntry {
  return {
    cardId,
    lexemeGroupId: cardId,
    lemma,
    language,
    wrongCount,
    lastWrongAt,
    firstWrongAt: lastWrongAt - 1000,
  };
}

/** 预置 cards Map (键 = lexemeGroupId, 与 addCardFromToken 的真实键一致) */
function setMemoryCards(cards: MemoryCard[]) {
  useMemoryStore.setState({
    cards: new Map(cards.map((c) => [c.lexemeGroupId, c])),
    dueCardsIndex: null,
    cardsByLanguageIndex: null,
  });
}

beforeEach(() => {
  // 重置各 store 单例, 避免跨测试泄漏
  useReviewSessionStore.setState({
    mode: 'idle',
    language: 'en',
    queue: [],
    currentIndex: 0,
    userAnswer: '',
    evaluation: null,
    isEvaluating: false,
    isPaused: false,
    showRatingBar: false,
    results: [],
    startedAt: 0,
    cardContexts: {},
  });
  useMemoryStore.setState({
    cards: new Map<string, MemoryCard>(),
    dueCardsIndex: null,
    cardsByLanguageIndex: null,
  });
  useWrongWordsStore.setState({ entries: [] });
  useAppModeStore.getState().reset();
  useStreakStore.setState({ lastStudyDate: null, currentStreak: 0, longestStreak: 0 });
  vi.useRealTimers();
});

describe('startWrongWordsReview (v1.0.0 Stage 3: 错词定向复习)', () => {
  describe('T01 [critical]: 正常定向会话', () => {
    it('T01: 2 条错词 + 对应卡片 → reviewing / queue=2 / startedAt>0 / 副作用生效', () => {
      const apple = makeCard('lg-apple', 'apple', 'en');
      const banana = makeCard('lg-banana', 'banana', 'de');
      setMemoryCards([apple, banana]);
      useWrongWordsStore.setState({
        entries: [makeEntry('lg-apple', 'apple', 'en', 1000), makeEntry('lg-banana', 'banana', 'de', 9000)],
      });
      // 模拟来源模式 (recordPreviousMode 记录的是调用瞬间的 currentMode)
      useAppModeStore.setState({ currentMode: 'wordlist' });

      useReviewSessionStore.getState().startWrongWordsReview();

      const s = useReviewSessionStore.getState();
      expect(s.mode).toBe('reviewing');
      expect(s.queue).toHaveLength(2);
      // lastWrongAt 倒序: banana (9000) 在前
      expect(s.queue.map((c) => c.id)).toEqual(['lg-banana', 'lg-apple']);
      expect(s.startedAt).toBeGreaterThan(0);

      // recordPreviousMode 副作用 (状态断言, 不 spy)
      expect(useAppModeStore.getState().previousMode).toBe('wordlist');
      // streak recordDay 副作用
      expect(useStreakStore.getState().lastStudyDate).not.toBeNull();
      expect(useStreakStore.getState().currentStreak).toBeGreaterThanOrEqual(1);
    });
  });

  describe('T02 [critical]: 已删卡过滤', () => {
    it('T02a: 1 条已删除卡 → queue 只含存在的 1 条', () => {
      setMemoryCards([makeCard('lg-apple', 'apple', 'en')]);
      useWrongWordsStore.setState({
        entries: [makeEntry('lg-apple', 'apple', 'en', 1000), makeEntry('lg-gone', 'ghost', 'en', 9000)],
      });

      useReviewSessionStore.getState().startWrongWordsReview();

      const s = useReviewSessionStore.getState();
      expect(s.mode).toBe('reviewing');
      expect(s.queue).toHaveLength(1);
      expect(s.queue[0].id).toBe('lg-apple');
    });

    it('T02b: 全部已删除 → mode=idle 不进会话 (空态分支)', () => {
      setMemoryCards([]);
      useWrongWordsStore.setState({
        entries: [makeEntry('lg-gone', 'ghost', 'en', 9000)],
      });

      useReviewSessionStore.getState().startWrongWordsReview();

      const s = useReviewSessionStore.getState();
      expect(s.mode).toBe('idle');
      expect(s.queue).toEqual([]);
      expect(s.startedAt).toBe(0);
      // 空态分支不触发会话启动副作用
      expect(useAppModeStore.getState().previousMode).toBeNull();
    });
  });

  describe('T03 [critical]: 会话语义等同 (与 startReview 断言集合对齐)', () => {
    it('T03: 逐字段比对 startReview 的会话启动语义', () => {
      setMemoryCards([makeCard('lg-apple', 'apple', 'en'), makeCard('lg-banana', 'banana', 'de')]);
      useWrongWordsStore.setState({
        entries: [makeEntry('lg-apple', 'apple', 'en', 1000), makeEntry('lg-banana', 'banana', 'de', 9000)],
      });
      useAppModeStore.setState({ currentMode: 'wordlist' });

      useReviewSessionStore.getState().startWrongWordsReview();

      const s = useReviewSessionStore.getState();
      // 与 startReview 相同的字段集合
      expect(s.mode).toBe('reviewing');
      expect(s.language).toBe('de'); // 取第一条 (lastWrongAt 倒序) 条目的 language
      expect(s.queue).toHaveLength(2);
      expect(s.currentIndex).toBe(0);
      expect(s.userAnswer).toBe('');
      expect(s.evaluation).toBeNull();
      expect(s.isEvaluating).toBe(false);
      expect(s.isPaused).toBe(false);
      expect(s.showRatingBar).toBe(false);
      expect(s.results).toEqual([]);
      expect(s.startedAt).toBeGreaterThan(0);
      // 副作用同构: recordPreviousMode + streak recordDay
      expect(useAppModeStore.getState().previousMode).toBe('wordlist');
      expect(useStreakStore.getState().lastStudyDate).not.toBeNull();
    });
  });

  describe('T05 [critical]: 定向会话评分回归 (completeReview 主链路)', () => {
    it('T05: grade=wrong → results 记录 + 错词本 wrongCount+1', () => {
      setMemoryCards([makeCard('lg-apple', 'apple', 'en'), makeCard('lg-banana', 'banana', 'de')]);
      useWrongWordsStore.setState({
        entries: [makeEntry('lg-apple', 'apple', 'en', 1000), makeEntry('lg-banana', 'banana', 'de', 9000)],
      });

      useReviewSessionStore.getState().startWrongWordsReview();

      // 模拟 submitAnswer 已落下 evaluation (queue=2, currentIndex=0, 规避末卡 notifyReviewCompleted)
      useReviewSessionStore.setState({ evaluation: { grade: 'wrong', feedback: 'x', hint: null } });
      useReviewSessionStore.getState().completeReview('again');

      // 主链路: results 正常记录
      expect(useReviewSessionStore.getState().results).toHaveLength(1);
      expect(useReviewSessionStore.getState().results[0].cardId).toBe('lg-banana');
      expect(useReviewSessionStore.getState().results[0].rating).toBe('again');
      // 错词本: 已有条目 wrongCount+1 (1 → 2), firstWrongAt 不变
      const entries = useWrongWordsStore.getState().entries;
      const bananaEntry = entries.find((e) => e.cardId === 'lg-banana');
      expect(bananaEntry?.wrongCount).toBe(2);
      expect(bananaEntry?.firstWrongAt).toBe(8000); // 9000 - 1000
    });
  });

  describe('v1.1.0 Stage 1: startWrongWordsReview(options?) 排序 + limit', () => {
    describe('T06 [critical]: mostWrong + limit=1', () => {
      it('T06: 3 条错词 (wrongCount 2/3/1) → queue 长度 1 且为 wrongCount=3 那张', () => {
        setMemoryCards([
          makeCard('lg-two', 'two', 'en'),
          makeCard('lg-three', 'three', 'en'),
          makeCard('lg-one', 'one', 'en'),
        ]);
        useWrongWordsStore.setState({
          entries: [
            makeEntry('lg-two', 'two', 'en', 5000, 2),
            makeEntry('lg-three', 'three', 'en', 1000, 3),
            makeEntry('lg-one', 'one', 'en', 9000, 1),
          ],
        });

        useReviewSessionStore.getState().startWrongWordsReview({ sort: 'mostWrong', limit: 1 });

        const s = useReviewSessionStore.getState();
        expect(s.mode).toBe('reviewing');
        expect(s.queue).toHaveLength(1);
        expect(s.queue[0].id).toBe('lg-three'); // wrongCount=3
      });
    });

    describe('T07 [critical]: limit 防御', () => {
      it('T07a: limit > 有效数 → 全量', () => {
        setMemoryCards([
          makeCard('lg-apple', 'apple', 'en'),
          makeCard('lg-banana', 'banana', 'de'),
        ]);
        useWrongWordsStore.setState({
          entries: [makeEntry('lg-apple', 'apple', 'en', 1000), makeEntry('lg-banana', 'banana', 'de', 9000)],
        });

        useReviewSessionStore.getState().startWrongWordsReview({ limit: 5 });

        expect(useReviewSessionStore.getState().queue).toHaveLength(2);
      });

      it('T07b: limit=0 / limit=-1 → 无效, 走缺省全量', () => {
        setMemoryCards([
          makeCard('lg-apple', 'apple', 'en'),
          makeCard('lg-banana', 'banana', 'de'),
        ]);
        useWrongWordsStore.setState({
          entries: [makeEntry('lg-apple', 'apple', 'en', 1000), makeEntry('lg-banana', 'banana', 'de', 9000)],
        });

        useReviewSessionStore.getState().startWrongWordsReview({ limit: 0 });
        expect(useReviewSessionStore.getState().queue).toHaveLength(2);

        // 复位会话后再验证负数
        useReviewSessionStore.setState({ mode: 'idle', queue: [] });
        useReviewSessionStore.getState().startWrongWordsReview({ limit: -1 });
        expect(useReviewSessionStore.getState().queue).toHaveLength(2);
      });
    });

    describe('T08 [critical]: 缺省调用零回归守护', () => {
      it('T08: 无参 startWrongWordsReview() → recent 全量, queue 顺序与 T01 一致', () => {
        setMemoryCards([makeCard('lg-apple', 'apple', 'en'), makeCard('lg-banana', 'banana', 'de')]);
        useWrongWordsStore.setState({
          entries: [makeEntry('lg-apple', 'apple', 'en', 1000), makeEntry('lg-banana', 'banana', 'de', 9000)],
        });

        useReviewSessionStore.getState().startWrongWordsReview();

        const s = useReviewSessionStore.getState();
        expect(s.mode).toBe('reviewing');
        expect(s.queue).toHaveLength(2);
        // 与既有 T01 完全一致: lastWrongAt 倒序, banana (9000) 在前
        expect(s.queue.map((c) => c.id)).toEqual(['lg-banana', 'lg-apple']);
      });
    });
  });
});
