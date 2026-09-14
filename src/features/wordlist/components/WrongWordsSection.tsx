/**
 * WrongWordsSection (v1.1.0 Stage 2: 错词本控件)
 *
 * 跨会话错词本区块, 渲染在 WordlistPage 顶部"我的词库"之后.
 * 数据来自 useWrongWordsStore (localStorage 持久化, 刷新不丢).
 *
 * 设计:
 * - v1.1.0 复习控件 (标题行, 仅 N>0 渲染): 排序 select (recent/oldest/mostWrong,
 *   默认 recent) + 数量 select (全部/10/20, 默认全部) + "复习错词 (N)" 按钮.
 *   文案联动: 全部 → v1.0.0 文案 "复习错词 (N)"; 有限 → "复习错词 (limit · 排序名)".
 *   onClick → startWrongWordsReview({ sort, limit }) (全部时 limit 不传).
 * - v1.1.0 列表筛选 (列表上方一行, 仅 N>0 渲染): 语言 select (全部 + entries 中
 *   实际存在的 language 值, undefined 条目只在"全部"可见) + 时间 select
 *   (全部/近 7 天/近 30 天/更早). 列表数据 = filterEntriesBy 后再 sortEntriesBy('recent')
 *   (列表保持最近错倒序, 与 v0.9.0 一致). 筛选后空列表显示空态文案.
 * - 契约: 筛选只影响列表显示; 复习按钮 N 恒为全量有效条目数 (不随筛选变化).
 * - v1.4.0 S3a: 列表行内新增单条删除按钮 (removeEntry), 移除后列表/总数 reactive 更新.
 * - lemma 缺失 (词条已删除) → "词条已删除"降级.
 * - 相对时间零依赖 (formatRelativeTime).
 */
import { useMemo, useState } from 'react';
import {
  useWrongWordsStore,
  sortEntriesBy,
  filterEntriesBy,
  formatRelativeTime,
  type WrongWordsSortMode,
  type WrongWordsLanguageFilter,
  type WrongWordsTimeFilter,
} from '../../review/store/useWrongWordsStore';
import { useReviewSessionStore } from '../../review/store/useReviewSessionStore';
import styles from './WrongWordsSection.module.css';

const SORT_LABELS: Record<WrongWordsSortMode, string> = {
  recent: '最近错',
  oldest: '最早错',
  mostWrong: '最常错',
};

type ReviewLimit = 'all' | 10 | 20;

export function WrongWordsSection() {
  const entries = useWrongWordsStore((s) => s.entries);
  const removeEntry = useWrongWordsStore((s) => s.removeEntry);
  const startWrongWordsReview = useReviewSessionStore(
    (s) => s.startWrongWordsReview
  );

  const [sortMode, setSortMode] = useState<WrongWordsSortMode>('recent');
  const [limit, setLimit] = useState<ReviewLimit>('all');
  const [langFilter, setLangFilter] = useState<WrongWordsLanguageFilter>('all');
  const [timeFilter, setTimeFilter] = useState<WrongWordsTimeFilter>('all');

  // 契约: 复习按钮 N 恒为全量有效条目数, 不随列表筛选变化.
  const total = entries.length;

  // 语言筛选选项动态: 仅 entries 中实际存在的 language 值 + "全部"
  // (undefined 条目只在"全部"可见, 口径与 filterEntriesBy 一致).
  const availableLanguages = useMemo(() => {
    const seen: WrongWordsLanguageFilter[] = [];
    for (const e of entries) {
      if (e.language && !seen.includes(e.language)) {
        seen.push(e.language);
      }
    }
    return seen;
  }, [entries]);

  // 列表数据 = filterEntriesBy(当前 entries, {language, timeRange}) 后再 sortEntriesBy('recent').
  const visibleEntries = useMemo(() => {
    const filtered = filterEntriesBy({ entries }, { language: langFilter, timeRange: timeFilter });
    return sortEntriesBy({ entries: filtered }, 'recent');
  }, [entries, langFilter, timeFilter]);

  // 复习按钮文案联动: recent+全部保持 v1.0.0 文案; 有限 → "(limit · 排序名)".
  const reviewLabel =
    limit === 'all'
      ? `复习错词 (${total})`
      : `复习错词 (${limit} · ${SORT_LABELS[sortMode]})`;

  const handleReview = () => {
    startWrongWordsReview({
      sort: sortMode,
      limit: limit === 'all' ? undefined : limit,
    });
  };

  return (
    <section data-testid="wrong-words-section" className={styles.section} aria-label="错词本">
      <h2 className={styles.title}>
        <span className={styles.titleText}>
          错词本 <span data-testid="wrong-words-count" className={styles.count}>{total}</span>
        </span>
        {total > 0 && (
          <span className={styles.reviewControls}>
            <select
              className={styles.select}
              aria-label="错词排序"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as WrongWordsSortMode)}
            >
              <option value="recent">最近错</option>
              <option value="oldest">最早错</option>
              <option value="mostWrong">最常错</option>
            </select>
            <select
              className={styles.select}
              aria-label="复习数量"
              value={String(limit)}
              onChange={(e) =>
                setLimit(e.target.value === 'all' ? 'all' : (Number(e.target.value) as 10 | 20))
              }
            >
              <option value="all">全部</option>
              <option value="10">10</option>
              <option value="20">20</option>
            </select>
            <button type="button" className={styles.reviewBtn} onClick={handleReview}>
              {reviewLabel}
            </button>
          </span>
        )}
      </h2>

      {total === 0 ? (
        <div className={styles.empty}>
          暂无错词记录，复习中答错的词会自动收录
        </div>
      ) : (
        <>
          <div className={styles.filterRow}>
            <select
              className={styles.select}
              aria-label="错词语言筛选"
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value as WrongWordsLanguageFilter)}
            >
              <option value="all">全部</option>
              {availableLanguages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              aria-label="错词时间筛选"
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value as WrongWordsTimeFilter)}
            >
              <option value="all">全部</option>
              <option value="7d">近 7 天</option>
              <option value="30d">近 30 天</option>
              <option value="older">更早</option>
            </select>
          </div>

          {visibleEntries.length === 0 ? (
            <div className={styles.empty}>当前筛选条件下暂无错词</div>
          ) : (
            <ul className={styles.list}>
              {visibleEntries.map((e) => {
                const isDeleted = !e.lemma || e.lemma.length === 0;
                return (
                <li key={e.cardId} data-testid="wrong-word-item" className={styles.item}>
                  <span className={isDeleted ? styles.lemmaDeleted : styles.lemma}>
                    {isDeleted ? '词条已删除' : e.lemma}
                  </span>
                  {e.language && (
                    <span className={styles.lang} data-testid="wrong-word-lang">
                      {e.language}
                    </span>
                  )}
                  <span className={styles.meta}>错 {e.wrongCount} 次</span>
                  <span className={styles.time}>{formatRelativeTime(e.lastWrongAt)}</span>
                  {/* v1.4.0 S3a: 单条删除 (v1.1.0 预留项); 流内 flex 布局, 不做 absolute
                      (v1.3.0 closeBtn 遮挡发音按钮教训) */}
                  <button
                    type="button"
                    className={styles.removeBtn}
                    data-testid="wrong-word-remove"
                    aria-label={`删除错词 ${isDeleted ? e.cardId : e.lemma}`}
                    onClick={() => removeEntry(e.cardId)}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <line x1="5" y1="5" x2="19" y2="19" />
                      <line x1="19" y1="5" x2="5" y2="19" />
                    </svg>
                  </button>
                </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
