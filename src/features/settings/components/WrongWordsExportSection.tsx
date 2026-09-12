/**
 * WrongWordsExportSection (v1.1.0 Stage 2: 错词导出)
 *
 * 设置面板独立区块 (沿 ShortcutsSection / CsvWordlistManagementSection 先例),
 * 提供"导出 CSV"/"导出 JSON"两个按钮, 把 useWrongWordsStore 的错词本落为文件下载.
 *
 * 设计:
 * - CSV: RFC 4180 转义 (字段含 逗号/双引号/换行 → 整体双引号包裹 + 内部 " 翻倍),
 *   时间字段 ISO 8601, language 空值输出空串, 行序 = sortEntriesBy recent.
 * - JSON: { schema: 'wordaydream-wrong-words', version: 1, exportedAt: ISO, entries },
 *   JSON.stringify 缩进 2.
 * - 文件名: wordaydream-wrong-words-YYYYMMDD.{csv|json} (本地日期).
 * - 下载手法沿 CsvWordlistManagementSection: Blob + URL.createObjectURL +
 *   a[download] + click + revokeObjectURL.
 * - 空错词本 (N=0): 两按钮 disabled.
 */
import { useWrongWordsStore, sortEntriesBy, type WrongWordEntry } from '../../review/store/useWrongWordsStore';
import styles from './WrongWordsExportSection.module.css';

const CSV_HEADER = 'cardId,lexemeGroupId,lemma,language,wrongCount,firstWrongAt,lastWrongAt';

/** RFC 4180 转义: 含 逗号/双引号/换行 → 双引号包裹 + 内部 " 翻倍 */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 本地日期戳 YYYYMMDD */
function toLocalDateStamp(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** 行序 = recent (lastWrongAt 倒序), 与列表展示一致 */
function buildCsv(entries: WrongWordEntry[]): string {
  const lines: string[] = [CSV_HEADER];
  for (const e of sortEntriesBy({ entries }, 'recent')) {
    lines.push(
      [
        escapeCsvField(e.cardId),
        escapeCsvField(e.lexemeGroupId),
        escapeCsvField(e.lemma),
        escapeCsvField(e.language ?? ''),
        String(e.wrongCount),
        new Date(e.firstWrongAt).toISOString(),
        new Date(e.lastWrongAt).toISOString(),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** 沿 CsvWordlistManagementSection 的下载手法 */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function WrongWordsExportSection() {
  const count = useWrongWordsStore((s) => s.entries.length);
  const disabled = count === 0;

  const handleExportCsv = () => {
    const { entries } = useWrongWordsStore.getState();
    const blob = new Blob([buildCsv(entries)], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `wordaydream-wrong-words-${toLocalDateStamp()}.csv`);
  };

  const handleExportJson = () => {
    const { entries } = useWrongWordsStore.getState();
    const payload = {
      schema: 'wordaydream-wrong-words',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    downloadBlob(blob, `wordaydream-wrong-words-${toLocalDateStamp()}.json`);
  };

  return (
    <div className={styles.section} data-testid="wrong-words-export-section">
      <div className={styles.title}>错词导出</div>
      <p className={styles.desc}>
        导出错词本 ({count} 条)，含答错次数与时间，便于备份或在外部分析。
      </p>
      <div className={styles.btnRow}>
        <button
          type="button"
          className={styles.btn}
          onClick={handleExportCsv}
          disabled={disabled}
        >
          导出 CSV
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={handleExportJson}
          disabled={disabled}
        >
          导出 JSON
        </button>
      </div>
    </div>
  );
}
