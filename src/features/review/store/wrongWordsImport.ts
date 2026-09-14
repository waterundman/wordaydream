/**
 * wrongWordsImport (v1.4.0 S1: 错词本导入 — 解析/校验/合并纯函数)
 *
 * 与 v1.1.0 WrongWordsExportSection 的导出格式 roundtrip 兼容:
 * - CSV: header `cardId,lexemeGroupId,lemma,language,wrongCount,firstWrongAt,lastWrongAt`,
 *   时间 ISO 8601 字符串, language 空值输出空串, RFC 4180 转义 (papaparse 还原).
 * - JSON: { schema: 'wordaydream-wrong-words', version: 1, exportedAt, entries },
 *   entries 时间为 number 时间戳.
 *
 * 设计 (SPEC v1.4.0 §4.2):
 * - 解析走 papaparse (header: true, skipEmptyLines: true), 沿 csvLoader 先例;
 *   错词导入量小 (MAX_WRONG_WORDS=500), 主线程解析即可, 不走 worker.
 * - 逐行校验返回 rejected 数组, 不抛异常 (沿 csvLoader.validateEntry 先例);
 *   错误消息格式 "行 N: ..." (1-based, header 不计).
 * - 表头缺必需列 / 非本产品 JSON → 整文件 rejected (row 0).
 * - 合并策略: cardId 冲突 → skip 保留现有 (幂等, 重复导入同一备份 imported=0);
 *   容量超出 → 按 lastWrongAt 降序保留最新 cap 条, 一次淘汰到位 (与 recordWrong FIFO 同口径).
 * - 时间归一化共享: CSV 传 ISO 字符串 (Date.parse), JSON 传 number, parseTime 双接受.
 */
import { MAX_WRONG_WORDS, type WrongWordEntry } from './useWrongWordsStore';
import type { Language } from '../../../types';

/** 单条解析结果: valid (可入账) + rejected (拒绝明细, row 为 1-based 数据行号; 整文件级错误 row=0) */
export interface WrongWordsParseResult {
  valid: WrongWordEntry[];
  rejected: Array<{ row: number; message: string }>;
  fileName: string;
}

/** 导入汇总: imported=实际入库数 (容量淘汰后仍存活的新增), skipped=cardId 冲突跳过数, evicted=容量淘汰总数 (含既有条目) */
export interface ImportSummary {
  imported: number;
  skipped: number;
  evicted: number;
}

/** CSV 必需列 (与 v1.1.0 导出 header 一致; language 可选) */
const REQUIRED_CSV_COLUMNS = [
  'cardId',
  'lexemeGroupId',
  'lemma',
  'wrongCount',
  'firstWrongAt',
  'lastWrongAt',
] as const;

const VALID_LANGUAGES: ReadonlyArray<Language> = ['en', 'de'];

/** 字符串字段归一化: trim; null/undefined → '' */
function toStr(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * 时间字段归一化: 接受 number 时间戳 (JSON 路径) 或 ISO 8601 字符串 (CSV 路径).
 * 不可解析 / 非有限数 / 非正数 → null (该行 rejected).
 */
function parseTime(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const t = Date.parse(v.trim());
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** wrongCount 归一化: 严格正整数 (CSV 中为字符串 "3", JSON 中为 number) */
function toPositiveInt(v: unknown): number | null {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v.trim())
        : NaN;
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * 单行校验 + 构造 WrongWordEntry (CSV / JSON 两条路径共享).
 * 返回 { entry } 或 { errors } (错误消息带 "行 N: " 前缀).
 */
function normalizeRow(
  raw: Record<string, unknown>,
  row: number,
): { entry: WrongWordEntry } | { errors: string[] } {
  const errors: string[] = [];

  const cardId = toStr(raw.cardId);
  const lexemeGroupId = toStr(raw.lexemeGroupId);
  const lemma = toStr(raw.lemma);
  if (!cardId) errors.push(`行 ${row}: cardId 不能为空`);
  if (!lexemeGroupId) errors.push(`行 ${row}: lexemeGroupId 不能为空`);
  if (!lemma) errors.push(`行 ${row}: lemma 不能为空`);

  const wrongCount = toPositiveInt(raw.wrongCount);
  if (wrongCount === null) {
    errors.push(`行 ${row}: wrongCount 必须为正整数`);
  }

  const firstWrongAt = parseTime(raw.firstWrongAt);
  if (firstWrongAt === null) {
    errors.push(`行 ${row}: firstWrongAt 必须为可解析时间 (ISO 8601 或时间戳)`);
  }

  const lastWrongAt = parseTime(raw.lastWrongAt);
  if (lastWrongAt === null) {
    errors.push(`行 ${row}: lastWrongAt 必须为可解析时间 (ISO 8601 或时间戳)`);
  }

  // language: 空串/缺失 → undefined (旧数据口径, 与 filterEntriesBy 一致); 非空须 ∈ {en, de}
  let language: Language | undefined;
  const langRaw = toStr(raw.language);
  if (langRaw !== '') {
    if ((VALID_LANGUAGES as ReadonlyArray<string>).includes(langRaw)) {
      language = langRaw as Language;
    } else {
      errors.push(`行 ${row}: language 非法值 "${langRaw}", 必须为 en/de 或留空`);
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  // errors 为空保证以下字段非 null (TS 层面用非空断言收窄)
  return {
    entry: {
      cardId,
      lexemeGroupId,
      lemma,
      language,
      wrongCount: wrongCount as number,
      firstWrongAt: firstWrongAt as number,
      lastWrongAt: lastWrongAt as number,
    },
  };
}

function wholeFileReject(
  fileName: string,
  message: string,
): WrongWordsParseResult {
  return { valid: [], rejected: [{ row: 0, message }], fileName };
}

/**
 * 解析错词 CSV 文本 (v1.1.0 导出格式; header 模式 papaparse).
 * 表头缺必需列 (含空文件) → 整文件 rejected.
 */
export async function parseWrongWordsCsv(
  csvText: string,
  fileName = 'unknown.csv',
): Promise<WrongWordsParseResult> {
  const Papa = (await import('papaparse')).default;
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const fields: string[] = result.meta?.fields ?? [];
  const missing = REQUIRED_CSV_COLUMNS.filter((c) => !fields.includes(c));
  if (missing.length > 0) {
    return wholeFileReject(
      fileName,
      `表头缺少必需列: ${missing.join(', ')}`,
    );
  }

  const valid: WrongWordEntry[] = [];
  const rejected: WrongWordsParseResult['rejected'] = [];
  const rows = result.data ?? [];

  rows.forEach((rawRow, index) => {
    const row = index + 1; // 1-based, header 不计
    const outcome = normalizeRow(rawRow, row);
    if ('entry' in outcome) {
      valid.push(outcome.entry);
    } else {
      for (const message of outcome.errors) {
        rejected.push({ row, message });
      }
    }
  });

  return { valid, rejected, fileName };
}

/** 导出 JSON 顶层校验常量 (与 v1.1.0 导出 payload 一致) */
const EXPECTED_SCHEMA = 'wordaydream-wrong-words';
const EXPECTED_VERSION = 1;

/**
 * 解析错词 JSON 文本 (v1.1.0 导出格式).
 * 非法 JSON / schema 或 version 不符 / entries 缺失 → 整文件 rejected.
 */
export function parseWrongWordsJson(
  jsonText: string,
  fileName = 'unknown.json',
): WrongWordsParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return wholeFileReject(fileName, '文件不是合法 JSON');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return wholeFileReject(fileName, 'JSON 顶层必须为对象');
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.schema !== EXPECTED_SCHEMA) {
    return wholeFileReject(
      fileName,
      `schema 不符: 期望 "${EXPECTED_SCHEMA}", 实际 "${toStr(obj.schema)}"`,
    );
  }
  if (obj.version !== EXPECTED_VERSION) {
    return wholeFileReject(
      fileName,
      `version 不符: 期望 ${EXPECTED_VERSION}, 实际 "${toStr(obj.version)}"`,
    );
  }
  if (!Array.isArray(obj.entries)) {
    return wholeFileReject(fileName, 'entries 字段缺失或非数组');
  }

  const valid: WrongWordEntry[] = [];
  const rejected: WrongWordsParseResult['rejected'] = [];

  obj.entries.forEach((raw, index) => {
    const row = index + 1;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      rejected.push({ row, message: `行 ${row}: 条目必须为对象` });
      return;
    }
    const outcome = normalizeRow(raw as Record<string, unknown>, row);
    if ('entry' in outcome) {
      valid.push(outcome.entry);
    } else {
      for (const message of outcome.errors) {
        rejected.push({ row, message });
      }
    }
  });

  return { valid, rejected, fileName };
}

/**
 * 合并规划 (纯函数, 不触碰 store): cardId 冲突 skip 保留现有 + 容量一次淘汰到位.
 * - existing 已有 cardId → skip (幂等: 重复导入同一备份 imported=0)
 * - incoming 内部重复 cardId → 仅首条计入, 其余 skip
 * - 合并后 > cap → 按 lastWrongAt 降序保留最新 cap 条 (淘汰最旧, 与 recordWrong FIFO 同口径);
 *   imported 计实际存活的新增数, evicted 计淘汰总数 (含既有条目).
 * - cap 参数化供测试注入小容量.
 */
export function mergeEntries(
  existing: WrongWordEntry[],
  incoming: WrongWordEntry[],
  cap: number = MAX_WRONG_WORDS,
): { merged: WrongWordEntry[]; imported: number; skipped: number; evicted: number } {
  const existingIds = new Set(existing.map((e) => e.cardId));
  const seenIncoming = new Set<string>();
  const toAdd: WrongWordEntry[] = [];
  let skipped = 0;

  for (const e of incoming) {
    if (existingIds.has(e.cardId) || seenIncoming.has(e.cardId)) {
      skipped++;
      continue;
    }
    seenIncoming.add(e.cardId);
    toAdd.push(e);
  }

  const combined = existing.concat(toAdd);
  if (combined.length <= cap) {
    return { merged: combined, imported: toAdd.length, skipped, evicted: 0 };
  }

  // 稳定排序 (ES2019+): lastWrongAt 相同保持插入序
  const sorted = [...combined].sort((a, b) => b.lastWrongAt - a.lastWrongAt);
  const merged = sorted.slice(0, cap);
  const imported = merged.filter((e) => seenIncoming.has(e.cardId)).length;
  return { merged, imported, skipped, evicted: combined.length - cap };
}
