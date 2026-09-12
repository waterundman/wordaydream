import { useState, useEffect } from 'react';
import {
  useShortcutsStore,
  DEFAULT_RATING_KEYS,
} from '../../shortcuts/store/useShortcutsStore';
import type { Rating } from '../../../types';
import styles from './ShortcutsSection.module.css';

/**
 * v1.0.0 Stage 2: 设置面板 "快捷键" 区块 — 评分键位编辑.
 *
 * 四行 (Again/Hard/Good/Easy), 每行显示当前键位 (kbd) + 修改 + 恢复默认.
 *
 * 捕获态交互关键决策:
 * - 点击 "修改" 进入捕获态, 在该行通过 `window.addEventListener('keydown', handler, true)`
 *   (capture 阶段) 监听下一次按键.
 * - handler 内 `e.preventDefault(); e.stopImmediatePropagation();` — 必须 stopImmediatePropagation,
 *   否则同挂在 window bubble 阶段的 useGlobalShortcuts (复习评分) 与 KeyboardShortcutsHelp ('?')
 *   会响应这次捕获按键, 造成误评分 / 误弹帮助.
 * - Escape 特殊处理: 退出捕获态 (取消), 不报冲突错误 — Escape 是保留键, 用户按 ESC 即想取消.
 * - 捕获成功 → setRatingKey; ok=true 退出并清该行错误; ok=false → 行内显示 reason (保持旧值) 并退出.
 * - 监听随 `capturing` 状态经 useEffect 挂载/卸载; 切换行或组件卸载自动清理 (useEffect cleanup).
 */

const ROWS: { rating: Rating; en: string; zh: string }[] = [
  { rating: 'again', en: 'Again', zh: '重来' },
  { rating: 'hard', en: 'Hard', zh: '困难' },
  { rating: 'good', en: 'Good', zh: '良好' },
  { rating: 'easy', en: 'Easy', zh: '简单' },
];

export function ShortcutsSection() {
  const ratingKeys = useShortcutsStore((s) => s.ratingKeys);
  const setRatingKey = useShortcutsStore((s) => s.setRatingKey);
  const resetRatingKeys = useShortcutsStore((s) => s.resetRatingKeys);

  const [capturing, setCapturing] = useState<Rating | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Rating, string>>>({});

  // 捕获态: 仅当 capturing 非 null 时挂 capture 阶段监听.
  // 依赖 capturing → 切换行 (capturing 变化) 自动卸载旧监听、挂新监听;
  // 组件卸载 → cleanup 自动移除监听.
  useEffect(() => {
    if (!capturing) return;

    const handler = (e: KeyboardEvent) => {
      // 阻止冒泡到 window bubble 阶段的 useGlobalShortcuts / KeyboardShortcutsHelp
      e.preventDefault();
      e.stopImmediatePropagation();

      const rating = capturing;

      // Escape: 取消捕获, 不视为冲突, 无错误提示.
      if (e.key === 'Escape') {
        setCapturing(null);
        return;
      }

      const res = setRatingKey(rating, e.key);
      if (res.ok) {
        setErrors((prev) => {
          const next = { ...prev };
          delete next[rating];
          return next;
        });
      } else {
        setErrors((prev) => ({ ...prev, [rating]: res.reason ?? '无效按键' }));
      }
      setCapturing(null);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturing, setRatingKey]);

  const startCapture = (rating: Rating) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[rating];
      return next;
    });
    setCapturing(rating);
  };

  const resetOne = (rating: Rating) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[rating];
      return next;
    });
    // 单行恢复默认: 直接写回该评级的默认键 (单字符/非保留/不与自身冲突, 必 ok).
    setRatingKey(rating, DEFAULT_RATING_KEYS[rating]);
  };

  const resetAll = () => {
    resetRatingKeys();
    setErrors({});
    setCapturing(null);
  };

  return (
    <section className={styles.section} aria-label="快捷键设置">
      <h2 className={styles.title}>快捷键</h2>
      <p className={styles.desc}>
        设置复习评分的快捷键 (Again / Hard / Good / Easy)。点击「修改」后按下新按键即可，按
        Esc 取消。
      </p>

      <ul className={styles.list}>
        {ROWS.map(({ rating, en, zh }) => {
          const isCapturing = capturing === rating;
          const err = errors[rating];
          return (
            <li
              key={rating}
              className={styles.row}
              data-testid={`shortcut-row-${rating}`}
            >
              <div className={styles.labelCol}>
                <span className={styles.keyLabel}>{en}</span>
                <span className={styles.keyDesc}>{zh}</span>
              </div>

              {isCapturing ? (
                <div
                  className={styles.capturePrompt}
                  role="status"
                  aria-live="polite"
                  aria-label={`正在修改 ${en} 键，请按下新按键`}
                >
                  按下新按键…
                </div>
              ) : (
                <kbd
                  className={styles.kbd}
                  aria-label={`${en} 当前按键 ${ratingKeys[rating]}`}
                >
                  {ratingKeys[rating]}
                </kbd>
              )}

              {err && !isCapturing && (
                <span className={styles.error} role="alert">
                  {err}
                </span>
              )}

              <div className={styles.actions}>
                {!isCapturing && (
                  <button
                    type="button"
                    className={styles.modifyBtn}
                    onClick={() => startCapture(rating)}
                    aria-label={`修改 ${en} 键`}
                  >
                    修改
                  </button>
                )}
                {!isCapturing && (
                  <button
                    type="button"
                    className={styles.resetBtn}
                    onClick={() => resetOne(rating)}
                    aria-label={`恢复 ${en} 默认键`}
                  >
                    恢复默认
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className={styles.resetAllBtn}
        onClick={resetAll}
        aria-label="恢复全部快捷键默认"
      >
        全部重置
      </button>
    </section>
  );
}

export default ShortcutsSection;
