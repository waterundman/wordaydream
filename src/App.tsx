import { useEffect, useState, useCallback, useRef, lazy, Suspense, type ReactNode } from 'react';
import { useReviewSessionStore } from './features/review/store/useReviewSessionStore';
import { useMemoryStore } from './features/review/store/useMemoryStore';
import { useWordlistStore } from './features/wordlist/store/useWordlistStore';
import { useSettingsStore } from './features/settings/store/useSettingsStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NotificationBanner } from './components/NotificationBanner';
import { OfflineBanner } from './components/OfflineBanner';
import { ToastContainer } from './components/ToastContainer';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';
import { InkWipeTransition } from './components/transitions/InkWipeTransition';
import { AchievementUnlockOverlay } from './components/transitions/AchievementUnlockOverlay';
import { AchievementToast } from './features/achievements/components/AchievementToast';
import { ThemeProvider } from './components/ThemeProvider';
import { ScrollProgressBar } from './components/ScrollProgressBar';
import { LoadingFallback } from './components/LoadingFallback';
import { useKeyboardShortcuts, setActiveShortcutScope } from './hooks/useKeyboardShortcuts';
import { useCursorGlow } from './hooks/useCursorGlow';
import { useBreathingEffect } from './hooks/useBreathingEffect';
import { useReadingTimeTracker } from './hooks/useReadingTimeTracker';
import { useAppModeStore } from './hooks/useAppModeStore';
import { useUrlHashSync } from './hooks/useUrlHashSync';
import './styles/tokens.css';

// v0.4.0-harmony Stage 3 (D3): 路由级 code splitting.
// 5 个路由组件 + SettingsPanel 改为 React.lazy 动态导入, 首屏 JS 体积下降 40%+.
// Suspense fallback 用轻量 LoadingFallback (一个 div + 居中文字, 无依赖).
const HomePage = lazy(() => import('./features/home/HomePage').then((m) => ({ default: m.HomePage })));
const ReadingSessionPage = lazy(() =>
  import('./features/reading/ReadingSessionPage').then((m) => ({ default: m.ReadingSessionPage })),
);
const ReviewSessionPage = lazy(() =>
  import('./features/review/components/ReviewSessionPage').then((m) => ({ default: m.ReviewSessionPage })),
);
const WordlistPage = lazy(() =>
  import('./features/wordlist/WordlistPage').then((m) => ({ default: m.WordlistPage })),
);
const CoursePathPage = lazy(() =>
  import('./features/course/components/CoursePathPage').then((m) => ({ default: m.CoursePathPage })),
);
// SettingsPanel 仅在 settingsOpen=true 时需要, 单独 lazy 避免阻塞首屏.
const SettingsPanel = lazy(() =>
  import('./features/settings/components/SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
);

function App() {
  const reviewMode = useReviewSessionStore((s) => s.mode);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const appMode = useAppModeStore((s) => s.currentMode);
  const setAppMode = useAppModeStore((s) => s.setMode);
  const [isTransitioning, setIsTransitioning] = useState(true);
  // pendingMode: 用户想切换到的页面. onCovered 时才真正 setAppMode, 避免页面闪烁.
  const pendingModeRef = useRef<typeof appMode | null>(null);
  const [achievementOverlay, setAchievementOverlay] = useState<{
    streak: number;
    title: string;
  } | null>(null);

  useUrlHashSync(); // v1.7.0 Stage 2: URL hash 同步 AppMode

  useCursorGlow(true);
  useBreathingEffect(true);

  // v1.6.0 Stage 3.5-A / 3.5-6 / 3.6-C: 应用启动时触发 syncFromMemoryCards (检查 mastered 衰减)
  // + resetDailyGoalIfNewDay (跨日重置 dailyGoal) + setReviewsTarget (设今日复习目标 = dueCards.length).
  // 确保 ProgressRing 和日进度反映真实状态.
  useEffect(() => {
    const { syncFromMemoryCards, resetDailyGoalIfNewDay, setReviewsTarget } = useWordlistStore.getState();
    const { cards, getDueCards } = useMemoryStore.getState();
    syncFromMemoryCards(cards);
    resetDailyGoalIfNewDay();
    // v1.6.0 Stage 3.6-C: 今日建议复习数 = 当前 dueCards 总数 (跨语言).
    setReviewsTarget(getDueCards().length);
  }, []);

  // v1.5.2 Stage 2 (Contract 28 NEW / D-2): 仅在 reading 模式累计阅读秒数
  // hook only, 不渲染 JSX; 跨日 reset / cleanup 由 hook 内部处理
  useReadingTimeTracker(appMode === 'reading');

  // Stage 3: 主页 ↔ 阅读 / 复习的路由状态机
  // 复习 store 切到 reviewing / completed 时, 路由强制进入 review 模式;
  // 复习结束 (mode === 'idle') 且当前处于 review 模式, 回到主页。
  //
  // v2.1.0 Stage 1 (Contract 61): 主路径由 exitReview 内部 returnToPrevious 驱动
  // (exitReview 调用 returnToPrevious 把 currentMode 改为 previousMode, 如 reading),
  // 所以此处第二条 `idle && appMode==='review' → home` 仅作为兜底:
  // 处理 persist 恢复 (刷新后 mode='idle' 但 appMode 仍 'review') 等异常场景。
  // 正常 exitReview 流程中, returnToPrevious 已改 appMode, 此处第二条条件不满足, 不触发。
  useEffect(() => {
    if (reviewMode === 'reviewing' || reviewMode === 'completed') {
      setAppMode('review');
    } else if (reviewMode === 'idle' && appMode === 'review') {
      setAppMode('home');
    }
  }, [reviewMode, appMode]);

  useEffect(() => {
    const scope = appMode === 'review' ? 'review' : 'reading';
    setActiveShortcutScope(scope);
  }, [appMode]);

  // v2.3: 两阶段过渡 — cover (overlay 覆盖) → 切换内容 → reveal (overlay 揭开)
  // 用户点击导航时设置 pendingMode + 触发 transition, onCovered 时才真正 setAppMode.
  //
  // v2.4.0 fix (导航回归): isTransitioning===true 时 setIsTransitioning(true) 是 no-op,
  // InkWipeTransition 的 effect 依赖 active (false→true) 才重跑, 导致 pendingMode 永远
  // 挂起, 页面卡死 (首屏开场动画 1.9s 内点击任何导航必触发, e2e T02/T04 因此超时).
  // 修复: 过渡进行中直接同步 setAppMode (overlay 仍在, 内容在 overlay 下方切换),
  // 当前动画的 onComplete 会正常把 isTransitioning 置 false.
  const navigateTo = useCallback((mode: typeof appMode) => {
    if (mode === appMode) return;
    if (isTransitioning) {
      setAppMode(mode);
      return;
    }
    pendingModeRef.current = mode;
    setIsTransitioning(true);
  }, [appMode, isTransitioning, setAppMode]);

  const handleCovered = useCallback(() => {
    const pending = pendingModeRef.current;
    if (pending) {
      setAppMode(pending);
      pendingModeRef.current = null;
    }
  }, [setAppMode]);

  const handleTransitionComplete = useCallback(() => {
    setIsTransitioning(false);
  }, []);

  // review store 驱动的模式切换也走过渡动画
  useEffect(() => {
    if (reviewMode === 'reviewing' || reviewMode === 'completed') {
      if (appMode !== 'review') navigateTo('review');
    } else if (reviewMode === 'idle' && appMode === 'review') {
      navigateTo('home');
    }
  }, [reviewMode, appMode, navigateTo]);

  const handleGoHome = useCallback(() => {
    navigateTo('home');
  }, [navigateTo]);

  const handleStartReading = useCallback(() => {
    navigateTo('reading');
  }, [navigateTo]);

  const handleViewWordlist = useCallback(() => {
    navigateTo('wordlist');
  }, [navigateTo]);

  useKeyboardShortcuts('app-global', [
    {
      id: 'open-settings',
      key: 's',
      scope: 'global',
      handler: () => openSettings(),
      description: '打开设置',
    },
    {
      id: 'go-home',
      key: 'h',
      scope: 'global',
      handler: () => handleGoHome(),
      description: '返回主页',
    },
  ]);

  let content: ReactNode;
  if (appMode === 'home') {
    content = (
      <InkWipeTransition active={isTransitioning} onCovered={handleCovered} onComplete={handleTransitionComplete}>
        <HomePage
          onStartReading={handleStartReading}
          onOpenSettings={openSettings}
          onViewWordlist={handleViewWordlist}
        />
      </InkWipeTransition>
    );
  } else if (appMode === 'wordlist') {
    content = (
      <InkWipeTransition active={isTransitioning} onCovered={handleCovered} onComplete={handleTransitionComplete}>
        <WordlistPage onGoHome={handleGoHome} />
      </InkWipeTransition>
    );
  } else if (appMode === 'course') {
    content = (
      <InkWipeTransition active={isTransitioning} onCovered={handleCovered} onComplete={handleTransitionComplete}>
        <CoursePathPage
          onGoHome={handleGoHome}
          onStartReading={handleStartReading}
        />
      </InkWipeTransition>
    );
  } else if (appMode === 'review') {
    content = (
      <InkWipeTransition active={isTransitioning} onCovered={handleCovered} onComplete={handleTransitionComplete}>
        <ReviewSessionPage />
      </InkWipeTransition>
    );
  } else {
    content = (
      <InkWipeTransition active={isTransitioning} onCovered={handleCovered} onComplete={handleTransitionComplete}>
        <ReadingSessionPage />
      </InkWipeTransition>
    );
  }

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <div className="grain-overlay" aria-hidden="true" />
        <ScrollProgressBar />
        <Suspense fallback={<LoadingFallback />}>{content}</Suspense>
        <NotificationBanner />
        <OfflineBanner />
        <ToastContainer />
        <AchievementToast />
        <KeyboardShortcutsHelp />
        {achievementOverlay && (
          <AchievementUnlockOverlay
            visible={true}
            streak={achievementOverlay.streak}
            title={achievementOverlay.title}
            onDismiss={() => setAchievementOverlay(null)}
          />
        )}

        {settingsOpen && (
          <Suspense fallback={<LoadingFallback />}>
            <SettingsPanel />
          </Suspense>
        )}
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
