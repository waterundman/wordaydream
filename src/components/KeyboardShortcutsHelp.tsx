import { useEffect, useState } from 'react';
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
  const tokens = keys.split(/(\s[+\/]\s)/);
  return (
    <span className={styles.kbdGroup}>
      {tokens.map((t, i) => {
        if (t.match(/^\s[+\/]\s$/)) {
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
      role="dialog"
      aria-modal="true"
      aria-label="键盘快捷键帮助"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          className={styles.closeBtn}
          onClick={() => setVisible(false)}
          aria-label="关闭帮助面板"
        >
          ×
        </button>
        <h2 className={styles.title}>键盘快捷键</h2>
        <div className={styles.categories}>
          {SHORTCUT_CATEGORIES.map((category) => (
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
