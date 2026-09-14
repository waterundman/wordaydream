/**
 * wrongWordsCsvFormat (v1.4.0 S1: 从 WrongWordsExportSection 提取的 CSV 构造纯函数)
 *
 * 提取原因: 组件文件 export 非组件值触发 react(only-export-components)
 * (fast-refresh) lint warning — v1.4.0 S1 导入 roundtrip 测试需要复用生产
 * buildCsv 构造输入, 故把 CSV 构造与组件解耦到本纯函数模块.
 *
 * 格式契约 (v1.1.0 定版, v1.4.0 导入侧 wrongWordsImport.ts 与此 roundtrip 兼容):
 * - header: cardId,lexemeGroupId,lemma,language,wrongCount,firstWrongAt,lastWrongAt
 * - RFC 4180 转义: 字段含 逗号/双引号/换行 → 整体双引号包裹 + 内部 " 翻倍
 * - 时间字段 ISO 8601, language 空值输出空串, 行序 = sortEntriesBy recent
 */
import { sortEntriesBy, type WrongWordEntry } from '../review/store/useWrongWordsStore';

export const CSV_HEADER = 'cardId,lexemeGroupId,lemma,language,wrongCount,firstWrongAt,lastWrongAt';

/** RFC 4180 转义: 含 逗号/双引号/换行 → 双引号包裹 + 内部 " 翻倍 */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 行序 = recent (lastWrongAt 倒序), 与列表展示一致 */
export function buildCsv(entries: WrongWordEntry[]): string {
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
