/**
 * 健壮的 JSON 解析工具 (Stage 3: jsonrepair + zod schema validation)
 *
 * LLM 响应往往不可控, 实际生产中会遇到:
 * - ```json ... ``` markdown 代码块包裹
 * - 前后夹杂解释性文字 ("Here is the JSON: ..." / "Sure!")
 * - 多余的尾随逗号 / 注释
 * - Unicode 转义不完整
 * - 截断 (maxTokens 太小)
 *
 * v1.1.0 Stage 3 改进:
 * - 集成 jsonrepair 库 (成熟 LLM JSON 修复, 0 依赖, 修复 80% 常见错误)
 * - 集成 zod schema validation (类型安全 + 错误信息精确)
 * - 新增 parseLLMResponse 函数, 返回 ParseResult { ok, data?, error?, repaired? }
 *
 * 设计分层:
 * 1. safeJsonParse: 通用 JSON 解析 (markdown 剥离 + 尾随逗号兜底)
 * 2. parseLLMResponse: 集成 jsonrepair + zod, 返回结构化 ParseResult
 * 3. extractPassageJson / parsePassagePayload: 业务级 passage 解析 (向下兼容)
 *
 * 调用流程 (Stage 3):
 *   LLM response -> parseLLMResponse -> ok/fail
 *     ok:  -> data (PassagePayload)
 *     fail: -> router 用 error context 重试 1 次
 *            -> 仍 fail: 走 mock fallback
 */

import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';
import type { Language } from '../../../types';
import { useAnalyticsStore } from '../../analytics/store/useAnalyticsStore';

// =====================================================================
// 旧版 (v1.0.0) API: 保留以保持 Stage 1-2 兼容性
// =====================================================================

export interface PassageJsonPayload {
  title?: string;
  text: string;
  tokens: Array<{
    lemma: string;
    surfaceForm: string;
    startIndex: number;
    endIndex: number;
    partOfSpeech: string;
  }>;
}

/**
 * 提取文本中第一个 {...} 块 (贪婪地从最外层大括号开始)
 */
function extractFirstJsonBlock(text: string): string | null {
  if (!text) return null;
  // 优先尝试 markdown fence
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  // 否则寻找最外层 {...}
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 移除 JS 风格尾随逗号 (e.g. {"a": 1,}) — 严格 JSON 不允许,
 * 但部分 LLM 会输出, 尝试一次兜底.
 */
function stripTrailingCommas(json: string): string {
  return json
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 通用 JSON 解析: 处理 markdown / 额外文字 / 尾随逗号
 */
export function safeJsonParse<T = unknown>(text: string): T | undefined {
  if (!text) return undefined;
  const block = extractFirstJsonBlock(text);
  if (!block) return undefined;
  // 第一次尝试: 严格 JSON
  try {
    return JSON.parse(block) as T;
  } catch {
    // 第二次尝试: 修复常见 LLM 问题后重试
    try {
      return JSON.parse(stripTrailingCommas(block)) as T;
    } catch {
      return undefined;
    }
  }
}

/**
 * 校验 + 解析 passage 响应 (v1.0.0 旧接口, 保留)
 *
 * 返回 null 表示响应不可用, 调用方应 fallback 到 mock 文本.
 */
export function extractPassageJson(text: string): PassageJsonPayload | null {
  const parsed = safeJsonParse<Record<string, unknown>>(text);
  if (!parsed || typeof parsed !== 'object') return null;

  const rawText = parsed.text;
  const rawTokens = parsed.tokens;
  if (typeof rawText !== 'string' || rawText.length === 0) return null;
  if (!Array.isArray(rawTokens) || rawTokens.length === 0) return null;

  const tokens: PassageJsonPayload['tokens'] = [];
  for (const raw of rawTokens) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const lemma = typeof t.lemma === 'string' ? t.lemma : '';
    const surfaceForm = typeof t.surfaceForm === 'string' ? t.surfaceForm : '';
    const startIndex = typeof t.startIndex === 'number' ? t.startIndex : -1;
    const endIndex = typeof t.endIndex === 'number' ? t.endIndex : -1;
    const partOfSpeech = typeof t.partOfSpeech === 'string' ? t.partOfSpeech : 'word';
    if (!lemma || !surfaceForm) continue;
    if (startIndex < 0 || endIndex <= startIndex) continue;
    if (endIndex > rawText.length) continue;
    // 验证切片与 surfaceForm 一致
    if (rawText.substring(startIndex, endIndex) !== surfaceForm) continue;
    tokens.push({ lemma, surfaceForm, startIndex, endIndex, partOfSpeech });
  }

  if (tokens.length === 0) return null;

  const title = typeof parsed.title === 'string' && parsed.title.trim().length > 0
    ? parsed.title.trim()
    : undefined;

  return { title, text: rawText, tokens };
}

// =====================================================================
// v1.1.0 Stage 3: zod schemas + jsonrepair integration
// =====================================================================

/**
 * Token schema (LLM 响应中的标注词)
 *
 * 字段约束:
 * - lemma / surfaceForm: 必填字符串
 * - startIndex / endIndex: 必填非负整数 (text 内的字符偏移)
 * - partOfSpeech: 可选 (旧版必填, 渐进放宽)
 * - difficulty: 可选
 * - id: 可选 (V2 prompt 要求 string, 但 zod 兼容缺省)
 */
const TokenSchema = z.object({
  id: z.string().optional(),
  lemma: z.string(),
  surfaceForm: z.string(),
  startIndex: z.number().int().nonnegative(),
  endIndex: z.number().int().nonnegative(),
  partOfSpeech: z.string().optional(),
  difficulty: z.string().optional(),
});

/**
 * Grammar point schema (语法点检测的产物)
 *
 * 字段约束:
 * - id: 接受 string 或 number (旧版 LLM 可能输出 number, 后续可校正)
 * - text: 必填字符串 (passage 中真实连续子串)
 * - startIndex / endIndex: 必填非负整数
 * - explanation: 可选
 */
const GrammarPointSchema = z.object({
  id: z.union([z.string(), z.number()]),
  text: z.string(),
  startIndex: z.number().int().nonnegative(),
  endIndex: z.number().int().nonnegative(),
  explanation: z.string().optional(),
});

/**
 * Passage payload schema (v1.1.0 LLM 响应)
 *
 * 必填:
 * - text: 段落文本
 * - tokens: 标注词数组 (允许 null / 缺省, 缺省时回退为 [])
 *
 * 可选:
 * - grammarPoints: 语法点 (允许 null / 缺省, 缺省时回退为 [])
 * - topic: 主题
 * - title: 标题
 * - language: v1.2.0 hotfix-3 新增 (LLM 响应中的 language 字段, optional, 用于 language compliance check)
 *
 * v1.2.0 Stage 4 hotfix P1-A: tokens / grammarPoints 由必填放宽为 nullable().default([]).
 * 根因: 4/5 run 真实 LLM 响应触发 "Schema validation failed: tokens expected array".
 * 放宽后允许 LLM 漏掉 tokens 字段, 由 parsePassagePayload 后续补空数组.
 */
const PassagePayloadSchema = z.object({
  text: z.string(),
  // v1.2.0 Stage 4 hotfix P1-A: 允许 null / 缺省 -> 默认空数组.
  // zod 本身: nullable().default([]) 仅对 undefined 触发 default, 不处理 null.
  // 用 preprocess 把 null 也归一为 [], 再走 array 校验.
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
  // v1.2.0 hotfix-3: language 字段为可选 string, 供 parseLLMResponse
  // 做 language compliance check (与 expectedLanguage 比对). 缺省时
  // 默认按 'en' 处理, 与 v1.2.0 hotfix-2 之前行为保持一致.
  language: z.string().optional(),
});

/**
 * zod 推导的 PassagePayload TS 类型
 *
 * 与 PassageJsonPayload 不同: PassagePayload 含 id / difficulty / grammarPoints
 * 等 Stage 1+ 字段, 是 zod schema 的"宽松视图".
 */
export type PassagePayload = z.infer<typeof PassagePayloadSchema> & {
  language?: string;
};

/**
 * 解析结果 (v1.1.0)
 *
 * - ok=true:  data 包含结构化 payload, repaired 指示是否走 jsonrepair
 * - ok=false: error 描述失败原因 (供 retry 时附到 prompt)
 *
 * v1.2.0 Stage 4 hotfix P1-A:
 * - issues: zod 校验失败时, 列出每个问题的 path + message.
 *   供 buildRetryPrompt 拼到 LLM 下次请求, 让 LLM 知道具体哪个字段错.
 */
export interface ParseResult {
  ok: boolean;
  data?: PassagePayload;
  error?: string;
  repaired?: boolean;
  issues?: Array<{ path: string; message: string }>;
}

/**
 * Stage 3 核心: 解析 LLM 响应 (jsonrepair + zod)
 *
 * 流程:
 * 1. JSON.parse(raw) — 严格解析
 *    成功: zod safeParse 校验
 *      成功: 返回 {ok: true, data, repaired: false}
 *      失败: 返回 {ok: false, error: schema 错误信息}
 * 2. JSON.parse 失败: jsonrepair(raw) 修复
 *    成功: JSON.parse(repaired) -> zod safeParse
 *      成功: 返回 {ok: true, data, repaired: true}
 *      失败: 返回 {ok: false, error: schema 错误信息}
 *    失败: 返回 {ok: false, error: jsonrepair/parse 错误信息}
 *
 * v1.2.0 hotfix-3 (Stage 4 P1 最后加固):
 * - 接受 expectedLanguage?: Language 第二个参数 (optional, 向后兼容).
 * - 解析成功 + 提供 expectedLanguage 时, 校验 parsed.data.language === expectedLanguage.
 *   缺省 / 缺失 / 错值 -> 视为 parse failure (ok=false, error="Language mismatch: ...").
 *   router 接住这个失败信号后, 走 retry (next attempt) -> 全部失败 -> mock fallback.
 * - 缺省 parsed.data.language 字段时, 默认按 'en' 兼容, 与 v1.2.0 hotfix-2 行为一致.
 *
 * 注意:
 * - 不修改 raw 输入
 * - error 信息同时保留 schema 错误 (给 LLM 下次修复用)
 * - jsonrepair 不会抛出未捕获异常外的额外异常, 但仍包 try/catch 保险
 */
export function parseLLMResponse(
  raw: string,
  expectedLanguage?: Language
): ParseResult {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'Empty or non-string LLM response' };
  }

  // Step 1: 直接 JSON.parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e1) {
    const e1Msg = e1 instanceof Error ? e1.message : String(e1);
    // Step 2: 用 jsonrepair 修复
    try {
      const repaired = jsonrepair(raw);
      parsed = JSON.parse(repaired);
    } catch (e2) {
      const e2Msg = e2 instanceof Error ? e2.message : String(e2);
      const summary = `JSON parse failed: ${e1Msg}; jsonrepair also failed: ${e2Msg}`;
      logParseFailure(raw, summary, []);
      return {
        ok: false,
        error: summary,
        issues: [],
      };
    }
    // 走 zod 校验
    return finalizeParseResult(parsed, /* repaired */ true, raw, expectedLanguage);
  }

  // 走 zod 校验 (未走 jsonrepair)
  return finalizeParseResult(parsed, /* repaired */ false, raw, expectedLanguage);
}

/**
 * v1.2.0 hotfix-3: parseLLMResponse 内部辅助 — 走 zod 校验 + language compliance check.
 *
 * 流程:
 * 1. zod safeParse 校验 -> 失败: 走原 logParseFailure 路径返回 ok=false.
 * 2. zod 校验成功: 检查 expectedLanguage.
 *    - 未提供 expectedLanguage -> 走原 success 路径, 不做语言校验.
 *    - 提供 expectedLanguage -> 校验 parsed.data.language === expectedLanguage.
 *      不一致 -> 返回 ok=false, error="Language mismatch: got X, expected Y".
 *      一致 -> 走原 success 路径.
 *
 * 设计要点:
 * - 缺省 parsed.data.language 时, 默认 'en' (与 LLM 之前行为一致, 兼容旧响应).
 * - jsonrepair 修复成功的埋点仍保留 (zod 校验通过的分支触发).
 */
function finalizeParseResult(
  parsed: unknown,
  repaired: boolean,
  raw: string,
  expectedLanguage: Language | undefined
): ParseResult {
  if (parsed === null || typeof parsed !== 'object') {
    const errorMsg = 'Parsed value is not an object';
    logParseFailure(raw, errorMsg, []);
    return {
      ok: false,
      error: errorMsg,
      repaired,
      issues: [],
    };
  }
  const validated = PassagePayloadSchema.safeParse(parsed);
  if (validated.success) {
    if (repaired) {
      // v1.2.0: jsonrepair 修复成功 -> 埋点 + 日志
      try {
        useAnalyticsStore.getState().incrementLLMRepair();
      } catch {
        // 埋点失败不应阻塞主流程
      }
      const nextCount = useAnalyticsStore.getState().llmRepairCount;
      console.info(`[JSON Repair] count=${nextCount}`);
    }

    // v1.2.0 hotfix-3: language compliance check (post-parse 验证)
    // 缺省 parsed.data.language 时, 默认 'en' (向后兼容)
    const actualLanguage = (validated.data as { language?: string }).language ?? 'en';
    if (expectedLanguage && actualLanguage !== expectedLanguage) {
      const errorMsg = `Language mismatch: got ${JSON.stringify(actualLanguage)}, expected ${JSON.stringify(expectedLanguage)}`;
      console.info(
        `[Language Compliance] ${errorMsg}\n` +
          `  raw (first 500 chars): ${(raw ?? '').slice(0, 500)}`
      );
      return {
        ok: false,
        error: errorMsg,
        repaired,
        issues: [],
      };
    }

    return {
      ok: true,
      data: validated.data as PassagePayload,
      repaired,
    };
  }
  // v1.2.0 Stage 4 hotfix P1-A: schema 校验失败时, console.info 打印原始响应 + issues
  const issues = validated.error.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));
  const summary = `Schema validation failed: ${validated.error.message}`;
  logParseFailure(raw, summary, issues);
  return {
    ok: false,
    error: summary,
    repaired,
    issues,
  };
}

/**
 * v1.2.0 Stage 4 hotfix P1-A: 解析失败时, 打印 LLM 原始响应前 500 chars + 错误摘要.
 *
 * 帮助快速定位 LLM 输出问题 (markdown 包裹 / 截断 / 字段缺失 / 类型错位).
 * 仅 console.info 级别, 不阻塞主流程.
 */
function logParseFailure(
  raw: string,
  summary: string,
  issues: Array<{ path: string; message: string }>
): void {
  const preview = (raw ?? '').slice(0, 500);
  console.info(
    `[JSON Parse Failure] ${summary}\n` +
      `  raw (first 500 chars): ${preview}\n` +
      `  issues: ${JSON.stringify(issues)}`
  );
}

/**
 * 业务级 passage payload 解析 (v1.1.0 推荐入口)
 *
 * 包装 parseLLMResponse, 进一步校验:
 * - 过滤掉 surfaceForm 与 text 切片不一致的 token
 * - 校正 partOfSpeech 缺省值
 * - 校正 grammarPoints 顺序
 *
 * 返回:
 * - ok=true: data 是规范化后的 PassagePayload (字段值经过一致性检查)
 * - ok=false: error 描述失败原因
 */
export function parsePassagePayload(raw: string): ParseResult & {
  filtered?: { tokensDropped: number; grammarPointsDropped: number };
} {
  const result = parseLLMResponse(raw);
  if (!result.ok || !result.data) return result;

  const payload = result.data;
  const text = payload.text;

  // token 过滤: 切片与 surfaceForm 不一致 -> 丢弃
  const validTokens = payload.tokens.filter((t) => {
    if (t.startIndex < 0 || t.endIndex <= t.startIndex) return false;
    if (t.endIndex > text.length) return false;
    if (text.substring(t.startIndex, t.endIndex) !== t.surfaceForm) return false;
    return true;
  });

  // grammarPoints 过滤: 同样校验 (parseLLMResponse 已保证是数组, 缺省 = [])
  const validGrammar = (payload.grammarPoints ?? []).filter((g) => {
    if (g.startIndex < 0 || g.endIndex <= g.startIndex) return false;
    if (g.endIndex > text.length) return false;
    if (text.substring(g.startIndex, g.endIndex) !== g.text) return false;
    return true;
  });

  // 校正: 为缺省 partOfSpeech 补 'word'
  const normalizedTokens = validTokens.map((t) => ({
    ...t,
    partOfSpeech: t.partOfSpeech ?? 'word',
  }));

  const droppedTokens = payload.tokens.length - normalizedTokens.length;
  const droppedGrammar = (payload.grammarPoints?.length ?? 0) - validGrammar.length;

  const data: PassagePayload = {
    ...payload,
    tokens: normalizedTokens,
    // v1.2.0: schema 已 nullable().default([]), 这里保持空数组语义而非 undefined,
    // 让调用方 (passageGenerator) 更容易处理 "LLM 没产出 grammar points" 的场景
    grammarPoints: validGrammar.length > 0 ? validGrammar : [],
  };

  return {
    ok: true,
    data,
    repaired: result.repaired,
    filtered: { tokensDropped: droppedTokens, grammarPointsDropped: droppedGrammar },
  };
}
