/**
 * WrongWordsSection (v0.9.0 Stage 1: 错词本)
 *
 * 跨会话错词本区块, 渲染在 WordlistPage 顶部"我的词库"之后.
 * 数据来自 useWrongWordsStore (localStorage 持久化, 刷新不丢).
 *
 * 设计:
 * - 只读展示, 无重练 / 删除单条入口 (clearAll 本轮不接 UI).
 * - 条目按 lastWrongAt 倒序 (getSortedEntries).
 * - lemma 缺失 (词条已删除: 手动编辑 store / 未来数据源变化) → "词条已删除"降级.
 * - 语言标记仅当 card.language 有值时显示 (en/de), undefined 不显示.
 * - 相对时间零依赖 (formatRelativeTime).
 */
import { useMemo } from 'react';
import {
  useWrongWordsStore,
  getSortedEntries,
  formatRelativeTime,
} from '../../review/store/useWrongWordsStore';
import { useReviewSessionStore } from '../../review/store/useReviewSessionStore';
import styles from './WrongWordsSection.module.css';

export function WrongWordsSection() {
  const entries = useWrongWordsStore((s) => s.entries);
  const sorted = useMemo(() => getSortedEntries({ entries }), [entries]);
  const startWrongWordsReview = useReviewSessionStore(
    (s) => s.startWrongWordsReview
  );

  return (
    <section data-testid="wrong-words-section" className={styles.section} aria-label="错词本">
      <h2 className={styles.title}>
        <span className={styles.titleText}>
          错词本 <span data-testid="wrong-words-count" className={styles.count}>{sorted.length}</span>
        </span>
        {sorted.length > 0 && (
          <button
            type="button"
            className={styles.reviewBtn}
            onClick={startWrongWordsReview}
          >
            复习错词 ({sorted.length})
          </button>
        )}
      </h2>

      {sorted.length === 0 ? (
        <div className={styles.empty}>
          暂无错词记录，复习中答错的词会自动收录
        </div>
      ) : (
        <ul className={styles.list}>
          {sorted.map((e) => {
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
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
