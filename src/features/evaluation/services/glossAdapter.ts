/**
 * Gloss Adapter (Stage 2: 字典 API + LLM 改写整合)
 *
 * 流程 (项目设计总结第七节):
 * 1. 先调用 wiktextractAdapter.fetchEntry 获取结构性事实 (词性, 词源, 例句, 语法标注)
 * 2. 如果拿到 entry 且 LLM 可用 -> 调用 LLM 将英文/德文释义改写为自然中文
 * 3. 否则保留字典原文 (按规范来源标注 "来源: Wiktionary")
 * 4. 全部失败时, fallback 到 v0.2.0 已有的 mock 字典
 *
 * 诚实标注 (项目设计总结第七节最后一条):
 * - 字典原文: '来源: Wiktionary'
 * - LLM 改写: 'AI 改写 (基于 Wiktionary)'
 * - 演示数据: '演示数据 (Wiktionary 离线)'
 *
 * 向后兼容 (v0.2.0 mock 模式):
 * - 无 LLM 启用时, 直接走 wiktextractAdapter (其自身 fallback 到 mock)
 * - 原 mockGlosses 字典作为"全部路径都失败"的最后兜底, 保留
 */

import type { GlossPayload, TokenOccurrence, Language } from '../../../types';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { generateWithFallback } from '../../llm/services/router';
import { getDictionaryAdapter } from '../../dictionary/services/wiktextractAdapter';

/* eslint-disable @typescript-eslint/no-magic-numbers */

/**
 * v0.2.0 兼容: 保留旧的 mock 字典, 作为全路径 fallback 兜底.
 * 当 wiktextractAdapter 也不可用 (网络 + 字典未覆盖词) 时, 仍能返回释义.
 */
const LEGACY_MOCK_GLOSSES: Record<string, GlossPayload> = {
  revolution: {
    word: 'revolution',
    partOfSpeech: 'noun',
    definitions: ['革命', '变革', '大变动'],
    examples: ['The industrial revolution transformed society.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '指社会、政治或技术领域的根本性、快速的变革。常用搭配：industrial revolution（工业革命），digital revolution（数字革命）。',
  },
  dilapidated: {
    word: 'dilapidated',
    partOfSpeech: 'adjective',
    definitions: ['破旧的', '荒废的', '年久失修的'],
    examples: ['The dilapidated old house needed extensive repairs.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '形容建筑物或物品因年久失修而破败的状态。语气偏正式，比 "broken" 更强调时间流逝造成的损坏。',
  },
  artisan: {
    word: 'artisan',
    partOfSpeech: 'noun',
    definitions: ['工匠', '手艺人', '技工'],
    examples: ['Local artisans sell their crafts at the market.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '指技艺精湛的手工艺人，通常制作高品质的手工制品。比 "craftsman" 更强调艺术性和专业性。',
  },
  marvel: {
    word: 'marvel',
    partOfSpeech: 'verb',
    definitions: ['惊叹', '赞叹', '感到惊奇'],
    examples: ['Visitors marvel at the ancient architecture.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '因敬畏或惊喜而注视、感叹。作动词时后接 at；作名词时意为"奇迹、奇观"。',
  },
  authenticity: {
    word: 'authenticity',
    partOfSpeech: 'noun',
    definitions: ['真实性', '地道性', '正宗'],
    examples: ['The authenticity of the painting was confirmed by experts.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '指事物真实、非伪造的品质。在文化语境中常表示"地道"、"原汁原味"。形容词形式是 authentic。',
  },
  endeavor: {
    word: 'endeavor',
    partOfSpeech: 'noun',
    definitions: ['努力', '尝试', '事业'],
    examples: ['It was a brave endeavor that succeeded against all odds.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '指为实现某个目标而付出的认真、持续的努力。比 "attempt" 更郑重，强调过程中的付出。也可作动词，意为"努力做"。',
  },
  blossom: {
    word: 'blossom',
    partOfSpeech: 'verb',
    definitions: ['开花', '繁荣', '发展'],
    examples: ['Her talent blossomed under the right teacher.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '原意为开花，引申为事物蓬勃发展、走向成熟。常用于描述人才、关系或事业的成长。',
  },
  vergessenheit: {
    word: 'Vergessenheit',
    partOfSpeech: 'Substantiv (feminin)',
    definitions: ['遗忘', '忘却'],
    examples: ['Das alte Gebäude geriet fast in Vergessenheit.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '表示"被遗忘的状态"。常用搭配：in Vergessenheit geraten（被遗忘），aus der Vergessenheit holen（使重新被记起）。',
  },
  verwittert: {
    word: 'verwittert',
    partOfSpeech: 'Adjektiv',
    definitions: ['风化的', '被风雨侵蚀的'],
    examples: ['Die verwitterte Fassade braucht eine Renovierung.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '形容物体因长期暴露在风雨中而受损、变色或变粗糙。常用于描述石材、木材等建筑材料。',
  },
  verbergen: {
    word: 'verbergen',
    partOfSpeech: 'Verb (unregelmäßig)',
    definitions: ['隐藏', '躲藏', '掩盖'],
    examples: ['Sie verbarg das Geschenk hinter ihrem Rücken.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '第二分词 verborgen，过去式 verbarg。既可指物理上的隐藏，也可指情感、事实的隐瞒。',
  },
  innehalten: {
    word: 'innehalten',
    partOfSpeech: 'Verb (unregelmäßig)',
    definitions: ['停下', '驻足', '暂停'],
    examples: ['Er hielt inne und blickte sich um.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '不及物动词，意为"突然停下、驻足"。过去式 hielt inne，第二分词 angehalten。带有文学色彩，比 anhalten 更正式。',
  },
  freiwillig: {
    word: 'freiwillig',
    partOfSpeech: 'Adjektiv',
    definitions: ['自愿的', '志愿的'],
    examples: ['Viele freiwillige Helfer unterstützen das Projekt.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '表示"出于自愿的、非强迫的"。名词形式：Freiwillige（志愿者）。反义词：pflichtgemäß（义务性的）。',
  },
  restaurierung: {
    word: 'Restaurierung',
    partOfSpeech: 'Substantiv (feminin)',
    definitions: ['修复', '修缮'],
    examples: ['Die Restaurierung des Denkmals dauerte zwei Jahre.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '指对古建筑、艺术品等的修复和修缮。动词形式：restaurieren。注意区别：Restaurant 是餐厅。',
  },
  'strömen': {
    word: 'strömen',
    partOfSpeech: 'Verb',
    definitions: ['涌来', '涌向', '流动'],
    examples: ['Tausende Menschen strömten zum Konzert.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '原意为"流动、流淌"，引申为人群大量涌入。常用搭配：herbeiströmen（蜂拥而至），strömen nach（涌向）。',
  },
  überdauern: {
    word: 'überdauern',
    partOfSpeech: 'Verb',
    definitions: ['度过', '经受住', '长存'],
    examples: ['Diese Bücher haben die Zeit überdauert.'],
    sourceLabel: 'Wiktionary + LLM 释义',
    llmExplanation: '意为"经受住（时间、困难）而留存"。前缀 über- 表示"超过、越过"，dauern 表示"持续"。',
  },
};

/**
 * 推断 token 的语种
 *
 * 优先使用调用方传入的 fallback (language prop);
 * v1.5.3 fix V3-P3-003: 改进 fallback 启发式, 之前仅用变音符判断,
 * 无变音符的德语词 (laufen/gehen/Haus) 误判为英语.
 * 现在综合变音符 + 首字母大写 (德语名词统一大写) 判断.
 */
function detectLanguage(token: TokenOccurrence, fallback?: Language): Language {
  if (fallback === 'en' || fallback === 'de') return fallback;
  const surface = token.surfaceForm;
  const hasGermanChars = /[äöüß]/i.test(surface);
  const startsUpper = /^[A-ZÄÖÜ]/.test(surface);
  if (hasGermanChars || startsUpper) return 'de';
  return 'en';
}

/**
 * 让 LLM 把字典原文 (英文/德文) 改写为自然流畅的中文释义
 *
 * 输入: 字典 facts (词性, 原文释义, 例句, 词源)
 * 输出: 简短的中文释义数组 (1-3 条) + 可选的中文解释
 */
async function rewriteToChinese(
  entry: {
    lemma: string;
    language: Language;
    partOfSpeech: string;
    definitions: string[];
    examples?: string[];
    etymology?: string;
  }
): Promise<{ definitions: string[]; explanation?: string } | null> {
  const { llm } = useSettingsStore.getState();
  if (llm.provider === 'mock' || !llm.enabled) return null;

  const system = `You are a bilingual dictionary assistant.
Given a source-language (英语 or 德语) word and its raw dictionary definitions
and examples from Wiktionary, you rewrite them into natural, concise Chinese glosses.

Rules:
- Output JSON only, no extra text.
- Provide 1 to 3 Chinese definitions, ordered by most common meaning first.
- Keep the partOfSpeech label in English (e.g. "noun", "verb", "adj").
- Optionally include a "explanation" field: a single short Chinese sentence
  (no more than 60 characters) that adds context (usage, nuance, or etymology).
- Do not invent meanings not implied by the source definitions.
- For German compound words, keep the original lemma intact (do not split it),
  but you may briefly hint the compound structure in the explanation if it helps.`;

  const userObj = {
    lemma: entry.lemma,
    language: entry.language,
    partOfSpeech: entry.partOfSpeech,
    definitions: entry.definitions,
    examples: entry.examples ?? [],
    etymology: entry.etymology,
  };

  const prompt = `Source dictionary data (from Wiktionary):
${JSON.stringify(userObj, null, 2)}

Rewrite into natural Chinese. Return JSON only matching:
{ "definitions": ["中文释义1", "中文释义2"], "explanation": "可选的简短补充" }`;

  const result = await generateWithFallback(llm, {
    system,
    prompt,
    temperature: 0.3,
    maxTokens: 300,
    expectJson: true,
  });

  if (result.fallbackToMock || !result.text) return null;

  // result.parsed 在 provider 解析成功时是对象, 否则需要手动 extract
  const parsed = (result.parsed ?? safeJson(result.text)) as
    | { definitions?: unknown; explanation?: unknown }
    | undefined;
  if (!parsed || typeof parsed !== 'object') return null;

  const defs = Array.isArray(parsed.definitions)
    ? parsed.definitions.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    : [];
  if (defs.length === 0) return null;

  const explanation =
    typeof parsed.explanation === 'string' && parsed.explanation.trim()
      ? parsed.explanation.trim()
      : undefined;

  return { definitions: defs, explanation };
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

/**
 * 把 DictionaryEntry 转换为 GlossPayload
 *
 * - 决定是否调用 LLM 改写
 * - 处理德语复合词 (保留原词, 提示词源)
 * - 标注 sourceLabel (诚实呈现信息来源)
 */
async function entryToGlossPayload(
  entry: import('../../../types').DictionaryEntry
): Promise<GlossPayload> {
  // 1) 拿到原始英文/德文释义
  const rawDefs = entry.definitions;
  const rawExamples = entry.examples ?? [];

  // 2) 尝试让 LLM 改写为中文
  const rewrite = await rewriteToChinese(entry);

  if (rewrite && rewrite.definitions.length > 0) {
    // LLM 改写成功
    const explanationParts: string[] = [];
    if (rewrite.explanation) explanationParts.push(rewrite.explanation);
    if (entry.etymology) explanationParts.push(`词源: ${entry.etymology}`);
    if (entry.grammaticalInfo) {
      const gi = entry.grammaticalInfo;
      const gParts: string[] = [];
      if (gi.gender) gParts.push(`性: ${gi.gender}`);
      if (gi.plural) gParts.push(`复数: ${gi.plural}`);
      if (gi.cases && gi.cases.length > 0) gParts.push(`变化: ${gi.cases.slice(0, 2).join('; ')}`);
      if (gParts.length > 0) explanationParts.push(gParts.join(' / '));
    }
    // 德语复合词提示
    if (entry.language === 'de' && /^[A-ZÄÖÜ]/.test(entry.lemma) && entry.lemma.length >= 8) {
      explanationParts.push('（德语复合词，保留原词形）');
    }

    return {
      word: entry.lemma,
      partOfSpeech: entry.partOfSpeech,
      definitions: rewrite.definitions,
      examples: rawExamples,
      sourceLabel: 'AI 改写 (基于 Wiktionary)',
      llmExplanation: explanationParts.length > 0 ? explanationParts.join('\n') : undefined,
    };
  }

  // 3) LLM 不可用 / 改写失败, 直接用字典原文
  // 不调用 LLM "翻译" 而是让 UI 自行展示原文 (UI 已知这种情况)
  // 但 GlossPayload.definitions 期望是用户能理解的释义, 这里做最简兜底:
  // 保留原义, sourceLabel 诚实标注为"字典原文, 需自行翻译或查中文词典"
  return {
    word: entry.lemma,
    partOfSpeech: entry.partOfSpeech,
    definitions: rawDefs,
    examples: rawExamples,
    sourceLabel:
      entry.source === 'wiktextract'
        ? '来源: Wiktionary (原文, 未改写)'
        : '演示数据 (Wiktionary 离线)',
  };
}

/**
 * 主入口: 获取词汇释义 (GlossPayload)
 *
 * 流程:
 * 1. 调 wiktextractAdapter.fetchEntry -> 优先真实 API, 失败时 mock
 * 2. 拿到 entry 后 -> 调 LLM 改写 / 标注字典原文
 * 3. entry 为空时 -> 退化到 v0.2.0 mock 字典
 * 4. 全部失败时 -> 返回"释义加载中..."占位, 不抛错
 */
export async function getGloss(
  token: TokenOccurrence,
  language?: Language
): Promise<GlossPayload> {
  const lang = detectLanguage(token, language);
  const adapter = getDictionaryAdapter();

  // 1) 字典查询
  let entry: import('../../../types').DictionaryEntry | null = null;
  try {
    entry = await adapter.fetchEntry(token.lemma, lang);
  } catch (err) {
    // adapter 自身已经 fallback, 这里再 catch 一次作为保险
    // eslint-disable-next-line no-console
    console.warn('[glossAdapter] dictionary fetch failed:', err);
    entry = null;
  }

  // 2) entry 存在时走"字典事实 + LLM 改写"路径
  if (entry) {
    return entryToGlossPayload(entry);
  }

  // 3) 退化到 v0.2.0 mock 字典
  const legacy = LEGACY_MOCK_GLOSSES[token.lemma.toLowerCase()];
  if (legacy) {
    // 维持原有 sourceLabel, 保持 v0.2.0 行为
    return { ...legacy, word: token.lemma };
  }

  // 4) 最后兜底: 占位 payload
  return {
    word: token.lemma,
    partOfSpeech: 'unknown',
    definitions: ['释义加载中...'],
    sourceLabel: 'Mock',
  };
}

/**
 * 清空所有缓存 (供测试 / 用户主动刷新)
 */
export function clearGlossCache(): void {
  getDictionaryAdapter().clearCache();
}
