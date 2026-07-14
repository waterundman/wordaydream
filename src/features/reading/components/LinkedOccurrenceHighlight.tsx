import { useCallback, memo } from 'react';
import { useReadingSessionStore } from '../store/useReadingSessionStore';
import { ResolvedUnderlineMotion } from './ResolvedUnderlineMotion';
import { WordUnveilAnimation } from './WordUnveilAnimation';
import { CompoundWordDisplay } from '../../grammar/components/CompoundWordDisplay';
import styles from './LinkedOccurrenceHighlight.module.css';
import type { TokenOccurrence, Language } from '../../../types';

interface Props {
  token: TokenOccurrence;
  language: Language;
  children: React.ReactNode;
}

function LinkedOccurrenceHighlightImpl({
  token,
  language,
  children,
}: Props) {
  const {
    activeOccurrenceId,
    hoveredGroupId,
    setActiveOccurrence,
    setHoveredGroup,
  } = useReadingSessionStore();

  const isActive = activeOccurrenceId === token.id;
  const isGroupHovered = hoveredGroupId === token.lexemeGroupId;
  const isPassiveHighlight = isGroupHovered && !isActive && !token.isResolved;
  const isReview = token.kind === 'review';
  const isCompound = token.isCompound;

  const handleClick = useCallback(() => {
    if (token.isResolved) return;
    setActiveOccurrence(isActive ? null : token.id);
  }, [token.isResolved, token.id, isActive, setActiveOccurrence]);

  const handleMouseEnter = useCallback(() => {
    if (!token.isResolved) {
      setHoveredGroup(token.lexemeGroupId);
    }
  }, [token.isResolved, token.lexemeGroupId, setHoveredGroup]);

  const handleMouseLeave = useCallback(() => {
    setHoveredGroup(null);
  }, [setHoveredGroup]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick]
  );

  const baseClassName = [
    styles.highlight,
    isActive ? styles.active : '',
    isPassiveHighlight ? styles.passive : '',
    isReview ? styles.review : '',
    isCompound ? styles.compound : '',
  ]
    .filter(Boolean)
    .join(' ');

  const renderContent = () => {
    if (isCompound) {
      return (
        <CompoundWordDisplay token={token} language={language} isActive={isActive}>
          {children}
        </CompoundWordDisplay>
      );
    }
    return <span className={styles.word}>{children}</span>;
  };

  return (
    <ResolvedUnderlineMotion isResolved={token.isResolved} className={baseClassName}>
      <span
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={token.isResolved ? -1 : 0}
        aria-disabled={token.isResolved}
        aria-label={isReview ? `复现词 ${token.lemma}` : isCompound ? `复合词 ${token.lemma}` : token.lemma}
        data-testid="token-trigger"
      >
        {isReview && <span className={styles.reviewDot} aria-hidden="true" />}
        <WordUnveilAnimation isResolved={token.isResolved}>
          {renderContent()}
        </WordUnveilAnimation>
      </span>
    </ResolvedUnderlineMotion>
  );
}

export const LinkedOccurrenceHighlight = memo(LinkedOccurrenceHighlightImpl);
