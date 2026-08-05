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
    // v2.2.4 Stage 3 (Bug 13): 只有答对 (resolvedGrade==='correct') 才变绿色.
    // 答错 (partial/wrong) 推进进度但保持原色, 让用户区分哪些词已掌握、哪些还需复习.
    // 旧数据无 resolvedGrade 时兼容视为 'correct' (保持旧行为).
    token.isResolved && (token.resolvedGrade ?? 'correct') === 'correct'
      ? styles.resolved
      : '',
    // v2.2.4 Stage 3 (Bug 13): 答错的 token 用柔和的灰色 + 删除线, 明确反馈"未掌握".
    token.isResolved && token.resolvedGrade && token.resolvedGrade !== 'correct'
      ? styles.resolvedWrong
      : '',
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

  // v2.2.4 Stage 3 (Bug 13): 揭开动画和下划线动画只在答对时播放.
  // 答错的 token 不应有"揭示庆祝"效果, 保持朴素即可.
  const isCorrectlyResolved = token.isResolved && (token.resolvedGrade ?? 'correct') === 'correct';

  return (
    <ResolvedUnderlineMotion isResolved={isCorrectlyResolved} className={baseClassName}>
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
        <WordUnveilAnimation isResolved={isCorrectlyResolved}>
          {renderContent()}
        </WordUnveilAnimation>
      </span>
    </ResolvedUnderlineMotion>
  );
}

export const LinkedOccurrenceHighlight = memo(LinkedOccurrenceHighlightImpl);
