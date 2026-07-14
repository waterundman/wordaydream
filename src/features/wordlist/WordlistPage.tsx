/**
 * WordlistPage (v1.6.0 Stage 2)
 *
 * 词表浏览页. 用户可查看当前等级的词表, 按状态筛选, 搜索,
 * 点击展开释义, 导出 JSON.
 *
 * 路由: 通过 AppMode='wordlist' (从首页"查看词表"按钮进入)
 *
 * 功能 (SPEC v1.6.0 第 8 节):
 * - 显示当前等级词表 (默认隐藏释义, 类似单词本)
 * - 按状态筛选: 全部 / 未学 / 学习中 / 已掌握
 * - 搜索框: 按 lemma 或 translation 搜索
 * - 点击单词: 展开释义 (translation 字段)
 * - 导出: 当前等级词表 JSON
 *
 * C1 (难度5): 显示"自由阅读模式, 无词表"占位.
 *
 * 设计决策 (glossAdapter):
 * - glossAdapter.getGloss 需要 TokenOccurrence (阅读流中的 token 对象),
 *   不适用于词表浏览场景. 展开时直接显示 WordlistEntry.translation 字段.
 */
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useSettingsStore } from '../settings/store/useSettingsStore';
import { useReadingSessionStore } from '../reading/store/useReadingSessionStore';
import { useWordlistStore, type WordStatus } from './store/useWordlistStore';
import { loadWordlist, getCachedWordlist, type WordlistEntry } from '../../data/wordlists';
import {
  parseCsvWordlist,
  generateCsvTemplate,
  type CsvImportResult,
} from '../../data/wordlists/csvLoader';
import {
  saveCsvWordlist,
  listCsvWordlists,
  deleteCsvWordlist,
  type StoredCsvWordlist,
} from '../../data/wordlists/csvStorage';
import type { Language, DifficultyLevel } from '../../types';
import { WordlistRow } from './components/WordlistRow';
import styles from './WordlistPage.module.css';

interface WordlistPageProps {
  onGoHome: () => void;
}

type FilterType = 'all' | 'unseen' | 'learning' | 'mastered';

const CEFR_LABELS: Record<number, string> = {
  1: 'A1',
  2: 'A2',
  3: 'B1',
  4: 'B2',
  5: 'C1',
};

export function WordlistPage({ onGoHome }: WordlistPageProps) {
  const difficulty = useSettingsStore((s) => s.difficulty);
  const setDifficulty = useSettingsStore((s) => s.setDifficulty);
  const lastConfig = useReadingSessionStore((s) => s.lastConfig);
  const setLastConfig = useReadingSessionStore((s) => s.setLastConfig);
  const language: Language = lastConfig?.language ?? 'en';
  const progress = useWordlistStore((s) => s.progress);

  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLemma, setExpandedLemma] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // v2.2.0 Stage 2 (D2): CSV 导入状态
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<CsvImportResult | null>(null);
  const [myWordlists, setMyWordlists] = useState<StoredCsvWordlist[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);

  const isFreeMode = difficulty === 5;

  // 加载词表
  useEffect(() => {
    if (isFreeMode) return;
    setIsLoading(true);
    loadWordlist(language, difficulty).finally(() => {
      setIsLoading(false);
    });
  }, [language, difficulty, isFreeMode]);

  const wordlist = getCachedWordlist(language, difficulty);
  const words: WordlistEntry[] = wordlist?.words ?? [];

  // 获取每个词的状态
  const getStatus = useCallback(
    (lemma: string): WordStatus => {
      const key = `${language}:${lemma.toLowerCase()}`;
      return progress[key]?.status ?? 'unseen';
    },
    [language, progress],
  );

  // 计算各状态计数
  const counts = useMemo(() => {
    let unseen = 0;
    let learning = 0;
    let mastered = 0;
    for (const entry of words) {
      const status = getStatus(entry.lemma);
      if (status === 'mastered') mastered++;
      else if (status === 'learning') learning++;
      else unseen++;
    }
    return { all: words.length, unseen, learning, mastered };
  }, [words, getStatus]);

  // 筛选 + 搜索
  const filteredWords = useMemo(() => {
    let result = words;
    if (filter !== 'all') {
      result = result.filter((entry) => getStatus(entry.lemma) === filter);
    }
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter(
        (entry) =>
          entry.lemma.toLowerCase().includes(query) ||
          (entry.translation ?? '').toLowerCase().includes(query),
      );
    }
    return result;
  }, [words, filter, searchQuery, getStatus]);

  const handleToggle = useCallback((lemma: string) => {
    setExpandedLemma((prev) => (prev === lemma ? null : lemma));
  }, []);

  const handleExport = useCallback(() => {
    if (!wordlist) return;
    const blob = new Blob([JSON.stringify(wordlist, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wordlist-${language}-${CEFR_LABELS[difficulty] ?? difficulty}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [wordlist, language, difficulty]);

  // v2.2.0 Stage 2 (D2): CSV 导入相关 handlers
  const refreshMyWordlists = useCallback(async () => {
    try {
      const lists = await listCsvWordlists();
      setMyWordlists(lists);
      setCsvError(null);
    } catch (e) {
      // IndexedDB 不可用, 降级到空列表
      setMyWordlists([]);
      setCsvError(`词库加载失败: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    refreshMyWordlists();
  }, [refreshMyWordlists]);

  const handleDownloadTemplate = useCallback(() => {
    const csv = generateCsvTemplate();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wordaydream-csv-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleCsvFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        const result = parseCsvWordlist(content, file.name);
        setImportPreview(result);
      };
      reader.onerror = () => {
        setCsvError('文件读取失败');
      };
      reader.readAsText(file);
      // 重置 input 以允许重复选择同一文件
      e.target.value = '';
    },
    [],
  );

  const handleConfirmImport = useCallback(async () => {
    if (!importPreview) return;
    try {
      await saveCsvWordlist(importPreview);
      setImportPreview(null);
      await refreshMyWordlists();
    } catch (e) {
      setCsvError(`导入失败: ${(e as Error).message}`);
    }
  }, [importPreview, refreshMyWordlists]);

  const handleCancelImport = useCallback(() => {
    setImportPreview(null);
  }, []);

  const handleDeleteWordlist = useCallback(
    async (id: string) => {
      try {
        await deleteCsvWordlist(id);
        await refreshMyWordlists();
      } catch (e) {
        setCsvError(`删除失败: ${(e as Error).message}`);
      }
    },
    [refreshMyWordlists],
  );

  const cefrLabel = CEFR_LABELS[difficulty] ?? `Level ${difficulty}`;

  // C1 自由阅读模式占位
  if (isFreeMode) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <button
            className={styles.backBtn}
            onClick={onGoHome}
            type="button"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            返回
          </button>
          <h1 className={styles.title}>C1 词表</h1>
        </header>
        <div className={styles.placeholder}>
          <svg
            className={styles.placeholderIcon}
            viewBox="0 0 24 24"
            width="48"
            height="48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <p className={styles.placeholderText}>自由阅读模式, 无词表</p>
        </div>
      </div>
    );
  }

  const filterTabs: { key: FilterType; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: counts.all },
    { key: 'unseen', label: '未学', count: counts.unseen },
    { key: 'learning', label: '学习中', count: counts.learning },
    { key: 'mastered', label: '已掌握', count: counts.mastered },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={onGoHome}
          type="button"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          返回
        </button>
        <h1 className={styles.title}>
          {cefrLabel} 词表 · {words.length} 词
        </h1>
        <button
          className={styles.exportBtn}
          onClick={handleExport}
          type="button"
          disabled={!wordlist}
          aria-label="导出词表 JSON"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          导出
        </button>
        {/* v2.2.0 Stage 2 (D2): CSV 导入 + 模板下载 */}
        <button
          className={styles.exportBtn}
          onClick={() => csvInputRef.current?.click()}
          type="button"
          aria-label="导入 CSV 词库"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          导入 CSV
        </button>
        <button
          className={styles.exportBtn}
          onClick={handleDownloadTemplate}
          type="button"
          aria-label="下载 CSV 模板"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="16" y2="17" />
          </svg>
          下载模板
        </button>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv"
          onChange={handleCsvFileSelect}
          className={styles.csvFileInput}
          aria-hidden="true"
        />
      </header>

      {/* v2.2.0 Stage 2 (D2): CSV 导入预览 */}
      {importPreview && (
        <div
          data-testid="csv-import-preview"
          className={styles.csvPreview}
        >
          <div className={styles.csvPreviewHeader}>
            <h2 className={styles.csvPreviewTitle}>
              导入预览 · {importPreview.fileName} · {importPreview.entries.length} 条
            </h2>
            <div className={styles.csvPreviewActions}>
              <button
                type="button"
                onClick={handleConfirmImport}
                className={styles.csvPreviewBtnConfirm}
              >
                确认导入
              </button>
              <button
                type="button"
                onClick={handleCancelImport}
                className={styles.csvPreviewBtnCancel}
              >
                取消
              </button>
            </div>
          </div>
          {importPreview.errors.length > 0 && (
            <div className={styles.csvPreviewError}>
              发现 {importPreview.errors.length} 个错误 (错误行已标红)
            </div>
          )}
          <div className={styles.csvPreviewRows}>
            {importPreview.entries.slice(0, 10).map((entry, idx) => {
              const rowErrors = importPreview.errors.filter((e) => e.row === idx + 1);
              const hasError = rowErrors.length > 0;
              return (
                <div
                  key={idx}
                  title={hasError ? rowErrors.map((e) => e.message).join('; ') : undefined}
                  className={`${styles.csvPreviewRow} ${hasError ? styles.csvPreviewRowError : ''}`}
                >
                  <span className={styles.csvPreviewRowIndex}>
                    {idx + 1}
                  </span>
                  <span className={styles.csvPreviewRowLemma}>{entry.lemma || '(空)'}</span>
                  <span className={styles.csvPreviewRowPos}>{entry.pos || '-'}</span>
                  <span className={styles.csvPreviewRowTranslation}>{entry.translation || '-'}</span>
                  <span className={styles.csvPreviewRowCefr}>{entry.cefr || '-'}</span>
                </div>
              );
            })}
          </div>
          {importPreview.entries.length > 10 && (
            <div className={styles.csvPreviewMore}>
              还有 {importPreview.entries.length - 10} 行未显示...
            </div>
          )}
        </div>
      )}

      {/* v2.2.0 Stage 2 (D2): CSV 错误提示 */}
      {csvError && (
        <div className={styles.csvError}>
          {csvError}
        </div>
      )}

      {/* v2.2.0 Stage 2 (D2): 我的词库 (已导入 CSV 列表) */}
      <div data-testid="my-csv-wordlists">
        <h2 className={styles.myWordlistsTitle}>
          我的词库
        </h2>
        {myWordlists.length === 0 ? (
          <div className={styles.myWordlistsEmpty}>
            暂无自定义词库, 点击"导入 CSV"上传
          </div>
        ) : (
          <div className={styles.myWordlistsList}>
            {myWordlists.map((wl) => (
              <div key={wl.id} className={styles.wordlistItem}>
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                  className={styles.wordlistItemIcon}
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className={styles.wordlistItemName}>
                  {wl.fileName}
                </span>
                <span className={styles.wordlistItemMeta}>
                  {wl.entryCount} 词
                </span>
                <span className={styles.wordlistItemMeta}>
                  {new Date(wl.importedAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteWordlist(wl.id)}
                  aria-label={`删除 ${wl.fileName}`}
                  className={styles.wordlistDeleteBtn}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.levelTabs} role="group" aria-label="语言与难度切换">
        <div className={styles.levelDots} role="group" aria-label="语言">
          <button
            type="button"
            className={`${styles.levelTab} ${language === 'en' ? styles.levelTabActive : ''}`}
            onClick={() => {
              if (language !== 'en') {
                setLastConfig({ language: 'en', difficulty });
              }
            }}
            aria-pressed={language === 'en'}
          >
            EN
          </button>
          <button
            type="button"
            className={`${styles.levelTab} ${language === 'de' ? styles.levelTabActive : ''}`}
            onClick={() => {
              if (language !== 'de') {
                setLastConfig({ language: 'de', difficulty });
              }
            }}
            aria-pressed={language === 'de'}
          >
            DE
          </button>
        </div>
        <div className={styles.levelDots} role="group" aria-label="难度">
          {[1, 2, 3, 4].map((lvl) => (
            <button
              key={lvl}
              type="button"
              className={`${styles.levelDot} ${difficulty === lvl ? styles.levelDotActive : ''}`}
              onClick={() => {
                if (difficulty !== lvl) {
                  setDifficulty(lvl as DifficultyLevel);
                }
              }}
              aria-pressed={difficulty === lvl}
              aria-label={CEFR_LABELS[lvl]}
            >
              {CEFR_LABELS[lvl]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filters}>
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            className={`${styles.filterTab} ${filter === tab.key ? styles.filterTabActive : ''}`}
            onClick={() => setFilter(tab.key)}
            type="button"
          >
            {tab.label} {tab.count}
          </button>
        ))}
      </div>

      <input
        className={styles.search}
        type="text"
        placeholder="搜索单词或释义..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        aria-label="搜索词表"
      />

      <div className={styles.list}>
        {isLoading && words.length === 0 ? (
          <div className={styles.empty}>加载中...</div>
        ) : filteredWords.length === 0 ? (
          <div className={styles.empty}>无匹配单词</div>
        ) : (
          filteredWords.map((entry) => (
            <WordlistRow
              key={entry.lemma}
              lemma={entry.lemma}
              pos={entry.pos}
              translation={entry.translation}
              status={getStatus(entry.lemma)}
              isExpanded={expandedLemma === entry.lemma}
              onToggle={() => handleToggle(entry.lemma)}
              language={language}
            />
          ))
        )}
      </div>
    </div>
  );
}
