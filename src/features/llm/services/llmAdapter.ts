import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { evaluateAnswer as mockEvaluate } from '../../evaluation/services/evaluateAnswer';
import { generateWithFallback } from './router';
import { evaluateDifficulty, mockEvaluateDifficulty } from './difficultyEvaluator';
import { buildPassagePrompt, buildEvaluateAnswerPrompt } from '../config/prompts';
import { extractPassageJson, safeJsonParse, type PassageJsonPayload } from './jsonParser';
import { normalizeTextPreservingOffsets, remapOffset } from '../utils/textNormalize';
import {
  summarizeAlignment,
  validateToken,
  type AlignmentResult,
} from '../utils/alignmentValidator';
import type { AnswerEvaluation, DifficultyEvaluation, DifficultyLevel, Language, MemoryCard } from '../../../types';

export interface EvaluateInput {
  userAnswer: string;
  lemma: string;
  objectiveDifficulty: DifficultyLevel;
  language: 'en' | 'de';
}

export async function evaluateAnswerViaLLM(input: EvaluateInput): Promise<AnswerEvaluation> {
  const { llm } = useSettingsStore.getState();

  if (llm.provider === 'mock' || !llm.enabled) {
    return mockEvaluate(input.userAnswer, input.lemma, input.objectiveDifficulty);
  }

  // v1.5.3: prompt 从 prompts.ts 集中管理, temperature 改为 0 提高判别稳定性.
  const { system, prompt, temperature, maxTokens } = buildEvaluateAnswerPrompt({
    lemma: input.lemma,
    language: input.language,
    userAnswer: input.userAnswer,
  });

  // v2.1.1 Stage 2 (D1): 使用 expectJson: 'evaluation' 走 schema-aware JSON 解析.
  // router.generateWithJsonRetry 会用 EvaluationPayloadSchema 校验 { grade, feedback, hint }
  // 格式, 不再用 PassagePayloadSchema (要求 text/tokens 字段) 拒绝非 passage 响应.
  // v2.1.0 hotfix 的本地 safeJsonParse workaround 已移除, 改回 result.parsed 路径.
  const result = await generateWithFallback(llm, {
    system,
    prompt,
    temperature,
    maxTokens,
    expectJson: 'evaluation',
  });

  // v1.5.3 fix: fallbackToMock 时走 mock 评估, 标注来源为 heuristic
  if (result.fallbackToMock) {
    return mockEvaluate(input.userAnswer, input.lemma, input.objectiveDifficulty);
  }

  // v2.2.1 Stage 2 (Bug 3 主因 B 协同): 优先用 router 已解析的 result.parsed.
  // result.parsed 为 undefined 时 (schema 校验未通过, 走了 mock fallback),
  // 走 mockEvaluate 而非解析 passage 文本 (passage JSON 会被误当评估结果).
  const parsed = result.parsed as { grade?: string; feedback?: string; hint?: string } | undefined;
  if (!parsed) {
    return mockEvaluate(input.userAnswer, input.lemma, input.objectiveDifficulty);
  }

  // v1.5.3 fix: 解析成功 → 标注来源为 llm
  if (parsed && typeof parsed === 'object') {
    const grade = (parsed.grade === 'correct' || parsed.grade === 'partial' || parsed.grade === 'wrong')
      ? parsed.grade
      : 'partial';
    // v1.5.3 fix: feedback 为空时提供兜底文案, 不再返回空字符串
    const feedback = typeof parsed.feedback === 'string' && parsed.feedback.trim()
      ? parsed.feedback.trim()
      : grade === 'correct'
        ? '回答正确。'
        : grade === 'partial'
          ? '部分正确，继续努力。'
          : '回答不正确，请查看提示。';
    return {
      grade,
      feedback,
      hint: typeof parsed.hint === 'string' ? parsed.hint.trim() : undefined,
      source: 'llm',
    };
  }

  // v1.5.3 fix: 解析失败不再返回 'partial' + 原始 LLM 文本 (会泄漏 JSON).
  // 改为明确标注为 error 来源, 让 UI 能区分"评估失败"与"学习反馈".
  return {
    grade: 'partial',
    feedback: '评估服务暂时不可用，请稍后重试。',
    source: 'error',
  };
}

/**
 * 便捷函数: 通过 LLM 评估词汇难度
 *
 * 内部委托给 difficultyEvaluator, 在 LLM 不可用时自动走 mock 启发式
 */
export async function evaluateDifficultyViaLLM(
  lemma: string,
  language: Language,
  context?: string
): Promise<DifficultyEvaluation> {
  return evaluateDifficulty(lemma, language, context);
}

/**
 * 同步便捷函数: 立即返回 mock 启发式难度评估 (不调 LLM)
 *
 * 适用于"先用启发式预判 + 后台异步调 LLM 校准"的两段式流程,
 * 或不阻塞主流程的预判场景.
 */
export function evaluateDifficultyViaMock(
  lemma: string,
  language: Language
): DifficultyEvaluation {
  return mockEvaluateDifficulty(lemma, language);
}

/**
 * 便捷函数: 直接调用 LLM 生成 passage JSON 负载
 *
 * 注意: 这是一个底层函数, 只负责"调用 LLM + 解析 JSON 响应".
 * 完整的 Passage 构造 (含 token 合并、难度评估、fallback 逻辑)
 * 由 features/reading/services/passageGenerator.ts 编排.
 *
 * 返回 null 表示 LLM 不可用 / 失败 / 解析失败, 调用方应自行决定 fallback.
 *
 * v1.1.0 (Stage 1): 收到 LLM 响应后, 对 passage.text 调用 normalizeText
 * 清洗 (\r\n / 零宽 / 孤立 markdown 行 / 首尾空白), 然后用 offsetMap
 * 重算所有 tokens / grammarPoints 的 startIndex/endIndex.
 *
 * v1.1.0 (Stage 2): 紧接着 normalizePassagePayload, 调用
 * validateAndAlignPassagePayload 对每个 token / grammarPoint 跑 5 步
 * alignment 校验, 过滤 dropped, 输出 console.info('[Alignment]', stats).
 */
export async function generatePassageViaLLM(
  language: Language,
  difficulty: DifficultyLevel,
  dueCards: Pick<MemoryCard, 'lemma'>[] = []
): Promise<PassageJsonPayload | null> {
  const { llm } = useSettingsStore.getState();
  // v2.1.1 Stage 4: LLMSettings.apiKey 字段已移除, 此处不再有任何 apiKey 检查.
  // v1.3.0 proxy 架构: API key 在后端 server/llm-proxy.js 的 .env 中.
  if (!llm.enabled || llm.provider === 'mock') {
    return null;
  }

  const { system, prompt } = buildPassagePrompt(language, difficulty, dueCards);
  // v2.1.1 Stage 2 (D1): expectJson: true -> 'passage' (显式使用 PassagePayloadSchema).
  // 行为等价 (true 在 router 内部映射为 'passage'), 但语义更清晰.
  const result = await generateWithFallback(llm, {
    system,
    prompt,
    temperature: llm.temperature,
    maxTokens: 1500,
    expectJson: 'passage',
  });

  // v2.1.0 hotfix: extractPassageJson 严格 slice 校验会丢弃所有 offset 不准确的 tokens.
  // 用 safeJsonParse 作为 fallback, 让 validateAndAlignPassagePayload 修复 offsets.
  let payload = extractPassageJson(result.text);
  if (!payload) {
    const raw = safeJsonParse<PassageJsonPayload>(result.text);
    if (raw && typeof raw.text === 'string' && raw.text.length > 0 &&
        Array.isArray(raw.tokens) && raw.tokens.length > 0) {
      payload = raw;
    }
  }
  if (!payload) return null;

  // Stage 1: text 清洗 + offsets 重算
  const normalized = normalizePassagePayload(payload);
  // Stage 2: alignment validation + correction
  return validateAndAlignPassagePayload(normalized);
}

/**
 * 对 PassageJsonPayload 应用 text 清洗, 并重算所有 offsets
 *
 * - normalizeText: \r\n -> \n, 去零宽, 移除孤立 markdown 行, trim
 * - normalizeTextPreservingOffsets: 同时返回 offsetMap 用于重算
 * - 重算: tokens[].startIndex/endIndex + grammarPoints[].startIndex/endIndex
 *
 * 注意: tokens / grammarPoints 的字段是可选的 (PassageJsonPayload 当前
 * 只有 tokens), 调用方如未来加入 grammarPoints 字段, 此函数会自动处理.
 */
export function normalizePassagePayload(
  payload: PassageJsonPayload
): PassageJsonPayload {
  const originalText = payload.text;
  const { normalized, offsetMap } = normalizeTextPreservingOffsets(originalText);

  // text 未变: 不需要重算 offsets
  if (normalized === originalText) {
    return payload;
  }

  const oldLen = originalText.length;
  const newLen = normalized.length;
  const remappedTokens = payload.tokens.map((tok) => ({
    ...tok,
    startIndex: remapOffset(tok.startIndex, offsetMap),
    endIndex: remapOffset(tok.endIndex, offsetMap),
  }));

  // 可选字段: grammarPoints (Stage 1 jsonParser 暂未产出, 但为后续兼容预留)
  const rawRecord = payload as unknown as { grammarPoints?: Array<{ startIndex: number; endIndex: number }> };
  const remappedGrammarPoints = Array.isArray(rawRecord.grammarPoints)
    ? rawRecord.grammarPoints.map((gp) => ({
        ...gp,
        startIndex: remapOffset(gp.startIndex, offsetMap),
        endIndex: remapOffset(gp.endIndex, offsetMap),
      }))
    : rawRecord.grammarPoints;

  const result: PassageJsonPayload = {
    ...payload,
    text: normalized,
    tokens: remappedTokens,
  };
  if (remappedGrammarPoints) {
    (result as unknown as { grammarPoints: typeof remappedGrammarPoints }).grammarPoints =
      remappedGrammarPoints;
  }

  console.info(
    `[Normalize] text length: ${oldLen} -> ${newLen}, offsets recalculated: ${remappedTokens.length + (Array.isArray(remappedGrammarPoints) ? remappedGrammarPoints.length : 0)}`
  );
  return result;
}

/**
 * grammarPoint 的最小可对齐形状 (duck-type)
 *
 * 来自 jsonParser / 未来 grammar detection LLM 的输出:
 * startIndex / endIndex / text (作为 surfaceForm) 是核心字段.
 */
interface GrammarPointLike {
  startIndex: number;
  endIndex: number;
  text: string;
}

/**
 * Stage 2 + Stage 4 hotfix: 对 PassageJsonPayload 应用 5 步 alignment 协议
 *
 * 流程:
 * 1. 对每个 token 调 validateToken -> AlignmentResult
 * 2. 对每个 grammarPoint (如果存在) 调 validateToken
 * 3. 过滤掉 status === 'dropped' 的 token
 * 4. 校正每个 token 的 startIndex / endIndex 为 validation 结果
 *    (grammarPoint 同样校正)
 * 5. 用 summarizeAlignment 计算 5 字段 stats
 * 6. console.info('[Alignment]', stats) 上报
 *
 * 入参: 必须是已经过 normalizePassagePayload 的 payload (text 已清洗)
 *
 * 兼容性:
 * - 当 payload 不含 grammarPoints (当前 v1.1.0 jsonParser 不产出),
 *   仅对 tokens 跑校验, stats.total == tokens.length
 * - 不修改 normalizePassagePayload 的行为, 仅追加一层校验
 *
 * Stage 4 hotfix P1-A: 该函数是公共契约, 返回类型保持 PassageJsonPayload
 * 不变. 内部逻辑委托给 validateAndAlignPassagePayloadInternal, 真正需要
 * per-token AlignmentResult[] 的调用方 (passageGenerator) 用
 * validateAndAlignPassagePayloadWithResults 拿到结果数组.
 */
export function validateAndAlignPassagePayload(
  payload: PassageJsonPayload
): PassageJsonPayload {
  return validateAndAlignPassagePayloadInternal(payload).payload;
}

/**
 * Stage 4 hotfix P1-A: 带 per-token 结果的 alignment 校验.
 *
 * 与 validateAndAlignPassagePayload 行为完全一致 (同样 console.info 同样
 * summarizeAlignment 同样过滤 dropped), 唯一区别是同时返回:
 * - payload: 校正后的 PassageJsonPayload (同 validateAndAlignPassagePayload)
 * - tokenResults: 与 payload.tokens 一一对应的 AlignmentResult[]
 *   (顺序匹配, 不含 dropped)
 * - grammarResults: 与 payload.grammarPoints 一一对应的 AlignmentResult[]
 *   (顺序匹配, 不含 dropped; 若 payload 不含 grammarPoints 则为 [])
 *
 * 用法 (passageGenerator): 把 AlignmentResult[] 写入 token.alignmentStatus
 * + token.originalOffset, 让 InteractivePassage 的 tooltip 能显示真实状态.
 */
export function validateAndAlignPassagePayloadWithResults(
  payload: PassageJsonPayload
): {
  payload: PassageJsonPayload;
  tokenResults: AlignmentResult[];
  grammarResults: AlignmentResult[];
} {
  return validateAndAlignPassagePayloadInternal(payload);
}

/**
 * Stage 4 hotfix P1-A: 真正干活的对齐 + 过滤逻辑.
 *
 * 调用方:
 * - validateAndAlignPassagePayload (Stage 1-3 公共契约, 仅返回 payload)
 * - validateAndAlignPassagePayloadWithResults (Stage 4 新增, 返回详情)
 */
function validateAndAlignPassagePayloadInternal(
  payload: PassageJsonPayload
): {
  payload: PassageJsonPayload;
  tokenResults: AlignmentResult[];
  grammarResults: AlignmentResult[];
} {
  const text = payload.text;

  // 1. tokens 校验 — 对每个 token 跑 5 步协议
  const allTokenResults: AlignmentResult[] = payload.tokens.map((t) =>
    validateToken(
      { startIndex: t.startIndex, endIndex: t.endIndex, surfaceForm: t.surfaceForm },
      text
    )
  );

  // 2. tokens 校正 + 过滤 dropped (按原始索引, dropped 项的 r 不参与)
  //    Stage 4 hotfix: 同步过滤 tokenResults, 让 survivingTokenResults 与
  //    alignedPayload.tokens 一一对应.
  const alignedTokens: PassageJsonPayload['tokens'] = [];
  const survivingTokenResults: AlignmentResult[] = [];
  for (let idx = 0; idx < payload.tokens.length; idx++) {
    const r = allTokenResults[idx];
    if (r.status === 'dropped') continue;
    const base = payload.tokens[idx];
    alignedTokens.push({
      ...base,
      startIndex: r.start,
      endIndex: r.end,
      surfaceForm: r.surfaceForm,
    });
    survivingTokenResults.push(r);
  }

  // 3. grammarPoints 校验 + 校正 (可选字段, 当前 passage json 不产出,
  //    但 alignmentValidator 必须兼容 — 直接读 rawRecord)
  const rawRecord = payload as unknown as { grammarPoints?: GrammarPointLike[] };
  let alignedGrammarPoints: GrammarPointLike[] | undefined;
  let survivingGrammarResults: AlignmentResult[] = [];
  let allGrammarResultsForStats: AlignmentResult[] = [];
  if (Array.isArray(rawRecord.grammarPoints)) {
    allGrammarResultsForStats = rawRecord.grammarPoints.map((gp) =>
      validateToken(
        { startIndex: gp.startIndex, endIndex: gp.endIndex, surfaceForm: gp.text },
        text
      )
    );
    alignedGrammarPoints = [];
    for (let idx = 0; idx < rawRecord.grammarPoints.length; idx++) {
      const r = allGrammarResultsForStats[idx];
      if (r.status === 'dropped') continue;
      const base = rawRecord.grammarPoints[idx];
      alignedGrammarPoints.push({
        ...base,
        startIndex: r.start,
        endIndex: r.end,
        text: r.surfaceForm,
      });
      survivingGrammarResults.push(r);
    }
  }

  // 4. 统计 (5 字段: perfect / corrected / fallback / dropped / total)
  //    注意: total = LLM 原 token/grammar 总数 (含 dropped)
  const stats = summarizeAlignment([...allTokenResults, ...allGrammarResultsForStats]);
  console.info('[Alignment]', stats);

  // 5. 组装结果
  const result: PassageJsonPayload = {
    ...payload,
    tokens: alignedTokens,
  };
  if (alignedGrammarPoints) {
    (result as unknown as { grammarPoints: GrammarPointLike[] }).grammarPoints =
      alignedGrammarPoints;
  }
  return {
    payload: result,
    tokenResults: survivingTokenResults,
    grammarResults: survivingGrammarResults,
  };
}

export function useLLMGenerator<TInput, TOutput>(
  buildPrompt: (input: TInput) => { system?: string; prompt: string; expectJson?: boolean },
  fallback: (input: TInput) => TOutput
) {
  const llm = useSettingsStore((s) => s.llm);
  const [lastResult, setLastResult] = useState<TOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // v1.5.3 fix V3-P3-002: config 变化时同时重置 isLoading, 避免旧请求进行中改配置后 loading 卡住.
  useEffect(() => {
    setLastResult(null);
    setIsLoading(false);
  }, [llm.provider, llm.model]);

  const run = async (input: TInput): Promise<TOutput> => {
    if (llm.provider === 'mock' || !llm.enabled) {
      const result = fallback(input);
      setLastResult(result);
      return result;
    }

    setIsLoading(true);
    try {
      const opts = buildPrompt(input);
      const result = await generateWithFallback(llm, { ...opts, temperature: llm.temperature });
      if (result.fallbackToMock || !result.text) {
        const fb = fallback(input);
        setLastResult(fb);
        return fb;
      }
      const parsed = opts.expectJson
        ? safeJson(result.text)
        : (result.text as unknown as TOutput);
      setLastResult(parsed as TOutput);
      return parsed as TOutput;
    } finally {
      setIsLoading(false);
    }
  };

  return { run, isLoading, lastResult };
}

function safeJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[0]);
  } catch {
    return undefined;
  }
}
