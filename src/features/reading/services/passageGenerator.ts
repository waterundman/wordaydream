/**
 * 文本生成服务 (Stage 3)
 *
 * 流程:
 * 1. 通过 LLM 生成 passage (language, difficulty, dueCards)
 * 2. 解析 LLM JSON 响应
 * 3. 对每个 token 调用 evaluateDifficulty 获取真实难度 (Stage 1)
 * 4. 构建 Passage 对象
 * 5. LLM 不可用 / 失败时, fallback 到 getMockPassage
 *
 * 缓存策略:
 * - LRU 缓存, key = `${language}::${difficulty}::${timeWindow}`
 *   (timeWindow = Date.now() / 60000 | 0, 1 分钟粒度)
 * - 容量上限 8 条
 * - 含 dueCards 的请求不缓存 (个性化)
 */

import type {
  DifficultyLevel,
  Language,
  LexemeGroup,
  MemoryCard,
  Passage,
  TokenOccurrence,
} from '../../../types';
import { getMockPassage } from '../../../mocks/passages';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { buildPassagePrompt } from '../../llm/config/prompts';
import { generateWithFallback } from '../../llm/services/router';
import { extractPassageJson } from '../../llm/services/jsonParser';
import {
  normalizePassagePayload,
  validateAndAlignPassagePayloadWithResults,
} from '../../llm/services/llmAdapter';
import type { AlignmentResult } from '../../llm/utils/alignmentValidator';
import {
  evaluateDifficulty,
  mockEvaluateDifficulty,
} from '../../llm/services/difficultyEvaluator';
import { detectGrammarPoints } from '../../grammar/services/grammarDetector';
import { splitCompound } from '../../grammar/services/compoundSplitter';

const CACHE_CAPACITY = 8;
/** 缓存时间窗: 1 分钟, 避免长时间缓存陈旧文本 */
const CACHE_WINDOW_MS = 60_000;

interface CacheEntry {
  key: string;
  passage: Passage;
  cachedAt: number;
}

const cache: CacheEntry[] = [];

function buildCacheKey(
  language: Language,
  difficulty: DifficultyLevel,
  hasDueCards: boolean
): string {
  const timeWindow = (Date.now() / CACHE_WINDOW_MS) | 0;
  return `${language}::${difficulty}::${hasDueCards ? 'with-rev' : 'no-rev'}::${timeWindow}`;
}

function getFromCache(key: string): Passage | undefined {
  const idx = cache.findIndex((c) => c.key === key);
  if (idx < 0) return undefined;
  const entry = cache[idx];
  // 简化: 时间窗已经包含在 key 中, 但额外做一次时间检查保护
  if (Date.now() - entry.cachedAt > CACHE_WINDOW_MS) {
    cache.splice(idx, 1);
    return undefined;
  }
  // LRU: 移动到末尾
  cache.splice(idx, 1);
  cache.push(entry);
  return entry.passage;
}

function putIntoCache(key: string, passage: Passage): void {
  cache.push({ key, passage, cachedAt: Date.now() });
  while (cache.length > CACHE_CAPACITY) {
    cache.shift();
  }
}

/** 测试/调试用: 清空缓存 */
export function clearPassageCache(): void {
  cache.length = 0;
}

/**
 * v1.5.3 fix V3-P3-005: 返回新数组而非原地修改, 避免副作用隐患.
 * 把 LLM 输出的 passage + 真实 difficulty 评估合并为最终 Passage.
 */
async function detectCompoundWordsForTokens(
  tokens: TokenOccurrence[],
  language: Language
): Promise<TokenOccurrence[]> {
  if (language !== 'de') return tokens;

  const result: TokenOccurrence[] = [];
  for (const token of tokens) {
    const compoundData = await splitCompound(token.lemma, language);
    if (compoundData) {
      result.push({
        ...token,
        isCompound: true,
        compoundParts: compoundData.parts.map((p) => p.text),
      });
    } else {
      result.push(token);
    }
  }
  return result;
}

/**
 * v1.2.0 Stage 4 hotfix P1-A: 把 LLM 输出的 passage + 真实 difficulty 评估
 * 合并为最终 Passage, 并把 alignment validator 的 per-token 结果写入每个
 * TokenOccurrence.alignmentStatus / .originalOffset.
 *
 * alignedTokens 数组与 llmTokens 一一对应 (按 index, 不含 dropped). 若
 * surfaceForm / startIndex 不一致 (说明数据链路有 bug), 退化为 'unknown'
 * + 0 offset, 让 InteractivePassage 视同 'perfect' 处理.
 */
export function buildPassageFromLLM(
  language: Language,
  difficulty: DifficultyLevel,
  llmText: string,
  llmTitle: string | undefined,
  llmTokens: Array<{
    lemma: string;
    surfaceForm: string;
    startIndex: number;
    endIndex: number;
    partOfSpeech: string;
  }>,
  alignedTokens?: AlignmentResult[]
): Passage {
  const id = `passage-${language}-${Date.now().toString(36)}`;

  const tokens: TokenOccurrence[] = llmTokens.map((t, idx) => {
    const aligned = alignedTokens?.[idx];
    let alignmentStatus: 'perfect' | 'corrected' | 'fallback' | 'dropped' | 'unknown' =
      'unknown';
    let originalOffset = 0;

    if (aligned) {
      // try-catch 容错: 即使 aligned 字段异常, 也不让 passage 构建挂掉
      try {
        const matches =
          aligned.surfaceForm === t.surfaceForm && aligned.start === t.startIndex;
        if (matches) {
          alignmentStatus = aligned.status;
          // 依 types/index.ts 约定: 仅 corrected / fallback 时写原始 offset
          if (aligned.status === 'corrected' || aligned.status === 'fallback') {
            originalOffset = aligned.originalOffset?.start ?? 0;
          }
        }
      } catch {
        alignmentStatus = 'unknown';
        originalOffset = 0;
      }
    }

    return {
      id: `tok-${id}-${idx}`,
      lexemeGroupId: `lex-${t.lemma.toLowerCase().replace(/[^a-z0-9äöüß]/gi, '-')}`,
      surfaceForm: t.surfaceForm,
      lemma: t.lemma,
      objectiveDifficulty: difficulty,
      startIndex: t.startIndex,
      endIndex: t.endIndex,
      isResolved: false,
      isActive: false,
      kind: 'normal',
      isCompound: false,
      alignmentStatus,
      originalOffset,
    };
  });

  const lemmaToTokenIds = new Map<string, string[]>();
  for (const tok of tokens) {
    const key = tok.lemma.toLowerCase();
    const list = lemmaToTokenIds.get(key) ?? [];
    list.push(tok.id);
    lemmaToTokenIds.set(key, list);
  }

  const lexemeGroups: LexemeGroup[] = [];
  for (const tok of tokens) {
    const ids = lemmaToTokenIds.get(tok.lemma.toLowerCase()) ?? [];
    if (ids.length === 0) continue;
    lexemeGroups.push({
      id: tok.lexemeGroupId,
      lemma: tok.lemma,
      objectiveDifficulty: tok.objectiveDifficulty,
      occurrences: ids,
    });
  }

  return {
    id,
    language,
    difficulty,
    text: llmText,
    title: llmTitle,
    tokens,
    lexemeGroups,
    grammarPoints: [],
  };
}

/**
 * 同步 mock 兜底难度评估, 永不抛错
 */
function safeEvaluateDifficultySync(lemma: string, language: Language): DifficultyLevel {
  try {
    return mockEvaluateDifficulty(lemma, language).level;
  } catch {
    return 3;
  }
}

/**
 * 异步评估 (LLM 优先, mock fallback), 永不抛错
 */
async function safeEvaluateDifficulty(
  lemma: string,
  language: Language
): Promise<DifficultyLevel> {
  try {
    const result = await evaluateDifficulty(lemma, language);
    return result.level;
  } catch {
    return safeEvaluateDifficultySync(lemma, language);
  }
}

/**
 * 合并真实难度到 passage (in-place)
 */
function applyDifficulties(
  passage: Passage,
  difficultyMap: Map<string, DifficultyLevel>
): Passage {
  for (const tok of passage.tokens) {
    const key = tok.lemma.toLowerCase();
    const level = difficultyMap.get(key);
    if (level) tok.objectiveDifficulty = level;
  }
  for (const group of passage.lexemeGroups) {
    const key = group.lemma.toLowerCase();
    const level = difficultyMap.get(key);
    if (level) group.objectiveDifficulty = level;
  }
  return passage;
}

/**
 * 主入口: 生成 Passage
 *
 * - LLM enabled → 调真实 LLM
 * - 失败 / disabled / 解析失败 → fallback 到 mock
 * - 内置 1 分钟 LRU 缓存
 */
export async function generatePassage(
  language: Language,
  difficulty: DifficultyLevel,
  dueCards: MemoryCard[] = [],
  // v1.5.3 fix V3-P3-006: 透传 AbortSignal, 让 loadSession 取消时能真正中断 LLM fetch.
  signal?: AbortSignal
): Promise<Passage> {
  const { llm } = useSettingsStore.getState();
  const hasDueCards = dueCards.length > 0;
  const cacheKey = buildCacheKey(language, difficulty, hasDueCards);

  if (!hasDueCards) {
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
  }

  // 1. 走 LLM (mock provider 在 disabled 时会直接返回空文本)
  if (llm.enabled && llm.provider !== 'mock' && llm.apiKey.trim().length > 0) {
    try {
      const { system, prompt } = buildPassagePrompt(language, difficulty, dueCards);
      const result = await generateWithFallback(llm, {
        system,
        prompt,
        temperature: llm.temperature,
        maxTokens: 1500,
        expectJson: true,
        // v1.2.0 hotfix-3 (Stage 4 P1 最后加固): 透传 expectedLanguage
        // 供 router → parseLLMResponse 做 language compliance check.
        expectedLanguage: language,
        // v1.5.3 fix V3-P3-006: 透传 signal 取消 LLM fetch.
        signal,
      });

      const payload = extractPassageJson(result.text);
      // v1.5.3 fix V4-P3-005: LLM 返回后检查 signal.aborted, 避免浪费后处理 CPU/网络.
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (payload) {
        // Stage 1: text 清洗 + offsets 重算
        const normalizedPayload = normalizePassagePayload(payload);
        // Stage 2 + Stage 4 hotfix P1-A: alignment validation + correction
        const {
          payload: alignedPayload,
          tokenResults,
        } = validateAndAlignPassagePayloadWithResults(normalizedPayload);
        const basePassage = buildPassageFromLLM(
          language,
          difficulty,
          alignedPayload.text,
          alignedPayload.title,
          alignedPayload.tokens,
          tokenResults
        );

        // 2. 评估每个 lemma 的真实难度 (去重)
        const uniqueLemmas = Array.from(
          new Set(basePassage.tokens.map((t) => t.lemma))
        );
        const difficultyMap = new Map<string, DifficultyLevel>();
        await Promise.all(
          uniqueLemmas.map(async (lemma) => {
            const level = await safeEvaluateDifficulty(lemma, language);
            difficultyMap.set(lemma.toLowerCase(), level);
          })
        );
        // v1.5.3 fix V4-P3-005: 难度评估后检查 abort.
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const enriched = applyDifficulties(basePassage, difficultyMap);

        // 3. 检测语法点
        const grammarPoints = await detectGrammarPoints(enriched.text, language);
        // v1.5.3 fix V4-P3-005: 语法检测后检查 abort.
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        enriched.grammarPoints = grammarPoints;

        // 4. 检测复合词 (德语)
        // v1.5.3 fix V3-P3-005: 用返回值替代原地修改, 避免副作用.
        enriched.tokens = await detectCompoundWordsForTokens(enriched.tokens, language);

        if (!hasDueCards) putIntoCache(cacheKey, enriched);
        return enriched;
      }
      // 解析失败, 落到 mock
    } catch (error) {
      // v1.5.3 fix V2-P2-005: 不再静默吞错, 记录日志便于调试.
      // LLM 配置错误 / API key 过期 / Edge Function 部署错误等持续故障会被发现.
      console.warn(
        '[passageGenerator] LLM generation failed, falling back to mock:',
        error instanceof Error ? error.message : error
      );
    }
  }

  // 3. fallback 到 mock 文本
  return getMockPassage(language, difficulty);
}
