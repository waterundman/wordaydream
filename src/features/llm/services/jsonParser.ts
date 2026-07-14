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
  // v2.2.4 Stage 1 (D1-1): grammarPoints 可选字段, 替代 llmAdapter 中
  // 多处 as unknown as 断言访问.
  grammarPoints?: Array<{ startIndex: number; endIndex: number; text: string }>;
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
export const PassagePayloadSchema = z.object({
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
 * v2.1.1 Stage 2 (D1): 评估响应 schema
 *
 * LLM 评估响应格式: { grade, feedback, hint }
 * - grade: 三值枚举 (correct / partial / wrong), 表示用户答题正确度
 * - feedback: 必填字符串, 给学习者的反馈信息
 * - hint: 可选字符串, 提示信息
 *
 * 与 PassagePayloadSchema 区别:
 * - 没有 text / tokens / grammarPoints 字段
 * - 没有 language 字段 (评估响应不做 language compliance check)
 */
export const EvaluationPayloadSchema = z.object({
  grade: z.enum(['correct', 'partial', 'wrong']),
  feedback: z.string(),
  hint: z.string().optional(),
});

/**
 * v2.1.1 Stage 2 (D1): 难度评估响应 schema
 *
 * LLM 难度评估响应格式: { morphological, abstractness, frequencyPercentile, reasoning }
 * - morphological: 1-5, 词形复杂度 (1=词根, 5=复杂派生/复合/屈折)
 * - abstractness: 1-5, 概念抽象度 (1=具体可感知, 5=抽象/学术/哲学)
 * - frequencyPercentile: 1-100, 频率百分位 (1=最常用, 100=罕见/专业)
 * - reasoning: 可选字符串, 评估理由 (一句话)
 */
export const DifficultyPayloadSchema = z.object({
  morphological: z.number().min(1).max(5),
  abstractness: z.number().min(1).max(5),
  frequencyPercentile: z.number().min(1).max(100),
  reasoning: z.string().optional(),
});

/**
 * v2.1.1 Stage 2 (D1): 词汇改写响应 schema
 *
 * LLM gloss 改写响应格式: { definitions, explanation }
 * - definitions: 1+ 中文释义数组 (min(1), 至少一条释义)
 * - explanation: 可选字符串, 补充解释 (用法/语感/词源等)
 */
export const GlossPayloadSchema = z.object({
  definitions: z.array(z.string()).min(1),
  explanation: z.string().optional(),
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
 * v2.1.1 Stage 2 (D1): 各 schema 推导的 TS 类型
 *
 * 暴露类型供调用方使用 (e.g. evaluateAnswerViaLLM 解析 result.parsed 时).
 */
export type EvaluationPayload = z.infer<typeof EvaluationPayloadSchema>;
export type DifficultyPayload = z.infer<typeof DifficultyPayloadSchema>;
export type GlossPayload = z.infer<typeof GlossPayloadSchema>;

/**
 * 解析结果 (v1.1.0)
 *
 * - ok=true:  data 包含结构化 payload, repaired 指示是否走 jsonrepair
 * - ok=false: error 描述失败原因 (供 retry 时附到 prompt)
 *
 * v1.2.0 Stage 4 hotfix P1-A:
 * - issues: zod 校验失败时, 列出每个问题的 path + message.
 *   供 buildRetryPrompt 拼到 LLM 下次请求, 让 LLM 知道具体哪个字段错.
 *
 * v2.1.1 Stage 2 (D1): 泛型化 ParseResult<T>.
 * - T 默认为 PassagePayload (向后兼容, 旧调用方代码无需修改)
 * - 调用方传入 schema 时, T 推导为 schema 对应的类型
 *   (e.g. EvaluationPayloadSchema -> T = EvaluationPayload)
 */
export interface ParseResult<T = PassagePayload> {
  ok: boolean;
  data?: T;
  error?: string;
  repaired?: boolean;
  issues?: Array<{ path: string; message: string }>;
}

/**
 * v2.1.1 Stage 1 (D8): 轻量级截断 JSON 修复层
 *
 * LLM 响应因 max_tokens 限制经常被截断, 导致 JSON.parse 失败.
 * 本函数在 jsonrepair 之前调用, 用括号深度匹配法做确定性修复,
 * 提高整体解析稳定性. 算法参考 Gualingo 的 _repair_truncated_json().
 *
 * 算法:
 * 1. 完整 JSON 直接返回: 先尝试 JSON.parse(raw), 成功则原样返回.
 * 2. 扫描寻找最后一个有效闭合括号位置:
 *    - 维护 depth / inString / escape / stack 状态
 *    - 字符串内的括号不影响深度 (inString 状态跟踪)
 *    - 记录每次闭合后 depth 达到的最小值及其位置 (lastCloseAtMinDepth)
 *    - 扫描结束时若 depth > 0 (未闭合) 且有有效闭合点:
 *      截断到该位置, 并补上 stack 中剩余的闭合括号
 *    - 若 depth > 0 且无有效闭合点: 返回原字符串 (让 jsonrepair 处理)
 *    - 若扫描期间 depth < 0 (多余闭合): 返回原字符串
 * 3. 不抛异常: 任何意外情况返回原字符串.
 *
 * 与 jsonrepair 的分工:
 * - repairTruncatedJson: 处理"深度嵌套但被截断"的场景, 确定性地截断到最近完整子结构
 * - jsonrepair: 处理尾随逗号 / 注释 / 引号缺失等更复杂的修复
 */
export function repairTruncatedJson(raw: string): string {
  // 任何意外情况返回原字符串, 绝不抛异常
  try {
    if (typeof raw !== 'string') return raw;

    // Step 1: 完整 JSON 直接返回 (JSON.parse 成功)
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
    // 记录闭合后 depth 达到的最小值, 及对应的位置和 stack 快照
    let minDepthAfterClose = Infinity;
    let lastCloseAtMinDepth = -1;
    let stackAtLastClose: Array<'{' | '['> = [];

    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      // escape 仅对下一个字符生效
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
          // 多余闭合括号: depth 变负, 异常输入, 标记后跳出
          depth -= 1;
          wentNegative = true;
          break;
        }
        stack.pop();
        depth -= 1;
        // 记录闭合后 depth <= 当前最小值的位置 (取最后一个达到最小值的位置)
        if (depth <= minDepthAfterClose) {
          minDepthAfterClose = depth;
          lastCloseAtMinDepth = i;
          stackAtLastClose = [...stack];
        }
      }
    }

    // Step 3: 根据扫描结果决定返回值
    // 多余闭合 (depth 曾经变负) 或 depth 最终为 0/负: 无法修复, 返回原字符串
    if (wentNegative || depth <= 0) {
      return raw;
    }

    // depth > 0 (未闭合) 但无有效闭合点: 返回原字符串让 jsonrepair 处理
    if (lastCloseAtMinDepth < 0) {
      return raw;
    }

    // 截断到最后一个有效闭合位置, 并补上剩余 stack 的闭合括号
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

/**
 * Stage 3 核心: 解析 LLM 响应 (repairTruncatedJson + jsonrepair + zod)
 *
 * v2.1.1 Stage 1 调用链:
 * 1. JSON.parse(raw) — 严格解析
 *    成功: zod safeParse 校验
 *      成功: 返回 {ok: true, data, repaired: false}
 *      失败: 返回 {ok: false, error: schema 错误信息}
 * 2. JSON.parse 失败: repairTruncatedJson(raw) 轻量级截断修复
 *    成功: JSON.parse(repaired) -> zod safeParse
 *      成功: 返回 {ok: true, data, repaired: true}
 *      失败: 进入 Step 3
 * 3. repairTruncatedJson 失败: jsonrepair(raw) 深度修复
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
 * v2.1.1 Stage 2 (D1): 泛型化 + schema 参数化.
 * - parseLLMResponse<T> 支持三种调用签名 (重载):
 *   1) (raw) — 旧签名, 使用 PassagePayloadSchema, 返回 ParseResult<PassagePayload>
 *   2) (raw, expectedLanguage) — 旧签名, 使用 PassagePayloadSchema + language check
 *   3) (raw, { schema, expectedLanguage }) — 新签名, 使用调用方提供的 schema
 *      T 从 schema 推导 (e.g. EvaluationPayloadSchema -> T = EvaluationPayload)
 * - language compliance check 仅在 schema === PassagePayloadSchema 时执行
 *   (只有 passage 响应有 language 字段)
 *
 * 注意:
 * - 不修改 raw 输入
 * - error 信息同时保留 schema 错误 (给 LLM 下次修复用)
 * - repaired 标志位反映"是否走了修复路径" (repairTruncatedJson 或 jsonrepair 成功均算)
 * - jsonrepair 不会抛出未捕获异常外的额外异常, 但仍包 try/catch 保险
 */
export function parseLLMResponse(raw: string): ParseResult<PassagePayload>;
export function parseLLMResponse(
  raw: string,
  expectedLanguage: Language
): ParseResult<PassagePayload>;
export function parseLLMResponse<T = PassagePayload>(
  raw: string,
  options: { schema?: z.ZodType<T>; expectedLanguage?: Language }
): ParseResult<T>;
export function parseLLMResponse(
  raw: string,
  // eslint-disable-next-line typescript/no-explicit-any -- ZodType<Input> 逆变, z.ZodObject 不可赋值给 z.ZodType<unknown>
  arg2?: Language | { schema?: z.ZodType<any>; expectedLanguage?: Language }
): ParseResult<PassagePayload> {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'Empty or non-string LLM response' };
  }

  // v2.1.1 Stage 2: 归一化 arg2 为 { schema, expectedLanguage }
  // - arg2 是 string (Language) -> 旧签名, 用默认 PassagePayloadSchema
  // - arg2 是 object -> 新签名, 用 options.schema (缺省回退 PassagePayloadSchema)
  // - arg2 undefined -> 旧签名无第二参数, 用默认 PassagePayloadSchema
  // 注: schema 用 z.ZodType<any> 而非 z.ZodType<unknown>, 因为 ZodType 在 Input
  // 类型上是逆变, z.ZodObject<PassagePayload> 不可赋值给 z.ZodType<unknown>.
  // eslint-disable-next-line typescript/no-explicit-any -- ZodType<Input> 逆变
  let schema: z.ZodType<any> = PassagePayloadSchema;
  let expectedLanguage: Language | undefined;
  if (typeof arg2 === 'string') {
    expectedLanguage = arg2;
  } else if (arg2 && typeof arg2 === 'object') {
    if (arg2.schema) {
      schema = arg2.schema;
    }
    if (arg2.expectedLanguage) {
      expectedLanguage = arg2.expectedLanguage;
    }
  }

  // Step 1: 直接 JSON.parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e1) {
    const e1Msg = e1 instanceof Error ? e1.message : String(e1);
    // Step 2: 用 repairTruncatedJson 修复 (轻量级截断修复, 在 jsonrepair 之前)
    try {
      const repairedRaw = repairTruncatedJson(raw);
      parsed = JSON.parse(repairedRaw);
      // 走 zod 校验
      return finalizeParseResult(parsed, /* repaired */ true, raw, schema, expectedLanguage);
    } catch (e2) {
      // Step 3: 用 jsonrepair 修复 (深度修复)
      try {
        const repaired = jsonrepair(raw);
        parsed = JSON.parse(repaired);
      } catch (e3) {
        const e3Msg = e3 instanceof Error ? e3.message : String(e3);
        const summary = `JSON parse failed: ${e1Msg}; repairTruncatedJson also failed; jsonrepair also failed: ${e3Msg}`;
        logParseFailure(raw, summary, []);
        return {
          ok: false,
          error: summary,
          issues: [],
        };
      }
      // 走 zod 校验
      return finalizeParseResult(parsed, /* repaired */ true, raw, schema, expectedLanguage);
    }
  }

  // 走 zod 校验 (未走修复路径)
  return finalizeParseResult(parsed, /* repaired */ false, raw, schema, expectedLanguage);
}

/**
 * v1.2.0 hotfix-3 + v2.1.1 Stage 2: parseLLMResponse 内部辅助 —
 * 走 zod 校验 + (仅 passage schema) language compliance check.
 *
 * 流程:
 * 1. zod safeParse 校验 -> 失败: 走原 logParseFailure 路径返回 ok=false.
 * 2. zod 校验成功: 检查 expectedLanguage (仅在 schema === PassagePayloadSchema 时).
 *    - schema 非 PassagePayloadSchema -> 跳过 language check (evaluation/difficulty/gloss
 *      响应没有 language 字段, 不做校验)
 *    - schema === PassagePayloadSchema + 提供 expectedLanguage ->
 *      校验 parsed.data.language === expectedLanguage.
 *      不一致 -> 返回 ok=false, error="Language mismatch: got X, expected Y".
 *      一致 -> 走原 success 路径.
 *    - schema === PassagePayloadSchema + 未提供 expectedLanguage -> 走原 success 路径.
 *
 * 设计要点:
 * - 缺省 parsed.data.language 时, 默认 'en' (与 LLM 之前行为一致, 兼容旧响应).
 * - jsonrepair 修复成功的埋点仍保留 (zod 校验通过的分支触发).
 * - v2.1.1 Stage 2: schema 参数化, language check 用 identity check (=== PassagePayloadSchema)
 *   而非字段存在性检查, 避免其他 schema 意外触发 language check.
 */
function finalizeParseResult(
  parsed: unknown,
  repaired: boolean,
  raw: string,
  // eslint-disable-next-line typescript/no-explicit-any -- ZodType<Input> 逆变
  schema: z.ZodType<any>,
  expectedLanguage: Language | undefined
): ParseResult<PassagePayload> {
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
  const validated = schema.safeParse(parsed);
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

    // v2.1.1 Stage 2: language compliance check 仅在 PassagePayloadSchema 时执行.
    // identity check (===) 确保只有显式使用 PassagePayloadSchema 的调用才走 language check,
    // 其他 schema (Evaluation/Difficulty/Gloss) 即使传了 expectedLanguage 也不触发.
    if (schema === PassagePayloadSchema && expectedLanguage) {
      const actualLanguage = (validated.data as { language?: string }).language ?? 'en';
      if (actualLanguage !== expectedLanguage) {
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
