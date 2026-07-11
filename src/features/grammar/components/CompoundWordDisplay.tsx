import { useState, useEffect, useCallback, memo } from 'react';
import { splitCompound } from '../services/compoundSplitter';
import styles from './CompoundWordDisplay.module.css';
import type { CompoundWord, Language, TokenOccurrence } from '../../../types';

interface Props {
  token: TokenOccurrence;
  language: Language;
  isActive: boolean;
  children: React.ReactNode;
}

function CompoundWordDisplayImpl({
  token,
  language,
  isActive,
  children,
}: Props) {
  const [compoundData, setCompoundData] = useState<CompoundWord | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!token.isCompound || language !== 'de') {
      setCompoundData(null);
      return;
    }
    // v1.5.3 fix V2-P2-003: 加竞态保护, token 切换后旧 Promise resolve 不覆盖新状态.
    let cancelled = false;
    splitCompound(token.lemma, language).then((data) => {
      if (!cancelled) {
        setCompoundData(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token.lemma, token.isCompound, language]);

  useEffect(() => {
    if (isActive && compoundData) {
      setIsExpanded(true);
    } else {
      setIsExpanded(false);
    }
  }, [isActive, compoundData]);

  const handleClick = useCallback((e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation?.();
    setIsExpanded((prev) => !prev);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick(e);
      }
    },
    [handleClick]
  );

  if (!token.isCompound || !compoundData) {
    return <span>{children}</span>;
  }

  const ariaLabel = compoundData
    ? `复合词 ${token.lemma}，拆分为 ${compoundData.parts.map((p) => p.text).join(' + ')}`
    : `复合词 ${token.lemma}`;

  return (
    <span className={styles.container}>
      <span
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        className={styles.word}
      >
        {children}
      </span>

      {!isExpanded && (
        <div className={styles.hoverPreview}>
          <div className={styles.previewTitle}>复合词拆分</div>
          <div className={styles.splitPreview}>
            {compoundData.parts.map((part, idx) => (
              <span key={idx}>
                {idx > 0 && <span className={styles.separator}>+</span>}
                <span className={styles.part}>{part.text}</span>
              </span>
            ))}
            <span className={styles.separator}>=</span>
            <span className={styles.part}>{compoundData.lemma}</span>
          </div>
        </div>
      )}

      <div className={`${styles.expandedPanel} ${isExpanded ? styles.visible : ''}`}>
        <div className={styles.panelTitle}>
          <span className={styles.compoundIcon}>✦</span>
          {compoundData.lemma}
        </div>

        <div className={styles.splitFormula}>
          {compoundData.parts.map((part, idx) => (
            <span key={idx}>
              {idx > 0 && <span className={styles.separator}>+</span>}
              <span className={styles.part}>{part.text}</span>
            </span>
          ))}
          <span className={styles.separator}>=</span>
          <span className={styles.part}>{compoundData.lemma}</span>
        </div>

        <div className={styles.partsList}>
          {compoundData.parts.map((part, idx) => (
            <div key={idx} className={styles.partItem}>
              <span className={styles.partText}>{part.text}</span>
              <span className={styles.partMeaning}>{part.meaning}</span>
            </div>
          ))}
        </div>

        {compoundData.etymology && (
          <div className={styles.etymology}>{compoundData.etymology}</div>
        )}
      </div>
    </span>
  );
}

export const CompoundWordDisplay = memo(CompoundWordDisplayImpl);