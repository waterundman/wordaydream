import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { generateWithFallback } from '../../llm/services/router';
import { safeJsonParse } from '../../llm/services/jsonParser';
import type { GrammarPoint, Language } from '../../../types';

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
 * @param text 输入文本
 * @param language 语言类型
 * @returns 语法知识点列表
 */
function mockDetectGrammarPoints(text: string, language: Language): GrammarPoint[] {
  const candidates = mockGrammarPoints[language];
  const result: GrammarPoint[] = [];
  const textLower = text.toLowerCase();

  for (const gp of candidates) {
    // 从语法模式描述中提取关键词 (e.g. "was/were + verb-ing" → ["was", "were", "verb-ing"])
    const keywords = gp.text
      .split(/[\s/]+/)
      .map((w) => w.replace(/[^a-zäöüß]/gi, ''))
      .filter((w) => w.length > 2);

    let found = false;
    for (const kw of keywords) {
      const idx = textLower.indexOf(kw.toLowerCase());
      if (idx >= 0) {
        // 扩展到完整短语 (取关键词后 20-40 字符, 不超文本边界)
        const end = Math.min(idx + Math.max(kw.length + 20, 30), text.length);
        result.push({
          ...gp,
          startIndex: idx,
          endIndex: end,
          isActive: false,
        });
        found = true;
        break;
      }
    }

    // 若关键词未命中, 用语法模式首个单词在 text 中找 (e.g. "Präteritum" → 找动词)
    if (!found) {
      // 退而求其次: 取 text 中间一段作为高亮位置 (至少不随机)
      const midStart = Math.floor(text.length / 4);
      const midEnd = Math.min(midStart + 30, text.length);
      if (midEnd > midStart) {
        result.push({
          ...gp,
          startIndex: midStart,
          endIndex: midEnd,
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
 * @param text 输入文本
 * @param language 语言类型
 * @returns 语法知识点列表
 */
async function llmDetectGrammarPoints(text: string, language: Language): Promise<GrammarPoint[]> {
  const { llm } = useSettingsStore.getState();
  const langName = language === 'en' ? '英语' : '德语';

  const system = `You are a language learning grammar assistant. Identify key grammar points in a passage and provide explanations in Chinese.
Output JSON array of objects with these fields:
- id: unique identifier
- text: the exact text snippet in the passage
- type: grammar category (e.g., 时态, 情态动词, 从句)
- difficulty: 1-5 (1=easy, 5=hard)
- explanation: detailed explanation in Chinese
- examples: array of 2-3 example sentences in the target language
- startIndex: 0-based start position in the original text
- endIndex: 0-based end position in the original text`;

  const prompt = `Passage (${langName}):
${text}

Identify 2-4 key grammar points that would be useful for language learners to learn. Focus on structures, not vocabulary.
Return ONLY a valid JSON array, no extra text.`;

  // v1.5.3 fix V2-P1-001: 不走 expectJson (PassagePayloadSchema 不兼容 JSON 数组),
  // 改用 expectJson: false 走 retryWithBackoff, 手动解析 JSON.
  const result = await generateWithFallback(llm, {
    system,
    prompt,
    temperature: 0.3,
    maxTokens: 800,
    expectJson: false,
  });

  // 手动解析 JSON 数组 (safeJsonParse 容错: 处理 markdown 包装 / 尾随逗号等)
  const parsed = safeJsonParse<unknown[]>(result.text);
  if (!parsed || !Array.isArray(parsed)) {
    return mockDetectGrammarPoints(text, language);
  }

  const validPoints: GrammarPoint[] = [];

  for (const item of parsed) {
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
 * @param text 输入文本
 * @param language 语言类型
 * @returns 语法知识点列表
 */
export async function detectGrammarPoints(text: string, language: Language): Promise<GrammarPoint[]> {
  const { llm } = useSettingsStore.getState();

  if (llm.provider === 'mock' || !llm.enabled) {
    return mockDetectGrammarPoints(text, language);
  }

  try {
    return await llmDetectGrammarPoints(text, language);
  } catch {
    return mockDetectGrammarPoints(text, language);
  }
}