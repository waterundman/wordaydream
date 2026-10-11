/**
 * 复习兜底与导航意图优先级 (v1.6.6 红队修复)
 *
 * 覆盖两条真机实测缺陷:
 * - T01 [critical] D1: `#/review` 无到期卡的自动兜底是「入队」的，而 hash 导航直接改
 *   store；旧实现里队列 shift 会把用户随后选的 reading 盖回 wordlist（实测停在词表页）。
 * - T02 [critical] D2: `reviewRescueRef` 粘滞。旧实现只在 reviewMode 变成 reviewing 时
 *   复位，于是「无卡兜底过一次」之后的每一次 `#/review` 都直接弹回首页，
 *   即使此时已有到期卡 —— 学生词再点复习会被弹走。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import App from '../App';
import { useAppModeStore } from '../hooks/useAppModeStore';
import { useMemoryStore } from '../features/review/store/useMemoryStore';
import { useReviewSessionStore } from '../features/review/store/useReviewSessionStore';
import type { MemoryCard } from '../types';

beforeAll(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function dueCard(): MemoryCard {
  const now = Date.now();
  return {
    id: 'card-g1',
    lexemeGroupId: 'g1',
    lemma: 'revolution',
    objectiveDifficulty: 2,
    language: 'en',
    firstLearnedAt: now - 86_400_000,
    lastReviewAt: now - 86_400_000,
    learningSteps: 0,
    due: now - 1000,
    stability: 1,
    difficulty: 5,
    elapsedDays: 1,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    status: 'learning',
  };
}

function gotoHash(hash: string): void {
  act(() => {
    window.location.hash = hash;
  });
}

beforeEach(() => {
  useAppModeStore.setState({ currentMode: 'home', previousMode: null });
  useReviewSessionStore.setState({ mode: 'idle' });
  useMemoryStore.setState({ cards: new Map(), dueCardsIndex: null, cardsByLanguageIndex: null });
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('App 复习兜底 (v1.6.6 红队)', () => {
  it(
    'T01 [critical]: 无到期卡兜底不得吃掉随后的导航意图',
    async () => {
      render(<App />);
      await screen.findByTestId('hero-cta', {}, { timeout: 15_000 });

      gotoHash('#/review');
      // 用户几乎同时改去阅读页 (浏览器里就是连点导航 / 地址栏回退)
      gotoHash('#/reading');

      await waitFor(
        () => {
          expect(useAppModeStore.getState().currentMode, '兜底不得覆盖用户最后选的 reading').toBe(
            'reading'
          );
        },
        { timeout: 10_000 }
      );

      // 兜底条目若还留在队列里，会在 cover 时被 shift 出来 —— 再等一段确认它没有复活
      await new Promise((r) => setTimeout(r, 2500));
      expect(useAppModeStore.getState().currentMode).toBe('reading');
    },
    40_000
  );

  it(
    'T02 [critical]: 兜底发生过后，再次 #/review 有到期卡必须真的进入复习',
    async () => {
      render(<App />);
      await screen.findByTestId('hero-cta', {}, { timeout: 15_000 });

      // 第一次: 无到期卡 → 兜底去词表
      gotoHash('#/review');
      await waitFor(
        () => {
          expect(useAppModeStore.getState().currentMode).toBe('wordlist');
        },
        { timeout: 10_000 }
      );

      // 用户去学了词，现在有到期卡
      act(() => {
        const card = dueCard();
        useMemoryStore.setState({ cards: new Map([[card.lexemeGroupId, card]]) });
      });

      gotoHash('#/review');
      await waitFor(
        () => {
          expect(useAppModeStore.getState().currentMode, '不得被粘滞的 rescue 弹回首页').toBe(
            'review'
          );
          expect(useReviewSessionStore.getState().mode).toBe('reviewing');
        },
        { timeout: 10_000 }
      );
    },
    40_000
  );
});
