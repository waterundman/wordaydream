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
import { useState, useMemo } from 'react';
import { StreakBadge } from './components/StreakBadge';
import { TodayCard } from './components/TodayCard';
import { ProgressRing } from './components/ProgressRing';
import { HeroSection } from './components/HeroSection';
import { AchievementWall } from './components/AchievementWall';
import { DifficultySuggestion } from '../difficulty-coupling/components/DifficultySuggestion';
import { AchievementListModal } from '../achievements/components/AchievementListModal';
import { useStreakStore } from '../streak/store/useStreakStore';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import styles from './HomePage.module.css';

interface HomePageProps {
  onStartReading: () => void;
  onOpenSettings: () => void;
  completedCount?: number;
  totalCount?: number;
}

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function HomePage({
  onStartReading,
  onOpenSettings,
  completedCount = 0,
  totalCount = 8,
}: HomePageProps) {
  const [achievementModalOpen, setAchievementModalOpen] = useState(false);
  const lastStudyDate = useStreakStore((s) => s.lastStudyDate);

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

  const isCompleted = useMemo(() => {
    if (!lastStudyDate) return false;
    return lastStudyDate === getTodayString();
  }, [lastStudyDate]);

  const handleOpenAchievements = () => {
    setAchievementModalOpen(true);
  };

  const handleCloseModal = () => {
    setAchievementModalOpen(false);
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
              isCompleted={isCompleted}
              revealClassName={todayClassName}
            />
            <ProgressRing
              completed={completedCount}
              total={totalCount}
              label={`今日完成 ${completedCount}/${totalCount} 词`}
              revealClassName={progressClassName}
            />
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
    </div>
  );
}
