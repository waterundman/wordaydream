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
import { useAppModeStore, type AppMode } from './hooks/useAppModeStore';
import { ROUTE_LOADERS, DEFAULT_PREFETCH_TARGETS, createRouteComponent, installIntentPrefetch, schedulePrefetch } from './platform/routePrefetch';
import { useUrlHashSync } from './hooks/useUrlHashSync';
import styles from './App.module.css';
import './styles/tokens.css';

/** v1.6.1 Stage 4 (D4): 切页后焦点容器的可访问名称 (读屏会播报)。 */
const PAGE_LABELS: Record<AppMode, string> = {
  home: '主页',
  reading: '阅读',
  review: '复习',
  wordlist: '词表',
  course: '课程',
};

// v0.4.0-harmony Stage 3 (D3): 路由级 code splitting.
// 5 个路由组件 + SettingsPanel 改为 React.lazy 动态导入, 首屏 JS 体积下降 40%+.
// Suspense fallback 用轻量 LoadingFallback (一个 div + 居中文字, 无依赖).
//
// v1.6.1 Stage 4: 5 条懒加载工厂收敛到 src/platform/routePrefetch.ts 的 ROUTE_LOADERS,
// 与空闲/意图预取共用同一个说明符 —— 预取到的 chunk 就是 lazy 要的那一个。
//
// v1.6.1 Stage 5: 这 5 条从 `lazy()` 换成 `createRouteComponent()`。
// 根因 (e2e T17 探针实测): `React.lazy` 首次渲染**必定挂起一次**, 即使模块已预取完成
// —— 它首次渲染时才调工厂, 拿到的是崭新的 import() promise, 所以仍要 throw 一轮再去
// 重试。实测 chunk 已预热时 LoadingFallback 仍出现 1 次 / 可见约 54ms。正常动效下这段
// 闪动被墨迹覆盖层挡住, 但 reduced-motion 用户会直接看到。
// `createRouteComponent` 在渲染时直接读模块注册表: 已就绪 → 同步渲染 (不挂起)。
// SettingsPanel 仍用 `lazy()`: 它不在 ROUTE_LOADERS 里, 也不会被预取。
const HomePage = createRouteComponent(ROUTE_LOADERS.home);
const ReadingSessionPage = createRouteComponent(ROUTE_LOADERS.reading);
const ReviewSessionPage = createRouteComponent(ROUTE_LOADERS.review);
const WordlistPage = createRouteComponent(ROUTE_LOADERS.wordlist);
const CoursePathPage = createRouteComponent(ROUTE_LOADERS.course);
// SettingsPanel 仅在 settingsOpen=true 时需要, 单独 lazy 避免阻塞首屏.
// 不进 ROUTE_LOADERS: 它不是 AppMode, 也不会被空闲预取。
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
  // v1.6.1 Stage 3: 待切换队列.
  //
  // 过渡进行中收到的导航请求不再"静默同步换页", 而是排入队列: 由当前过渡的
  // onCovered 消费队首 (在 overlay 下方换页), 剩余条目在当前过渡结束后接续播放.
  //
  // 为什么不沿用 v2.4.0 的同步绕过: 那样虽然解了死锁, 却让首屏开场 1.9s 窗口内
  // 的导航彻底失去过渡 (内容在正在退场的 overlay 后面突变). 排队保证每次导航都
  // 拿到自己的完整过渡, 代价是多等一段动画 (有界: 最多再等 1 段).
  const queueRef = useRef<AppMode[]>([]);
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

  // v1.6.1 Stage 4 (P2-2): 空闲预取首页的常用去向 (串行, ≤3 chunk; saveData 时整体跳过).
  // 目的: 点「开始阅读」时路由 chunk 已在缓存里 → 不再闪 LoadingFallback。
  // 限定在 home 下, 避免在其他页面做无意义的预取。
  useEffect(() => {
    if (appMode !== 'home') return;
    schedulePrefetch(DEFAULT_PREFETCH_TARGETS);
  }, [appMode]);

  // v1.6.1 Stage 4 (P2-2): 委托式意图预取 —— hover / 键盘聚焦到
  // [data-prefetch-route] 元素时立刻拉取对应 chunk。
  useEffect(() => installIntentPrefetch(), []);

  // v1.6.1 Stage 4 (D4): 路由切换后的焦点管理。
  //
  // 以前切页后焦点落回 <body>, 读屏不会播报新页面, 键盘用户的下一次 Tab 也会从
  // 文档开头重新开始 —— 这是真实的 a11y 缺口。
  //
  // 只在"最近一次交互来自键盘"时迁移焦点: 鼠标用户点击导航后若把焦点挪走, 会让
  // 其后的 Tab 起点变得不可预期, 属体验倒退。capture 阶段监听以便在任何组件
  // stopPropagation 之前拿到事件。
  //
  // 为什么要 pending 标志 + ref 回调, 而不是在 [appMode] 的 effect 里直接 focus():
  // 目标路由是懒加载的 (createRouteComponent), **未预取**时首次进入会挂起 ——
  // Suspense 边界 (包在 InkWipeTransition 外面) 会把**整个子树**换成 LoadingFallback,
  // 焦点容器此刻根本不在 DOM 里, ref.current 为 null, 聚焦调用直接空转。
  // 所以要在容器真正挂载的那一刻补聚焦。
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const pendingRouteFocusRef = useRef(false);
  const lastInputWasKeyboardRef = useRef(false);
  const isFirstModeRef = useRef(true);

  const handleRouteContainerRef = useCallback((node: HTMLDivElement | null) => {
    pageContainerRef.current = node;
    if (node && pendingRouteFocusRef.current) {
      pendingRouteFocusRef.current = false;
      node.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    const onKeyDown = () => {
      lastInputWasKeyboardRef.current = true;
    };
    const onPointerDown = () => {
      lastInputWasKeyboardRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  useEffect(() => {
    // 首次挂载不是"切页", 不应抢走初始焦点
    if (isFirstModeRef.current) {
      isFirstModeRef.current = false;
      return;
    }
    if (!lastInputWasKeyboardRef.current) return;
    const node = pageContainerRef.current;
    if (node) {
      // 容器已在 (目标路由 chunk 已缓存, 未触发 Suspense)
      node.focus({ preventScroll: true });
    } else {
      // 被 Suspense 挂起, 容器稍后挂载时由 ref 回调补聚焦
      pendingRouteFocusRef.current = true;
    }
  }, [appMode]);

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
  }, [reviewMode, appMode, setAppMode]);

  useEffect(() => {
    const scope = appMode === 'review' ? 'review' : 'reading';
    setActiveShortcutScope(scope);
  }, [appMode]);

  // v2.3: 两阶段过渡 — cover (overlay 覆盖) → 切换内容 → reveal (overlay 揭开)
  // 用户点击导航时把目标排入队列 + 必要时起播, onCovered 时才真正 setAppMode.
  //
  // v1.6.1 Stage 3: 队列化 (取代 v2.4.0 的"过渡中同步 setAppMode"绕过).
  const navigateTo = useCallback((mode: AppMode) => {
    if (mode === appMode) return;
    const queue = queueRef.current;
    // 去重: 队尾已是同一目标时不再追加 (用户连点同一个导航按钮)
    if (queue[queue.length - 1] === mode) return;
    queue.push(mode);
    // 空闲 -> 立即起播; 过渡中 -> 只入队, 由 handleTransitionComplete 接续
    if (!isTransitioning) setIsTransitioning(true);
  }, [appMode, isTransitioning]);

  const handleCovered = useCallback(() => {
    const next = queueRef.current.shift();
    if (next !== undefined) setAppMode(next);
  }, [setAppMode]);

  const handleTransitionComplete = useCallback(() => {
    setIsTransitioning(false);
  }, []);

  // 当前过渡播完, 若队列仍有待处理导航, 于下一帧重新起播.
  //
  // 必须落在独立的一帧里把 active 从 false 翻回 true: 同一个 handler 内直接
  // false→true 会被 React 批处理合并成"值未变化", InkWipeTransition 的 effect
  // (依赖 active 的 false→true 沿) 不会重跑 —— 这正是 v2.4.0 记录的死锁根因.
  // 放在 effect 里还能保证这次翻转发生在 false 那次渲染**提交之后**.
  useEffect(() => {
    if (isTransitioning || queueRef.current.length === 0) return;
    const frame = requestAnimationFrame(() => setIsTransitioning(true));
    return () => cancelAnimationFrame(frame);
  }, [isTransitioning]);

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

  // v1.6.1 Stage 3: 过渡容器提升为单层 —— 原先 5 条分支各自包裹一次
  // <InkWipeTransition> (同一元素类型, React 本就复用同一实例, 5 份只是代码重复),
  // 现在只包一次, 内层按 appMode 换内容.
  //
  // 内层元素带 key={appMode}: 换页时强制重新挂载目标页面 (而非就地复用),
  // 保证上一页的 hook 状态 / 局部滚动位置被清理.
  let page: ReactNode;
  if (appMode === 'home') {
    page = (
      <HomePage
        key={appMode}
        onStartReading={handleStartReading}
        onOpenSettings={openSettings}
        onViewWordlist={handleViewWordlist}
      />
    );
  } else if (appMode === 'wordlist') {
    page = <WordlistPage key={appMode} onGoHome={handleGoHome} />;
  } else if (appMode === 'course') {
    page = <CoursePathPage key={appMode} onGoHome={handleGoHome} onStartReading={handleStartReading} />;
  } else if (appMode === 'review') {
    page = <ReviewSessionPage key={appMode} />;
  } else {
    page = <ReadingSessionPage key={appMode} />;
  }

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <div className="grain-overlay" aria-hidden="true" />
        <ScrollProgressBar />
        <Suspense fallback={<LoadingFallback />}>
          <InkWipeTransition
            active={isTransitioning}
            onCovered={handleCovered}
            onComplete={handleTransitionComplete}
          >
            {/* v1.6.1 Stage 4 (D4): 路由焦点容器 —— 切页后 (键盘模态下) 把焦点移到
                这里, 读屏播报 PAGE_LABELS[appMode], 键盘 Tab 从新页面开头继续。 */}
            <div
              ref={handleRouteContainerRef}
              className={styles.routeContainer}
              tabIndex={-1}
              aria-label={PAGE_LABELS[appMode]}
              data-route-container=""
            >
              {page}
            </div>
          </InkWipeTransition>
        </Suspense>
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
