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
  jumpToCard: (cardId: string) => boolean;
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

/**
 * 常规复习启动流程（startReview 分支 / openCard 场景 A 共用）。
 *
 * 1. 取语言：reading lastConfig.language ?? reviewState.language
 * 2. 调 startReview，无到期卡则换另一语言重试
 * 3. 返回是否成功进入 reviewing 态
 *
 * 调用方需自行判断 mode —— 本流程仅在 mode === 'idle' 时用于启动新会话
 * （startReview 自身已处理"无 due 卡则维持 idle"的语义）。
 */
function startRegularReviewSession(dependencies: HarmonyLaunchDependencies): boolean {
  const reviewState = dependencies.getReviewState();
  const language =
    dependencies.getReadingState().lastConfig?.language ?? reviewState.language;
  reviewState.startReview(language);

  if (dependencies.getReviewState().mode !== 'reviewing') {
    const fallbackLanguage: Language = language === 'en' ? 'de' : 'en';
    dependencies.getReviewState().startReview(fallbackLanguage);
  }

  return dependencies.getReviewState().mode === 'reviewing';
}

/**
 * openCard 定向卡片落地（SPEC §3 + §5）。
 *
 * - 场景 B/C：已在复习会话中 → 直接 jumpToCard，不重启会话。
 *   - 成功：切到复习页。
 *   - 失败（目标不在本次队列）：提示"该词不在本次复习队列中"并保持现有会话，仍切到复习页。
 * - 场景 A：非 reviewing（idle/completed）→ 先常规启动复习；
 *   - 启动失败（无到期卡）：提示"暂无到期复习卡片"。
 *   - 启动成功但目标未到期/不存在：降级常规复习并提示
 *     "该词当前不在复习队列，已开始常规复习"，切到复习页。
 */
function handleOpenCardLaunch(
  cardId: string,
  dependencies: HarmonyLaunchDependencies,
): void {
  const reviewState = dependencies.getReviewState();

  if (reviewState.mode === 'reviewing') {
    // 场景 B / C：会话内定位，不重启
    if (reviewState.jumpToCard(cardId)) {
      dependencies.setAppMode('review');
    } else {
      // 场景 C：目标不在本次复习队列，保持现有会话
      dependencies.showWarning('该词不在本次复习队列中');
      dependencies.setAppMode('review');
    }
    return;
  }

  // 场景 A：非 reviewing → 先常规启动复习
  if (!startRegularReviewSession(dependencies)) {
    dependencies.showWarning('暂无到期复习卡片');
    return;
  }

  // 已进入 reviewing，尝试定位目标卡
  if (dependencies.getReviewState().jumpToCard(cardId)) {
    dependencies.setAppMode('review');
  } else {
    // 目标未到期 / 不存在于本次队列 → 降级为常规复习
    dependencies.showWarning('该词当前不在复习队列，已开始常规复习');
    dependencies.setAppMode('review');
  }
}

export function dispatchHarmonyLaunchAction(
  action: HarmonyLaunchAction,
  dependencies: HarmonyLaunchDependencies = defaultDependencies,
): void {
  if (action.type === 'openCard') {
    handleOpenCardLaunch(action.cardId, dependencies);
    return;
  }

  // startReview 分支：已在会话中直接切页；否则走常规启动流程
  if (dependencies.getReviewState().mode !== 'idle') {
    dependencies.setAppMode('review');
    return;
  }

  if (startRegularReviewSession(dependencies)) {
    dependencies.setAppMode('review');
  } else {
    dependencies.showWarning('暂无到期复习卡片');
  }
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
