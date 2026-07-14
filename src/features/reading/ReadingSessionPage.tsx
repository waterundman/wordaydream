import { useState, useEffect, useMemo } from 'react';
import { InteractivePassage } from './components/InteractivePassage';
import { ReadingHistoryPanel } from './components/ReadingHistoryPanel';
import { useReadingSessionStore } from './store/useReadingSessionStore';
import { useReadingHistoryStore } from './store/useReadingHistoryStore';
import { useMemoryStore } from '../review/store/useMemoryStore';
import { useSettingsStore } from '../settings/store/useSettingsStore';
import { useWordlistStore } from '../wordlist/store/useWordlistStore';
import { SettingsPanel } from '../settings/components/SettingsPanel';
import { ReviewPromptBanner } from '../review/components/ReviewPromptBanner';
import { AnalyticsPanel } from '../analytics/components/AnalyticsPanel';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import styles from './ReadingSessionPage.module.css';
import type { Language, DifficultyLevel } from '../../types';
import type { HistoryEntry } from './store/useReadingHistoryStore';

const CEFR_LABELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;

const MD_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MD_BREAKPOINT);

  useEffect(() => {
    // v1.5.2 fix L6: resize 事件加 150ms 防抖, 避免拖拽窗口时高频 setState.
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const handleResize = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        setIsMobile(window.innerWidth < MD_BREAKPOINT);
      }, 150);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);

  return isMobile;
}

export function ReadingSessionPage() {
  const { session, isLoading, loadSession, loadFromHistory, getResolvedCount, getTotalTokenCount, setActiveOccurrence } = useReadingSessionStore();
  const currentHistoryId = useReadingSessionStore((s) => s.currentHistoryId);
  const { addCardFromToken } = useMemoryStore();
  const { openSettings, settingsOpen, llm } = useSettingsStore();
  // v1.5.3 fix V2-P2-009: 初始值从持久化 session / lastConfig 读取, 避免刷新后选择器与实际不一致.
  const [language, setLanguage] = useState<Language>(() => {
    const store = useReadingSessionStore.getState();
    return store.session?.language ?? store.lastConfig?.language ?? 'en';
  });
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(() => {
    const store = useReadingSessionStore.getState();
    return store.session?.difficulty ?? store.lastConfig?.difficulty ?? 2;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  // v1.6.0: 课程化难度解锁 (CEFR 词表驱动)
  const wordlistProgress = useWordlistStore((s) => s.progress);
  const linearMode = useWordlistStore((s) => s.linearMode);

  useEffect(() => {
    // 预加载当前语言 A1-B2 词表, 确保解锁判定准确
    for (let lvl = 1; lvl <= 4; lvl++) {
      void useWordlistStore.getState().getLevelTotal(language, lvl as DifficultyLevel);
    }
  }, [language]);

  const unlockedLevels = useMemo(() => {
    void wordlistProgress;
    void linearMode;
    return CEFR_LABELS.map((_, i) =>
      useWordlistStore.getState().isLevelUnlocked(language, (i + 1) as DifficultyLevel)
    );
  }, [language, wordlistProgress, linearMode]);

  const resolvedCount = getResolvedCount();
  const totalCount = getTotalTokenCount();

  const handleGenerate = async () => {
    await loadSession(language, difficulty);
  };

  useGlobalShortcuts({
    enabled: true,
    ratingEnabled: false,
    handlers: {
      onEscape: () => setActiveOccurrence(null),
    },
  });

  useKeyboardShortcuts('reading-page', [
    {
      id: 'regenerate',
      key: 'r',
      scope: 'reading',
      handler: () => {
        if (!isLoading) {
          handleGenerate();
        }
      },
      description: '重新生成文本',
    },
  ]);

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
  };

  const handleDifficultyChange = (level: DifficultyLevel) => {
    setDifficulty(level);
  };

  const handleReRead = (entry: HistoryEntry) => {
    // v2.2.1 Stage 1 (Bug 2 P0): 加载中时禁止从历史重读, 避免与 in-flight loadSession 竞态.
    if (isLoading) return;
    loadFromHistory(entry.passage, entry.language, entry.difficulty);
  };

  useEffect(() => {
    const currentSession = useReadingSessionStore.getState().session;
    if (!currentSession) {
      loadSession(language, difficulty);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    // v1.5.2 fix P1-5: 历史重读会话跳过 addCardFromToken.
    // 之前 loadFromHistory 加载的 session 中已 resolved token 会触发 addCardFromToken,
    // 若记忆库已被 resetAll 清空, 会用全新 firstLearnedAt/reps=0 重建卡片, 丢失 FSRS 进度.
    // isReplay=true 的会话只供用户回顾文本, 不再产生记忆卡片副作用.
    if (session.isReplay) return;
    const resolvedTokens = session.passage.tokens.filter((t) => t.isResolved);
    for (const token of resolvedTokens) {
      addCardFromToken(token, session.language);
    }
    // v1.5.3 fix V2-P3-005: 移除 session 对象依赖, 仅用 resolvedTokens.size 触发,
    // 避免 setActiveOccurrence 等不改变 resolvedTokens 的操作也重跑 effect.
    // v2.2.1 Stage 1 (Bug 2 P2): 进一步移除 session?.passage.tokens 与 session?.language 依赖,
    // 避免 markOccurrenceResolved 产生新 tokens 数组引用时重跑 effect 触发 addCardFromToken 事件风暴.
  }, [session?.resolvedTokens.size, addCardFromToken, session?.isReplay]);

  // v2.1.0 Stage 2 (Contract 64): 阅读完成时激活 completeEntry (标记 completedAt).
  // 触发条件: 非重读会话 + 有 token + 全部 resolved + 有 currentHistoryId.
  // completeEntry 自身幂等 (检查 completedAt), effect 重复触发不会重复标记.
  // 历史重读 (isReplay) 不触发: 只读模式不应标记完成.
  // v2.2.4 Stage 2 (D2-1): completeEntry 不再发布 'reading:completed' 事件 (死事件已移除).
  useEffect(() => {
    if (!session) return;
    if (session.isReplay) return;
    if (totalCount === 0) return;
    if (resolvedCount < totalCount) return;
    if (!currentHistoryId) return;
    useReadingHistoryStore.getState().completeEntry(currentHistoryId);
  }, [resolvedCount, totalCount, session?.isReplay, currentHistoryId]);

  // v2.1.0 Stage 2 (Contract 64): 阅读完成态 — 渲染 "读下一篇" CTA 的条件.
  // 重读会话 (isReplay) 不显示完成 CTA: 只读回顾不应有 "读下一篇" 入口.
  const isReadingCompleted = !!session && !session.isReplay && totalCount > 0 && resolvedCount >= totalCount;

  // v2.2.0 Stage 1 (D4): passage 来源标签文案 + 配色.
  // source === 'llm' → "AI 生成" (深墨色文字 + 暖白底)
  // source === 'mock' 或 undefined → "演示数据" (灰色文字 + 浅米色底)
  // source === 'mixed' → "AI 生成 (部分)" (深墨色文字 + 浅黄色底)
  const passageSource = session?.passage.source;
  const sourceBadgeConfig = (() => {
    if (passageSource === 'llm') {
      return {
        label: 'AI 生成',
        className: styles.sourceBadgeLlm,
        icon: <path d="M12 2L9.5 8.5 2 9l5.5 5.5L6 22l6-3 6 3-1.5-7.5L22 9l-7.5-0.5L12 2z" fill="currentColor" />,
      };
    }
    if (passageSource === 'mixed') {
      return {
        label: 'AI 生成 (部分)',
        className: styles.sourceBadgeMixed,
        icon: <path d="M12 2L9.5 8.5 2 9l5.5 5.5L6 22l6-3 6 3-1.5-7.5L22 9l-7.5-0.5L12 2z" fill="none" stroke="currentColor" strokeWidth="1.5" />,
      };
    }
    // source === 'mock' 或 undefined (旧数据保守显示)
    return {
      label: '演示数据',
      className: styles.sourceBadgeMock,
      icon: <path d="M4 4h16v4H4zM4 10h16v10H4z" fill="none" stroke="currentColor" strokeWidth="1.5" />,
    };
  })();

  return (
    <div className={styles.page}>
      {isMobile && (
        <>
          <button
            className={styles.sidebarToggle}
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              {sidebarOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
          <div
            className={`${styles.drawerOverlay} ${sidebarOpen ? styles.drawerOverlayVisible : ''}`}
            onClick={() => setSidebarOpen(false)}
          />
        </>
      )}

      <aside className={`${styles.sidebar} ${isMobile && sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.brand}>
          <h1 className={styles.brandName}>Wordaydream</h1>
          <p className={styles.brandTagline}>在语境中学习词汇</p>
        </div>

        <div className={styles.controlSection}>
          <label className={styles.sectionLabel}>语言</label>
          <div className={styles.languageTabs}>
            <button
              className={`${styles.langTab} ${language === 'en' ? styles.active : ''}`}
              onClick={() => handleLanguageChange('en')}
            >
              英语
            </button>
            <button
              className={`${styles.langTab} ${language === 'de' ? styles.active : ''}`}
              onClick={() => handleLanguageChange('de')}
            >
              德语
            </button>
          </div>
        </div>

        <div className={styles.controlSection}>
          <label className={styles.sectionLabel}>难度 (CEFR)</label>
          <div className={styles.difficultySlider}>
            {CEFR_LABELS.map((cefr, i) => {
              const level = (i + 1) as DifficultyLevel;
              const unlocked = unlockedLevels[i];
              const prevCefr = i > 0 ? CEFR_LABELS[i - 1] : null;
              return (
                <button
                  key={level}
                  className={`${styles.diffDot} ${difficulty === level ? styles.active : ''} ${!unlocked ? styles.locked : ''}`}
                  onClick={() => unlocked && handleDifficultyChange(level)}
                  disabled={!unlocked}
                  aria-label={`${cefr}${!unlocked ? ' (未解锁)' : ''}`}
                  title={!unlocked && prevCefr ? `完成 ${prevCefr} 80% 掌握可解锁` : cefr}
                >
                  <span className={styles.diffLabel}>{cefr}</span>
                  {!unlocked && (
                    <svg className={styles.lockIcon} viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <button
          className={styles.generateBtn}
          onClick={handleGenerate}
          disabled={isLoading}
        >
          {isLoading ? '生成中...' : '生成新文本'}
        </button>

        {session && (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>学习进度</span>
              <span className={styles.progressCount}>
                {resolvedCount} / {totalCount}
              </span>
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: totalCount > 0 ? `${(resolvedCount / totalCount) * 100}%` : '0%' }}
              />
            </div>
          </div>
        )}

        <div className={styles.sidebarFooter}>
          <ReadingHistoryPanel onReRead={handleReRead} />
          <AnalyticsPanel />
          <button className={styles.settingsBtn} onClick={openSettings} aria-label="设置">
            <span className={styles.settingsLabel}>设置</span>
            {llm.provider !== 'mock' && (
              <span className={styles.providerTag}>{llm.provider}</span>
            )}
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.readingContainer}>
          {isLoading ? (
            <div className={styles.loading}>
              <div className={styles.loadingSpinner} />
              <p>正在生成文本...</p>
            </div>
          ) : (
            <>
              {session && (
                <div
                  data-testid="passage-source-badge"
                  className={`${styles.sourceBadge} ${sourceBadgeConfig.className}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    {sourceBadgeConfig.icon}
                  </svg>
                  <span>{sourceBadgeConfig.label}</span>
                </div>
              )}
              <ReviewPromptBanner language={language} onGenerate={handleGenerate} />
              <InteractivePassage isReplay={session?.isReplay ?? false} />
              {session?.isReplay && (
                <div className={styles.replayCta}>
                  <p className={styles.replayText}>这是历史重读模式，词汇作答已禁用。</p>
                  <button
                    type="button"
                    className={styles.replayBtn}
                    onClick={() => {
                      if (!session) return;
                      loadFromHistory(session.passage, session.language, session.difficulty, { resetResolved: true });
                    }}
                  >
                    重新练习
                  </button>
                </div>
              )}
              {isReadingCompleted && (
                <div className={styles.completionCta}>
                  <p className={styles.completionText}>本篇词汇已全部掌握</p>
                  <button
                    type="button"
                    className={styles.readNextBtn}
                    onClick={handleGenerate}
                    disabled={isLoading}
                  >
                    读下一篇
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {settingsOpen && <SettingsPanel />}
    </div>
  );
}
