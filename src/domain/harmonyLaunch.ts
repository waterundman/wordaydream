import type { Language } from '../types';
import { useAppModeStore } from '../hooks/useAppModeStore';
import { useReadingSessionStore } from '../features/reading/store/useReadingSessionStore';
import {
  useReviewSessionStore,
  type ReviewMode,
} from '../features/review/store/useReviewSessionStore';
import { useToastStore } from '../store/useToastStore';
import { waitForNativeMemoryRestore } from '../features/review/store/useMemoryStore';
import {
  installHarmonyLaunchHandler,
  type HarmonyLaunchAction,
} from '../platform/harmonyLaunch';

interface ReviewLaunchState {
  mode: ReviewMode;
  language: Language;
  startReview: (language?: Language) => void;
}

interface ReadingLaunchState {
  lastConfig: { language: Language } | null;
}

export interface HarmonyLaunchDependencies {
  getReviewState: () => ReviewLaunchState;
  getReadingState: () => ReadingLaunchState;
  setAppMode: (mode: 'review') => void;
  showWarning: (message: string) => void;
  waitForMemoryRestore: () => Promise<void>;
}

const defaultDependencies: HarmonyLaunchDependencies = {
  getReviewState: () => useReviewSessionStore.getState(),
  getReadingState: () => useReadingSessionStore.getState(),
  setAppMode: (mode) => useAppModeStore.getState().setMode(mode),
  showWarning: (message) => useToastStore.getState().addToast('warning', message),
  waitForMemoryRestore: waitForNativeMemoryRestore,
};

export function dispatchHarmonyLaunchAction(
  action: HarmonyLaunchAction,
  dependencies: HarmonyLaunchDependencies = defaultDependencies,
): void {
  if (action.type === 'openCard') {
    dependencies.showWarning('暂不支持从鸿蒙卡片直接打开指定单词');
    return;
  }

  const reviewState = dependencies.getReviewState();
  if (reviewState.mode !== 'idle') {
    dependencies.setAppMode('review');
    return;
  }

  const language =
    dependencies.getReadingState().lastConfig?.language ?? reviewState.language;
  reviewState.startReview(language);

  if (dependencies.getReviewState().mode !== 'reviewing') {
    const fallbackLanguage: Language = language === 'en' ? 'de' : 'en';
    dependencies.getReviewState().startReview(fallbackLanguage);
  }

  if (dependencies.getReviewState().mode === 'reviewing') {
    dependencies.setAppMode('review');
    return;
  }

  dependencies.showWarning('暂无到期复习卡片');
}

export function installHarmonyLaunchHandling(
  dependencies: HarmonyLaunchDependencies = defaultDependencies,
): () => void {
  let disposed: boolean = false;
  let launchQueue: Promise<void> = dependencies.waitForMemoryRestore();

  const uninstall: () => void = installHarmonyLaunchHandler((action) => {
    const actionResult: Promise<void> = launchQueue
      .catch(() => undefined)
      .then(() => {
        if (disposed) {
          throw new Error('Harmony launch handler was disposed');
        }
        try {
          dispatchHarmonyLaunchAction(action, dependencies);
        } catch {
          try {
            dependencies.showWarning('\u65e0\u6cd5\u5904\u7406\u9e3f\u8499\u542f\u52a8\u8bf7\u6c42');
          } catch {
            // Keep queue recovery independent from toast failures.
          }
        }
      });
    launchQueue = actionResult.catch(() => undefined);
    return actionResult;
  });

  return () => {
    disposed = true;
    uninstall();
  };
}
