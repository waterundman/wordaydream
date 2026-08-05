/// <reference lib="webworker" />
/**
 * v0.4.0-harmony Stage 4 (D4): CSV 解析 Web Worker
 *
 * 将 papaparse 的 CPU 密集解析移至 Worker 线程, 避免阻塞主线程动画 / 交互.
 *
 * 通信协议:
 * - 主线程 -> Worker: { id, csvText, fileName? }
 * - Worker -> 主线程: { id, ok, result?, error? }
 *   - ok=true:  result = CsvImportResult (与主线程 parseCsvWordlist 返回值一致)
 *   - ok=false: error  = string (错误描述)
 *
 * Vite 原生支持 `new Worker(new URL('./csvParser.worker.ts', import.meta.url), { type: 'module' })`,
 * Worker 内部 dynamic import papaparse 不会进入主线程 bundle (与 Stage 3 TMA 配合).
 *
 * 注意: Worker 文件不直接复用 csvLoader.ts 的 parseCsvWordlist 逻辑,
 * 因为 csvLoader.ts 顶层 `await import('papaparse')` 在 Worker context 也能工作,
 * 但为了避免 Worker 与主线程共享 module graph (导致 papaparse 仍被打到主线程),
 * 这里独立实现解析逻辑 (复用相同字段映射 + 校验规则).
 */

import type { CsvImportResult, CsvWordlistEntry } from '../data/wordlists/csvLoader';

// Worker 内部类型断言: self 在 worker context 是 DedicatedWorkerGlobalScope,
// 但 tsconfig.app.json 的 lib 仅含 DOM, 这里用 minimal 断言避免 lib 冲突.
interface WorkerSelf {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage: (msg: unknown) => void;
}
const workerSelf = self as unknown as WorkerSelf;

const VALID_CEFR = ['A1', 'A2', 'B1', 'B2'] as const;
const VALID_PRIORITIES = [1, 2, 3] as const;

interface CsvParseRequest {
  id: number;
  csvText: string;
  fileName?: string;
}

interface CsvParseResponse {
  id: number;
  ok: boolean;
  result?: CsvImportResult;
  error?: string;
}

/**
 * 校验单个 entry (与 csvLoader.validateEntry 等价)
 */
function validateEntry(
  entry: Partial<CsvWordlistEntry>,
  row: number,
): string[] | null {
  const errors: string[] = [];

  const lemma = entry.lemma?.trim() ?? '';
  if (!lemma) {
    errors.push(`行 ${row}: lemma 不能为空`);
  } else if (lemma.length > 100) {
    errors.push(`行 ${row}: lemma 超过 100 字符 (当前 ${lemma.length})`);
  }

  const pos = entry.pos?.trim() ?? '';
  if (!pos) {
    errors.push(`行 ${row}: pos 不能为空`);
  }

  const translation = entry.translation?.trim() ?? '';
  if (!translation) {
    errors.push(`行 ${row}: translation 不能为空`);
  }

  const cefr = entry.cefr;
  if (!cefr) {
    errors.push(`行 ${row}: cefr 不能为空`);
  } else if (!VALID_CEFR.includes(cefr as (typeof VALID_CEFR)[number])) {
    errors.push(`行 ${row}: cefr 非法值 "${cefr}", 必须为 A1/A2/B1/B2`);
  }

  if (entry.priority !== undefined && entry.priority !== null) {
    const p = entry.priority;
    if (!VALID_PRIORITIES.includes(p as (typeof VALID_PRIORITIES)[number])) {
      errors.push(`行 ${row}: priority 非法值 "${p}", 必须为 1/2/3`);
    }
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Worker 内部解析逻辑 (与 csvLoader.parseCsvWordlist 等价, 但用 Worker 内 dynamic import 的 Papa)
 */
async function parseCsvInWorker(
  csvText: string,
  fileName: string,
): Promise<CsvImportResult> {
  const Papa = (await import('papaparse')).default;

  const importedAt = Date.now();
  const errors: CsvImportResult['errors'] = [];
  const entries: CsvWordlistEntry[] = [];

  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const rows = result.data ?? [];

  rows.forEach((rawRow, index) => {
    const row = index + 1;

    const lemma = (rawRow.lemma ?? '').trim();
    const pos = (rawRow.pos ?? '').trim();
    const translation = (rawRow.translation ?? '').trim();
    const cefrRaw = (rawRow.cefr ?? '').trim();
    const priorityRaw = (rawRow.priority ?? '').trim();
    const topic = (rawRow.topic ?? '').trim();
    const semanticConflictsRaw = (rawRow.semanticConflicts ?? '').trim();

    const entry: CsvWordlistEntry = {
      lemma,
      pos,
      translation,
      cefr: cefrRaw as CsvWordlistEntry['cefr'],
    };

    if (priorityRaw) {
      const p = Number(priorityRaw);
      if (!Number.isNaN(p)) {
        entry.priority = p as 1 | 2 | 3;
      }
    } else {
      entry.priority = 2;
    }

    if (topic) {
      entry.topic = topic;
    }

    if (semanticConflictsRaw) {
      entry.semanticConflicts = semanticConflictsRaw
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

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
    fileName,
    importedAt,
  };
}

workerSelf.onmessage = async (ev: MessageEvent) => {
  const req = ev.data as CsvParseRequest;
  if (!req || typeof req.id !== 'number' || typeof req.csvText !== 'string') {
    // 无效请求, 忽略 (避免 worker 卡死)
    return;
  }

  const response: CsvParseResponse = {
    id: req.id,
    ok: false,
  };

  try {
    response.result = await parseCsvInWorker(req.csvText, req.fileName ?? 'unknown.csv');
    response.ok = true;
  } catch (e) {
    response.error = e instanceof Error ? e.message : String(e);
  }

  workerSelf.postMessage(response);
};
