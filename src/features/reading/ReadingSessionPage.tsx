import { useState, useEffect } from 'react';
import { InteractivePassage } from './components/InteractivePassage';
import { ReadingHistoryPanel } from './components/ReadingHistoryPanel';
import { useReadingSessionStore } from './store/useReadingSessionStore';
import { useMemoryStore } from '../review/store/useMemoryStore';
import { useSettingsStore } from '../settings/store/useSettingsStore';
import { SettingsPanel } from '../settings/components/SettingsPanel';
import { ReviewPromptBanner } from '../review/components/ReviewPromptBanner';
import { AnalyticsPanel } from '../analytics/components/AnalyticsPanel';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import styles from './ReadingSessionPage.module.css';
import type { Language, DifficultyLevel } from '../../types';
import type { HistoryEntry } from './store/useReadingHistoryStore';

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
  }, [session?.resolvedTokens.size, addCardFromToken, session?.isReplay, session?.passage.tokens, session?.language]);

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
          <label className={styles.sectionLabel}>难度</label>
          <div className={styles.difficultySlider}>
            {[1, 2, 3, 4, 5].map((level) => (
              <button
                key={level}
                className={`${styles.diffDot} ${difficulty === level ? styles.active : ''}`}
                onClick={() => handleDifficultyChange(level as DifficultyLevel)}
                aria-label={`难度 ${level}`}
              >
                <span className={styles.diffLabel}>{level}</span>
              </button>
            ))}
          </div>
          <div className={styles.difficultyLabels}>
            <span>入门</span>
            <span>进阶</span>
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
              <ReviewPromptBanner language={language} onGenerate={handleGenerate} />
              <InteractivePassage />
            </>
          )}
        </div>
      </main>

      {settingsOpen && <SettingsPanel />}
    </div>
  );
}
