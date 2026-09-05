import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installHarmonyLaunchHandler,
  HARMONY_LAUNCH_QUEUE_STORAGE_KEY,
  parseHarmonyLaunchQuery,
} from '../harmonyLaunch';

describe('parseHarmonyLaunchQuery', () => {
  it('parses the supported launch actions', () => {
    expect(parseHarmonyLaunchQuery('action=startReview')).toEqual({
      type: 'startReview',
    });
    expect(parseHarmonyLaunchQuery('action=openCard&cardId=card_123')).toEqual({
      type: 'openCard',
      cardId: 'card_123',
    });
    expect(
      parseHarmonyLaunchQuery(
        'action=openCard&cardId=' + 'a'.repeat(128),
      ),
    ).toEqual({
      type: 'openCard',
      cardId: 'a'.repeat(128),
    });
  });

  it.each([
    undefined,
    null,
    '',
    'action=unknown',
    'action=startReview&extra=true',
    'extra=true&action=startReview',
    'action=openCard&cardId=',
    'action=openCard&cardId=' + 'a'.repeat(129),
    'action=openCard&cardId=with%20space',
    'action=openCard&cardId=with+space',
    'action=openCard&cardId=with space',
    'action=openCard&cardId=with/slash',
    'action=openCard&cardId=quote"',
    'action=startReview\n',
  ])('rejects malformed input %#', (input) => {
    expect(parseHarmonyLaunchQuery(input)).toBeNull();
  });
});

describe('installHarmonyLaunchHandler', () => {
  afterEach(() => {
    delete window.handleHarmonyLaunch;
    window.localStorage.removeItem(HARMONY_LAUNCH_QUEUE_STORAGE_KEY);
  });

  it('dispatches only validated actions and removes its handler on cleanup', () => {
    const handleAction = vi.fn();
    const cleanup = installHarmonyLaunchHandler(handleAction);

    window.handleHarmonyLaunch?.('action=unknown');
    window.handleHarmonyLaunch?.('action=startReview');

    expect(handleAction).toHaveBeenCalledTimes(1);
    expect(handleAction).toHaveBeenCalledWith({ type: 'startReview' });

    cleanup();
    expect(window.handleHarmonyLaunch).toBeUndefined();
  });

  it('restores an existing handler without overwriting a later owner', () => {
    const previousHandler = vi.fn();
    window.handleHarmonyLaunch = previousHandler;
    const cleanup = installHarmonyLaunchHandler(vi.fn());
    const laterHandler = vi.fn();
    window.handleHarmonyLaunch = laterHandler;

    cleanup();
    expect(window.handleHarmonyLaunch).toBe(laterHandler);
  });
  it('replays a persisted action after the page handler is reinstalled', async () => {
    const neverSettles = new Promise<void>(() => undefined);
    const firstCleanup = installHarmonyLaunchHandler(() => neverSettles);

    window.handleHarmonyLaunch?.('action=startReview');

    expect(
      JSON.parse(
        window.localStorage.getItem(HARMONY_LAUNCH_QUEUE_STORAGE_KEY) ?? '[]',
      ),
    ).toHaveLength(1);
    firstCleanup();

    const replay = vi.fn().mockResolvedValue(undefined);
    const secondCleanup = installHarmonyLaunchHandler(replay);

    try {
      expect(replay).toHaveBeenCalledWith({ type: 'startReview' });
      await vi.waitFor(() => {
        expect(
          JSON.parse(
            window.localStorage.getItem(HARMONY_LAUNCH_QUEUE_STORAGE_KEY) ??
              '[]',
          ),
        ).toEqual([]);
      });
    } finally {
      secondCleanup();
    }
  });

});
