/// <reference lib="webworker" />
/**
 * v0.4.0-harmony Stage 4 (D4): LLM JSON 修复 + zod 校验 Web Worker
 *
 * 将 jsonrepair + zod safeParse 的 CPU 密集校验移至 Worker 线程,
 * 避免阻塞 LLM 流式响应 / 用户答题 UI.
 *
 * 通信协议:
 * - 主线程 -> Worker: { id, raw, schemaName, expectedLanguage? }
 *   - schemaName: 'passage' | 'evaluation' | 'difficulty' | 'gloss' | 'generic'
 * - Worker -> 主线程: { id, ok, result?, error? }
 *   - ok=true:  result = ParseResult (与主线程 parseLLMResponse 返回值一致)
 *   - ok=false: error  = string (Worker 内部异常描述)
 *
 * Worker 内部:
 * - 动态 import jsonrepair + zod, 不会进入主线程 bundle
 * - 重新定义与 jsonParser.ts 等价的 6 个 schema (TokenSchema / GrammarPointSchema /
 *   PassagePayloadSchema / EvaluationPayloadSchema / DifficultyPayloadSchema / GlossPayloadSchema)
 *   独立定义避免与主线程共享 module graph (zod 不会被打到主线程)
 *
 * 注意:
 * - 不依赖主线程的 useAnalyticsStore (Worker 无法访问 zustand store);
 *   repaired 计数由主线程在收到 Worker 响应后, 根据 result.repaired 自行埋点.
 * - language compliance check 在 Worker 内执行 (与主线程 parseLLMResponse 行为一致).
 * - repairTruncatedJson 也在 Worker 内重新实现 (与 jsonParser.ts 等价, 不依赖主线程).
 */

// Worker 内部类型断言: self 在 worker context 是 DedicatedWorkerGlobalScope,
// 但 tsconfig.app.json 的 lib 仅含 DOM, 这里用 minimal 断言避免 lib 冲突.
interface WorkerSelf {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage: (msg: unknown) => void;
}
const workerSelf = self as unknown as WorkerSelf;

type SchemaName = 'passage' | 'evaluation' | 'difficulty' | 'gloss' | 'generic';

interface LlmJsonParseRequest {
  id: number;
  raw: string;
  schemaName: SchemaName;
  expectedLanguage?: string;
}

interface LlmJsonParseResponse {
  id: number;
  ok: boolean;
  result?: {
    ok: boolean;
    data?: unknown;
    error?: string;
    repaired?: boolean;
    issues?: Array<{ path: string; message: string }>;
  };
  error?: string;
}

// Schema 类型用最小契约 (Worker 内部不暴露 zod 类型, 仅用 unknown 接收 schema 对象)
// 注: issue.path 用 PropertyKey[] 对齐 zod v4 ($ZodIssue.path: (string|number|symbol)[]),
//     否则 ZodObject 无法结构性赋值给本契约 (TS2322).
interface ZodSchemaLike {
  safeParse: (input: unknown) => {
    success: boolean;
    data?: unknown;
    error?: {
      issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
      message: string;
    };
  };
}

let zodLib: ((typeof import('zod'))['z']) | null = null;
let jsonrepairFn: ((text: string) => string) | null = null;

/**
 * 动态加载 zod (Worker 内部缓存, 避免重复 import)
 */
async function loadZod() {
  if (zodLib) return zodLib;
  const mod = await import('zod');
  zodLib = mod.z;
  return zodLib;
}

/**
 * 动态加载 jsonrepair (Worker 内部缓存)
 */
async function loadJsonrepair() {
  if (jsonrepairFn) return jsonrepairFn;
  const mod = await import('jsonrepair');
  // jsonrepair 包导出方式: 默认导出 jsonrepair 函数 (在 ESM 下是 .default)
  jsonrepairFn = (mod as unknown as { jsonrepair: (text: string) => string }).jsonrepair
    ?? (mod as unknown as { default: (text: string) => string }).default;
  return jsonrepairFn;
}

/**
 * Worker 内部 schema 注册表 (按需构建, 避免模块加载时全量初始化)
 */
async function getSchema(name: SchemaName): Promise<ZodSchemaLike> {
  const z = await loadZod();

  // 局部 schema 定义 (与 jsonParser.ts 等价)
  const TokenSchema = z.object({
    id: z.string().optional(),
    lemma: z.string(),
    surfaceForm: z.string(),
    startIndex: z.number().int().nonnegative(),
    endIndex: z.number().int().nonnegative(),
    partOfSpeech: z.string().optional(),
    difficulty: z.string().optional(),
  });

  const GrammarPointSchema = z.object({
    id: z.union([z.string(), z.number()]),
    text: z.string(),
    startIndex: z.number().int().nonnegative(),
    endIndex: z.number().int().nonnegative(),
    explanation: z.string().optional(),
  });

  switch (name) {
    case 'passage':
      return z.object({
        text: z.string(),
        tokens: z.preprocess(
          (v) => (v === null || v === undefined ? [] : v),
          z.array(TokenSchema)
        ),
        grammarPoints: z.preprocess(
          (v) => (v === null || v === undefined ? [] : v),
          z.array(GrammarPointSchema)
        ),
        topic: z.string().optional(),
        title: z.string().optional(),
        language: z.string().optional(),
      });
    case 'evaluation':
      return z.object({
        grade: z.enum(['correct', 'partial', 'wrong']),
        feedback: z.string(),
        hint: z.string().optional(),
      });
    case 'difficulty':
      return z.object({
        morphological: z.number().min(1).max(5),
        abstractness: z.number().min(1).max(5),
        frequencyPercentile: z.number().min(1).max(100),
        reasoning: z.string().optional(),
      });
    case 'gloss':
      return z.object({
        definitions: z.array(z.string()).min(1),
        explanation: z.string().optional(),
      });
    case 'generic':
      // 宽松校验: 接受任意 JSON object, 不强制字段
      return z.object({}).passthrough();
  }
}

/**
 * Worker 内部: 轻量级截断 JSON 修复 (与 jsonParser.repairTruncatedJson 等价)
 */
function repairTruncatedJson(raw: string): string {
  try {
    if (typeof raw !== 'string') return raw;

    // Step 1: 完整 JSON 直接返回
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      // 继续到 Step 2
    }

    // Step 2: 扫描寻找最后一个有效闭合括号位置
    let depth = 0;
    let inString = false;
    let escape = false;
    let wentNegative = false;
    const stack: Array<'{' | '['> = [];
    let minDepthAfterClose = Infinity;
    let lastCloseAtMinDepth = -1;
    let stackAtLastClose: Array<'{' | '['> = [];

    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{' || ch === '[') {
        stack.push(ch);
        depth += 1;
      } else if (ch === '}' || ch === ']') {
        if (stack.length === 0) {
          depth -= 1;
          wentNegative = true;
          break;
        }
        stack.pop();
        depth -= 1;
        if (depth <= minDepthAfterClose) {
          minDepthAfterClose = depth;
          lastCloseAtMinDepth = i;
          stackAtLastClose = [...stack];
        }
      }
    }

    if (wentNegative || depth <= 0) {
      return raw;
    }

    if (lastCloseAtMinDepth < 0) {
      return raw;
    }

    let result = raw.slice(0, lastCloseAtMinDepth + 1);
    for (let i = stackAtLastClose.length - 1; i >= 0; i -= 1) {
      const open = stackAtLastClose[i];
      result += open === '{' ? '}' : ']';
    }
    return result;
  } catch {
    return raw;
  }
}

interface WorkerParseResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  repaired?: boolean;
  issues?: Array<{ path: string; message: string }>;
}

/**
 * Worker 内部: 解析 LLM 响应 (与 jsonParser.parseLLMResponse 等价, 但不调用 useAnalyticsStore)
 */
async function parseLLMResponseInWorker(
  raw: string,
  schemaName: SchemaName,
  expectedLanguage: string | undefined,
): Promise<WorkerParseResult> {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'Empty or non-string LLM response' };
  }

  const schema = await getSchema(schemaName);

  // Step 1: 直接 JSON.parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e1) {
    const e1Msg = e1 instanceof Error ? e1.message : String(e1);
    // Step 2: 用 repairTruncatedJson 修复
    try {
      const repairedRaw = repairTruncatedJson(raw);
      parsed = JSON.parse(repairedRaw);
      return finalizeParseResultInWorker(parsed, true, schema, schemaName, expectedLanguage);
    } catch {
      // Step 3: 用 jsonrepair 修复
      try {
        const jsonrepairFnLoaded = await loadJsonrepair();
        const repaired = jsonrepairFnLoaded(raw);
        parsed = JSON.parse(repaired);
      } catch (e3) {
        const e3Msg = e3 instanceof Error ? e3.message : String(e3);
        const summary = `JSON parse failed: ${e1Msg}; repairTruncatedJson also failed; jsonrepair also failed: ${e3Msg}`;
        return { ok: false, error: summary, issues: [] };
      }
      return finalizeParseResultInWorker(parsed, true, schema, schemaName, expectedLanguage);
    }
  }

  return finalizeParseResultInWorker(parsed, false, schema, schemaName, expectedLanguage);
}

/**
 * Worker 内部: zod safeParse + language compliance check
 */
function finalizeParseResultInWorker(
  parsed: unknown,
  repaired: boolean,
  schema: ZodSchemaLike,
  schemaName: SchemaName,
  expectedLanguage: string | undefined,
): WorkerParseResult {
  if (parsed === null || typeof parsed !== 'object') {
    return {
      ok: false,
      error: 'Parsed value is not an object',
      repaired,
      issues: [],
    };
  }

  const validated = schema.safeParse(parsed);
  if (validated.success) {
    // language compliance check 仅在 passage schema 时执行
    if (schemaName === 'passage' && expectedLanguage) {
      const actualLanguage = (validated.data as { language?: string }).language ?? 'en';
      if (actualLanguage !== expectedLanguage) {
        const errorMsg = `Language mismatch: got ${JSON.stringify(actualLanguage)}, expected ${JSON.stringify(expectedLanguage)}`;
        return {
          ok: false,
          error: errorMsg,
          repaired,
          issues: [],
        };
      }
    }
    return {
      ok: true,
      data: validated.data,
      repaired,
    };
  }

  const issues = validated.error!.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));
  const summary = `Schema validation failed: ${validated.error!.message}`;
  return {
    ok: false,
    error: summary,
    repaired,
    issues,
  };
}

workerSelf.onmessage = async (ev: MessageEvent) => {
  const req = ev.data as LlmJsonParseRequest;
  if (!req || typeof req.id !== 'number' || typeof req.raw !== 'string' || typeof req.schemaName !== 'string') {
    return;
  }

  const response: LlmJsonParseResponse = {
    id: req.id,
    ok: false,
  };

  try {
    response.result = await parseLLMResponseInWorker(
      req.raw,
      req.schemaName as SchemaName,
      req.expectedLanguage,
    );
    response.ok = true;
  } catch (e) {
    response.error = e instanceof Error ? e.message : String(e);
  }

  workerSelf.postMessage(response);
};
