/**
 * WrongWordsImportSection (v1.4.0 S2: 错词本导入)
 *
 * 设置面板独立区块, 紧跟 WrongWordsExportSection (导出对称位), 提供
 * .csv / .json 错词备份导入: 解析 (wrongWordsImport 纯函数) → store.importEntries
 * (cardId 冲突 skip 保留现有 + 容量 FIFO 淘汰) → 内联结果反馈.
 *
 * 设计:
 * - UI 沿同目录区块先例 (CsvWordlistManagementSection / 配置迁移): SettingsPanel.module.css
 *   的 .section / .sectionTitle / .migrationRow / .migrationBtn / .fileInput /
 *   .importResult(.success/.error) 类; hidden <input type="file"> + ref 触发.
 * - 扩展名路由: .csv → parseWrongWordsCsv; .json → parseWrongWordsJson;
 *   其他 → 拒绝并提示支持的格式 (accept 属性可被"所有文件"绕过).
 * - 结果行 (data-testid="wrong-words-import-result"):
 *   - 有 imported: success 行 "导入 N 条 · 跳过 M 条 · 容量淘汰 X 条"
 *   - 有 rejected: error 行列前 3 条 "行 N: msg" 明细 + 总数
 *   - 全部拒绝 / 不支持格式: error 行
 * - store 隔离: importEntries 来自 useWrongWordsStore.getState() (非 hook 订阅,
 *   导入是一次性命令式动作; 组件不依赖 entries 变化渲染).
 */
import { useRef, useState } from 'react';
import { useWrongWordsStore } from '../../review/store/useWrongWordsStore';
import {
  parseWrongWordsCsv,
  parseWrongWordsJson,
  type WrongWordsParseResult,
} from '../../review/store/wrongWordsImport';
import styles from './SettingsPanel.module.css';

interface ImportFeedback {
  kind: 'success' | 'error';
  message: string;
}

/** rejected 明细展示上限 (完整明细在解析返回值中, UI 只列前几条避免溢出) */
const MAX_SHOWN_REJECTIONS = 3;

function buildFeedback(
  result: WrongWordsParseResult,
  summary: { imported: number; skipped: number; evicted: number },
): ImportFeedback {
  const parts = [`导入 ${summary.imported} 条`];
  if (summary.skipped > 0) parts.push(`跳过 ${summary.skipped} 条`);
  if (summary.evicted > 0) parts.push(`容量淘汰 ${summary.evicted} 条`);

  if (result.rejected.length > 0) {
    const shown = result.rejected
      .slice(0, MAX_SHOWN_REJECTIONS)
      .map((r) => r.message)
      .join('; ');
    const suffix =
      result.rejected.length > MAX_SHOWN_REJECTIONS
        ? ` 等 ${result.rejected.length} 条被拒绝`
        : '';
    return {
      kind: summary.imported > 0 ? 'success' : 'error',
      message: `${parts.join(' · ')}; 拒绝 ${result.rejected.length} 条: ${shown}${suffix}`,
    };
  }

  return { kind: 'success', message: parts.join(' · ') };
}

export function WrongWordsImportSection() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);

  const handleFile = async (file: File) => {
    const name = file.name.toLowerCase();
    let result: WrongWordsParseResult;

    if (name.endsWith('.csv')) {
      result = await parseWrongWordsCsv(await file.text(), file.name);
    } else if (name.endsWith('.json')) {
      result = parseWrongWordsJson(await file.text(), file.name);
    } else {
      setFeedback({
        kind: 'error',
        message: `不支持的文件类型 "${file.name}", 仅支持 .csv / .json`,
      });
      return;
    }

    if (result.valid.length === 0 && result.rejected.length === 0) {
      setFeedback({ kind: 'error', message: '文件中没有可导入的错词条目' });
      return;
    }

    const summary = useWrongWordsStore.getState().importEntries(result.valid);
    setFeedback(buildFeedback(result, summary));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 重置 value, 允许重复选择同一文件再次触发 change
    e.target.value = '';
    if (file) {
      void handleFile(file);
    }
  };

  return (
    <div className={styles.section} data-testid="wrong-words-import-section">
      <div className={styles.sectionTitle}>错词导入</div>
      <div className={styles.migrationHint}>
        导入此前导出的错词备份 (CSV / JSON)。重复条目自动跳过, 超出容量上限时淘汰最旧条目。
      </div>
      <div className={styles.migrationRow}>
        <button
          type="button"
          className={styles.migrationBtn}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          导入错词
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json"
          onChange={handleInputChange}
          className={styles.fileInput}
          data-testid="wrong-words-import-input"
        />
      </div>
      {feedback && (
        <div
          data-testid="wrong-words-import-result"
          className={`${styles.importResult} ${feedback.kind === 'success' ? styles.success : styles.error}`}
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}
