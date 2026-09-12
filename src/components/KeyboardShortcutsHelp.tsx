import { useEffect, useRef, useState, useMemo } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useShortcutsStore } from '../features/shortcuts/store/useShortcutsStore';
import styles from './KeyboardShortcutsHelp.module.css';

interface ShortcutItem {
  keys: string;
  description: string;
}

const SHORTCUT_CATEGORIES: { name: string; items: ShortcutItem[] }[] = [
  {
    name: '全局',
    items: [
      { keys: '?', description: '显示快捷键帮助' },
      { keys: 'ESC', description: '关闭面板/取消' },
      { keys: 'S', description: '打开设置' },
    ],
  },
  {
    name: '阅读页',
    items: [
      { keys: 'Space', description: '开始阅读/继续' },
      { keys: 'Tab', description: '下一个词汇' },
      { keys: 'Shift + Tab', description: '上一个词汇' },
      { keys: 'Enter', description: '激活词汇' },
      { keys: '← / →', description: '翻页/导航' },
      { keys: 'R', description: '重新生成文本' },
    ],
  },
  {
    name: '复习页',
    items: [
      { keys: '1', description: '重来 (Again)' },
      { keys: '2', description: '困难 (Hard)' },
      { keys: '3', description: '良好 (Good)' },
      { keys: '4', description: '简单 (Easy)' },
      { keys: 'Enter', description: '确认' },
    ],
  },
];

function KeyCombo({ keys }: { keys: string }) {
  const tokens = keys.split(/(\s[+/]\s)/);
  return (
    <span className={styles.kbdGroup}>
      {tokens.map((t, i) => {
        if (t.match(/^\s[+/]\s$/)) {
          return (
            <span key={i} className={styles.sep}>
              {t.trim()}
            </span>
          );
        }
        return (
          <kbd key={i} className={styles.kbd}>
            {t}
          </kbd>
        );
      })}
    </span>
  );
}

export function KeyboardShortcutsHelp() {
  const [visible, setVisible] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // 订阅评分键位 (改键后帮助面板实时反映当前键位); 仅 复习页 的 1/2/3/4 动态,
  // 其余分类保持 SHORTCUT_CATEGORIES 静态数组不变.
  const ratingKeys = useShortcutsStore((s) => s.ratingKeys);

  const categories = useMemo(() => {
    return SHORTCUT_CATEGORIES.map((category) => {
      if (category.name !== '复习页') return category;
      return {
        ...category,
        items: [
          { keys: ratingKeys.again, description: '重来 (Again)' },
          { keys: ratingKeys.hard, description: '困难 (Hard)' },
          { keys: ratingKeys.good, description: '良好 (Good)' },
          { keys: ratingKeys.easy, description: '简单 (Easy)' },
          { keys: 'Enter', description: '确认' },
        ],
      };
    });
  }, [ratingKeys]);

  // v2.2.4 Round 2 (D3-5): Tab 循环交给 useFocusTrap
  useFocusTrap(modalRef, visible);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setVisible((v) => !v);
      } else if (e.key === 'Escape') {
        setVisible(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!visible) return null;

  return (
    <div
      className={styles.overlay}
      onClick={() => setVisible(false)}
    >
      <div
        ref={modalRef}
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="键盘快捷键帮助"
      >
        <button
          className={styles.closeBtn}
          onClick={() => setVisible(false)}
          aria-label="关闭帮助面板"
        >
          ×
        </button>
        <h2 className={styles.title}>键盘快捷键</h2>
        <div className={styles.categories}>
          {categories.map((category) => (
            <div key={category.name} className={styles.category}>
              <h3 className={styles.categoryName}>{category.name}</h3>
              <div className={styles.shortcutList}>
                {category.items.map((item) => (
                  <div key={item.keys} className={styles.shortcutRow}>
                    <KeyCombo keys={item.keys} />
                    <span className={styles.description}>{item.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
