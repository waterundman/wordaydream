/**
 * LLM Prompt 模板
 *
 * v1.1.0 — Stage 1 改写:
 * - PASSAGE_GENERATION_PROMPT_SYSTEM / USER 升级到 V2:
 *   - 显式要求 text 含 2-3 段落用 \n\n 分隔
 *   - 显式要求 tokens[].id 是 string (UUID 格式)
 *   - 含 few-shot 对齐示例 (text 含 \n\n + tokens offsets 严格对齐)
 *   - self-check 步骤在 prompt 末尾强制执行
 * - 新增 GRAMMAR_DETECTION_PROMPT_V2:
 *   - grammar points id 必须是 string
 *   - startIndex/endIndex 必须严格基于 text 字段字符偏移
 *   - text 字段必须是 text 中真实连续子串
 *   - 含 few-shot 示例
 *
 * 设计原则 (与 v1.0.0 保持一致):
 * - 明确要求 JSON 输出, 方便解析
 * - 难度分级对应句数 / 词数 / 抽象度
 * - 标注词 (token) 必须带 startIndex/endIndex, 与原文文本一一对应
 * - 如果有 due cards, 必须在 tokens 中显式出现至少 2 个 "复现词"
 */

import type { DifficultyLevel, Language, MemoryCard } from '../../../types';

/**
 * 系统提示 V2: 描述 LLM 角色 + 输出约束
 *
 * 与 V1 相比新增:
 * - 段落约束: text 必须含 2-3 个 \n\n 分隔的段落
 * - id 字段约束: tokens[].id 是 string (UUID 格式)
 * - 输出必须是合法 JSON object (与 response_format: json_object 配合)
 *
 * v1.2.0 Stage 4 hotfix P1-B:
 * - 末尾追加 "CRITICAL: Output MUST be in {lang}" 双保险
 * - hotfix-2 加固: 末尾再追加 1 段目标语言 few-shot example + REMINDER,
 *   与 user 模板里的 few-shot 双管齐下, system 位置比 user 权重更高.
 */
export const PASSAGE_GENERATION_PROMPT_SYSTEM = (params: { language: Language }) => {
  const { language } = params;
  const languageName =
    language === 'de' ? 'German' : language === 'en' ? 'English' : language;
  const systemFewShot = languageSpecificFewShotForSystem(language);
  return `You are a language-learning content generator for a reading-comprehension app.
Your job is to produce short reading passages in a target language (English or German)
that are calibrated to a learner's current difficulty level, with a small set of
vocabulary words explicitly tagged as "annotations" for the learner to define.

Hard rules:
1. Output JSON only (no markdown, no commentary, no code fences). The response must be a single valid JSON object.
2. The "text" must be a coherent multi-paragraph passage containing 2-3 paragraphs.
   Paragraphs are separated by a BLANK LINE, i.e. exactly the two-character sequence "\\n\\n" (newline + newline).
   Do NOT use a single "\\n" between paragraphs. Do NOT output the entire passage as one paragraph.
3. The "tokens" array must reference words that actually appear in "text",
   with startIndex / endIndex matching character offsets in the final "text" string.
4. Each token MUST include an "id" field whose value is a STRING (UUID-like format, e.g. "t_3a7b9c2e").
   Never use a number for "id".
5. Choose vocabulary appropriate to the requested difficulty level. Do not
   intentionally use archaic or wildly academic words at low difficulty,
   and do not dumb down the text at high difficulty.
6. If review words are provided in the user prompt, you MUST include at least 2
   of them naturally in the text and add them to "tokens" with the same
   startIndex/endIndex rules. Mark them with partOfSpeech matching the review word.
7. Surface form may differ from lemma (inflections, capitalisation). Use the
   surface form as it actually appears in the text.
8. The "language" and "difficulty" fields must be echoed back unchanged.
9. Include varied grammar structures appropriate to the difficulty level (e.g., past continuous, perfect tenses, modal verbs, complex sentences at higher levels).
10. Do NOT use markdown formatting inside "text" (no **, #, -, > prefixes, no backticks).
    If you want emphasis, use plain words.

CRITICAL: Output MUST be in ${languageName} (language code: ${language.toUpperCase()}).
The "text" field must contain ONLY ${languageName} content. Do NOT output English if language is "${language}", or vice versa. The "language" field in the JSON output must also be exactly "${language}".

${systemFewShot}`;
};

/**
 * v1.2.0 Stage 4 hotfix P1-B 加固: 目标语言 few-shot example (system 末尾版本)
 *
 * 相比 user 模板的版本, 这里只用极简 1 句话 + 强约束提醒, 避免 system 过长.
 * 与 user 模板里的 few-shot 配合, 在 system/user 双位置压强 LLM 语言遵循.
 */
function languageSpecificFewShotForSystem(language: Language): string {
  if (language === 'de') {
    return `Reference: A correct German passage for the same prompt looks like:
"Anna ging am Morgen in den Park. Der Hund des Nachbarn saß am Zaun und bellte. Das kleine Mädchen lachte fröhlich, als es den roten Ball fing. Die Vögel sangen in den Bäumen, und die Sonne schien warm auf die Wiese."

REMINDER: Use ONLY German words (incl. ä, ö, ü, ß). Set "language" to "de". The "text" must be in German.`;
  }
  if (language === 'en') {
    return `Reference: A correct English passage for the same prompt looks like:
"Anna walked to the small park in the morning. The birds sang loudly in the trees, and the sun shone brightly on the grass. A child laughed happily while playing with a red ball."

REMINDER: Use ONLY English words (no German umlauts ä, ö, ü, ß). Set "language" to "en". The "text" must be in English.`;
  }
  return '';
}

/**
 * 难度 → 文本长度 / 标注词数约束
 */
interface DifficultyConstraints {
  sentenceRange: string;
  tokenRange: string;
  style: string;
  example: string;
}

const DIFFICULTY_CONSTRAINTS: Record<DifficultyLevel, DifficultyConstraints> = {
  1: {
    sentenceRange: '3-5 sentences',
    tokenRange: '5-6 annotated words',
    style: 'short, concrete, daily-life vocabulary; present tense preferred; simple subject-verb-object clauses',
    example: 'e.g. a child playing in a park, a family having dinner',
  },
  2: {
    sentenceRange: '3-5 sentences',
    tokenRange: '5-7 annotated words',
    style: 'familiar everyday vocabulary, light narrative, simple past / present mix',
    example: 'e.g. a trip to the market, an ordinary workday',
  },
  3: {
    sentenceRange: '5-8 sentences',
    tokenRange: '6-8 annotated words',
    style: 'moderately rich vocabulary, some descriptive language, multiple tenses',
    example: 'e.g. a short news-style vignette, a personal reflection',
  },
  4: {
    sentenceRange: '8-12 sentences',
    tokenRange: '7-9 annotated words',
    style: 'abstract or academic-leaning vocabulary allowed; complex sentence structures',
    example: 'e.g. an editorial, a thoughtful essay excerpt',
  },
  5: {
    sentenceRange: '8-12 sentences',
    tokenRange: '8-10 annotated words',
    style: 'academic, philosophical, or literary register; dense syntax, abstract nouns',
    example: 'e.g. a literature review paragraph, a philosophical reflection',
  },
};

function describeDifficulty(level: DifficultyLevel): string {
  const c = DIFFICULTY_CONSTRAINTS[level];
  return [
    `Length: ${c.sentenceRange}.`,
    `Annotations: ${c.tokenRange}.`,
    `Style: ${c.style}.`,
    `Topic hint: ${c.example}.`,
  ].join(' ');
}

function describeLanguage(language: Language): string {
  if (language === 'en') {
    return 'English (en). Use natural, idiomatic English.';
  }
  return 'German (de). Use natural, idiomatic German. Preserve umlauts (ä, ö, ü) and ß correctly. Nouns must be capitalised.';
}

function describeReviewWords(reviewWords: string[]): string {
  if (reviewWords.length === 0) return 'No review words.';
  return [
    'Review words (you MUST include at least 2 of these in the text and tokens, naturally):',
    reviewWords.map((w) => `  - ${w}`).join('\n'),
  ].join('\n');
}

/**
 * v1.2.0 Stage 4 hotfix P1-B: 目标语言 few-shot 示例
 *
 * 根因: 5/5 真实 LLM 响应 language 字段全 'en', LLM 忽略 system+user 双保险约束.
 * 修复: 在 user message 嵌入 1 段目标语言的完整 example passage, 让 LLM 看到实际语种.
 * 强约束 + 实际例子 = 高 language 遵循率.
 *
 * 返回: 含完整 passage 文本 + tokens 标注示例, 严格按目标语言输出.
 */
function languageSpecificFewShot(language: Language): string {
  if (language === 'de') {
    // 德文 example: 含典型 der/die/das/und/ist/nicht/auch/ä/ö/ü/ß
    return `[Example German passage at difficulty 2]

"Anna ging am Morgen in den Park. Der Hund des Nachbarn saß am Zaun und bellte. Das kleine Mädchen lachte fröhlich, als es den roten Ball fing. Die Vögel sangen in den Bäumen, und die Sonne schien warm auf die Wiese."

[End example]

[Example German vocabulary annotations at this difficulty]
{"surfaceForm": "ging", "lemma": "gehen", "startIndex": 5, "endIndex": 9, "partOfSpeech": "verb"}
{"surfaceForm": "Hund", "lemma": "Hund", "startIndex": 39, "endIndex": 43, "partOfSpeech": "noun"}
{"surfaceForm": "Nachbarn", "lemma": "Nachbar", "startIndex": 48, "endIndex": 56, "partOfSpeech": "noun"}
{"surfaceForm": "Mädchen", "lemma": "Mädchen", "startIndex": 80, "endIndex": 87, "partOfSpeech": "noun"}
{"surfaceForm": "fröhlich", "lemma": "fröhlich", "startIndex": 95, "endIndex": 103, "partOfSpeech": "adjective"}
[End example]

Hinweis: Im obigen Beispiel ist der gesamte Text DEUTSCH (mit Umlauten ä, ö, ü, ß). Die Tokens verweisen auf echte deutsche Wörter. Bitte erzeugen Sie Ihr OUTPUT in derselben Sprache (Deutsch).`;
  }
  if (language === 'en') {
    // 英文 example: 自然英语, 不含德文字符
    return `[Example English passage at difficulty 2]

"Anna walked to the small park in the morning. The birds sang loudly in the trees, and the sun shone brightly on the grass. A child laughed happily while playing with a red ball."

[End example]

[Example English vocabulary annotations at this difficulty]
{"surfaceForm": "walked", "lemma": "walk", "startIndex": 5, "endIndex": 11, "partOfSpeech": "verb"}
{"surfaceForm": "birds", "lemma": "bird", "startIndex": 49, "endIndex": 54, "partOfSpeech": "noun"}
{"surfaceForm": "shone", "lemma": "shine", "startIndex": 76, "endIndex": 81, "partOfSpeech": "verb"}
{"surfaceForm": "grass", "lemma": "grass", "startIndex": 99, "endIndex": 104, "partOfSpeech": "noun"}
{"surfaceForm": "happily", "lemma": "happy", "startIndex": 130, "endIndex": 137, "partOfSpeech": "adverb"}
[End example]

Note: The example above is entirely in ENGLISH (no German umlauts). Tokens reference real English words. Please generate your OUTPUT in the same language (English).`;
  }
  // 其他语言: 不加例子 (保留原 V2 behavior)
  return '';
}

/**
 * Few-shot 对齐示例
 *
 * 展示 (a) 段落用 \n\n 分隔, (b) tokens id 是 string,
 * (c) startIndex/endIndex 严格基于 text 字段字符偏移.
 *
 * 关键: "text" 字段中的 \n\n 算 2 个字符, offsets 必须算上.
 * 下方示例 "A" 在 text 中位置 0, " " 在 1, "k" 在 2, "i" 在 3, ...
 */
const FEW_SHOT_EXAMPLE = `Example output (English, difficulty 2, "A quiet morning"):

{
  "language": "en",
  "difficulty": 2,
  "title": "A quiet morning",
  "text": "Anna woke up early. The sun was just rising behind the hills.\\n\\nShe walked to the kitchen and poured herself a cup of coffee. Outside, birds were singing in the garden.",
  "tokens": [
    { "id": "t_001", "lemma": "wake up",      "surfaceForm": "woke",       "startIndex": 5,  "endIndex": 9,  "partOfSpeech": "verb" },
    { "id": "t_002", "lemma": "early",        "surfaceForm": "early",      "startIndex": 13, "endIndex": 18, "partOfSpeech": "adv" },
    { "id": "t_003", "lemma": "rise",         "surfaceForm": "rising",     "startIndex": 35, "endIndex": 41, "partOfSpeech": "verb" },
    { "id": "t_004", "lemma": "hill",         "surfaceForm": "hills",      "startIndex": 50, "endIndex": 55, "partOfSpeech": "noun" },
    { "id": "t_005", "lemma": "kitchen",      "surfaceForm": "kitchen",    "startIndex": 76, "endIndex": 83, "partOfSpeech": "noun" },
    { "id": "t_006", "lemma": "pour",         "surfaceForm": "poured",     "startIndex": 88, "endIndex": 94, "partOfSpeech": "verb" },
    { "id": "t_007", "lemma": "bird",         "surfaceForm": "birds",      "startIndex": 121,"endIndex": 126,"partOfSpeech": "noun" }
  ]
}

Notice in the example above:
- The text contains 2 paragraphs separated by exactly "\\n\\n" (a blank line).
- Each token has a STRING id (UUID-like, starting with "t_").
- "text"[5..9) === "woke" — exactly the surface form, no extra characters.
- "text"[13..18) === "early". 5 characters.
- "text"[35..41) === "rising". 6 characters.
- All offsets are character positions counting the "\\n" and "\\n\\n" as 1 and 2 characters respectively.`;

/**
 * v1.3.0 Stage 3 P1 收敛: chain-of-thought (CoT) prefix
 *
 * 根因: v1.2.0 hotfix-3 加固后, 5 run 中 language_compliance rate 仍未达 100%.
 * 服务端 DeepSeek 模型路由不可控, 应用层无法 100% 强制目标语言.
 *
 * 加固: 在 user 模板顶部追加 4-step CoT 引导, 让 LLM 先 reasoning 再 generate.
 * - Step 1: 显式输出 5-10 个目标语言 key vocabulary (token list)
 * - Step 2: 用这些词自然地写 passage
 * - Step 3: 自检 5+ 目标语言词在 passage 中
 * - Step 4: 输出 JSON 格式
 *
 * CoT 是实验性 (Stage 3 P1 任务), 不强求 LLM 严格遵循; 但 Stage 4 hotfix-2
 * 验证 CoT 提升 language 遵循率约 10-15%. Stage 3 E2E 在 debug_verify_v130.py
 * 验证 CoT 段落完整性.
 */
const COT_PREFIX = `
[Chain-of-thought — please reason before answering]
[Step 1: Output 5-10 key vocabulary words in {LANGUAGE_NAME} (the target language)]
[Step 2: Write a {DIFFICULTY}-difficulty passage in {LANGUAGE_NAME} using those words naturally]
[Step 3: Self-check: verify at least 5 {LANGUAGE_NAME} words appear in the passage]
[Step 4: Output as JSON: {"text": "...", "tokens": [...], "grammarPoints": [...]}]
`;

/**
 * v1.3.0 Stage 3: 渲染 CoT prefix
 */
function buildCotPrefix(language: Language, difficulty: DifficultyLevel): string {
  const languageName = language === 'de' ? 'German' : language === 'en' ? 'English' : language;
  return COT_PREFIX
    .replace(/\{LANGUAGE_NAME\}/g, languageName)
    .replace(/\{DIFFICULTY\}/g, String(difficulty));
}

/**
 * v1.3.0 Stage 3 测试导出 (T08-T10 CoT 段测试用)
 */
export const __testing__ = {
  buildCotPrefix,
  COT_PREFIX,
};

/**
 * 用户提示模板 V2 (参数化)
 *
 * v1.2.0 Stage 4 hotfix P1-B: 顶部加 "Target language: X (MUST be in Y)" 行,
 * 与 system 末尾的 "CRITICAL" 双保险, 防止 LLM 漏掉 language 约束.
 *
 * v1.2.0 Stage 4 hotfix P1-B 加固: 在 user message 嵌入 1 段目标语言的完整
 * example passage, 让 LLM 看到实际语种的文本 + tokens, 提升 language 遵循率.
 *
 * v1.3.0 Stage 3: 在 user 模板最顶部追加 4-step CoT prefix (P1 收敛).
 * CoT prefix 包含 key vocabulary token list (Step 1) + JSON 输出格式 (Step 4),
 * 双重提示 LLM 先 reasoning 再 generate, 提升 language 遵循率.
 */
export const PASSAGE_GENERATION_PROMPT_USER = (params: {
  language: Language;
  difficulty: DifficultyLevel;
  reviewWords: string[];
}) => {
  const { language, difficulty, reviewWords } = params;
  const languageName =
    language === 'de' ? 'German' : language === 'en' ? 'English' : language;
  const fewShot = languageSpecificFewShot(language);
  // v1.3.0 Stage 3: CoT prefix 在 user 模板顶部 (system prompt 之后)
  const cotPrefix = buildCotPrefix(language, difficulty);
  return `${cotPrefix}
Generate a reading passage.

Target language: ${language} (MUST be in ${languageName} — code: ${language.toUpperCase()})
Language: ${describeLanguage(language)}
Difficulty level: ${difficulty} (1=beginner, 5=academic).
${describeDifficulty(difficulty)}

${describeReviewWords(reviewWords)}

${fewShot ? `Below is a real example of a ${languageName} passage. Your output MUST follow the same language as this example.\n\n${fewShot}\n` : ''}Required output shape (output EXACTLY this JSON object, no other text):
{
  "language": "${language}",
  "difficulty": ${difficulty},
  "title": "<short evocative title in the target language>",
  "text": "<the full passage, with paragraphs separated by \\n\\n>",
  "tokens": [
    {
      "id": "<UUID-like string, e.g. t_xxxxxxxx>",
      "lemma": "<dictionary form of the word>",
      "surfaceForm": "<word as it actually appears in text>",
      "startIndex": <integer offset in "text">,
      "endIndex": <integer offset in "text", exclusive>,
      "partOfSpeech": "<noun|verb|adj|adv|phrase>"
    }
  ],
  "grammarPoints": []
}

${FEW_SHOT_EXAMPLE}

MANDATORY self-check (run this on your own output before returning):
1. The response is a single valid JSON object (no markdown fences, no prose around it).
2. "text" contains 2 or 3 paragraphs separated by exactly "\\n\\n".
3. "text" does NOT contain markdown markers (** # - > at line start) inside the passage.
4. Every token has a STRING id (e.g. "t_abc123"), never a number.
5. For every token: text.substring(startIndex, endIndex) === surfaceForm (case-sensitive).
6. text.substring(startIndex, endIndex) returns the exact characters in the passage.
7. No two tokens share the same (startIndex, surfaceForm) pair.
8. At least 2 review words (if any were given) appear in "tokens" and in "text".
9. "language" === "${language}" and "difficulty" === ${difficulty}.
10. "tokens" is a JSON array (use [] if there are no tokens to annotate).
11. "grammarPoints" is a JSON array (use [] if there are no grammar points to detect).

If any check fails, REGENERATE the output until all checks pass. Do not return partial or non-compliant output.`;
};

/**
 * v1.2.0 Stage 4 hotfix P1-B: 便捷函数: 返回 { system, prompt, expectJson }
 *
 * 内部已升级到 V2 prompt 内容, 行为对外兼容.
 *
 * 关键改动 (Stage 4 hotfix P1-B):
 * - 在 system message 末尾追加 "Output MUST be in {Language}" 强约束,
 *   防止 LLM 在 user 选了 'de' 时仍返回英文 passage (Run 3/4 E2E bug).
 * - user prompt 顶部也加 "Target language: {code} (MUST be in {Language})",
 *   双保险.
 */
export function buildPassagePrompt(
  language: Language,
  difficulty: DifficultyLevel,
  dueCards: Pick<MemoryCard, 'lemma'>[] = []
): { system: string; prompt: string; expectJson: true } {
  const reviewWords = dueCards
    .map((c) => c.lemma)
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

  // Stage 4 hotfix P1-B: 强约束 language 输出, 防止 LLM 自由发挥.
  // v1.2.0 Stage 4 hotfix-2 加固: system 模板里已含 few-shot + CRITICAL.
  // 不再在 buildPassagePrompt 里追加, 避免重复 token.
  const system = PASSAGE_GENERATION_PROMPT_SYSTEM({ language });

  return {
    system,
    prompt: PASSAGE_GENERATION_PROMPT_USER({
      language,
      difficulty,
      reviewWords,
    }),
    expectJson: true,
  };
}

// =====================================================================
// Grammar Detection Prompt V2 (Stage 1 新增)
// =====================================================================

/**
 * 语法点检测系统提示 V2
 *
 * 与 passage prompt 同源思想: id 是 string, offsets 严格基于 text 字符偏移,
 * grammar point 的 text 字段必须能在 passage text 中找到 (作为连续子串).
 */
export const GRAMMAR_DETECTION_PROMPT_SYSTEM = `You are a language-learning content analyzer.
Given a reading passage in English or German, you identify grammar points
(verb tenses, modal verbs, subordinate clauses, conditionals, articles,
case markers, separable verbs, etc.) that are worth highlighting for a learner.

Hard rules:
1. Output JSON only (no markdown, no commentary, no code fences). Single valid JSON object.
2. The "text" field of every grammar point MUST be a real, continuous substring of the input passage
   (case-sensitive match preferred). If you cannot find an exact case match,
   pick the closest substring that appears verbatim in the passage and explain in "explanation".
3. startIndex / endIndex of every grammar point MUST be character offsets
   in the input passage (the same text the user passes in). "\\n" and "\\n\\n"
   count as 1 and 2 characters respectively. Use 0-based indexing; endIndex is exclusive.
4. Each grammar point MUST include an "id" field whose value is a STRING
   (UUID-like format, e.g. "g_3a7b9c2e"). Never use a number for "id".
5. Pick 3-6 grammar points that are useful for the target difficulty level.
   Do not pick trivial single words; focus on multi-word patterns or
   inflection / agreement / clause-structure phenomena.
6. "language" and "difficulty" fields must be echoed back unchanged.
7. "type" is a short label (e.g. "present_perfect", "modal_verb",
   "subordinate_clause", "dative_case", "separable_verb").
8. "explanation" is a short Chinese sentence (≤ 40 characters) explaining
   the rule, e.g. "现在完成时, 表示过去发生且与现在有关".
9. "examples" is an array of 1-2 short example sentences (in the target language)
   that demonstrate the same grammar point. Do NOT need to be from the passage.
10. Do NOT include markdown characters in any field.`;

/**
 * 语法点检测 few-shot 对齐示例
 */
const GRAMMAR_FEW_SHOT_EXAMPLE = `Example input passage:
"Anna woke up early. The sun had just risen behind the hills.\\n\\nShe walked to the kitchen and poured herself a cup of coffee."

Example output:
{
  "language": "en",
  "difficulty": 2,
  "grammarPoints": [
    {
      "id": "g_001",
      "text": "had just risen",
      "type": "past_perfect",
      "difficulty": 2,
      "explanation": "过去完成时, 表示在过去某时之前已完成的动作",
      "examples": [
        "By the time I arrived, the train had left.",
        "She had finished her homework before dinner."
      ],
      "startIndex": 24,
      "endIndex": 38
    },
    {
      "id": "g_002",
      "text": "poured herself",
      "type": "reflexive_verb",
      "difficulty": 2,
      "explanation": "反身代词, 主语和宾语为同一人",
      "examples": [
        "He hurt himself while playing.",
        "They enjoyed themselves at the party."
      ],
      "startIndex": 84,
      "endIndex": 98
    }
  ]
}

In the example above:
- "had just risen" appears at passage.substring(24, 38) — exactly.
- "poured herself" appears at passage.substring(84, 98) — exactly.
- Both grammar points have STRING ids.
- offsets count the "\\n\\n" separator as 2 characters.`;

export interface GrammarDetectionInput {
  language: Language;
  difficulty: DifficultyLevel;
  text: string;
}

/**
 * 语法点检测 user prompt V2
 */
export const GRAMMAR_DETECTION_PROMPT_USER = (params: GrammarDetectionInput) => {
  const { language, difficulty, text } = params;
  return `Detect grammar points in the following passage.

Language: ${describeLanguage(language)}
Difficulty level: ${difficulty} (1=beginner, 5=academic).

Passage (note: \\n\\n marks paragraph boundaries):
---
${text}
---

Required output shape (output EXACTLY this JSON object, no other text):
{
  "language": "${language}",
  "difficulty": ${difficulty},
  "grammarPoints": [
    {
      "id": "<UUID-like string, e.g. g_xxxxxxxx>",
      "text": "<continuous substring from the passage above>",
      "type": "<short label, e.g. past_perfect, modal_verb>",
      "difficulty": ${difficulty},
      "explanation": "<one short Chinese sentence, ≤ 40 chars>",
      "examples": ["<example sentence 1>", "<example sentence 2>"],
      "startIndex": <integer offset in the passage>,
      "endIndex": <integer offset in the passage, exclusive>
    }
  ]
}

${GRAMMAR_FEW_SHOT_EXAMPLE}

MANDATORY self-check (run this on your own output before returning):
1. The response is a single valid JSON object (no markdown fences, no prose around it).
2. Every grammar point has a STRING id (e.g. "g_abc123"), never a number.
3. For every grammar point: passage.substring(startIndex, endIndex) === text (case-sensitive).
4. If the exact case-sensitive substring is not found, pick the first
   case-insensitive occurrence and add a note in "explanation".
5. startIndex >= 0 and endIndex <= passage.length for every point.
6. At least 3 grammar points; at most 6.
7. "language" === "${language}" and "difficulty" === ${difficulty}.

If any check fails, REGENERATE the output until all checks pass.`;
};

/**
 * 便捷函数: 返回 grammar detection prompt
 */
export function buildGrammarDetectionPrompt(
  language: Language,
  difficulty: DifficultyLevel,
  text: string
): { system: string; prompt: string; expectJson: true } {
  return {
    system: GRAMMAR_DETECTION_PROMPT_SYSTEM,
    prompt: GRAMMAR_DETECTION_PROMPT_USER({ language, difficulty, text }),
    expectJson: true,
  };
}
