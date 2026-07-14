/**
 * 主页 (Stage 4 扩展 + Stage 2 Hero-First 重设计)
 *
 * 三段式布局:
 *  1. 顶部 header: 品牌 + 连续天数 + 设置入口 (Stage 2 紧凑化: 移除 tagline)
 *  2. 主区 main: Hero (60%) + TodayCard+ProgressRing (40%) 桌面 split, 移动端 stack
 *  3. 底部 footer: 难度建议 (软提示) + 成就墙
 *
 * Stage 2 (v1.5.1) 新增:
 * - `HeroSection`: 60% 大标题 hero, 大 CTA 56px, 渐变背景, 入场动画
 * - 桌面 60/40 split (1.2fr Hero / 1fr TodayCard+ProgressRing)
 * - 移动端 stack 单列
 * - max-width 1024px (ultrawide 1200px via .page 居中)
 *
 * Stage 4 (v1.5.1) 新增: 滚动叙事 4 段错峰入场
 * - HeroSection 沿用 Stage 2 自管 useScrollReveal (立即, threshold 0.2)
 * - TodayCard / ProgressRing / AchievementWall 由本组件 useScrollReveal 统一调度:
 *     TodayCard  threshold 0.3 delay 100ms
 *     ProgressRing threshold 0.5 delay 200ms
 *     AchievementWall threshold 0.7 delay 300ms
 * - 入场动画: opacity 0->1 + translateY(16px)->0, 350ms ease-out-quart
 * - prefers-reduced-motion 兼容: 立即 visible, 无 transform
 * - 0 layout shift (CLS = 0, will-change: opacity, transform)
 *
 * 通过 props 把 "切到阅读 / 设置" 的副作用交给 App.tsx 处理,
 * HomePage 自身不持有 mode state, 保证与现有 App 路由无缝衔接。
 */
import { useState, useMemo, useEffect } from 'react';
import { StreakBadge } from './components/StreakBadge';
import { TodayCard } from './components/TodayCard';
import { ProgressRing } from './components/ProgressRing';
import { HeroSection } from './components/HeroSection';
import { TodayReviewCard } from './components/TodayReviewCard';
import { AchievementWall } from './components/AchievementWall';
import { DifficultySuggestion } from '../difficulty-coupling/components/DifficultySuggestion';
import { AchievementListModal } from '../achievements/components/AchievementListModal';
import { GraduationModal } from '../graduation/components/GraduationModal';
import { useSettingsStore } from '../settings/store/useSettingsStore';
import { useReadingSessionStore } from '../reading/store/useReadingSessionStore';
import { useWordlistStore } from '../wordlist/store/useWordlistStore';
import { useMemoryStore } from '../review/store/useMemoryStore';
import { useReviewSessionStore } from '../review/store/useReviewSessionStore';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import type { DifficultyLevel } from '../../types';
import styles from './HomePage.module.css';

interface HomePageProps {
  onStartReading: () => void;
  onOpenSettings: () => void;
  onViewWordlist: () => void;
}

export function HomePage({
  onStartReading,
  onOpenSettings,
  onViewWordlist,
}: HomePageProps) {
  const [achievementModalOpen, setAchievementModalOpen] = useState(false);

  // v1.6.0: 课程进度 (CEFR 词表驱动)
  const difficulty = useSettingsStore((s) => s.difficulty);
  const setDifficulty = useSettingsStore((s) => s.setDifficulty);
  const lastConfig = useReadingSessionStore((s) => s.lastConfig);
  const language = lastConfig?.language ?? 'en';
  const progress = useWordlistStore((s) => s.progress);
  // v1.6.0 Stage 3.5-6: 每日学习目标 (新词 X/10 · 复习 Y)
  const dailyGoal = useWordlistStore((s) => s.dailyGoal);
  const [levelTotal, setLevelTotal] = useState(0);

  // v1.6.0 Stage 3.6-C: 复习编排 — 获取当前语言的待复习卡片, 用于首页提示 + 跳转复习.
  const memoryCards = useMemoryStore((s) => s.cards);
  const dueCards = useMemo(
    () => useMemoryStore.getState().getDueCards(language),
    [memoryCards, language],
  );

  // v1.6.0 Stage 1: 毕业机制 state
  // graduationShownFor: 记录已显示过毕业 modal 的等级, 防止重复弹出
  const [graduationShownFor, setGraduationShownFor] = useState<DifficultyLevel | null>(null);
  // courseCompleteShown: 课程毕业 modal 是否已显示
  const [courseCompleteShown, setCourseCompleteShown] = useState(false);
  // graduationMode: 当前毕业 modal 模式 (level / course)
  const [graduationMode, setGraduationMode] = useState<'level' | 'course'>('level');
  // graduationOpen: 毕业 modal 是否打开
  const [graduationOpen, setGraduationOpen] = useState(false);

  useEffect(() => {
    setLevelTotal(0);
    void useWordlistStore.getState().getLevelTotal(language, difficulty).then(setLevelTotal);
  }, [language, difficulty]);

  const masteredCount = useMemo(() => {
    return useWordlistStore.getState().getMasteredCount(language, difficulty);
  }, [language, difficulty, progress, levelTotal]);

  const cefrLabel = difficulty === 1 ? 'A1' : difficulty === 2 ? 'A2' : difficulty === 3 ? 'B1' : difficulty === 4 ? 'B2' : 'C1';
  const isFreeMode = difficulty === 5;
  const progressLabel = isFreeMode
    ? 'C1 自由阅读模式'
    : levelTotal > 0
      ? `${cefrLabel} 已掌握 ${masteredCount}/${levelTotal} 词`
      : `${cefrLabel} 词表加载中`;

  // v1.6.0 Stage 1: 毕业检测 — 课程毕业优先于等级毕业
  useEffect(() => {
    // 课程毕业: A1-B2 全部 100% mastered 且未显示过
    if (useWordlistStore.getState().checkCourseCompletion(language) && !courseCompleteShown) {
      setGraduationMode('course');
      setGraduationOpen(true);
      return;
    }
    // 等级毕业: 当前等级 100% mastered 且未为该等级显示过
    if (
      !isFreeMode &&
      levelTotal > 0 &&
      masteredCount === levelTotal &&
      graduationShownFor !== difficulty
    ) {
      setGraduationMode('level');
      setGraduationOpen(true);
    }
  }, [language, difficulty, isFreeMode, levelTotal, masteredCount, graduationShownFor, courseCompleteShown]);

  // v1.6.0 Stage 1: 毕业处理 — 用户选"进入下一级"
  const handleGraduationEnterNext = () => {
    if (graduationMode === 'course') {
      setDifficulty(5);
      setCourseCompleteShown(true);
    } else {
      // level mode: difficulty < 4 → 下一级; difficulty === 4 → C1 自由阅读
      setDifficulty((difficulty + 1) as DifficultyLevel);
      setGraduationShownFor(difficulty);
    }
    setGraduationOpen(false);
  };

  // v1.6.0 Stage 1: 毕业处理 — 用户选"留下巩固" / "关闭"
  const handleGraduationStay = () => {
    if (graduationMode === 'course') {
      setCourseCompleteShown(true);
    } else {
      setGraduationShownFor(difficulty);
    }
    setGraduationOpen(false);
  };

  // === Stage 4 滚动叙事 3 段调度 (HeroSection 自管, 不在此处) ===
  const [, , todayClassName] = useScrollReveal<HTMLDivElement>({
    threshold: 0.3,
    delayMs: 100,
  });
  const [, , progressClassName] = useScrollReveal<HTMLDivElement>({
    threshold: 0.5,
    delayMs: 200,
  });
  const [, , achievementClassName] = useScrollReveal<HTMLDivElement>({
    threshold: 0.7,
    delayMs: 300,
  });

  const sessionStatus = useMemo(() => ({
    newWordsDone: dailyGoal.newWordsDone,
    newWordsTarget: dailyGoal.newWordsTarget,
    reviewsDone: dailyGoal.reviewsDone,
    reviewsTarget: dailyGoal.reviewsTarget,
    dueCount: dueCards.length,
  }), [dailyGoal, dueCards]);

  const handleOpenAchievements = () => {
    setAchievementModalOpen(true);
  };

  const handleCloseModal = () => {
    setAchievementModalOpen(false);
  };

  // v1.6.0 Stage 3.6-C: 启动复习会话 (startReview 加载 dueCards 并切 mode='reviewing',
  // App.tsx 的 useEffect 监听 reviewMode 自动路由到 ReviewSessionPage).
  const handleStartReview = () => {
    useReviewSessionStore.getState().startReview(language);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1 className={styles.brandTitle}>Wordaydream</h1>
        </div>
        <div className={styles.headerRight}>
          <StreakBadge />
          <button
            className={styles.settingsBtn}
            onClick={onOpenSettings}
            aria-label="设置"
            type="button"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.split}>
          <div className={styles.splitLeft}>
            <HeroSection onStart={onStartReading} />
          </div>
          <div className={styles.splitRight}>
            <TodayCard
              onStart={onStartReading}
              sessionStatus={sessionStatus}
              revealClassName={todayClassName}
            />
            <ProgressRing
              completed={isFreeMode ? 0 : masteredCount}
              total={isFreeMode ? 1 : (levelTotal || 1)}
              label={progressLabel}
              revealClassName={progressClassName}
            />
            {/* v1.6.0 Stage 3.5-6: 每日学习目标 (新词 X/10 · 复习 Y/Z). 与 ProgressRing 共享 reveal. */}
            <div
              className={`${styles.dailyGoal} ${progressClassName}`}
              aria-label={`今日新词 ${dailyGoal.newWordsDone} / ${dailyGoal.newWordsTarget}, 复习 ${dailyGoal.reviewsDone}${dailyGoal.reviewsTarget > 0 ? ` / ${dailyGoal.reviewsTarget}` : ''}`}
            >
              <span className={styles.dailyGoalItem}>
                <span className={styles.dailyGoalLabel}>今日新词</span>
                <span
                  className={
                    dailyGoal.newWordsDone >= dailyGoal.newWordsTarget
                      ? `${styles.dailyGoalValue} ${styles.dailyGoalDone}`
                      : styles.dailyGoalValue
                  }
                >
                  {dailyGoal.newWordsDone}/{dailyGoal.newWordsTarget}
                </span>
              </span>
              <span className={styles.dailyGoalDivider} aria-hidden="true">·</span>
              <span className={styles.dailyGoalItem}>
                <span className={styles.dailyGoalLabel}>复习</span>
                <span
                  className={
                    dailyGoal.reviewsTarget > 0 && dailyGoal.reviewsDone >= dailyGoal.reviewsTarget
                      ? `${styles.dailyGoalValue} ${styles.dailyGoalDone}`
                      : styles.dailyGoalValue
                  }
                >
                  {dailyGoal.reviewsTarget > 0
                    ? `${dailyGoal.reviewsDone}/${dailyGoal.reviewsTarget}`
                    : dailyGoal.reviewsDone}
                </span>
              </span>
            </div>
            {/* v1.6.0 Stage 3.6-C: 复习编排 — dueCards 积压时主动提示"先复习". */}
            <TodayReviewCard
              dueCount={dueCards.length}
              onStartReview={handleStartReview}
              revealClassName={progressClassName}
            />
            {/* v1.6.0 Stage 2: 查看词表按钮 */}
            <button
              className={`${styles.wordlistBtn} ${progressClassName}`}
              onClick={onViewWordlist}
              type="button"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              查看词表
            </button>
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <DifficultySuggestion />
        <AchievementWall
          onOpenAll={handleOpenAchievements}
          revealClassName={achievementClassName}
        />
      </footer>

      <AchievementListModal
        open={achievementModalOpen}
        onClose={handleCloseModal}
      />

      {/* v1.6.0 Stage 1: 毕业弹窗 (level/course 双模式) */}
      <GraduationModal
        open={graduationOpen}
        mode={graduationMode}
        currentDifficulty={difficulty}
        onEnterNext={handleGraduationEnterNext}
        onStay={handleGraduationStay}
      />
    </div>
  );
}
