import { useRef, useEffect } from 'react';
import { usePanelPosition } from '../../../hooks/usePanelPosition';
import styles from './GrammarPanel.module.css';
import type { GrammarPoint } from '../../../types';

interface Props {
  grammarPoint: GrammarPoint;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

function DifficultyStars({ level }: { level: number }) {
  return (
    <div className={styles.difficulty}>
      {[1, 2, 3, 4, 5].map((idx) => (
        <svg
          key={idx}
          className={`${styles.star} ${idx <= level ? styles.filled : ''}`}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </div>
  );
}

const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function GrammarPanel({ grammarPoint, onClose, anchorRef }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const liveId = useRef(`grammar-live-${Math.random().toString(36).slice(2)}`).current;

  const panelPosition = usePanelPosition(
    anchorRef ?? { current: null } as React.RefObject<HTMLElement | null>,
    true,
    { width: 360, height: 320 },
  );

  const panelStyle: React.CSSProperties = {
    top: panelPosition.vertical === 'top' ? undefined : 'calc(100% + var(--space-2))',
    bottom: panelPosition.vertical === 'top' ? 'calc(100% + var(--space-2))' : undefined,
    left: panelPosition.horizontal === 'right' ? 'auto' : panelPosition.horizontal === 'left' ? '0' : '50%',
    right: panelPosition.horizontal === 'right' ? '0' : 'auto',
    ['--panel-offset-x' as string]: `${panelPosition.offsetX}px`,
  };

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    panel.addEventListener('keydown', onKeyDown);
    first?.focus();

    return () => panel.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className={`${styles.panel} ${styles.expandAnimation}`}
      role="dialog"
      aria-label="语法解释"
      style={panelStyle}
    >
      <div className={styles.header}>
        <div className={styles.typeBadge}>
          <span className={styles.typeLabel}>{grammarPoint.type}</span>
          <DifficultyStars level={grammarPoint.difficulty} />
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className={styles.content}>
        <div className={styles.exampleText}>{grammarPoint.text}</div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>语法规则</h3>
          <p className={styles.explanation}>{grammarPoint.explanation}</p>
        </div>

        {grammarPoint.examples.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>例句</h3>
            <ul className={styles.examplesList}>
              {grammarPoint.examples.map((example, idx) => (
                <li key={idx} className={styles.exampleItem}>{example}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div id={liveId} aria-live="polite" aria-atomic="true" style={srOnlyStyle}>
        {grammarPoint.type} 语法规则已展开
      </div>
    </div>
  );
}