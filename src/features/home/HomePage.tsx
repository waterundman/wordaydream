/**
 * 主页 (Design v3 — 单列 960px 居中)
 *
 * 设计稿对齐:
 *  1. Header: Wordaydream wordmark (Newsreader) + streak badge + 设置按钮
 *  2. Hero Card: fleuron + 标题 + 手绘下划线 + 首字下沉 + CTA + 140px 进度环
 *  3. BotanicalDivider: 植物藤蔓墨迹绘制
 *  4. CurrentLessonCard: 当前课时 / 选择课程
 *  5. TodayCard + dailyGoal + review prompt + wordlist btn
 *  6. TornPaperDivider: 撕纸纹墨迹绘制
 *  7. AchievementWall: 2x2 / 4cols 徽章卡
 *  8. Seedling 空状态
 *  9. Footer: DifficultySuggestion + mini divider + wordmark
 *
 * 入场动画: HeroSection 自管 (错峰 fadeUp), 其余由 useScrollReveal 调度.
 * prefers-reduced-motion 兼容.
 */
import { useState, useMemo, useEffect } from 'react';
import { StreakBadge } from './components/StreakBadge';
import { TodayCard } from './components/TodayCard';
import { HeroSection } from './components/HeroSection';
import { TodayReviewCard } from './components/TodayReviewCard';
import { AchievementWall } from './components/AchievementWall';
import { BotanicalDivider, TornPaperDivider } from './components/Dividers';
import { DifficultySuggestion } from '../difficulty-coupling/components/DifficultySuggestion';
import { AchievementListModal } from '../achievements/components/AchievementListModal';
import { GraduationModal } from '../graduation/components/GraduationModal';
import { LessonCompleteModal } from '../course/components/LessonCompleteModal';
import { CurrentLessonCard } from './CurrentLessonCard';
import { useSettingsStore } from '../settings/store/useSettingsStore';
import { useReadingSessionStore } from '../reading/store/useReadingSessionStore';
import { useWordlistStore } from '../wordlist/store/useWordlistStore';
import { useMemoryStore } from '../review/store/useMemoryStore';
import { useReviewSessionStore } from '../review/store/useReviewSessionStore';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import { publicAssetUrl } from '../../platform/publicAssetUrl';
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

  const difficulty = useSettingsStore((s) => s.difficulty);
  const setDifficulty = useSettingsStore((s) => s.setDifficulty);
  const lastConfig = useReadingSessionStore((s) => s.lastConfig);
  const language = lastConfig?.language ?? 'en';
  const progress = useWordlistStore((s) => s.progress);
  const dailyGoal = useWordlistStore((s) => s.dailyGoal);
  const [levelTotal, setLevelTotal] = useState(0);

  const memoryCards = useMemoryStore((s) => s.cards);
  const dueCards = useMemo(
    () => useMemoryStore.getState().getDueCards(language),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- memoryCards 是 zustand 订阅的重算触发器 (memo 体走 getState() 快照), 删除会导致复习后 dueCount 冻结
    [memoryCards, language],
  );

  const [graduationShownFor, setGraduationShownFor] = useState<DifficultyLevel | null>(null);
  const [courseCompleteShown, setCourseCompleteShown] = useState(false);
  const [graduationMode, setGraduationMode] = useState<'level' | 'course'>('level');
  const [graduationOpen, setGraduationOpen] = useState(false);

  useEffect(() => {
    setLevelTotal(0);
    void useWordlistStore.getState().getLevelTotal(language, difficulty).then(setLevelTotal);
  }, [language, difficulty]);

  const masteredCount = useMemo(() => {
    return useWordlistStore.getState().getMasteredCount(language, difficulty);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- progress/levelTotal 是重算触发器 (memo 体走 getState() 快照), 删除会导致已掌握计数冻结
  }, [language, difficulty, progress, levelTotal]);

  const isFreeMode = difficulty === 5;

  useEffect(() => {
    if (useWordlistStore.getState().checkCourseCompletion(language) && !courseCompleteShown) {
      setGraduationMode('course');
      setGraduationOpen(true);
      return;
    }
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

  const handleGraduationEnterNext = () => {
    if (graduationMode === 'course') {
      setDifficulty(5);
      setCourseCompleteShown(true);
    } else {
      setDifficulty((difficulty + 1) as DifficultyLevel);
      setGraduationShownFor(difficulty);
    }
    setGraduationOpen(false);
  };

  const handleGraduationStay = () => {
    if (graduationMode === 'course') {
      setCourseCompleteShown(true);
    } else {
      setGraduationShownFor(difficulty);
    }
    setGraduationOpen(false);
  };

  const [, , todayClassName] = useScrollReveal<HTMLDivElement>({
    threshold: 0.3,
    delayMs: 100,
  });
  const [, , achievementClassName] = useScrollReveal<HTMLDivElement>({
    threshold: 0.5,
    delayMs: 200,
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
        <HeroSection
          onStart={onStartReading}
          progressCompleted={isFreeMode ? 0 : masteredCount}
          progressTotal={isFreeMode ? 1 : (levelTotal || 1)}
        />

        {/* 每日学习目标 (新词 X/10 · 复习 Y/Z) */}
        <div
          className={`${styles.dailyGoal} ${todayClassName}`}
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

        <BotanicalDivider />

        <CurrentLessonCard />

        <div className={todayClassName}>
          <TodayCard
            onStart={onStartReading}
            sessionStatus={sessionStatus}
          />
        </div>

        <TodayReviewCard
          dueCount={dueCards.length}
          onStartReview={handleStartReview}
          revealClassName={todayClassName}
        />

        <button
          className={`${styles.wordlistBtn} ${todayClassName}`}
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

        <TornPaperDivider />

        <AchievementWall
          onOpenAll={handleOpenAchievements}
          revealClassName={achievementClassName}
        />

        {/* Seedling 空状态 */}
        <div className={`${styles.seedling} ${achievementClassName}`}>
          <img
            src={publicAssetUrl('assets/svg/spot-seedling.svg')}
            width="96"
            height="64"
            alt=""
            aria-hidden="true"
          />
          <p className={styles.seedlingText}>继续阅读解锁更多</p>
        </div>
      </main>

      <footer className={styles.footer}>
        <DifficultySuggestion />
        <div className={styles.footerDivider}>
          <TornPaperDivider />
        </div>
        <span className={styles.footerWordmark}>Wordaydream</span>
      </footer>

      <AchievementListModal
        open={achievementModalOpen}
        onClose={handleCloseModal}
      />

      <GraduationModal
        open={graduationOpen}
        mode={graduationMode}
        currentDifficulty={difficulty}
        onEnterNext={handleGraduationEnterNext}
        onStay={handleGraduationStay}
      />

      <LessonCompleteModal />
    </div>
  );
}
