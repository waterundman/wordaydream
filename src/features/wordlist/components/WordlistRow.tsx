/**
 * WordlistRow (v1.6.0 Stage 2)
 *
 * 单行词表条目. 点击整行展开/收起释义.
 *
 * 设计决策 (glossAdapter):
 * - glossAdapter.getGloss 需要 TokenOccurrence (阅读流中的 token 对象),
 *   不适用于词表浏览场景. 展开时直接显示 WordlistEntry.translation 字段.
 * - 不强行接入不合适的 API, 保持组件自洽.
 *
 * 状态图标 (SVG, 0 emoji):
 * - mastered: 实心圆 + check (accent-green)
 * - learning: 半圆 (accent-orange)
 * - unseen: 空心圆 (muted)
 */
import type { Language } from '../../../types';
import type { WordStatus } from '../store/useWordlistStore';
import styles from '../WordlistPage.module.css';

interface WordlistRowProps {
  lemma: string;
  pos?: string;
  translation?: string;
  status: WordStatus;
  isExpanded: boolean;
  onToggle: () => void;
  language: Language;
}

function StatusIcon({ status }: { status: WordStatus }) {
  if (status === 'mastered') {
    return (
      <svg
        className={styles.statusIconSvg}
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <path
          d="M7.5 12.5l3 3 6-7"
          fill="none"
          stroke="var(--color-text-inverse, #ffffff)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (status === 'learning') {
    return (
      <svg
        className={styles.statusIconSvg}
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path d="M12 2 A10 10 0 0 1 12 22 Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      className={styles.statusIconSvg}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function statusLabel(status: WordStatus): string {
  if (status === 'mastered') return '已掌握';
  if (status === 'learning') return '学习中';
  return '未学';
}

export function WordlistRow({
  lemma,
  pos,
  translation,
  status,
  isExpanded,
  onToggle,
}: WordlistRowProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  const statusClass =
    status === 'mastered'
      ? styles.statusMastered
      : status === 'learning'
        ? styles.statusLearning
        : styles.statusUnseen;

  return (
    <div
      className={`${styles.row} ${isExpanded ? styles.rowExpanded : ''}`}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
    >
      <div className={styles.rowMain}>
        <span className={`${styles.statusIcon} ${statusClass}`}>
          <StatusIcon status={status} />
        </span>
        <span className={styles.lemma}>{lemma}</span>
        {pos ? <span className={styles.pos}>{pos}</span> : null}
        <span className={`${styles.statusLabel} ${statusClass}`}>
          {statusLabel(status)}
        </span>
      </div>
      {isExpanded && translation ? (
        <div className={styles.translation}>{translation}</div>
      ) : null}
    </div>
  );
}
