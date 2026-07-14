/**
 * LLM 难度评估服务 (Difficulty Evaluator)
 *
 * 实现设计文档第五节定义的难度分级体系:
 * - 不依赖 CEFR/Goethe 等外部词表
 * - 使用 few-shot 跨语言锚点, 让 LLM 做相对判断
 * - 输出三维度: 词形复杂度/概念抽象度/使用频率百分位
 * - 归一化到 1-5 难度等级
 *
 * 兼容 v0.2.0 mock 模式: 当 LLM 不可用时, 使用基于词长/字符特征
 * (含变音符号/复合词/前后缀等) 的启发式规则, 返回合理等级.
 */

import type { DifficultyEvaluation, DifficultyLevel, Language } from '../../../types';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { generateWithFallback } from './router';
import {
  DIFFICULTY_ANCHORS,
  getCrossLanguageAnchorsByLevel,
} from '../config/difficultyAnchors';
import { LRUCache } from '../../dictionary/services/cache';

/* eslint-disable @typescript-eslint/no-magic-numbers */

const DIFFICULTY_CACHE_CAPACITY = 50;
const difficultyCache = new LRUCache<DifficultyEvaluation>({
  capacity: DIFFICULTY_CACHE_CAPACITY,
});

function buildCacheKey(language: Language, lemma: string): string {
  return `${language}::${lemma.toLowerCase()}`;
}

export function clearDifficultyCache(): void {
  difficultyCache.clear();
}

/**
 * 把三维度评分合成为 0-100 的原始分, 再归一化到 1-5 等级
 *
 * 合成权重: 词形 0.25 / 抽象度 0.35 / 频率 0.40
 * 频率百分位越高(越罕见)越难, 所以直接计入
 * 词形和抽象度都按 1-5 线性映射到 0-100
 */
const WEIGHT_MORPH = 0.25;
const WEIGHT_ABSTRACT = 0.35;
const WEIGHT_FREQUENCY = 0.40;

/**
 * 将 0-100 的原始分归一化到 1-5 的难度等级
 *
 * 分段: 0-20 -> 1, 20-40 -> 2, 40-60 -> 3, 60-80 -> 4, 80-100 -> 5
 */
export function normalizeScore(rawScore: number): DifficultyLevel {
  if (rawScore < 0) rawScore = 0;
  if (rawScore > 100) rawScore = 100;
  if (rawScore < 20) return 1;
  if (rawScore < 40) return 2;
  if (rawScore < 60) return 3;
  if (rawScore < 80) return 4;
  return 5;
}

/**
 * 基于三维度合成 0-100 原始分
 */
function composeRawScore(
  morphological: number,
  abstractness: number,
  frequencyPercentile: number
): number {
  const morph = clamp1to5(morphological) * 20; // 0-100
  const abs = clamp1to5(abstractness) * 20;    // 0-100
  const freq = clamp1to100(frequencyPercentile); // 1-100
  return morph * WEIGHT_MORPH + abs * WEIGHT_ABSTRACT + freq * WEIGHT_FREQUENCY;
}

function clamp1to5(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v < 1) return 1;
  if (v > 5) return 5;
  return v;
}

function clamp1to100(v: number): number {
  if (!Number.isFinite(v)) return 50;
  if (v < 1) return 1;
  if (v > 100) return 100;
  return v;
}

function clampPercentileToLevel(percentile: number): DifficultyLevel {
  if (percentile <= 15) return 1;
  if (percentile <= 35) return 2;
  if (percentile <= 60) return 3;
  if (percentile <= 80) return 4;
  return 5;
}

/**
 * Mock 模式下的启发式评估
 *
 * 特征:
 * - 词长: 越长越可能难
 * - 德语变音符号 (ä/ö/ü/ß): 暗示派生/复合词
 * - 复合词 (德语首字母大写且长度 >= 10): 提示需要拆分
 * - 已知后缀 (-tion, -ment, -ness, -ung, -keit, -heit, -isch): 抽象度+1
 * - 已知前缀 (ver-, be-, ent-, er-, 拉丁化 re-/in-): 词形+1
 * - 数字/年份/专有名词: 词形简单
 */
export function mockEvaluateDifficulty(
  lemma: string,
  language: Language
): DifficultyEvaluation {
  const normalized = lemma.trim();
  const len = normalized.length;
  let morph = 1;
  let abs = 1;
  let freq = 50; // 起始中位

  // 词长贡献 (4 字符以内 -> +0, 5-6 -> +0.5, 7-9 -> +1, 10+ -> +1.5)
  if (len <= 4) morph += 0;
  else if (len <= 6) morph += 0.5;
  else if (len <= 9) morph += 1;
  else morph += 1.5;

  if (len <= 4) freq -= 25;       // 短词更可能高频
  else if (len <= 6) freq -= 10;
  else if (len <= 9) freq += 5;
  else freq += 20;                // 长词更可能低频

  // 抽象度后缀
  const lower = normalized.toLowerCase();
  const ABSTRACT_SUFFIXES = [
    'tion', 'sion', 'ment', 'ness', 'ity', 'ous', 'ive', 'ism', 'ence', 'ance',
    'ung', 'keit', 'heit', 'schaft', 'tum', 'ität', 'tion', 'isch', 'lich',
  ];
  for (const suf of ABSTRACT_SUFFIXES) {
    if (lower.endsWith(suf)) {
      abs += 1.2;
      morph += 0.5;
      freq += 8;
      break;
    }
  }

  // 词形前缀 (德语可分前缀 + 拉丁化前缀)
  const MORPH_PREFIXES = ['ver', 'be', 'ent', 'er', 'zer', 'miss', 'über', 'unter'];
  for (const p of MORPH_PREFIXES) {
    if (lower.startsWith(p) && lower.length > p.length + 2) {
      morph += 0.8;
      break;
    }
  }
  const LATIN_PREFIXES = ['re', 'in', 'im', 'dis', 'pre', 'post', 'sub', 'super', 'trans'];
  for (const p of LATIN_PREFIXES) {
    if (lower.startsWith(p) && lower.length > p.length + 2) {
      morph += 0.4;
      break;
    }
  }

  // 德语变音符号
  if (language === 'de' && /[äöüß]/.test(lower)) {
    morph += 0.5;
  }

  // 德语复合词: 大写开头 + 长度 >= 8 且包含两个常见词根特征
  if (language === 'de' && /^[A-ZÄÖÜ]/.test(normalized) && normalized.length >= 8) {
    morph += 0.7;
  }

  // 数字/年份: 词形简单, 频率高
  if (/^\d+$/.test(normalized)) {
    morph = 1;
    abs = 1;
    freq = 10;
  }

  // 钳制到合法区间
  const morphClamped = clamp1to5(Math.round(morph));
  const absClamped = clamp1to5(Math.round(abs));
  const freqClamped = clamp1to100(Math.round(freq));
  const raw = composeRawScore(morphClamped, absClamped, freqClamped);
  const level = normalizeScore(raw);

  return {
    lemma: normalized,
    language,
    level,
    rawScore: Math.round(raw),
    morphological: morphClamped,
    abstractness: absClamped,
    frequencyPercentile: freqClamped,
    isLLMEvaluated: false,
    reasoning: 'mock 启发式 (词长/后缀/前缀/变音符号/复合词特征)',
  };
}

/**
 * 从 LLM 响应文本中提取 JSON 对象
 */
function extractJson(text: string): unknown {
  if (!text) return undefined;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[0]);
  } catch {
    return undefined;
  }
}

/**
 * 构建 few-shot 跨语言锚点 prompt
 */
function buildAnchorsBlock(): string {
  const lines: string[] = [];
  for (let level = 1 as DifficultyLevel; level <= 5; level = (level + 1) as DifficultyLevel) {
    const { en, de } = getCrossLanguageAnchorsByLevel(level);
    const enSamples = en.slice(0, 4).map((a) => a.lemma).join(', ');
    const deSamples = de.slice(0, 4).map((a) => a.lemma).join(', ');
    lines.push(
      `Level ${level} (expected: morph=~${level}, abs=~${level}, freq=~${level * 20}):`,
      `  en: ${enSamples}`,
      `  de: ${deSamples}`
    );
  }
  return lines.join('\n');
}

interface LLMRawEvaluation {
  morphological?: number;
  abstractness?: number;
  frequencyPercentile?: number;
  reasoning?: string;
}

/**
 * 把 LLM 返回的字段归一化为合法的 DifficultyEvaluation
 */
function buildEvaluationFromLLM(
  lemma: string,
  language: Language,
  raw: LLMRawEvaluation
): DifficultyEvaluation {
  const morph = clamp1to5(Math.round(raw.morphological ?? 3));
  const abs = clamp1to5(Math.round(raw.abstractness ?? 3));
  const freq = clamp1to100(Math.round(raw.frequencyPercentile ?? 50));
  const rawScore = composeRawScore(morph, abs, freq);
  return {
    lemma,
    language,
    level: normalizeScore(rawScore),
    rawScore: Math.round(rawScore),
    morphological: morph,
    abstractness: abs,
    frequencyPercentile: freq,
    reasoning: raw.reasoning,
    isLLMEvaluated: true,
  };
}

/**
 * 评估单个词汇的难度
 *
 * - 当 LLM 不可用 (mock 或 disabled) 时, 使用启发式规则
 * - 当 LLM 可用时, 使用 few-shot 跨语言锚点 prompt 让 LLM 做相对判断
 * - LLM 调用失败时, 自动 fallback 到 mock
 */
export async function evaluateDifficulty(
  lemma: string,
  language: Language,
  context?: string
): Promise<DifficultyEvaluation> {
  const normalized = lemma.trim();
  if (!normalized) {
    return mockEvaluateDifficulty(lemma, language);
  }

  const cacheKey = buildCacheKey(language, normalized);
  const cached = difficultyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { llm } = useSettingsStore.getState();
  if (llm.provider === 'mock' || !llm.enabled) {
    const result = mockEvaluateDifficulty(normalized, language);
    difficultyCache.set(cacheKey, result);
    return result;
  }

  const anchorsBlock = buildAnchorsBlock();
  const system = `You are a multilingual lexical difficulty judge.
Given a target lemma and optional context, you score three independent dimensions
on the scales below, and you may optionally add a one-sentence reasoning.

Dimensions:
- morphological: 1 (plain root form) to 5 (heavy derivation / compound / inflection)
- abstractness: 1 (concrete, perceivable) to 5 (abstract / academic / philosophical)
- frequencyPercentile: 1 (most frequent in native speech) to 100 (rare / specialist)

You must output JSON only, no extra text, matching exactly:
{ "morphological": <1-5>, "abstractness": <1-5>, "frequencyPercentile": <1-100>, "reasoning": "<one short sentence>" }

Calibrate against the cross-language anchor examples below. The two languages
(English, German) at the same level should feel similarly difficult to a learner.
Do NOT confuse morphologically complex (e.g. German compound "Krankenhaus") with
high lexical difficulty if it is high-frequency and concrete.`;

  const prompt = `${anchorsBlock}

Target lemma: ${normalized}
Language: ${language}
Context (optional): ${context?.trim() || '(none)'}

Score this lemma. Return JSON only.`;

  // v2.1.1 Stage 2 (D1): 使用 expectJson: 'difficulty' 走 schema-aware JSON 解析.
  // router.generateWithJsonRetry 会用 DifficultyPayloadSchema 校验
  // { morphological, abstractness, frequencyPercentile, reasoning } 格式,
  // 不再用 PassagePayloadSchema 拒绝非 passage 响应.
  // v2.1.0 hotfix 的本地 extractJson workaround 已移除, 改回 result.parsed 路径.
  const result = await generateWithFallback(llm, {
    system,
    prompt,
    temperature: 0.2,
    maxTokens: 300,
    expectJson: 'difficulty',
  });

  // v2.1.1 Stage 2: 优先用 router 已解析的 result.parsed (DifficultyPayloadSchema 校验通过).
  // fallback: 如果 result.parsed 不存在 (e.g. 旧路径残留), 用 extractJson 本地解析.
  const parsed = (result.parsed ?? extractJson(result.text)) as LLMRawEvaluation | undefined;
  if (parsed && typeof parsed === 'object') {
    const evaluation = buildEvaluationFromLLM(normalized, language, parsed);
    difficultyCache.set(cacheKey, evaluation);
    return evaluation;
  }

  // LLM 失败 / 返回格式错误, 落到 mock
  const fallback = mockEvaluateDifficulty(normalized, language);
  difficultyCache.set(cacheKey, fallback);
  return fallback;
}

/**
 * 同步 mock 评估 (不调 LLM), 适用于不阻塞主流程的预判场景
 */
export function evaluateDifficultySync(
  lemma: string,
  language: Language
): DifficultyEvaluation {
  return mockEvaluateDifficulty(lemma, language);
}

/**
 * 把 DifficultyLevel 反推为频率百分位参考点 (用于 UI 展示)
 */
export function levelToFrequencyGuide(level: DifficultyLevel): number {
  return clampPercentileToLevel(level * 20);
}

/**
 * 暴露给 UI: 列出所有锚点 (调试/校准面板)
 */
export function listAllAnchors() {
  return DIFFICULTY_ANCHORS;
}
