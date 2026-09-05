import { describe, expect, it, vi } from 'vitest';
import type { Language } from '../types';
import type { ReviewMode } from '../features/review/store/useReviewSessionStore';
import {
  dispatchHarmonyLaunchAction,
  type HarmonyLaunchDependencies,
  installHarmonyLaunchHandling,
} from './harmonyLaunch';

interface DependencyOptions {
  mode?: ReviewMode;
  reviewLanguage?: Language;
  readingLanguage?: Language | null;
  startSucceeds?: boolean;
  restorePromise?: Promise<void>;
  availableLanguage?: Language;
  throwOnFirstStart?: boolean;
}

function createDependencies(options: DependencyOptions = {}) {
  let mode: ReviewMode = options.mode ?? 'idle';
  const reviewLanguage = options.reviewLanguage ?? 'en';
  const startReview = vi.fn((language?: Language) => {
    if (options.throwOnFirstStart === true && startReview.mock.calls.length === 1) {
      throw new Error('synthetic launch failure');
    }

    if (
      options.startSucceeds !== false &&
      (options.availableLanguage === undefined || options.availableLanguage === language)
    ) {
      mode = 'reviewing';
    }
  });
  const setAppMode = vi.fn();
  const showWarning = vi.fn();

  const dependencies: HarmonyLaunchDependencies = {
    getReviewState: () => ({
      mode,
      language: reviewLanguage,
      startReview,
    }),
    getReadingState: () => ({
      lastConfig:
        options.readingLanguage === undefined ||
        options.readingLanguage === null
          ? null
          : { language: options.readingLanguage },
    }),
    setAppMode,
    showWarning,
    waitForMemoryRestore: () => options.restorePromise ?? Promise.resolve(),
  };

  return { dependencies, setAppMode, showWarning, startReview };
}

describe('dispatchHarmonyLaunchAction', () => {
  it('starts review through the review state machine using the last reading language', () => {
    const setup = createDependencies({ readingLanguage: 'de' });

    dispatchHarmonyLaunchAction({ type: 'startReview' }, setup.dependencies);

    expect(setup.startReview).toHaveBeenCalledWith('de');
    expect(setup.setAppMode).toHaveBeenCalledWith('review');
    expect(setup.showWarning).not.toHaveBeenCalled();
  });

  it('uses the review language when no reading configuration exists', () => {
    const setup = createDependencies({ reviewLanguage: 'de' });

    dispatchHarmonyLaunchAction({ type: 'startReview' }, setup.dependencies);

    expect(setup.startReview).toHaveBeenCalledWith('de');
  });

  it('keeps the current page and warns when no cards are due', () => {
    const setup = createDependencies({ startSucceeds: false });

    dispatchHarmonyLaunchAction({ type: 'startReview' }, setup.dependencies);

    expect(setup.setAppMode).not.toHaveBeenCalled();
    expect(setup.showWarning).toHaveBeenCalledWith('暂无到期复习卡片');
  });
  it('falls back to the other language when only it has due cards', () => {
    const setup = createDependencies({
      readingLanguage: 'en',
      availableLanguage: 'de',
    });

    dispatchHarmonyLaunchAction({ type: 'startReview' }, setup.dependencies);

    expect(setup.startReview).toHaveBeenNthCalledWith(1, 'en');
    expect(setup.startReview).toHaveBeenNthCalledWith(2, 'de');
    expect(setup.setAppMode).toHaveBeenCalledWith('review');
    expect(setup.showWarning).not.toHaveBeenCalled();
  });


  it.each(['reviewing', 'completed'] as const)(
    'does not reset an existing %s session',
    (mode) => {
      const setup = createDependencies({ mode });

      dispatchHarmonyLaunchAction({ type: 'startReview' }, setup.dependencies);

      expect(setup.startReview).not.toHaveBeenCalled();
      expect(setup.setAppMode).toHaveBeenCalledWith('review');
    },
  );

  it('reports the intentionally unsupported targeted-card action', () => {
    const setup = createDependencies();

    dispatchHarmonyLaunchAction(
      { type: 'openCard', cardId: 'card-123' },
      setup.dependencies,
    );

    expect(setup.startReview).not.toHaveBeenCalled();
    expect(setup.setAppMode).not.toHaveBeenCalled();
    expect(setup.showWarning).toHaveBeenCalledWith(
      '暂不支持从鸿蒙卡片直接打开指定单词',
    );
  });
  it('continues with the next launch after one action throws', async () => {
    const setup = createDependencies({ throwOnFirstStart: true });
    const cleanup = installHarmonyLaunchHandling(setup.dependencies);

    try {
      window.handleHarmonyLaunch?.('action=startReview');
      window.handleHarmonyLaunch?.('action=startReview');

      await vi.waitFor(() => {
        expect(setup.startReview).toHaveBeenCalledTimes(2);
      });
      expect(setup.setAppMode).toHaveBeenCalledWith('review');
      expect(setup.showWarning).toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('queues a native launch until Harmony RDB restore settles', async () => {
    let releaseRestore: () => void = () => undefined;
    const restorePromise = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    const setup = createDependencies({ restorePromise });
    const cleanup = installHarmonyLaunchHandling(setup.dependencies);

    try {
      window.handleHarmonyLaunch?.('action=startReview');

      expect(setup.startReview).not.toHaveBeenCalled();

      releaseRestore();
      await restorePromise;
      await Promise.resolve();

      expect(setup.startReview).toHaveBeenCalledTimes(1);
      expect(setup.setAppMode).toHaveBeenCalledWith('review');
    } finally {
      cleanup();
    }
  });

});
