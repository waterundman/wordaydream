/**
 * v2.2.0 Stage 2 (D2): CSV 批量导入词库 - 解析 + 校验 + 模板生成
 *
 * 设计:
 * - 用 papaparse 解析 CSV, 处理引号转义 ("hello,world")
 * - semanticConflicts 用 `|` 分隔 (如 "apple|orange")
 * - parseCsvWordlist 返回 CsvImportResult (含 errors 数组, 不抛异常)
 * - validateEntry 返回 string[] (错误消息数组) 或 null (校验通过)
 * - generateCsvTemplate 返回合法 CSV 字符串 (含表头 + 2 示例行)
 *
 * 字段顺序: lemma,pos,translation,cefr,priority,topic,semanticConflicts
 */
import Papa from 'papaparse';

export interface CsvWordlistEntry {
  lemma: string;
  pos: string;
  translation: string;
  cefr: 'A1' | 'A2' | 'B1' | 'B2';
  priority?: 1 | 2 | 3;
  topic?: string;
  semanticConflicts?: string[];
}

export interface CsvImportResult {
  success: boolean;
  entries: CsvWordlistEntry[];
  errors: Array<{ row: number; field: string; message: string }>;
  fileName: string;
  importedAt: number;
}

const VALID_CEFR = ['A1', 'A2', 'B1', 'B2'] as const;
const VALID_PRIORITIES = [1, 2, 3] as const;

/**
 * 校验单个 entry
 * - lemma: 非空, ≤100 字符
 * - pos: 非空
 * - translation: 非空
 * - cefr: ∈ {A1, A2, B1, B2}
 * - priority: ∈ {1, 2, 3} (可选, 默认 2)
 * 返回 string[] (错误消息数组) 或 null (校验通过)
 */
export function validateEntry(
  entry: Partial<CsvWordlistEntry>,
  row: number,
): string[] | null {
  const errors: string[] = [];

  // lemma: 非空, ≤100 字符
  const lemma = entry.lemma?.trim() ?? '';
  if (!lemma) {
    errors.push(`行 ${row}: lemma 不能为空`);
  } else if (lemma.length > 100) {
    errors.push(`行 ${row}: lemma 超过 100 字符 (当前 ${lemma.length})`);
  }

  // pos: 非空
  const pos = entry.pos?.trim() ?? '';
  if (!pos) {
    errors.push(`行 ${row}: pos 不能为空`);
  }

  // translation: 非空
  const translation = entry.translation?.trim() ?? '';
  if (!translation) {
    errors.push(`行 ${row}: translation 不能为空`);
  }

  // cefr: ∈ {A1, A2, B1, B2}
  const cefr = entry.cefr;
  if (!cefr) {
    errors.push(`行 ${row}: cefr 不能为空`);
  } else if (!VALID_CEFR.includes(cefr as (typeof VALID_CEFR)[number])) {
    errors.push(`行 ${row}: cefr 非法值 "${cefr}", 必须为 A1/A2/B1/B2`);
  }

  // priority: ∈ {1, 2, 3} (可选, 默认 2)
  if (entry.priority !== undefined && entry.priority !== null) {
    const p = entry.priority;
    if (!VALID_PRIORITIES.includes(p as (typeof VALID_PRIORITIES)[number])) {
      errors.push(`行 ${row}: priority 非法值 "${p}", 必须为 1/2/3`);
    }
  }

  return errors.length > 0 ? errors : null;
}

/**
 * 解析 CSV 文本为 CsvWordlistEntry[]
 * 字段顺序: lemma,pos,translation,cefr,priority,topic,semanticConflicts
 * semanticConflicts 用 `|` 分隔 (如 "apple|orange")
 * priority 可选, 默认 2
 * topic 可选
 */
export function parseCsvWordlist(csvText: string, fileName?: string): CsvImportResult {
  const importedAt = Date.now();
  const errors: CsvImportResult['errors'] = [];
  const entries: CsvWordlistEntry[] = [];

  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const rows = result.data ?? [];

  rows.forEach((rawRow, index) => {
    // 1-based 数据行号 (header 不计入)
    const row = index + 1;

    const lemma = (rawRow.lemma ?? '').trim();
    const pos = (rawRow.pos ?? '').trim();
    const translation = (rawRow.translation ?? '').trim();
    const cefrRaw = (rawRow.cefr ?? '').trim();
    const priorityRaw = (rawRow.priority ?? '').trim();
    const topic = (rawRow.topic ?? '').trim();
    const semanticConflictsRaw = (rawRow.semanticConflicts ?? '').trim();

    // 构建 entry (priority/semanticConflicts 条件性赋值)
    const entry: CsvWordlistEntry = {
      lemma,
      pos,
      translation,
      cefr: cefrRaw as CsvWordlistEntry['cefr'],
    };

    // priority 可选, 默认 2; 有值时解析为数字
    if (priorityRaw) {
      const p = Number(priorityRaw);
      if (!Number.isNaN(p)) {
        entry.priority = p as 1 | 2 | 3;
      }
    } else {
      entry.priority = 2;
    }

    // topic 可选
    if (topic) {
      entry.topic = topic;
    }

    // semanticConflicts 用 `|` 分隔
    if (semanticConflictsRaw) {
      entry.semanticConflicts = semanticConflictsRaw
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    // 校验 (用未裁剪的原值, 让 validateEntry 处理空值判定)
    const entryToValidate: Partial<CsvWordlistEntry> = {
      lemma: rawRow.lemma ?? '',
      pos: rawRow.pos ?? '',
      translation: rawRow.translation ?? '',
      cefr: cefrRaw as CsvWordlistEntry['cefr'],
      priority: entry.priority,
    };

    const validationErrors = validateEntry(entryToValidate, row);
    if (validationErrors) {
      for (const msg of validationErrors) {
        // 从消息中提取 field (格式: "行 N: <field> ...")
        const fieldMatch = msg.match(/行 \d+: (\w+)/);
        const field = fieldMatch ? fieldMatch[1] : 'unknown';
        errors.push({ row, field, message: msg });
      }
    }

    entries.push(entry);
  });

  return {
    success: errors.length === 0,
    entries,
    errors,
    fileName: fileName ?? 'unknown.csv',
    importedAt,
  };
}

/**
 * 生成 CSV 模板供用户下载
 * 含表头 + 2 示例行
 */
export function generateCsvTemplate(): string {
  const header = 'lemma,pos,translation,cefr,priority,topic,semanticConflicts';
  const example1 = 'apple,noun,苹果,A1,1,food,pear|orange';
  const example2 = 'run,verb,跑,A2,2,action,walk|jog';
  return `${header}\n${example1}\n${example2}\n`;
}
