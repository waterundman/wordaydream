import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../features/review/services/schedulerAdapter', () => ({
  getRetrievability: vi.fn(),
}));

import { deriveStatus, syncFromMemoryCards, makeProgress } from './wordlistDomain';
import type { WordProgress } from './wordlistDomain';
import type { MemoryCard } from '../types';
import { getRetrievability } from '../features/review/services/schedulerAdapter';

const mockedGetRetrievability = vi.mocked(getRetrievability);

function makeCard(overrides: Partial<MemoryCard> = {}): MemoryCard {
  return {
    id: 'card-1',
    lexemeGroupId: 'grp-1',
    lemma: 'test',
    objectiveDifficulty: 1,
    language: 'en',
    firstLearnedAt: 1000,
    lastReviewAt: 2000,
    due: 3000,
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 0,
    lapses: 0,
    status: 'new',
    learningSteps: 0,
    ...overrides,
  };
}

function makeProgressFixture(overrides: Partial<WordProgress> = {}): WordProgress {
  return {
    status: 'learning',
    encounterCount: 0,
    lastEncounterPassageId: null,
    firstEncounteredAt: 0,
    lastEncounteredAt: 0,
    ...overrides,
  };
}

describe('wordlistDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deriveStatus', () => {
    it('D1: card.status === "new" → returns "unseen" regardless of progress', () => {
      const card = makeCard({ status: 'new', reps: 5 });
      const progress = makeProgressFixture({ encounterCount: 10 });
      expect(deriveStatus(progress, card)).toBe('unseen');
    });

    it('D2: card.status === "review", reps < 2 → returns "learning"', () => {
      const card = makeCard({ status: 'review', reps: 1 });
      const progress = makeProgressFixture({ encounterCount: 5 });
      expect(deriveStatus(progress, card)).toBe('learning');
    });

    it('D3: card.status === "review", reps >= 2, encounterCount < 2 → returns "learning"', () => {
      const card = makeCard({ status: 'review', reps: 3 });
      const progress = makeProgressFixture({ encounterCount: 1 });
      expect(deriveStatus(progress, card)).toBe('learning');
    });

    it('D4: review + reps>=2 + enc>=2 + getRetrievability 0.8 (<0.9) → "learning"', () => {
      mockedGetRetrievability.mockReturnValue(0.8);
      const card = makeCard({ status: 'review', reps: 2 });
      const progress = makeProgressFixture({ encounterCount: 2 });
      expect(deriveStatus(progress, card)).toBe('learning');
      expect(mockedGetRetrievability).toHaveBeenCalledWith(card);
    });

    it('D5: review + reps>=2 + enc>=2 + getRetrievability 0.95 (>=0.9) → "mastered"', () => {
      mockedGetRetrievability.mockReturnValue(0.95);
      const card = makeCard({ status: 'review', reps: 2 });
      const progress = makeProgressFixture({ encounterCount: 2 });
      expect(deriveStatus(progress, card)).toBe('mastered');
      expect(mockedGetRetrievability).toHaveBeenCalledWith(card);
    });

    it('D6: progress undefined → enc=0, even review+reps>=2 returns "learning" (enc<2)', () => {
      const card = makeCard({ status: 'review', reps: 5 });
      expect(deriveStatus(undefined, card)).toBe('learning');
      // getRetrievability 不应被调用 (enc<2 短路)
      expect(mockedGetRetrievability).not.toHaveBeenCalled();
    });

    it('D7: card.status === "learning" → returns "learning"', () => {
      const card = makeCard({ status: 'learning', reps: 5 });
      const progress = makeProgressFixture({ encounterCount: 10 });
      expect(deriveStatus(progress, card)).toBe('learning');
    });
  });

  describe('syncFromMemoryCards', () => {
    it('D8: basic sync — input cards map + progress → returns new progress with correct statuses (unseen/learning/mastered)', () => {
      const newCard = makeCard({ id: 'c1', lemma: 'apple', status: 'new' });
      const learningCard = makeCard({
        id: 'c2',
        lemma: 'banana',
        status: 'learning',
        reps: 1,
      });
      mockedGetRetrievability.mockReturnValue(0.95);
      const masteredCard = makeCard({
        id: 'c3',
        lemma: 'cherry',
        status: 'review',
        reps: 3,
      });

      const cards = new Map<string, MemoryCard>([
        ['c1', newCard],
        ['c2', learningCard],
        ['c3', masteredCard],
      ]);

      // cherry 需要 encounterCount>=2 才能进入 mastered 判定分支
      const existing: Record<string, WordProgress> = {
        'en:cherry': makeProgressFixture({ encounterCount: 2 }),
      };

      const result = syncFromMemoryCards(cards, existing);

      expect(result['en:apple']).toEqual(
        expect.objectContaining({ status: 'unseen', encounterCount: 0 })
      );
      expect(result['en:banana']).toEqual(
        expect.objectContaining({ status: 'learning' })
      );
      expect(result['en:cherry']).toEqual(
        expect.objectContaining({ status: 'mastered' })
      );
    });

    it('D9: preserves encounterCount from existing progress', () => {
      const card = makeCard({ id: 'c1', lemma: 'apple', status: 'new' });
      const cards = new Map<string, MemoryCard>([['c1', card]]);

      const existing: Record<string, WordProgress> = {
        'en:apple': makeProgressFixture({
          encounterCount: 7,
          lastEncounterPassageId: 'p-42',
          firstEncounteredAt: 111,
          lastEncounteredAt: 222,
        }),
      };

      const result = syncFromMemoryCards(cards, existing);

      expect(result['en:apple']).toEqual({
        status: 'unseen',
        encounterCount: 7,
        lastEncounterPassageId: 'p-42',
        firstEncounteredAt: 111,
        lastEncounteredAt: 222,
      });
    });

    it('D10: skips cards with no language (card.language undefined)', () => {
      const noLangCard = makeCard({ id: 'c1', lemma: 'apple', language: undefined });
      const withLangCard = makeCard({ id: 'c2', lemma: 'banana', language: 'en', status: 'new' });
      const cards = new Map<string, MemoryCard>([
        ['c1', noLangCard],
        ['c2', withLangCard],
      ]);

      const result = syncFromMemoryCards(cards, {});

      expect(result['en:apple']).toBeUndefined();
      expect(result['en:banana']).toBeDefined();
      expect(result['en:banana'].status).toBe('unseen');
    });
  });

  describe('makeProgress', () => {
    it('creates fresh progress with defaults when no existing provided', () => {
      const p = makeProgress('learning');
      expect(p).toEqual({
        status: 'learning',
        encounterCount: 0,
        lastEncounterPassageId: null,
        firstEncounteredAt: 0,
        lastEncounteredAt: 0,
      });
    });

    it('preserves encounter tracking fields from existing while applying new status', () => {
      const existing = makeProgressFixture({
        encounterCount: 5,
        lastEncounterPassageId: 'p-1',
        firstEncounteredAt: 100,
        lastEncounteredAt: 200,
      });
      const p = makeProgress('mastered', existing);
      expect(p.status).toBe('mastered');
      expect(p.encounterCount).toBe(5);
      expect(p.lastEncounterPassageId).toBe('p-1');
      expect(p.firstEncounteredAt).toBe(100);
      expect(p.lastEncounteredAt).toBe(200);
    });
  });
});
