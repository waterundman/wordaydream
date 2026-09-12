import { useState, useEffect, useMemo, useRef } from 'react';
import { InteractivePassage } from './components/InteractivePassage';
import { ReadingHistoryPanel } from './components/ReadingHistoryPanel';
import { useReadingSessionStore } from './store/useReadingSessionStore';
import { useReadingHistoryStore } from './store/useReadingHistoryStore';
import { useSettingsStore } from '../settings/store/useSettingsStore';
import { useWordlistStore } from '../wordlist/store/useWordlistStore';
import { ReviewPromptBanner } from '../review/components/ReviewPromptBanner';
import { AnalyticsPanel } from '../analytics/components/AnalyticsPanel';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useAppModeStore } from '../../hooks/useAppModeStore';
import { WordLearnedOverlay } from '../../components/transitions/WordLearnedOverlay';
import { ReadingCompleteOverlay } from '../../components/transitions/ReadingCompleteOverlay';
import { detectPlatform } from '../../platform/detect';
import {
  speakViaWebSpeechSynthesis,
  stopWebSpeechSynthesis,
  setWebSpeechSynthesisEndCallback,
} from '../../platform/speechSynthesis';
import type { SpeakPayload } from '../../platform/harmonyBridge';
import styles from './ReadingSessionPage.module.css';
import type { Language, DifficultyLevel } from '../../types';
import type { HistoryEntry } from './store/useReadingHistoryStore';

const CEFR_LABELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
const LANGUAGE_LABELS: Record<Language, string> = { en: '英语', de: '德语' };

/** v0.3.0-harmony Stage 2: TTS 语速四档枚举. */
const RATE_OPTIONS = [0.5, 1.0, 1.5, 2.0] as const;
type SpeechRate = (typeof RATE_OPTIONS)[number];
const TTS_RATE_PREF_KEY = 'tts_rate';
const DEFAULT_RATE: SpeechRate = 1.0;

const MD_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MD_BREAKPOINT);

  useEffect(() => {
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

/** Estimate reading time in minutes from passage text (~200 wpm). */
function estimateReadingMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function ReadingSessionPage() {
  const { session, isLoading, loadSession, loadFromHistory, getResolvedCount, getTotalTokenCount, setActiveOccurrence, streamingPreviewText } = useReadingSessionStore();
  const currentHistoryId = useReadingSessionStore((s) => s.currentHistoryId);
  const { openSettings } = useSettingsStore();
  const setAppMode = useAppModeStore((s) => s.setMode);
  const [language, setLanguage] = useState<Language>(() => {
    const store = useReadingSessionStore.getState();
    return store.session?.language ?? store.lastConfig?.language ?? 'en';
  });
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(() => {
    const store = useReadingSessionStore.getState();
    return store.session?.difficulty ?? store.lastConfig?.difficulty ?? 2;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useIsMobile();

  const [wordLearned, setWordLearned] = useState<string | null>(null);
  const [readingCompleteVisible, setReadingCompleteVisible] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  // v0.3.0-harmony Stage 2: TTS 语速 (四档, 默认 1.0, 持久化到 localStorage)
  // 懒加载: 首次渲染从 localStorage 读取, 避免首屏闪烁.
  const [currentRate, setCurrentRate] = useState<SpeechRate>(() => {
    if (typeof window === 'undefined') return DEFAULT_RATE;
    try {
      const stored = window.localStorage.getItem(TTS_RATE_PREF_KEY);
      if (stored === '0.5' || stored === '1.0' || stored === '1.5' || stored === '2.0') {
        return Number(stored) as SpeechRate;
      }
    } catch {
      // localStorage 在某些环境可能抛 SecurityError, 静默回退默认值
    }
    return DEFAULT_RATE;
  });
  const prevCorrectIdsRef = useRef<Set<string>>(new Set());
  const sessionInitializedRef = useRef(false);

  const nativeSpeechRequestRef = useRef(0);
  const wordlistProgress = useWordlistStore((s) => s.progress);
  const linearMode = useWordlistStore((s) => s.linearMode);
  const dailyGoal = useWordlistStore((s) => s.dailyGoal);

  useEffect(() => {
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

  // v0.3.0-harmony Stage 2: TTS 双路径能力探测.
  // - Harmony: supportsSpeechSynthesis() 返回 true (由 harmonyBridge.speak 兜底)
  // - Web: 检测 'speechSynthesis' in window
  // - 任意一条可用 → 朗读按钮 enabled
  const platformCapability = detectPlatform();
  const nativeBridge = platformCapability.getNativeBridge();
  const ttsSupported =
    platformCapability.supportsSpeechSynthesis() || !!nativeBridge?.speak;

  // v0.3.0-harmony Stage 2: 双路径 TTS 朗读.
  // 优先调用 harmonyBridge.speak (鸿蒙原生 @ohos.textToSpeech Kit),
  // fallback 到 speakViaWebSpeechSynthesis (Web SpeechSynthesis API).
  // - isPlaying 时点击 → 停止 (bridge.stopSpeech + stopWebSpeechSynthesis)
  // - bridge 存在 → 走原生路径, fire-and-forget, 异常 catch 重置 isPlaying
  // - 否则 → Web SpeechSynthesis, setWebSpeechSynthesisEndCallback 切换 isPlaying
  const handleTogglePlay = () => {
    if (!ttsSupported) return;

    if (isPlaying) {
      nativeSpeechRequestRef.current += 1;
      if (nativeBridge) {
        try {
          nativeBridge.stopSpeech();
        } catch {
          // fire-and-forget: stopSpeech 异常静默跳过
        }
      }
      stopWebSpeechSynthesis();
      setWebSpeechSynthesisEndCallback(null);
      setIsPlaying(false);
      return;
    }

    if (!session?.passage.text) return;

    const payload: SpeakPayload = {
      text: session.passage.text,
      language: language === 'de' ? 'de-DE' : 'en-US',
      rate: currentRate,
    };

    if (nativeBridge) {
      // Harmony 原生路径
      const requestId = ++nativeSpeechRequestRef.current;
      setIsPlaying(true);
      const clearNativePlayingState = (): void => {
        if (nativeSpeechRequestRef.current === requestId) {
          setIsPlaying(false);
        }
      };
      try {
        void nativeBridge.speak(payload).then(
          clearNativePlayingState,
          clearNativePlayingState,
        );
      } catch {
        clearNativePlayingState();
      }
    } else {
      // Web SpeechSynthesis fallback 路径
      setWebSpeechSynthesisEndCallback(() => setIsPlaying(false));
      speakViaWebSpeechSynthesis(payload);
      setIsPlaying(true);
    }
  };

  // v0.3.0-harmony Stage 2: 切换 TTS 语速 + 持久化到 localStorage.
  // - 0.5 / 1.0 / 1.5 / 2.0 四档枚举 (SpeechRate)
  // - 持久化: localStorage (Web + 鸿蒙 ArkWeb 均支持 Web Storage API)
  // - 切换后立即生效: 下一次 handleTogglePlay 使用新 rate
  const handleRateChange = (rate: SpeechRate) => {
    setCurrentRate(rate);
    try {
      window.localStorage.setItem(TTS_RATE_PREF_KEY, String(rate));
    } catch {
      // localStorage 不可用时静默跳过, 内存状态仍生效
    }
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
    if (isLoading) return;
    loadFromHistory(entry.passage, entry.language, entry.difficulty);
  };

  const handleGoHome = () => {
    setAppMode('home');
  };

  useEffect(() => {
    const currentSession = useReadingSessionStore.getState().session;
    if (!currentSession) {
      loadSession(language, difficulty);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 仅 mount 引导一次会话; loadSession 为 zustand action 引用稳定, 但补 language/difficulty 依赖会在 session 为 null (生成进行中) 时切下拉重入触发重复生成竞态
  }, []);

  useEffect(() => {
    if (!session) return;
    if (session.isReplay) return;
    if (totalCount === 0) return;
    if (resolvedCount < totalCount) return;
    if (!currentHistoryId) return;
    useReadingHistoryStore.getState().completeEntry(currentHistoryId);
  }, [session, resolvedCount, totalCount, session?.isReplay, currentHistoryId]);

  const isReadingCompleted = !!session && !session.isReplay && totalCount > 0 && resolvedCount >= totalCount;

  useEffect(() => {
    prevCorrectIdsRef.current = new Set();
    setWordLearned(null);
    setReadingCompleteVisible(false);
    sessionInitializedRef.current = false;
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;

    const correctTokens = session.passage.tokens.filter(
      (t) => t.isResolved && t.resolvedGrade === 'correct' && (t.kind === 'normal' || t.kind === 'review'),
    );

    if (!sessionInitializedRef.current) {
      sessionInitializedRef.current = true;
      prevCorrectIdsRef.current = new Set(correctTokens.map((t) => t.id));
      return;
    }

    if (session.isReplay) return;

    for (const token of correctTokens) {
      if (!prevCorrectIdsRef.current.has(token.id)) {
        setWordLearned(token.surfaceForm);
        prevCorrectIdsRef.current = new Set(correctTokens.map((t) => t.id));
        return;
      }
    }
    prevCorrectIdsRef.current = new Set(correctTokens.map((t) => t.id));
  }, [session]);

  useEffect(() => {
    if (isReadingCompleted) {
      setReadingCompleteVisible(true);
    }
  }, [isReadingCompleted]);

  // 组件卸载时停止朗读 (v0.3.0-harmony Stage 2: 双路径清理)
  useEffect(() => {
    return () => {
      nativeSpeechRequestRef.current += 1;
      const bridge = detectPlatform().getNativeBridge();
      if (bridge) {
        try {
          bridge.stopSpeech();
        } catch {
          // fire-and-forget: stopSpeech 异常静默跳过
        }
      }
      stopWebSpeechSynthesis();
      setWebSpeechSynthesisEndCallback(null);
    };
  }, []);

  const readingStats = useMemo(() => {
    const history = useReadingHistoryStore.getState().history;
    const completedCount = history.filter((e) => e.completedAt).length;
    const minutes = session
      ? Math.max(1, Math.round((Date.now() - session.startedAt) / 60000))
      : 1;
    return {
      minutesRead: minutes,
      articlesRead: completedCount + 1,
    };
  }, [session]);

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
    return {
      label: '演示数据',
      className: styles.sourceBadgeMock,
      icon: <path d="M4 4h16v4H4zM4 10h16v10H4z" fill="none" stroke="currentColor" strokeWidth="1.5" />,
    };
  })();

  const passageTitle = session?.passage.title ?? '';
  const readingMinutes = session ? estimateReadingMinutes(session.passage.text) : 0;
  const headerMeta = session
    ? `${LANGUAGE_LABELS[session.language]} · 难度 ${session.difficulty} · 约 ${readingMinutes} 分钟`
    : '';

  const sidebarHidden = !isMobile && sidebarCollapsed;

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

      <aside
        className={`${styles.sidebar} ${isMobile && sidebarOpen ? styles.sidebarOpen : ''}`}
        style={sidebarHidden ? { display: 'none' } : undefined}
      >
        <div className={styles.sidebarContent}>
          <button className={styles.backBtn} onClick={handleGoHome} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>返回首页</span>
          </button>

          <div className={styles.brand}>
            <h1 className={styles.brandName}>Wordaydream</h1>
            <p className={styles.brandTagline}>在语境中学习词汇</p>
          </div>

          <div className={styles.controlSection}>
            <label className={styles.sectionLabel}>语言</label>
            <div className={styles.languagePills}>
              <button
                className={`${styles.langPill} ${language === 'en' ? styles.active : ''}`}
                onClick={() => handleLanguageChange('en')}
              >
                英语
              </button>
              <button
                className={`${styles.langPill} ${language === 'de' ? styles.active : ''}`}
                onClick={() => handleLanguageChange('de')}
              >
                德语
              </button>
            </div>
          </div>

          <div className={styles.controlSection}>
            <label className={styles.sectionLabel}>难度</label>
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
                    <span className={styles.diffLabel}>{i + 1}</span>
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
            <div className={styles.progressCard}>
              <div className={styles.progressHeader}>
                <span className={styles.progressLabel}>学习进度</span>
                <span className={styles.progressCount}>
                  {resolvedCount} / {totalCount}
                </span>
              </div>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{
                    transform: `scaleX(${totalCount > 0 ? resolvedCount / totalCount : 0})`,
                  }}
                />
              </div>
            </div>
          )}

          <div className={styles.sidebarFooter}>
            <ReadingHistoryPanel onReRead={handleReRead} />
            <AnalyticsPanel />
          </div>
        </div>
      </aside>

      <section className={styles.mainPanel}>
        <header className={styles.headerBar}>
          <div className={styles.headerInfo}>
            <h2 className={styles.headerTitle}>{passageTitle || '阅读练习'}</h2>
            <p className={styles.headerMeta}>{headerMeta}</p>
          </div>
          <button
            className={styles.playBtn}
            aria-label={isPlaying ? '停止朗读' : '朗读'}
            onClick={handleTogglePlay}
            type="button"
            disabled={!ttsSupported}
          >
            {isPlaying ? (
              <span className={styles.playStop} />
            ) : (
              <span className={styles.playTriangle} />
            )}
          </button>
          {ttsSupported && (
            <div
              className={styles.rateSelector}
              role="radiogroup"
              aria-label="朗读语速"
              data-testid="tts-rate-selector"
            >
              {RATE_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={currentRate === r}
                  className={`${styles.ratePill} ${currentRate === r ? styles.ratePillActive : ''}`}
                  onClick={() => handleRateChange(r)}
                  data-testid={`tts-rate-${r}`}
                >
                  {r === 1.0 ? '1×' : `${r}×`}
                </button>
              ))}
            </div>
          )}
          <button
            className={styles.iconBtn}
            aria-label={sidebarHidden ? '展开侧栏' : '收起侧栏'}
            onClick={() => setSidebarCollapsed((c) => !c)}
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {sidebarHidden ? (
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        </header>

        <div className={styles.readingArea}>
          <div className={styles.readingContainer}>
            {isLoading ? (
              <div className={styles.loading}>
                {streamingPreviewText ? (
                  <>
                    <p className={styles.streamingHint}>AI 正在生成文本...</p>
                    <div className={styles.streamingPreview}>
                      {streamingPreviewText}
                      <span className={styles.streamingCursor} aria-hidden="true" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.loadingSpinner} />
                    <p>正在生成文本...</p>
                  </>
                )}
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
                <InteractivePassage isReplay={session?.isReplay ?? false} hideTitle />
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
        </div>

        <footer className={styles.actionBar}>
          <span className={styles.actionBarText}>
            今日 <span className={styles.actionBarCount}>{dailyGoal.newWordsDone}/{dailyGoal.newWordsTarget}</span> 词
          </span>
          <button
            className={styles.iconBtn}
            aria-label="设置"
            onClick={openSettings}
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </footer>
      </section>

      {wordLearned && (
        <WordLearnedOverlay
          word={wordLearned}
          visible={true}
          onDismiss={() => setWordLearned(null)}
        />
      )}

      {readingCompleteVisible && (
        <ReadingCompleteOverlay
          visible={readingCompleteVisible}
          stats={readingStats}
          onDismiss={() => setReadingCompleteVisible(false)}
        />
      )}
    </div>
  );
}
