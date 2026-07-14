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
import { getWordlistState, getMemoryState } from '../../../domain/storeAccessors';
import { getCachedWordlist } from '../../../data/wordlists';
import { buildPassagePrompt } from '../../llm/config/prompts';
import { generateWithFallback } from '../../llm/services/router';
import { extractPassageJson, safeJsonParse, type PassageJsonPayload } from '../../llm/services/jsonParser';
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
import { getRecentRecallRate, getAdaptiveLearningThreshold } from '../../review/services/recallRateCalculator';

const CACHE_CAPACITY = 8;
/** 缓存时间窗: 1 分钟, 避免长时间缓存陈旧文本 */
const CACHE_WINDOW_MS = 60_000;

/**
 * v1.6.0 Stage 3.6-C: 复习编排超载阈值.
 * dueCards (review/relearning 状态) 数量 > 此值时, pacing 强制巩固模式:
 * targetWords 取 dueCards 的 lemma, 主动建议复习而非引入新词.
 */
const REVIEW_OVERLOAD_THRESHOLD = 20;

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
 * v2.2.2 Stage 2 (Bug 5): 最近生成的标题黑名单 (LRU), 避免连续生成相同标题.
 *
 * 设计:
 * - 模块级单例, 进程内有效 (不持久化, 重启后清空, 与 passage 缓存生命周期一致).
 * - 容量 5: 取最近 5 个标题作为 avoidTitles 注入 prompt.
 * - LRU 语义: 重复 push 会先删除旧位置再追加到末尾; 超容量丢弃最旧.
 */
const recentTitles: string[] = [];
const RECENT_TITLES_MAX = 5;

function pushRecentTitle(title: string): void {
  const t = title.trim();
  if (!t) return;
  const idx = recentTitles.indexOf(t);
  if (idx >= 0) recentTitles.splice(idx, 1);
  recentTitles.push(t);
  while (recentTitles.length > RECENT_TITLES_MAX) recentTitles.shift();
}

export function getRecentTitles(): string[] {
  return [...recentTitles];
}

/** 测试/调试用: 清空 recentTitles 黑名单 */
export function clearRecentTitles(): void {
  recentTitles.length = 0;
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
  signal?: AbortSignal,
  // v2.2.1 Stage 1 (Bug 1): 强制跳过缓存读取, 供 loadSession 每次生成新 passage.
  // 缓存写入逻辑保持不变 (forceRefresh 时仍写入缓存, 供页面刷新等场景命中).
  forceRefresh?: boolean
): Promise<Passage> {
  const { llm } = useSettingsStore.getState();
  const hasDueCards = dueCards.length > 0;
  const cacheKey = buildCacheKey(language, difficulty, hasDueCards);

  if (!hasDueCards && !forceRefresh) {
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
  }

  // 1. 走 LLM (mock provider 在 disabled 时会直接返回空文本)
  // v2.1.1 Stage 4: LLMSettings.apiKey 字段已移除, 此处不再有任何 apiKey 检查.
  // v1.3.0 proxy 架构: API key 在后端 server/llm-proxy.js 的 .env 中.
  if (llm.enabled && llm.provider !== 'mock') {
    try {
      // v1.6.0 Stage 3.5-4: pacing 感知取词.
      // v1.7.0 Stage 1: pacing 阈值改为自适应 (基于 ratingHistory recall 率),
      //   替代 v1.6.0 硬编码 LEARNING_THRESHOLD=30.
      // learning 词过载 (>= 自适应阈值) 时转入巩固模式:
      //   targetWords = learning 词 (强化复现), optionalWords = [] (专注 target)
      // 正常模式: targetWords = 未学词 (引入新词), optionalWords = learning 词 (复现)
      // C1 (难度 5) 无词表 → learningWords 为 [] → isOverloaded=false → getUnlearnedWords 返回 []
      // → wordlistConstraint 为 undefined, 沿用 v1.5.x 自由生成 (0 breaking change).
      const wordlistState = getWordlistState();
      // 先异步加载词表 + 取 learning 词 (getLearningWords 内部会 loadWordlist)
      const learningWords = await wordlistState.getLearningWords(language, difficulty, 999);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      // v1.6.0 Stage 3.6-C: 复习编排 — dueCards 超载时强制巩固模式.
      // 仅统计 review/relearning 状态的 due 卡片 (new/learning 由自适应阈值处理),
      // 避免 learning 卡片 (初始学习流) 与 review 积压混淆.
      const memoryState = getMemoryState();
      const dueReviewCards = memoryState
        .getDueCards(language)
        .filter((c) => c.status === 'review' || c.status === 'relearning');
      const isReviewOverloaded = dueReviewCards.length > REVIEW_OVERLOAD_THRESHOLD;

      // v1.7.0 Stage 1: 自适应 pacing 阈值 (运行时计算, 不持久化).
      // 首次用户 (无 ratingHistory) 基于难度估算; 有历史用户基于近 7 天 recall 率.
      const ratingHistory = memoryState.ratingHistory;
      const learningThreshold = getAdaptiveLearningThreshold(
        getRecentRecallRate(ratingHistory),
        difficulty,
        ratingHistory.length > 0
      );
      const isOverloaded = learningWords.length >= learningThreshold;
      let targetWords: string[];
      let optionalWords: string[];
      if (isReviewOverloaded) {
        // v1.6.0 Stage 3.6-C: 优先级最高 — dueCards 超载 → 强制巩固, targetWords 取 dueCards 的 lemma.
        // dueCards 已按 due 升序排 (getDueCards 内部排序), slice(0,8) 取最过期的.
        targetWords = dueReviewCards.slice(0, 8).map((c) => c.lemma);
        optionalWords = [];
      } else if (isOverloaded) {
        // v1.6.0 Stage 3.5-B: 巩固模式按 lapses 降序排, 困难词优先作 target.
        // 反复遗忘的词 (lapses 高) 优先复现, 打破"困难词永远卡住"死锁.
        const learningWithLapses = learningWords.map((lemma) => {
          const card = memoryState.getCardByLemma(lemma, language);
          return { lemma, lapses: card?.lapses ?? 0 };
        });
        learningWithLapses.sort((a, b) => b.lapses - a.lapses);
        targetWords = learningWithLapses.slice(0, 8).map((w) => w.lemma);
        optionalWords = [];
      } else {
        // 正常模式: 新词作 target, learning 词作 optional
        targetWords = await wordlistState.getUnlearnedWords(language, difficulty, 8);
        optionalWords = wordlistState.getLearningWordsSync(language, difficulty, 20);
      }
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const wordlistConstraint = targetWords.length > 0
        ? { targetWords, optionalWords }
        : undefined;

      const { system, prompt } = buildPassagePrompt(
        language,
        difficulty,
        dueCards,
        wordlistConstraint,
        // v2.2.2 Stage 2 (Bug 5): 注入最近标题黑名单, 避免连续生成相同标题
        getRecentTitles()
      );
      // v2.2.2 Stage 2 (Bug 5): passage 生成使用更高 temperature 增加多样性,
      // 不影响评估 (evaluateAnswer 用单独的调用, temperature 由其自身控制).
      const passageTemperature = Math.max(llm.temperature, 0.85);
      const result = await generateWithFallback(llm, {
        system,
        prompt,
        temperature: passageTemperature,
        maxTokens: 1500,
        expectJson: true,
        // v1.2.0 hotfix-3 (Stage 4 P1 最后加固): 透传 expectedLanguage
        // 供 router → parseLLMResponse 做 language compliance check.
        expectedLanguage: language,
        // v1.5.3 fix V3-P3-006: 透传 signal 取消 LLM fetch.
        signal,
      });

      // v2.1.0 hotfix: extractPassageJson 的严格 slice 校验 (rawText.substring(start, end) !== surfaceForm)
      // 会过滤掉所有 offset 不准确的 tokens, 导致 payload 为 null, fallback 到 mock.
      // 但 LLM 返回的 token offsets 经常不准确, validateAndAlignPassagePayloadWithResults
      // 的设计目的就是修复不准确的 offsets. 所以先用 safeJsonParse 作为 fallback,
      // 跳过 slice 校验, 让 alignment validator 修复 offsets.
      let payload = extractPassageJson(result.text);
      if (!payload) {
        const raw = safeJsonParse<PassageJsonPayload>(result.text);
        if (raw && typeof raw.text === 'string' && raw.text.length > 0 &&
            Array.isArray(raw.tokens) && raw.tokens.length > 0) {
          payload = raw;
        }
      }
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

        // v1.6.0 Stage 3.5: 对 passage 中所有词表内 token 标记 learning.
        // 这样 recordEncounter 在用户答对时能生效 (progress 中已有记录).
        // 不限于 targetWords — LLM 自由用的词表内词也算"已见".
        const cachedWordlist = getCachedWordlist(language, difficulty);
        if (cachedWordlist) {
          const wordlistSet = new Set(
            cachedWordlist.words.map((w) => w.lemma.toLowerCase())
          );
          const coveredLemmas = new Set<string>();
          for (const tok of basePassage.tokens) {
            if (wordlistSet.has(tok.lemma.toLowerCase())) {
              coveredLemmas.add(tok.lemma);
            }
          }
          // targetWords 覆盖率日志 (保留诊断能力)
          if (wordlistConstraint) {
            const targetSet = new Set(targetWords.map((w) => w.toLowerCase()));
            const targetCovered = Array.from(coveredLemmas).filter((l) =>
              targetSet.has(l.toLowerCase())
            );
            console.info(
              `[Wordlist] target covered: ${targetCovered.length}/${targetWords.length}`,
              targetCovered
            );
          }
          for (const lemma of coveredLemmas) {
            getWordlistState().markWordLearning(language, lemma);
          }
        }

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

        // v2.2.0 Stage 1 (D4): LLM 路径产物显式标记 source='llm'.
        // buildPassageFromLLM 默认不设 source, 由调用方 (本函数) 统一赋值,
        // 让 UI 能明确区分 "AI 生成" vs "演示数据".
        enriched.source = 'llm';

        // v2.2.2 Stage 2 (Bug 5): LLM 成功生成后, 把标题加入 recentTitles 黑名单,
        // 下次生成时通过 avoidTitles 注入 prompt, 避免连续重复.
        pushRecentTitle(enriched.title ?? '');

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
