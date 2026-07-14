import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { ReadingSessionPage } from './features/reading/ReadingSessionPage';
import { ReviewSessionPage } from './features/review/components/ReviewSessionPage';
import { useReviewSessionStore } from './features/review/store/useReviewSessionStore';
import { useMemoryStore } from './features/review/store/useMemoryStore';
import { useWordlistStore } from './features/wordlist/store/useWordlistStore';
import { useSettingsStore } from './features/settings/store/useSettingsStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NotificationBanner } from './components/NotificationBanner';
import { OfflineBanner } from './components/OfflineBanner';
import { ToastContainer } from './components/ToastContainer';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';
import { PageTransition } from './components/PageTransition';
import { AchievementToast } from './features/achievements/components/AchievementToast';
import { ThemeProvider } from './components/ThemeProvider';
import { ScrollProgressBar } from './components/ScrollProgressBar';
import { useKeyboardShortcuts, setActiveShortcutScope } from './hooks/useKeyboardShortcuts';
import { useCursorGlow } from './hooks/useCursorGlow';
import { useBreathingEffect } from './hooks/useBreathingEffect';
import { useReadingTimeTracker } from './hooks/useReadingTimeTracker';
import { useAppModeStore } from './hooks/useAppModeStore';
import { useUrlHashSync } from './hooks/useUrlHashSync';
import { HomePage } from './features/home/HomePage';
import { WordlistPage } from './features/wordlist/WordlistPage';
import './styles/tokens.css';

function App() {
  const reviewMode = useReviewSessionStore((s) => s.mode);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const appMode = useAppModeStore((s) => s.currentMode);
  const setAppMode = useAppModeStore((s) => s.setMode);
  const [isTransitioning, setIsTransitioning] = useState(true);

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

  useEffect(() => {
    setIsTransitioning(true);
    const timer = setTimeout(() => setIsTransitioning(false), 100);
    return () => clearTimeout(timer);
  }, [appMode]);

  const handleGoHome = useCallback(() => {
    setAppMode('home');
  }, []);

  const handleStartReading = useCallback(() => {
    setAppMode('reading');
  }, []);

  const handleViewWordlist = useCallback(() => {
    setAppMode('wordlist');
  }, []);

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
      <PageTransition isEntering={isTransitioning}>
        <HomePage
          onStartReading={handleStartReading}
          onOpenSettings={openSettings}
          onViewWordlist={handleViewWordlist}
        />
      </PageTransition>
    );
  } else if (appMode === 'wordlist') {
    content = (
      <PageTransition isEntering={isTransitioning}>
        <WordlistPage onGoHome={handleGoHome} />
      </PageTransition>
    );
  } else if (appMode === 'review') {
    content = (
      <PageTransition isEntering={isTransitioning}>
        <ReviewSessionPage />
      </PageTransition>
    );
  } else {
    content = (
      <PageTransition isEntering={isTransitioning}>
        <ReadingSessionPage />
      </PageTransition>
    );
  }

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <ScrollProgressBar />
        {content}
        <NotificationBanner />
        <OfflineBanner />
        <ToastContainer />
        <AchievementToast />
        <KeyboardShortcutsHelp />
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
