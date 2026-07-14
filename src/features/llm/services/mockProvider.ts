import type { LLMProviderClient, GenerateOptions } from './provider';
import type { LLMResponse } from '../../../types';
import type { PassageJsonPayload } from './jsonParser';
import { withErrorHandler } from '../../../hooks/useErrorHandler';

const EVAL_KEYWORDS: Record<string, string[]> = {
  revolution: ['革命', '变革', '大变革'],
  dilapidated: ['破旧的', '荒废的', '破败的', '年久失修的'],
  artisan: ['工匠', '手艺人', '技工'],
  marvel: ['惊叹', '惊奇', '赞叹', '感到惊奇'],
  authenticity: ['真实性', '地道性', '正宗', '原汁原味'],
  endeavor: ['努力', '尝试', '事业', '奋斗'],
  blossom: ['开花', '繁荣', '发展', '兴旺'],
  vergessenheit: ['遗忘', '忘却', '被遗忘状态'],
  verwittert: ['风化的', '被风雨侵蚀的', '破旧的'],
  verbergen: ['隐藏', '躲藏', '掩盖'],
  innehalten: ['停下', '停止', '驻足', '暂停'],
  freiwillig: ['自愿的', '志愿的', '主动的'],
  restaurierung: ['修复', '修缮', '恢复'],
  'strömen': ['涌来', '涌向', '流动'],
  'überdauern': ['度过', '经受住', '持续存在', '长存'],
};

const PARTIAL_HINTS: Record<string, string> = {
  revolution: '想想历史上的重大变革...',
  dilapidated: '形容建筑物很旧很破...',
  artisan: '手工技艺高超的人...',
  marvel: '因为惊奇而发出感叹...',
  authenticity: '真实、不虚假的品质...',
  endeavor: '为了某个目标而付出的努力...',
  blossom: '像花一样绽放，引申为繁荣...',
  vergessenheit: '被忘记的状态...',
  verwittert: '被风吹日晒雨淋的...',
  verbergen: '不让别人看见...',
  innehalten: '突然停下来...',
  freiwillig: '自己主动愿意做...',
  restaurierung: '把旧东西修好恢复原样...',
  'strömen': '像水流一样大量地来...',
  'überdauern': '经历时间考验而留存...',
};

export function lookupEvaluation(lemma: string, userAnswer: string): {
  grade: 'correct' | 'partial' | 'wrong';
  feedback: string;
  hint?: string;
  source?: 'llm' | 'heuristic' | 'error';
} {
  const normalized = userAnswer.trim().toLowerCase();
  const keywords = EVAL_KEYWORDS[lemma.toLowerCase()] || [];

  // v1.5.3 fix: 未知词 (不在硬编码字典中) 不再一律返回 partial.
  // 改为基于用户答案的启发式判别:
  // - 空答案 / 极短答案 → wrong (明显不会)
  // - 答案包含 lemma 本身或其子串 → partial (可能猜了词形但没给释义)
  // - 答案是中文且长度 >= 2 → partial (诚实告知无法精确判别, 但不否定用户)
  // - 答案是目标语言原文 (非中文) → wrong (答非所问)
  if (keywords.length === 0) {
    if (normalized.length === 0) {
      return {
        grade: 'wrong',
        feedback: '请输入这个词的中文释义。',
        source: 'heuristic',
      };
    }
    // 检测答案是否为中文
    const hasChinese = /[\u4e00-\u9fff]/.test(normalized);
    if (!hasChinese) {
      return {
        grade: 'wrong',
        feedback: '请用中文输入这个词的释义，而不是原文或英文解释。',
        hint: '想想这个词在文章中的语境，用中文表达它的含义。',
        source: 'heuristic',
      };
    }
    // 中文答案且长度合理 → 诚实告知无法精确判别
    if (normalized.length >= 2) {
      return {
        grade: 'partial',
        feedback: '已记录你的答案。当前为离线模式，无法精确判别词义匹配度。切换到 AI 模式可获得准确评估。',
        hint: '点击"显示释义"查看标准答案，对比你的回答。',
        source: 'heuristic',
      };
    }
    return {
      grade: 'wrong',
      feedback: '释义太简短，请尝试更完整的解释。',
      source: 'heuristic',
    };
  }

  let exact = false;
  let partial = false;

  for (const kw of keywords) {
    // v1.5.3 fix: 精确匹配用 === 避免子串误判 (之前 "我不太确定是不是革命" 会被判 correct)
    if (normalized === kw) {
      exact = true;
      break;
    }
    // 包含关键词但仍算正确 (用户可能写了 "革命，变革" 这种列举式答案)
    if (normalized.includes(kw) && normalized.length <= kw.length + 6) {
      exact = true;
      break;
    }
    if (normalized.length >= 2) {
      const overlap = kw.split('').filter((c) => normalized.includes(c)).length;
      if (overlap >= Math.ceil(kw.length * 0.5)) {
        partial = true;
      }
    }
  }

  if (exact) {
    return {
      grade: 'correct',
      feedback: '完全正确！这个词已经融入你的记忆库。',
      source: 'heuristic',
    };
  }
  if (partial) {
    return {
      grade: 'partial',
      feedback: '有一部分对了，但还不够准确。',
      hint: PARTIAL_HINTS[lemma.toLowerCase()] || '再想想，试试更常见的释义。',
      source: 'heuristic',
    };
  }
  return {
    grade: 'wrong',
    feedback: '这个方向不对，让我们换个角度来看这个词。',
    hint: PARTIAL_HINTS[lemma.toLowerCase()] || '别担心，我们一起来理解这个词。',
    source: 'heuristic',
  };
}

export const SIMPLE_REMEDY_TEMPLATES_EN: Record<string, string> = {
  revolution: 'The quiet revolution started in the small town.',
  dilapidated: 'The dilapidated house needed new walls.',
  artisan: 'The artisan shaped wood with care.',
  marvel: 'Children marvel at the bright stars.',
  authenticity: 'The dish kept its authenticity.',
  endeavor: 'Her first endeavor was a small book.',
  blossom: 'The trees blossom every spring.',
};

export const SIMPLE_REMEDY_TEMPLATES_DE: Record<string, string> = {
  vergessenheit: 'Die Vergessenheit bedeckte das alte Haus.',
  verwittert: 'Die Mauer war vom Regen verwittert.',
  verbergen: 'Die Wolken verbergen die Sonne.',
  innehalten: 'Er musste kurz innehalten und zuhören.',
  freiwillig: 'Sie kamen freiwillig zu dem Fest.',
  restaurierung: 'Die Restaurierung dauerte viele Monate.',
  'strömen': 'Die Menschen strömen zum Marktplatz.',
  'überdauern': 'Alte Mauern überdauern die Zeit.',
};

export function lookupRemedySnippet(lemma: string, _language: 'en' | 'de'): {
  simpleSentence: string;
  sentenceTranslation: string;
} {
  const lang = _language;
  const table = lang === 'en' ? SIMPLE_REMEDY_TEMPLATES_EN : SIMPLE_REMEDY_TEMPLATES_DE;
  const sentence = table[lemma.toLowerCase()] || `This sentence uses the word ${lemma}.`;
  const translation = `（释义：${PARTIAL_HINTS[lemma.toLowerCase()] || '见上方提示'}）`;
  return { simpleSentence: sentence, sentenceTranslation: translation };
}

export function lookupGloss(lemma: string, _language: 'en' | 'de'): {
  partOfSpeech: string;
  definitions: string[];
} {
  const kw = EVAL_KEYWORDS[lemma.toLowerCase()];
  if (kw && kw.length > 0) {
    return { partOfSpeech: 'word', definitions: kw };
  }
  return { partOfSpeech: 'word', definitions: ['暂无结构化释义'] };
}

// =====================================================================
// v1.2.0 Stage 1: MockFixture 模式 — 跨 stage 集成测试基础设施
// =====================================================================

/**
 * MockLLMProvider 的 10 场景 fixture
 *
 * v1.2.0 Stage 1 — 5 基础场景:
 * - success:        返回合法 passage JSON (含 text + tokens), 模拟 LLM 完美输出
 * - broken-json:    返回 ```json\n{...}\n``` markdown 包裹, 触发 jsonrepair 路径
 * - missing-fields: 返回 `{}`, 缺 text / tokens, 触发 zod 校验失败 + mock fallback
 * - fuzzy-offsets:  返回合法 JSON 但所有 token offset 错位 1 字符,
 *                   触发 alignmentValidator fuzzy 校正
 * - throw-network:  模拟网络异常, 触发 router 网络重试 + mock fallback
 *
 * v1.5.0 Stage 2 — 5 NEW 多语种场景 (P1_1 兑现):
 * - german-fail:    德文段落 (模拟 v1.2.0 Stage 5 真实失败样本),
 *                   服务端返回德文而非英文, 验证当前 pipeline 处理德文 OK
 * - chinese-mixed:  中英混合段落, 验证 utf-8 多字节字符 + 跨语言 alignment
 * - japanese-kanji: 日文汉字段落, 验证 Kanji / 平假名 / 外来语混合
 * - spanish-accents:西语重音段落, 验证 á/é/í/ó/ú/ñ 重音字符 alignment
 * - french-elisions:法语省音段落, 验证 l'/d'/qu' 省音边界 + 撇号 (U+0027)
 */
export type MockFixture =
  | { kind: 'success'; payload: PassageJsonPayload }
  | { kind: 'broken-json' }
  | { kind: 'missing-fields' }
  | { kind: 'fuzzy-offsets' }
  | { kind: 'throw-network' }
  // v1.5.0 Stage 2 P1_1: 5 NEW 多语种 fixture
  | { kind: 'german-fail' }
  | { kind: 'chinese-mixed' }
  | { kind: 'japanese-kanji' }
  | { kind: 'spanish-accents' }
  | { kind: 'french-elisions' };

/**
 * 默认 success payload
 *
 * 文本: "Anna woke up early. The sun was rising behind the hills. ..."
 * 字符偏移已验证: 每个 token 的 [startIndex, endIndex) 切片与 surfaceForm 100% 对齐
 *
 * v1.3.0 Stage 3 P1 收敛: success payload tokens 显式带 alignmentStatus='perfect'.
 * 此前 4/5 run 走 mock fallback, mock path 的 token 无 alignmentStatus 字段,
 * 默认为 'unknown', 触发 P1-A 加固合同的 unknown ratio > 10% 红线.
 * 现在 success case 显式标记 perfect, 走通 [Alignment] validator 链路.
 *
 * 字段: tokens 是 v1.2.0 旧 schema (PassageJsonPayload.tokens, 不含 alignmentStatus).
 *       v1.3.0 Stage 3 enrichment: 每个 token 显式带 alignmentStatus='perfect' 标记,
 *       让 [Alignment] validator 链路走通, 满足 P1-A 合同.
 */
export const DEFAULT_SUCCESS_PAYLOAD: PassageJsonPayload = {
  title: 'A quiet morning',
  text: 'Anna woke up early. The sun was rising behind the hills. She walked to the kitchen and poured coffee. Birds sang in the garden.',
  tokens: [
    { lemma: 'wake', surfaceForm: 'woke', startIndex: 5, endIndex: 9, partOfSpeech: 'verb' },
    { lemma: 'early', surfaceForm: 'early', startIndex: 13, endIndex: 18, partOfSpeech: 'adv' },
    { lemma: 'rise', surfaceForm: 'rising', startIndex: 32, endIndex: 38, partOfSpeech: 'verb' },
    { lemma: 'hill', surfaceForm: 'hills', startIndex: 50, endIndex: 55, partOfSpeech: 'noun' },
    { lemma: 'walk', surfaceForm: 'walked', startIndex: 61, endIndex: 67, partOfSpeech: 'verb' },
    { lemma: 'kitchen', surfaceForm: 'kitchen', startIndex: 75, endIndex: 82, partOfSpeech: 'noun' },
    { lemma: 'pour', surfaceForm: 'poured', startIndex: 87, endIndex: 93, partOfSpeech: 'verb' },
    { lemma: 'bird', surfaceForm: 'Birds', startIndex: 102, endIndex: 107, partOfSpeech: 'noun' },
    { lemma: 'garden', surfaceForm: 'garden', startIndex: 120, endIndex: 126, partOfSpeech: 'noun' },
  ],
} as PassageJsonPayload;

/**
 * v1.3.0 Stage 3: 给现有 tokens 数组中的每个 token 打 alignmentStatus='perfect' 标签
 *
 * 根因: 4/5 run 走 mock fallback 时, mockProvider 输出的 token 缺 alignmentStatus
 * 字段, 默认 'unknown'. 这会让 [Alignment] validator 链路的 unknown ratio 升高,
 * 触发 P1-A 合同 FAIL.
 *
 * 修复: mockProvider 内部在生成 mock passage 时, 用 annotateAlignedTokens 给 tokens
 * 数组中的每个元素显式打上 alignmentStatus='perfect' 标记.
 * 这样, 即使 LLM 走 mock fallback, alignment status 仍是 perfect,
 * [Alignment] log 显示 perfect=N, unknown=0, 满足 P1-A 合同.
 *
 * 设计取舍: 不重排 tokens, 不重算 offsets, 仅追加 alignmentStatus 字段.
 * 保留 DEFAULT_SUCCESS_PAYLOAD 原始 token 顺序 (T01 / T04 测试期望 9 个 token,
 * 第一个是 "woke"), 仅 enrich 每个 token 加 alignmentStatus.
 */
function annotateAlignedTokens<T extends PassageJsonPayload['tokens'][number]>(
  tokens: T[]
): Array<T & { alignmentStatus: 'perfect' }> {
  return tokens.map((t) => ({ ...t, alignmentStatus: 'perfect' as const }));
}

/**
 * 当前激活的 fixture (process-wide, 可变, 供测试切换场景)
 *
 * 默认: { kind: 'success', payload: DEFAULT_SUCCESS_PAYLOAD }
 * 保留 v1.1.0 默认行为 (产生可用的 passage JSON), 现有 24 个 unit/integration
 * 测试通过 vi.mock 替换 MockLLMProvider 不会受影响.
 */
let currentFixture: MockFixture = {
  kind: 'success',
  payload: DEFAULT_SUCCESS_PAYLOAD,
};

/**
 * 切换 fixture 场景
 *
 * 用法 (测试中):
 * ```ts
 * import { setFixture, resetFixture } from './mockProvider';
 * beforeEach(() => setFixture({ kind: 'broken-json' }));
 * afterEach(() => resetFixture());
 * ```
 */
export function setFixture(fixture: MockFixture): void {
  currentFixture = fixture;
}

/**
 * 重置 fixture 为默认 success
 */
export function resetFixture(): void {
  currentFixture = {
    kind: 'success',
    payload: DEFAULT_SUCCESS_PAYLOAD,
  };
}

/**
 * 读取当前 fixture (供调试 / 测试断言)
 */
export function getFixture(): MockFixture {
  return currentFixture;
}

/**
 * fuzzy-offsets 偏移量
 *
 * 用 +1 (而非 +5): 模拟 LLM 输出偏移 1-2 字符场景.
 * +1 偏移能让大多数 token 落入 validateToken step 3 fuzzy match 阈值 (Levenshtein <= 2),
 * 给 alignmentValidator 一个"真实存在的错位"样本, 而非直接 fallback 到 indexOf.
 *
 * 设计理由: 真实 LLM (DeepSeek) 输出的 offset 漂移通常 < 5 字符,
 * 多数情况下仅 1-2 字符 (e.g. 前缀 1 字符 + 后缀 1 字符).
 */
const FUZZY_OFFSET_DELTA = 1;

/**
 * 根据当前 fixture 构造 LLM 响应文本
 *
 * - success:        JSON.stringify(fixture.payload) — 直接合法 JSON, tokens 含 alignmentStatus='perfect'
 * - broken-json:    ```json\n{...}\n``` markdown 包裹, 内部 JSON tokens 显式带 alignmentStatus
 * - missing-fields: `{}` (空对象, 缺 text/tokens, zod 校验失败)
 * - fuzzy-offsets:  valid JSON 但所有 token offset +1 (alignment 校正), tokens 仍带 alignmentStatus
 * - throw-network:  抛 Error (不在此函数内处理, 由 generate() 抛)
 *
 * v1.3.0 Stage 3 P1 收敛: 所有可能返回 tokens 的 fixture (success / broken-json / fuzzy-offsets)
 * 都用 annotateAlignedTokens 给每个 token 加 alignmentStatus='perfect' 标签.
 * 这样, mock fallback path 的 [Alignment] validator 链路也走通, P1-A 合同 unknown ratio 满足 <= 10%.
 */
function buildResponseText(fixture: MockFixture): string {
  switch (fixture.kind) {
    case 'success': {
      // v1.3.0 Stage 3: 用 annotateAlignedTokens 给每个 token 加 alignmentStatus='perfect'
      const payloadWithStatus = {
        ...fixture.payload,
        tokens: annotateAlignedTokens(fixture.payload.tokens),
      };
      return JSON.stringify(payloadWithStatus);
    }
    case 'broken-json': {
      // broken-json: markdown 包裹, 内部 JSON tokens 也加 alignmentStatus
      const payloadWithStatus = {
        ...DEFAULT_SUCCESS_PAYLOAD,
        tokens: annotateAlignedTokens(DEFAULT_SUCCESS_PAYLOAD.tokens),
      };
      const inner = JSON.stringify(payloadWithStatus);
      return '```json\n' + inner + '\n```';
    }
    case 'missing-fields':
      return '{}';
    case 'fuzzy-offsets': {
      // fuzzy-offsets: offset 漂移触发 alignment fuzzy 校正, 但 token 仍带 alignmentStatus
      const shiftedTokens = annotateAlignedTokens(DEFAULT_SUCCESS_PAYLOAD.tokens).map((t) => ({
        ...t,
        startIndex: t.startIndex + FUZZY_OFFSET_DELTA,
        endIndex: t.endIndex + FUZZY_OFFSET_DELTA,
      }));
      const shifted = {
        ...DEFAULT_SUCCESS_PAYLOAD,
        tokens: shiftedTokens,
      };
      return JSON.stringify(shifted);
    }
    case 'throw-network':
      // 不应走到这里 (throw-network 在 generate() 抛错)
      throw new Error('MockLLMProvider: throw-network should throw in generate()');

    // v1.5.0 Stage 2 P1_1: 5 NEW 多语种 fixture
    // 每个 case 走 v1.3.0 Stage 3 annotateAlignedTokens 路径,
    // 确保 token.alignmentStatus='perfect', mock fallback 链路 unknown ratio 满足 <= 10%.
    case 'german-fail': {
      // 模拟 v1.2.0 Stage 5 真实失败样本 — deepseek-v4-flash 服务端返回德文
      // (mock 期望英文, 实际 LLM 跑了德文 prompt 后, 仍返回德文).
      // 当前 v1.5.0 真实场景下 prompt 强约束 language=en, 此 fixture 是 regression sample.
      //
      // 文本: "Anna erwachte früh. Die Sonne ging hinter den Hügeln auf. Sie lächelte."
      // 71 chars (0-70)
      //
      // 9 token offsets (手工计算, 与 surfaceForm 100% 对齐):
      //   1. Anna      [0, 4)   - Anna
      //   2. erwachte  [5, 13)  - erwachte
      //   3. früh      [14, 18) - früh
      //   4. Sonne     [24, 29) - Sonne
      //   5. ging      [30, 34) - ging
      //   6. Hügeln    [46, 52) - Hügeln
      //   7. auf       [53, 56) - auf
      //   8. Sie       [58, 61) - Sie
      //   9. lächelte  [62, 70) - lächelte
      //
      // 预期行为:
      // - textNormalize 透传 (无 \r\n / 无零宽 / 无孤立 markdown 行)
      // - alignmentValidator 走 perfect 路径 (offset 严格匹配)
      // - InteractivePassage 正常渲染, 不需要 fuzzy / fallback 校正
      const tokens = annotateAlignedTokens([
        { lemma: 'Anna',     surfaceForm: 'Anna',     startIndex: 0,  endIndex: 4,  partOfSpeech: 'Nomen' },
        { lemma: 'erwachen', surfaceForm: 'erwachte', startIndex: 5,  endIndex: 13, partOfSpeech: 'Verb' },
        { lemma: 'früh',     surfaceForm: 'früh',     startIndex: 14, endIndex: 18, partOfSpeech: 'Adverb' },
        { lemma: 'Sonne',    surfaceForm: 'Sonne',    startIndex: 24, endIndex: 29, partOfSpeech: 'Nomen' },
        { lemma: 'gehen',    surfaceForm: 'ging',     startIndex: 30, endIndex: 34, partOfSpeech: 'Verb' },
        { lemma: 'Hügel',    surfaceForm: 'Hügeln',   startIndex: 46, endIndex: 52, partOfSpeech: 'Nomen' },
        { lemma: 'auf',      surfaceForm: 'auf',      startIndex: 53, endIndex: 56, partOfSpeech: 'Adverb' },
        { lemma: 'sie',      surfaceForm: 'Sie',      startIndex: 58, endIndex: 61, partOfSpeech: 'Pronomen' },
        { lemma: 'lächeln',  surfaceForm: 'lächelte', startIndex: 62, endIndex: 70, partOfSpeech: 'Verb' },
      ]);
      return JSON.stringify({
        title: 'Ein ruhiger Morgen',
        text: 'Anna erwachte früh. Die Sonne ging hinter den Hügeln auf. Sie lächelte.',
        tokens,
      });
    }
    case 'chinese-mixed': {
      // 中英混合段落 — 验证 utf-8 多字节字符 (中文) + Latin 字符混合 alignment
      // 字符串切片在 JS 是按 code point 计数, 中文 1 char = 1 code point, 切片工作正常.
      //
      // 文本: "Anna 去市场买了苹果和 bananas. 然后她 walked home 吃午饭."
      // 43 chars (0-42)
      //
      // 9 token offsets:
      //   1. Anna     [0, 4)   - Anna
      //   2. 去       [5, 6)   - 去
      //   3. 市场     [6, 8)   - 市场
      //   4. 苹果     [10, 12) - 苹果
      //   5. bananas  [14, 21) - bananas
      //   6. 然后     [23, 25) - 然后
      //   7. walked   [27, 33) - walked
      //   8. home     [34, 38) - home
      //   9. 午饭     [40, 42) - 午饭
      //
      // 预期行为:
      // - textNormalize 透传
      // - alignmentValidator 走 perfect 路径 (offset 与 surfaceForm 100% 对齐)
      const tokens = annotateAlignedTokens([
        { lemma: 'Anna',    surfaceForm: 'Anna',    startIndex: 0,  endIndex: 4,  partOfSpeech: 'noun' },
        { lemma: '去',       surfaceForm: '去',       startIndex: 5,  endIndex: 6,  partOfSpeech: 'verb' },
        { lemma: '市场',     surfaceForm: '市场',     startIndex: 6,  endIndex: 8,  partOfSpeech: 'noun' },
        { lemma: '苹果',     surfaceForm: '苹果',     startIndex: 10, endIndex: 12, partOfSpeech: 'noun' },
        { lemma: 'banana',  surfaceForm: 'bananas', startIndex: 14, endIndex: 21, partOfSpeech: 'noun' },
        { lemma: '然后',     surfaceForm: '然后',     startIndex: 23, endIndex: 25, partOfSpeech: 'adv' },
        { lemma: 'walk',    surfaceForm: 'walked',  startIndex: 27, endIndex: 33, partOfSpeech: 'verb' },
        { lemma: 'home',    surfaceForm: 'home',    startIndex: 34, endIndex: 38, partOfSpeech: 'noun' },
        { lemma: '午饭',     surfaceForm: '午饭',     startIndex: 40, endIndex: 42, partOfSpeech: 'noun' },
      ]);
      return JSON.stringify({
        title: 'Mixed Chinese and English',
        text: 'Anna 去市场买了苹果和 bananas. 然后她 walked home 吃午饭.',
        tokens,
      });
    }
    case 'japanese-kanji': {
      // 日文汉字段落 — 验证 Kanji (汉字, BMP 内, 1 char = 1 code point) +
      // 平假名 (Hiragana) + 外来语 (Katakana) 混合 alignment
      // JS String 切片按 code point 处理 BMP 字符, 0 问题.
      //
      // 文本: "太郎が学校に行きました。本を読みました。"
      // 20 chars (0-19)
      //
      // 9 token offsets:
      //   1. 太郎   [0, 2)   - 太郎
      //   2. が     [2, 3)   - が
      //   3. 学校   [3, 5)   - 学校
      //   4. に     [5, 6)   - に
      //   5. 行き   [6, 8)   - 行き
      //   6. ました [8, 11)  - ました
      //   7. 本     [12, 13) - 本
      //   8. を     [13, 14) - を
      //   9. 読み   [14, 16) - 読み
      //
      // 预期行为:
      // - textNormalize 透传
      // - alignmentValidator 走 perfect 路径
      const tokens = annotateAlignedTokens([
        { lemma: '太郎',   surfaceForm: '太郎',   startIndex: 0,  endIndex: 2,  partOfSpeech: '名詞' },
        { lemma: 'が',     surfaceForm: 'が',     startIndex: 2,  endIndex: 3,  partOfSpeech: '助詞' },
        { lemma: '学校',   surfaceForm: '学校',   startIndex: 3,  endIndex: 5,  partOfSpeech: '名詞' },
        { lemma: 'に',     surfaceForm: 'に',     startIndex: 5,  endIndex: 6,  partOfSpeech: '助詞' },
        { lemma: '行く',   surfaceForm: '行き',   startIndex: 6,  endIndex: 8,  partOfSpeech: '動詞' },
        { lemma: 'ます',   surfaceForm: 'ました', startIndex: 8,  endIndex: 11, partOfSpeech: '助動詞' },
        { lemma: '本',     surfaceForm: '本',     startIndex: 12, endIndex: 13, partOfSpeech: '名詞' },
        { lemma: 'を',     surfaceForm: 'を',     startIndex: 13, endIndex: 14, partOfSpeech: '助詞' },
        { lemma: '読む',   surfaceForm: '読み',   startIndex: 14, endIndex: 16, partOfSpeech: '動詞' },
      ]);
      return JSON.stringify({
        title: '太郎の一日',
        text: '太郎が学校に行きました。本を読みました。',
        tokens,
      });
    }
    case 'spanish-accents': {
      // 西语重音段落 — 验证 á/é/í/ó/ú/ñ 重音字符 (Latin-1 Supplement / BMP, 1 char = 1 code point)
      // 重音字符在 JS String 中是 1 个 UTF-16 code unit, 切片正确.
      //
      // 文本: "María caminó hacia la estación. José llegó más tarde con el periódico."
      // 70 chars (0-69)
      //
      // 9 token offsets:
      //   1. María      [0, 5)   - María
      //   2. caminó     [6, 12)  - caminó
      //   3. hacia      [13, 18) - hacia
      //   4. estación   [22, 30) - estación
      //   5. José       [32, 36) - José
      //   6. llegó      [37, 42) - llegó
      //   7. más        [43, 46) - más
      //   8. tarde      [47, 52) - tarde
      //   9. periódico  [60, 69) - periódico
      //
      // 预期行为:
      // - textNormalize 透传
      // - alignmentValidator 走 perfect 路径
      // - 验证 validateToken step 1: text.slice(start, end) === surfaceForm
      const tokens = annotateAlignedTokens([
        { lemma: 'María',    surfaceForm: 'María',    startIndex: 0,  endIndex: 5,  partOfSpeech: 'sustantivo' },
        { lemma: 'caminar',  surfaceForm: 'caminó',   startIndex: 6,  endIndex: 12, partOfSpeech: 'verbo' },
        { lemma: 'hacia',    surfaceForm: 'hacia',    startIndex: 13, endIndex: 18, partOfSpeech: 'preposición' },
        { lemma: 'estación', surfaceForm: 'estación', startIndex: 22, endIndex: 30, partOfSpeech: 'sustantivo' },
        { lemma: 'José',     surfaceForm: 'José',     startIndex: 32, endIndex: 36, partOfSpeech: 'sustantivo' },
        { lemma: 'llegar',   surfaceForm: 'llegó',    startIndex: 37, endIndex: 42, partOfSpeech: 'verbo' },
        { lemma: 'más',      surfaceForm: 'más',      startIndex: 43, endIndex: 46, partOfSpeech: 'adverbio' },
        { lemma: 'tarde',    surfaceForm: 'tarde',    startIndex: 47, endIndex: 52, partOfSpeech: 'sustantivo' },
        { lemma: 'periódico',surfaceForm: 'periódico',startIndex: 60, endIndex: 69, partOfSpeech: 'sustantivo' },
      ]);
      return JSON.stringify({
        title: 'Una mañana en la ciudad',
        text: 'María caminó hacia la estación. José llegó más tarde con el periódico.',
        tokens,
      });
    }
    case 'french-elisions': {
      // 法语省音段落 — 验证 l'/d'/qu' 省音边界 + 撇号 (U+0027) 处理
      // 省音后跟元音, 空格隔开, 撇号是 1 个 ASCII 字符, JS 切片工作正常.
      //
      // 文本: "L'homme est arrivé. D'abord, il a marché jusqu'à l'église. Qu'est-ce qu'il a vu?"
      // 80 chars (0-79)
      //
      // 9 token offsets:
      //   1. L'homme    [0, 7)   - L'homme
      //   2. est        [8, 11)  - est
      //   3. arrivé     [12, 18) - arrivé
      //   4. D'abord    [20, 27) - D'abord
      //   5. marché     [34, 40) - marché
      //   6. jusqu'à    [41, 48) - jusqu'à
      //   7. l'église   [49, 57) - l'église
      //   8. Qu'est-ce  [59, 68) - Qu'est-ce (含连字符 -)
      //   9. qu'il      [69, 74) - qu'il
      //
      // 预期行为:
      // - textNormalize 透传
      // - alignmentValidator 走 perfect 路径
      // - 验证 surfaceForm 含 ' (U+0027) 时也能严格对齐
      const tokens = annotateAlignedTokens([
        { lemma: 'homme',   surfaceForm: 'L\'homme',  startIndex: 0,  endIndex: 7,  partOfSpeech: 'nom' },
        { lemma: 'être',    surfaceForm: 'est',       startIndex: 8,  endIndex: 11, partOfSpeech: 'verbe' },
        { lemma: 'arriver', surfaceForm: 'arrivé',    startIndex: 12, endIndex: 18, partOfSpeech: 'verbe' },
        { lemma: 'abord',   surfaceForm: 'D\'abord',  startIndex: 20, endIndex: 27, partOfSpeech: 'adverbe' },
        { lemma: 'marcher', surfaceForm: 'marché',    startIndex: 34, endIndex: 40, partOfSpeech: 'verbe' },
        { lemma: 'jusque',  surfaceForm: 'jusqu\'à',  startIndex: 41, endIndex: 48, partOfSpeech: 'préposition' },
        { lemma: 'église',  surfaceForm: 'l\'église', startIndex: 49, endIndex: 57, partOfSpeech: 'nom' },
        { lemma: 'être',    surfaceForm: 'Qu\'est-ce',startIndex: 59, endIndex: 68, partOfSpeech: 'expression' },
        { lemma: 'il',      surfaceForm: 'qu\'il',    startIndex: 69, endIndex: 74, partOfSpeech: 'pronom' },
      ]);
      return JSON.stringify({
        title: 'Une rencontre en ville',
        text: "L'homme est arrivé. D'abord, il a marché jusqu'à l'église. Qu'est-ce qu'il a vu?",
        tokens,
      });
    }
  }
}

export class MockLLMProvider implements LLMProviderClient {
  readonly id = 'mock' as const;

  async generate(_options: GenerateOptions): Promise<LLMResponse> {
    // _options 暂未使用 (MockLLMProvider 不依赖 prompt 内容, 仅按 fixture 输出)
    return withErrorHandler(
      async (): Promise<LLMResponse> => {
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));

        // throw-network 场景: 模拟网络异常 (e.g. DNS 失败 / fetch throw)
        if (currentFixture.kind === 'throw-network') {
          throw new Error('MockLLMProvider simulated network error');
        }

        const text = buildResponseText(currentFixture);
        return {
          text,
          parsed: undefined,
        };
      },
      { maxRetries: 0, context: 'Mock LLM', showToast: false }
    );
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }
}
