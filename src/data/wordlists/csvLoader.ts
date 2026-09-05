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
 *
 * v0.4.0-harmony Stage 4 (D4): 新增 parseCsvWordlistAsync, 将 CPU 密集的
 * papaparse 解析移至 Web Worker (src/workers/csvParser.worker.ts).
 * - 旧 sync API parseCsvWordlist 作为兼容与 Worker 不可用时的 fallback 保留
 * - WordlistPage 使用 async API 走 Worker, 主线程不承担 CSV 解析
 * - Worker 不可用 (jsdom / 老浏览器) 时 fallback 到主线程动态 import papaparse
 */
// v0.4.0-harmony Stage 3 (D3): papaparse 改为动态 import (TMA), 不阻塞首屏.
// papaparse 仅在 CSV 导入时需要, 加载到 data-parsers chunk 中.
// v0.4.0-harmony Stage 4 (D4): top-level await 保留以兼容 sync API (parseCsvWordlist),
// Worker 路径独立 import 不与主线程共享 module graph (papaparse 仍属 data-parsers chunk).
const Papa = (await import('papaparse')).default;

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

// =====================================================================
// v0.4.0-harmony Stage 4 (D4): Worker-based async API
// =====================================================================

/**
 * CSV Worker 通信协议
 * - 请求: { id, csvText, fileName? }
 * - 响应: { id, ok, result?, error? }
 */
interface CsvWorkerRequest {
  id: number;
  csvText: string;
  fileName?: string;
}

interface CsvWorkerResponse {
  id: number;
  ok: boolean;
  result?: CsvImportResult;
  error?: string;
}

/**
 * Worker 单例 (惰性创建, 同一进程内复用)
 *
 * 注意: `new Worker(new URL('./csvParser.worker.ts', import.meta.url), { type: 'module' })`
 * 是 Vite 原生 Worker import 语法, 编译时 Vite 把 worker 文件单独打包.
 * ArkWeb Chromium M114 支持 module worker, 兼容.
 */
let _csvWorker: Worker | null = null;
let _csvWorkerUnsupported: boolean = false;
let _csvRequestCounter: number = 0;
const _csvPendingRequests = new Map<number, {
  resolve: (result: CsvImportResult) => void;
  reject: (error: Error) => void;
}>();

function disableCsvWorker(error: Error): void {
  const worker = _csvWorker;
  _csvWorker = null;
  _csvWorkerUnsupported = true;
  worker?.terminate();
  for (const [id, pending] of _csvPendingRequests) {
    _csvPendingRequests.delete(id);
    pending.reject(error);
  }
}

/**
 * 获取 (惰性创建) CSV Worker 单例
 *
 * - 首次调用时 new Worker(...)
 * - Worker 不可用 (typeof Worker === 'undefined') 返回 null
 * - Worker 创建失败也返回 null (降级到主线程)
 */
function getCsvWorker(): Worker | null {
  if (_csvWorkerUnsupported) return null;
  if (_csvWorker) return _csvWorker;
  if (typeof Worker === 'undefined') {
    _csvWorkerUnsupported = true;
    return null;
  }
  try {
    // Vite 原生 Worker import 语法: new URL('./xxx.worker.ts', import.meta.url)
    // 编译时 Vite 把 worker 文件识别为独立 entry, 单独打包.
    _csvWorker = new Worker(
      new URL('../../workers/csvParser.worker.ts', import.meta.url),
      { type: 'module' }
    );
    _csvWorker.onmessage = (ev: MessageEvent) => {
      const resp = ev.data as CsvWorkerResponse;
      if (!resp || typeof resp.id !== 'number') return;
      const pending = _csvPendingRequests.get(resp.id);
      if (!pending) return;
      _csvPendingRequests.delete(resp.id);
      if (resp.ok && resp.result) {
        pending.resolve(resp.result);
      } else {
        pending.reject(new Error(resp.error ?? 'CSV worker failed without error message'));
      }
    };
    _csvWorker.onerror = (err) => {
      // Worker 整体崩溃, reject 所有 pending 请求
      console.warn('[csvLoader] Worker error, falling back to main thread:', err);
      disableCsvWorker(new Error('CSV worker crashed'));
    };
    return _csvWorker;
  } catch (e) {
    console.warn('[csvLoader] Worker creation failed, falling back to main thread:', e);
    _csvWorkerUnsupported = true;
    return null;
  }
}

/**
 * v0.4.0-harmony Stage 4 (D4): 异步解析 CSV (Worker-based)
 *
 * - Worker 可用: 把 csvText postMessage 给 worker, 等待解析结果 (主线程 0 阻塞)
 * - Worker 不可用: fallback 到主线程, 调用 sync parseCsvWordlist (papaparse 主线程执行)
 *
 * 与 sync parseCsvWordlist 的区别:
 * - 返回 Promise<CsvImportResult>
 * - CPU 密集的 papaparse 解析在 worker 线程, 不阻塞主线程动画 / 交互
 * - Worker 内部 dynamic import papaparse, 不与主线程共享 module graph
 *
 * @param csvText CSV 文本
 * @param fileName 文件名 (可选, 默认 'unknown.csv')
 */
export async function parseCsvWordlistAsync(
  csvText: string,
  fileName?: string,
): Promise<CsvImportResult> {
  const worker = getCsvWorker();
  if (!worker) {
    // Fallback: 主线程执行 (与 sync API 等价, 但包裹 Promise 以保持接口一致)
    return parseCsvWordlist(csvText, fileName);
  }

  const id = ++_csvRequestCounter;
  const request: CsvWorkerRequest = {
    id,
    csvText,
    fileName: fileName ?? 'unknown.csv',
  };

  return new Promise<CsvImportResult>((resolve, reject) => {
    // 超时保护 (30s): 避免 Worker 卡死时主线程永远 pending
    const timeout = setTimeout(() => {
      disableCsvWorker(new Error('CSV worker timeout (30s)'));
    }, 30000);

    _csvPendingRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });

    try {
      worker.postMessage(request);
    } catch (e) {
      clearTimeout(timeout);
      _csvPendingRequests.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * @internal 测试用: 强制重置 Worker 单例 + unsupported 标志.
 * 让测试可以在 "Worker 可用 / 不可用" 两种模式间切换.
 */
export function _resetCsvWorkerForTesting(): void {
  if (_csvWorker) {
    _csvWorker.terminate();
    _csvWorker = null;
  }
  _csvWorkerUnsupported = false;
  _csvPendingRequests.clear();
  _csvRequestCounter = 0;
}
