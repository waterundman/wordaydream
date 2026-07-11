import { useState } from 'react';
import { useMemoryStore } from '../store/useMemoryStore';
import { ExportService, type ExportFormat } from '../services/exportService';
import styles from './ExportButton.module.css';

export function ExportButton() {
  const [isOpen, setIsOpen] = useState(false);
  const cardCount = useMemoryStore((state) => state.cards.size);

  const handleExport = (format: ExportFormat) => {
    const cards = Array.from(useMemoryStore.getState().cards.values());
    if (cards.length === 0) return;
    ExportService.exportAndDownload(cards, { format });
    setIsOpen(false);
  };

  const formats: { format: ExportFormat; label: string; description: string }[] = [
    { format: 'csv', label: 'CSV', description: '表格格式' },
    { format: 'json', label: 'JSON', description: '数据格式' },
    { format: 'anki', label: 'Anki', description: '导入Anki' },
  ];

  return (
    <div className={styles.exportWrapper}>
      <button
        className={styles.exportButton}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="导出词汇"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span className={styles.exportLabel}>导出</span>
      </button>

      {isOpen && (
        <>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <div className={styles.menu}>
            <div className={styles.menuTitle}>选择导出格式</div>
            {formats.map((item) => (
              <button
                key={item.format}
                className={styles.menuItem}
                onClick={() => handleExport(item.format)}
              >
                <span className={styles.itemLabel}>{item.label}</span>
                <span className={styles.itemDesc}>{item.description}</span>
              </button>
            ))}
            <div className={styles.menuHint}>
              {cardCount} 个词汇待导出
            </div>
          </div>
        </>
      )}
    </div>
  );
}