import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { ReadingSessionPage } from './features/reading/ReadingSessionPage';
import { ReviewSessionPage } from './features/review/components/ReviewSessionPage';
import { useReviewSessionStore } from './features/review/store/useReviewSessionStore';
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
import { HomePage } from './features/home/HomePage';
import './styles/tokens.css';

/**
 * 应用级路由模式 (Stage 3 扩展)
 *
 * - 'home': 主页 (默认)
 * - 'reading': 阅读会话页
 * - 'review': 复习会话页 (由 useReviewSessionStore.mode 触发)
 */
type AppMode = 'home' | 'reading' | 'review';

function App() {
  const reviewMode = useReviewSessionStore((s) => s.mode);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const [appMode, setAppMode] = useState<AppMode>('home');
  const [isTransitioning, setIsTransitioning] = useState(true);

  useCursorGlow(true);
  useBreathingEffect(true);

  // v1.5.2 Stage 2 (Contract 28 NEW / D-2): 仅在 reading 模式累计阅读秒数
  // hook only, 不渲染 JSX; 跨日 reset / cleanup 由 hook 内部处理
  useReadingTimeTracker(appMode === 'reading');

  // Stage 3: 主页 ↔ 阅读 / 复习的路由状态机
  // 复习 store 切到 reviewing / completed 时, 路由强制进入 review 模式;
  // 复习结束 (mode === 'idle') 且当前处于 review 模式, 回到主页。
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
        />
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
