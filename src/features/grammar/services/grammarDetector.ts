import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { generateWithFallback } from '../../llm/services/router';
import { safeJsonParse } from '../../llm/services/jsonParser';
import { buildGrammarDetectionPrompt } from '../../llm/config/prompts';
import type { GrammarPoint, Language, DifficultyLevel } from '../../../types';

/**
 * Mock 语法知识点数据
 * 用于 LLM 不可用时的回退方案
 *
 * v1.5.0 Stage 3: 加 `export` 关键字 (0 breaking change) 供
 * grammarDetector.functional.ts 复用 mock 数据, 避免重复定义.
 */
export const mockGrammarPoints: Record<Language, Array<Omit<GrammarPoint, 'startIndex' | 'endIndex' | 'isActive'>>> = {
  en: [
    {
      id: 'mock-grammar-en-001',
      text: 'was/were + verb-ing',
      type: '时态',
      difficulty: 2,
      explanation: '过去进行时表示过去某一时刻正在进行的动作。由 was/were + 动词-ing 构成。',
      examples: ['She was reading when I arrived.', 'They were building the house last year.'],
    },
    {
      id: 'mock-grammar-en-002',
      text: 'had + past participle',
      type: '时态',
      difficulty: 3,
      explanation: '过去完成时表示过去某一时间之前已经完成的动作。由 had + 过去分词构成。',
      examples: ['He had finished his work before I came.', 'The train had left when we arrived.'],
    },
    {
      id: 'mock-grammar-en-003',
      text: 'can + verb',
      type: '情态动词',
      difficulty: 1,
      explanation: '情态动词 can 表示能力或可能性，后面接动词原形。',
      examples: ['She can speak three languages.', 'Change can happen at any time.'],
    },
    {
      id: 'mock-grammar-en-004',
      text: 'What + clause',
      type: '名词性从句',
      difficulty: 3,
      explanation: 'What 引导的名词性从句可以作主语或宾语，表示"所……的事物"。',
      examples: ['What he said is true.', 'I know what you mean.'],
    },
    {
      id: 'mock-grammar-en-005',
      text: 'when + clause',
      type: '时间状语从句',
      difficulty: 2,
      explanation: 'When 引导时间状语从句，表示"当……的时候"。',
      examples: ['I was reading when she called.', 'When he arrived, we had already left.'],
    },
  ],
  de: [
    {
      id: 'mock-grammar-de-001',
      text: 'Präteritum',
      type: '时态',
      difficulty: 3,
      explanation: '德语过去时（Präteritum）用于书面语中表示过去发生的动作，动词位于句末。',
      examples: ['Sie las ein Buch.', 'Er kam gestern an.'],
    },
    {
      id: 'mock-grammar-de-002',
      text: 'Perfekt',
      type: '时态',
      difficulty: 2,
      explanation: '德语现在完成时（Perfekt）用于口语中表示过去完成的动作，由 haben/sein + 第二分词构成。',
      examples: ['Ich habe ein Buch gelesen.', 'Er ist gestern angekommen.'],
    },
    {
      id: 'mock-grammar-de-003',
      text: 'Dativ',
      type: '格',
      difficulty: 2,
      explanation: '德语第三格（Dativ）表示动作的间接宾语或方向，动词和介词后常接第三格。',
      examples: ['Ich gebe ihm ein Buch.', 'Er geht zur Schule.'],
    },
    {
      id: 'mock-grammar-de-004',
      text: 'Modalverben',
      type: '情态动词',
      difficulty: 2,
      explanation: '德语情态动词（können, müssen, sollen, wollen 等）位于第二位，实义动词位于句末。',
      examples: ['Ich kann Deutsch sprechen.', 'Sie muss lernen.'],
    },
    {
      id: 'mock-grammar-de-005',
      text: 'Relativsatz',
      type: '定语从句',
      difficulty: 4,
      explanation: '德语定语从句中，关系代词位于从句首位，动词位于从句末位。',
      examples: ['Das ist das Buch, das ich gelesen habe.', 'Die Frau, die dort steht, ist meine Mutter.'],
    },
  ],
};

/**
 * 使用 Mock 数据检测语法知识点
 * 在 LLM 不可用时提供回退功能
 *
 * v1.5.3 fix V2-P2-006: 之前用 Math.random 生成 startIndex/endIndex,
 * 高亮位置与文本完全无关. 修复: 在 text 中搜索语法模式关键词的近似出现.
 *
 * v2.2.4 Stage 3 (Bug 8): 关键修复 — 之前 gp.text 保持为语法模式描述
 * (如 'was/were + verb-ing'), validateToken 用它当 surfaceForm 在原文中查找,
 * 必然全部 dropped, 导致 grammarPoints 为空数组, 语法划线不显示.
 * 修复: 找到关键词位置后, 把 gp.text 设为 text.slice(start, end) (原文子串),
 * 这样 validateToken Step 1 (exact match) 能直接对齐.
 *
 * @param text 输入文本
 * @param language 语言类型
 * @returns 语法知识点列表
 */
function mockDetectGrammarPoints(text: string, language: Language): GrammarPoint[] {
  const candidates = mockGrammarPoints[language];
  const result: GrammarPoint[] = [];

  // 扩展到句子边界: 从 start 向后找句号/问号/感叹号/换行, 避免截断在词中间.
  const findSentenceEnd = (start: number): number => {
    const remaining = text.slice(start);
    const punctIdx = remaining.search(/[.!?\n]/);
    if (punctIdx >= 0) {
      return Math.min(start + punctIdx + 1, text.length); // +1 包含标点
    }
    return Math.min(start + 40, text.length); // fallback: 最多 40 字符
  };

  for (const gp of candidates) {
    // 从语法模式描述中提取关键词 (e.g. "was/were + verb-ing" → ["was", "were", "verb"])
    const keywords = gp.text
      .split(/[\s/]+/)
      .map((w) => w.replace(/[^a-zäöüß]/gi, ''))
      .filter((w) => w.length > 2);

    let found = false;
    for (const kw of keywords) {
      // 用词边界正则查找, 避免子串误匹配 (如 "was" 匹配 "washed")
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
      const match = re.exec(text);
      if (match && match.index !== undefined) {
        const idx = match.index;
        const end = findSentenceEnd(idx);
        const snippet = text.slice(idx, end);
        result.push({
          ...gp,
          text: snippet, // 关键修复: text 设为原文子串, validateToken 可对齐
          startIndex: idx,
          endIndex: end,
          isActive: false,
        });
        found = true;
        break;
      }
    }

    // v2.2.4 Stage 3 (Bug 8): fallback 路径也把 text 设为原文子串.
    // 之前取文本中间 30 字符但 text 仍是描述性的, validateToken 必然 dropped.
    // 现在在原文中找动词-like 的词 (含 -ed/-ing/-s 后缀) 作为 fallback 锚点.
    if (!found) {
      const fallbackMatch = text.match(/\b\w+(ed|ing|s)\b/i);
      if (fallbackMatch && fallbackMatch.index !== undefined) {
        const idx = fallbackMatch.index;
        const end = findSentenceEnd(idx);
        const snippet = text.slice(idx, end);
        result.push({
          ...gp,
          text: snippet,
          startIndex: idx,
          endIndex: end,
          isActive: false,
        });
      }
    }

    if (result.length >= 3) break;
  }

  return result;
}

/**
 * 使用 LLM 检测语法知识点
 * 通过调用 LLM 分析文本，提取关键语法结构
 *
 * v1.5.3 fix V2-P1-001: 之前用 expectJson: true 走 parseLLMResponse → PassagePayloadSchema,
 * 但语法检测返回 JSON 数组而非 PassagePayload 对象, zod 永远拒绝, 导致 100% fallback mock.
 * 修复: 改用 expectJson: false 走 retryWithBackoff, 手动用 safeJsonParse 解析 JSON 数组.
 *
 * v2.2.4 Stage 3 (Bug 8): 关键修复 — 之前用内联弱 prompt (只说 "exact text snippet"),
 * LLM 经常返回描述性文本 (如 "Past Simple Tense" / "was/were + verb-ing"),
 * validateToken 用它当 surfaceForm 在原文中查找, 必然全部 dropped.
 * 修复: 改用 prompts.ts 的 buildGrammarDetectionPrompt 强约束 prompt,
 * 该 prompt:
 *   1. 明确要求 text 是原文连续子串 (case-sensitive match)
 *   2. 有 few-shot 示例展示正确格式
 *   3. 有 self-check 要求 LLM 验证 passage.substring(startIndex, endIndex) === text
 * 返回格式从 JSON 数组改为 JSON object {"grammarPoints": [...]}.
 *
 * @param text 输入文本
 * @param language 语言类型
 * @param difficulty 难度等级 (传入 prompt 让 LLM 选合适难度的语法点)
 * @returns 语法知识点列表
 */
async function llmDetectGrammarPoints(
  text: string,
  language: Language,
  difficulty: DifficultyLevel
): Promise<GrammarPoint[]> {
  const { llm } = useSettingsStore.getState();

  // v2.2.4 Stage 3: 用强约束 prompt 替代内联弱 prompt
  const { system, prompt } = buildGrammarDetectionPrompt(language, difficulty, text);

  // v1.5.3 fix V2-P1-001: 不走 expectJson (PassagePayloadSchema 不兼容 grammar detection JSON),
  // 改用 expectJson: false 走 retryWithBackoff, 手动解析 JSON object.
  const result = await generateWithFallback(llm, {
    system,
    prompt,
    temperature: 0.3,
    maxTokens: 1000,
    expectJson: false,
  });

  // 手动解析 JSON object {"grammarPoints": [...]} (safeJsonParse 容错: markdown / 尾随逗号)
  const parsed = safeJsonParse<{ grammarPoints?: unknown[] }>(result.text);
  if (!parsed || !Array.isArray(parsed.grammarPoints)) {
    return mockDetectGrammarPoints(text, language);
  }

  const validPoints: GrammarPoint[] = [];

  for (const item of parsed.grammarPoints) {
    if (typeof item !== 'object' || item === null) continue;
    const point = item as Partial<GrammarPoint>;
    if (
      typeof point.id === 'string' &&
      typeof point.text === 'string' &&
      typeof point.type === 'string' &&
      typeof point.difficulty === 'number' &&
      typeof point.explanation === 'string' &&
      Array.isArray(point.examples) &&
      typeof point.startIndex === 'number' &&
      typeof point.endIndex === 'number'
    ) {
      validPoints.push({
        id: point.id,
        text: point.text,
        type: point.type,
        difficulty: Math.min(5, Math.max(1, Math.round(point.difficulty))) as GrammarPoint['difficulty'],
        explanation: point.explanation,
        examples: point.examples.map((e) => String(e)),
        startIndex: Math.max(0, Math.round(point.startIndex)),
        endIndex: Math.max(point.startIndex + 1, Math.round(point.endIndex)),
        isActive: false,
      });
    }
  }

  return validPoints.length > 0 ? validPoints : mockDetectGrammarPoints(text, language);
}

/**
 * 检测文本中的语法知识点
 * 根据配置决定使用 LLM 还是 Mock 数据
 *
 * v2.2.4 Stage 3 (Bug 8): 增加 difficulty 参数, 传入 LLM prompt 让其选合适难度的语法点.
 *
 * @param text 输入文本
 * @param language 语言类型
 * @param difficulty 难度等级 (默认 2, 传入 prompt 影响 LLM 语法点选择)
 * @returns 语法知识点列表
 */
export async function detectGrammarPoints(
  text: string,
  language: Language,
  difficulty: DifficultyLevel = 2
): Promise<GrammarPoint[]> {
  const { llm } = useSettingsStore.getState();

  if (llm.provider === 'mock' || !llm.enabled) {
    return mockDetectGrammarPoints(text, language);
  }

  try {
    return await llmDetectGrammarPoints(text, language, difficulty);
  } catch {
    return mockDetectGrammarPoints(text, language);
  }
}