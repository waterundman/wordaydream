import { describe, it, expect } from 'vitest';
import { createMemoryCardFromToken, scheduleCardReview, getCardRetrievability } from './memoryDomain';
import type { TokenOccurrence, MemoryCard } from '../types';

function makeToken(overrides: Partial<TokenOccurrence> = {}): TokenOccurrence {
  return {
    id: 'tok-1',
    lexemeGroupId: 'grp-1',
    surfaceForm: 'test',
    lemma: 'test',
    objectiveDifficulty: 1,
    startIndex: 0,
    endIndex: 4,
    isResolved: false,
    isActive: false,
    kind: 'normal',
    isCompound: false,
    ...overrides,
  };
}

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

describe('memoryDomain', () => {
  it('D11: createMemoryCardFromToken — creates MemoryCard with correct lemma, lexemeGroupId, objectiveDifficulty, language', () => {
    const token = makeToken({
      lexemeGroupId: 'lex-grp-9',
      lemma: 'Apfel',
      objectiveDifficulty: 3,
    });
    const card = createMemoryCardFromToken(token, 'de');

    expect(card.lexemeGroupId).toBe('lex-grp-9');
    expect(card.lemma).toBe('Apfel');
    expect(card.objectiveDifficulty).toBe(3);
    expect(card.language).toBe('de');
    expect(card.status).toBe('new');
    expect(card.reps).toBe(0);
    expect(card.id).toBeTruthy();
  });

  it('D11b: createMemoryCardFromToken — without language, card.language is undefined', () => {
    const token = makeToken();
    const card = createMemoryCardFromToken(token);
    expect(card.language).toBeUndefined();
  });

  it('D12: scheduleCardReview — rating "good" on a new card returns ReviewUpdate with reps incremented and status changed from "new"', () => {
    const card = makeCard({ status: 'new', reps: 0 });
    const update = scheduleCardReview(card, 'good');

    expect(update.card).toBeDefined();
    expect(update.nextReviewAt).toBeGreaterThan(0);
    // reps should have incremented from 0
    expect(update.card.reps).toBeGreaterThan(0);
    // status should no longer be 'new' after a successful review
    expect(update.card.status).not.toBe('new');
    // identity fields preserved
    expect(update.card.id).toBe(card.id);
    expect(update.card.lexemeGroupId).toBe(card.lexemeGroupId);
    expect(update.card.lemma).toBe(card.lemma);
    expect(update.card.language).toBe(card.language);
  });

  it('D13: getCardRetrievability — returns a number between 0 and 1 for a card', () => {
    const card = makeCard({ status: 'review', reps: 3, stability: 5, due: Date.now() + 86400000 });
    const r = getCardRetrievability(card);
    expect(typeof r).toBe('number');
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});
