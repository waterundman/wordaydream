import { useState, useRef, useEffect, useCallback } from 'react';
import { useReadingSessionStore } from '../store/useReadingSessionStore';
import { evaluateAnswer } from '../../evaluation/services/evaluateAnswer';
import { RemedyPanel } from '../../evaluation/components/RemedyPanel';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';
import { RatingBar } from '../../review/components/RatingBar';
import { usePageEntranceAnimation } from '../hooks/usePageEntranceAnimation';
import { useVocabPulseAnimation } from '../hooks/useVocabPulseAnimation';
import { usePanelPosition } from '../../../hooks/usePanelPosition';
import styles from './InlineAnswerPanel.module.css';
import type { TokenOccurrence, AnswerEvaluation, Rating, Language } from '../../../types';

interface Props {
  token: TokenOccurrence;
  language: Language;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export function InlineAnswerPanel({ token, language, anchorRef }: Props) {
  const [answer, setAnswer] = useState('');
  const [evaluation, setEvaluation] = useState<AnswerEvaluation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`answer-title-${Math.random().toString(36).slice(2)}`).current;
  const descId = useRef(`answer-desc-${Math.random().toString(36).slice(2)}`).current;
  const liveId = useRef(`answer-live-${Math.random().toString(36).slice(2)}`).current;
  // v1.5.2 fix P1-4: 持有 resolve timeout 引用, unmount/关闭时 cleanup, 避免跨会话误触发.
  const resolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // v1.5.3 fix V3-P2-002: mountedRef 守卫, 防止 evaluateAnswer 异步返回后卸载组件 setState.
  const mountedRef = useRef(true);
  const { markOccurrenceResolved, setActiveOccurrence } = useReadingSessionStore();
  const { addCardFromToken, rateCard, getCardByLexemeGroup } = useMemoryStore();
  const { recordEncounter } = useWordlistStore();

  // v1.5.2 fix P1-4: unmount 时清理 pending resolve timeout.
  // 之前 setTimeout 无 cleanup, 用户答对后 600ms 内关闭面板或切换会话,
  // timeout 仍会触发 markOccurrenceResolved, 可能在新会话误标记 token resolved.
  // v1.5.3 fix V3-P2-002: 同时标记 mountedRef=false, 守卫 evaluateAnswer 异步返回.
  useEffect(() => {
    // v1.5.3 fix: StrictMode 双重挂载时 cleanup 会置 false, 第二次 setup 需重置为 true.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (resolveTimerRef.current !== null) {
        clearTimeout(resolveTimerRef.current);
        resolveTimerRef.current = null;
      }
    };
  }, []);

  const { getStyle: getPanelStyle } = usePageEntranceAnimation({
    staggerDelay: 50,
    animationDuration: 400,
    offset: 8,
  });

  const { className: pulseClassName, triggerPulse } = useVocabPulseAnimation({
    duration: 600,
  });

  useEffect(() => {
    inputRef.current?.focus();
    triggerPulse();
  }, [triggerPulse]);

  const handleClose = useCallback(() => {
    // v2.2.4 Stage 3 (Bug 10): 答题后手动关闭面板时, 如果 token 还没 resolved (timer pending),
    // 立即 markOccurrenceResolved 推进进度. 未答题直接关闭则不 resolved.
    // v2.2.4 Stage 3 (Bug 13): 传入当前 evaluation.grade, 区分答对/答错视觉表现.
    if (resolveTimerRef.current !== null) {
      clearTimeout(resolveTimerRef.current);
      resolveTimerRef.current = null;
      const grade = evaluation?.grade ?? 'wrong';
      markOccurrenceResolved(token.id, grade);
    }
    setActiveOccurrence(null);
  }, [setActiveOccurrence, markOccurrenceResolved, token.id, evaluation?.grade]);

  const handleRating = useCallback((rating: Rating) => {
    if (token.kind === 'review' && token.cardId) {
      const card = getCardByLexemeGroup(token.lexemeGroupId);
      if (card) {
        rateCard(card.lexemeGroupId, rating);
      }
    }
    setShowRating(false);
    setActiveOccurrence(null);
  }, [token.kind, token.cardId, token.lexemeGroupId, rateCard, setActiveOccurrence, getCardByLexemeGroup]);

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
        handleClose();
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
    return () => panel.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await evaluateAnswer(
        answer.trim(),
        token.lemma,
        token.objectiveDifficulty,
        language
      );
      // v1.5.3 fix V3-P2-002: 卸载后不 setState, 避免 React 警告.
      if (!mountedRef.current) return;
      setEvaluation(result);

      if (result.grade === 'correct') {
        const existing = getCardByLexemeGroup(token.lexemeGroupId);
        if (!existing) {
          addCardFromToken(token, language);
        }
        // v1.6.0 Stage 3.5: 记录语境相遇 (按 passageId 去重), 用于 mastered 语境闭环判定.
        const passageId = useReadingSessionStore.getState().session?.id;
        if (passageId) {
          recordEncounter(language, token.lemma, passageId);
        }
        // v2.2.4 Stage 3 (Bug 10): 答对后延迟 1500ms 再关闭面板, 让用户看到"回答正确"反馈.
        // 之前 600ms 太短, 用户来不及确认答对, 也感觉不到词汇状态变化.
        resolveTimerRef.current = setTimeout(() => {
          resolveTimerRef.current = null;
          markOccurrenceResolved(token.id, 'correct');
        }, 1500);
        if (token.kind === 'review' && token.cardId) {
          setShowRating(true);
        }
      } else {
        // v2.2.4 Stage 3 (Bug 10): 答错/部分对也延迟关闭, 让用户看到反馈和 RemedyPanel.
        // 之前立即 markOccurrenceResolved 导致面板瞬间卸载, 红色/琥珀色反馈、hint、RemedyPanel
        // 用户根本看不到. correct 用 1500ms (反馈简单), partial/wrong 用 3500ms (需读补救内容).
        // v2.2.4 Stage 3 (Bug 13): 传入 grade, 让 markOccurrenceResolved 区分视觉表现.
        // 答错推进进度但 token 不变绿, 只有答对变绿.
        resolveTimerRef.current = setTimeout(() => {
          resolveTimerRef.current = null;
          markOccurrenceResolved(token.id, result.grade);
        }, 3500);
      }
    } catch (error) {
      // v1.5.3 fix: 评估错误标注为 'error' 来源, UI 可区分"评估失败"与"学习反馈".
      // 之前伪装成 'partial' 会误导用户以为自己部分答对.
      if (!mountedRef.current) return;
      setEvaluation({
        grade: 'partial',
        feedback: '评估服务暂时不可用，请稍后重试。',
        hint: error instanceof Error ? error.message : '未知错误',
        source: 'error',
      });
    } finally {
      if (mountedRef.current) setIsSubmitting(false);
    }
  };

  const gradeClass = evaluation
    ? evaluation.grade === 'correct'
      ? styles.correct
      : evaluation.grade === 'partial'
      ? styles.partial
      : styles.wrong
    : '';

  const isReview = token.kind === 'review';

  const panelPosition = usePanelPosition(
    anchorRef ?? { current: null } as React.RefObject<HTMLElement | null>,
    true,
    { width: 340, height: 260 },
  );

  const panelStyle: React.CSSProperties = {
    ...getPanelStyle(0),
    top: panelPosition.vertical === 'top' ? undefined : 'calc(100% + var(--space-2))',
    bottom: panelPosition.vertical === 'top' ? 'calc(100% + var(--space-2))' : undefined,
    left: panelPosition.horizontal === 'right' ? 'auto' : panelPosition.horizontal === 'left' ? '0' : '50%',
    right: panelPosition.horizontal === 'right' ? '0' : 'auto',
    ['--panel-offset-x' as string]: `${panelPosition.offsetX}px`,
  };

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

  return (
    <div
      ref={panelRef}
      className={`${styles.panel} ${styles.open} ${gradeClass} ${isReview ? styles.review : ''} ${pulseClassName}`}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      style={panelStyle}
    >
      <div id={titleId} style={srOnlyStyle}>
        {isReview ? `复现词：${token.lemma}` : '输入释义'}
      </div>
      <div id={descId} style={srOnlyStyle}>
        {isReview ? '请回忆这个词的中文含义并输入' : '请输入这个词的中文释义'}
      </div>
      {isReview && (
        <div className={styles.reviewBadge}>
          复现词 · {token.lemma}
        </div>
      )}
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.inputRow}>
          <input
            ref={inputRef}
            type="text"
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              // v1.5.3: 用户重新输入时清除上一次评估反馈, 让"重试"体验自然,
              // 避免旧的 wrong/partial 反馈和 RemedyPanel 干扰新一轮作答.
              if (evaluation && evaluation.grade !== 'correct') {
                setEvaluation(null);
              }
            }}
            placeholder={isReview ? '复现：回忆这个词的含义...' : '输入中文释义...'}
            className={styles.input}
            disabled={isSubmitting || evaluation?.grade === 'correct'}
            aria-label="释义输入"
          />
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={!answer.trim() || isSubmitting || evaluation?.grade === 'correct'}
          >
            {isSubmitting ? '...' : '确认'}
          </button>
        </div>

        {evaluation && (
          <div className={`${styles.feedback} ${styles[evaluation.grade]}`}>
            <div className={styles.feedbackHeader}>
              <p className={styles.feedbackText}>{evaluation.feedback}</p>
              {evaluation.source && (
                <span className={styles.sourceTag} data-source={evaluation.source}>
                  {evaluation.source === 'llm'
                    ? 'AI 评估'
                    : evaluation.source === 'heuristic'
                    ? '离线评估'
                    : '评估异常'}
                </span>
              )}
            </div>
            {evaluation.hint && evaluation.grade !== 'correct' && evaluation.source !== 'error' && (
              <p className={styles.hint}>{evaluation.hint}</p>
            )}
            {evaluation.source === 'error' && (
              <button
                type="button"
                className={styles.retryBtn}
                onClick={() => handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
                disabled={isSubmitting || !answer.trim()}
              >
                {isSubmitting ? '重试中...' : '重试评估'}
              </button>
            )}
          </div>
        )}

        {(evaluation?.grade === 'wrong' || evaluation?.grade === 'partial') &&
          evaluation?.source !== 'error' && (
            <RemedyPanel token={token} userAnswer={answer} language={language} />
          )}

        {showRating && (
          <RatingBar
            cardId={token.lexemeGroupId}
            onRate={handleRating}
          />
        )}

        <button
          type="button"
          className={styles.closeBtn}
          onClick={handleClose}
          aria-label="关闭"
        >
          ×
        </button>
      </form>
      <div id={liveId} aria-live="polite" aria-atomic="true" style={srOnlyStyle}>
        {evaluation
          ? evaluation.grade === 'correct'
            ? '回答正确'
            : evaluation.grade === 'partial'
            ? '部分正确'
            : '回答错误'
          : ''}
      </div>
    </div>
  );
}