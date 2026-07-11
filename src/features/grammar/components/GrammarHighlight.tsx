import { memo, useCallback } from 'react';
import styles from './GrammarHighlight.module.css';
import type { GrammarPoint } from '../../../types';

interface Props {
  grammarPoint: GrammarPoint;
  children: React.ReactNode;
  isActive: boolean;
  isTypeHovered: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function GrammarHighlightImpl({
  grammarPoint,
  children,
  isActive,
  isTypeHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const isPassiveHighlight = isTypeHovered && !isActive;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // 阻止冒泡到父级 token，避免同时激活两个 panel
      e.stopPropagation();
      onClick();
    },
    [onClick]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }
    },
    [onClick]
  );

  const baseClassName = [
    styles.highlight,
    isActive ? styles.active : '',
    isPassiveHighlight ? styles.passive : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={baseClassName}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`语法点: ${grammarPoint.type}`}
    >
      <span className={styles.text}>{children}</span>
    </span>
  );
}

export const GrammarHighlight = memo(GrammarHighlightImpl);