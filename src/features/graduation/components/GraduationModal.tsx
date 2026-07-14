/**
 * v1.6.0 Stage 1: 毕业弹窗
 *
 * 两种模式:
 * - level: 单等级毕业 (如 A2 100% mastered → 解锁 B1)
 * - course: 课程毕业 (A1-B2 全部 100% mastered → 解锁 C1 自由阅读)
 *
 * 设计要点:
 * - 沿用 warm white paper + dark ink 配色 (tokens.css)
 * - 入场动效: opacity 0->1 + translateY(16px)->0, 350ms ease-out
 * - prefers-reduced-motion 兼容: 立即 visible, 无 transform
 * - ESC 关闭 + 点击 overlay 关闭
 * - 0 emoji
 */
import { useEffect } from 'react';
import type { DifficultyLevel } from '../../../types';
import styles from './GraduationModal.module.css';

interface GraduationModalProps {
  open: boolean;
  mode: 'level' | 'course';
  /** 当前完成的等级 (level mode: 1-4; course mode: 4) */
  currentDifficulty: DifficultyLevel;
  /** 用户选"进入下一级" / "进入 C1 自由阅读" */
  onEnterNext: () => void;
  /** 用户选"留下巩固" (level mode) 或 "关闭" (course mode) */
  onStay: () => void;
}

/** CEFR 标签映射: 1=A1, 2=A2, 3=B1, 4=B2, 5=C1 */
const CEFR_LABELS: Record<number, string> = {
  1: 'A1',
  2: 'A2',
  3: 'B1',
  4: 'B2',
  5: 'C1',
};

export function GraduationModal({
  open,
  mode,
  currentDifficulty,
  onEnterNext,
  onStay,
}: GraduationModalProps) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onStay();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onStay]);

  if (!open) return null;

  const currentCEFR = CEFR_LABELS[currentDifficulty] ?? 'C1';
  const nextDifficulty = Math.min(currentDifficulty + 1, 5) as DifficultyLevel;
  const nextCEFR = CEFR_LABELS[nextDifficulty] ?? 'C1';

  // course mode: 课程毕业
  if (mode === 'course') {
    return (
      <div
        className={styles.overlay}
        onClick={onStay}
        role="dialog"
        aria-modal="true"
        aria-label="课程毕业"
      >
        <div
          className={styles.modal}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.body}>
            <h2 className={styles.title}>恭喜完成全部课程!</h2>
            <p className={styles.subtitle}>C1 自由阅读已解锁</p>
            <div className={styles.actions}>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={onEnterNext}
                type="button"
              >
                进入 C1 自由阅读
              </button>
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={onStay}
                type="button"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // level mode: 单等级毕业
  // B2 (difficulty=4) 完成时, "进入 C1" 意味着进入自由阅读模式
  const isB2Complete = currentDifficulty === 4;
  const enterLabel = isB2Complete ? '进入 C1 自由阅读' : `进入 ${nextCEFR}`;
  const stayLabel = `留在 ${currentCEFR} 巩固`;

  return (
    <div
      className={styles.overlay}
      onClick={onStay}
      role="dialog"
      aria-modal="true"
      aria-label="等级毕业"
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.body}>
          <h2 className={styles.title}>恭喜完成 {currentCEFR}!</h2>
          <p className={styles.subtitle}>已解锁 {nextCEFR}</p>
          <div className={styles.actions}>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onEnterNext}
              type="button"
            >
              {enterLabel}
            </button>
            <button
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={onStay}
              type="button"
            >
              {stayLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
