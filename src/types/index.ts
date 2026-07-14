/**
 * 语言类型
 * @enum {'en' | 'de'}
 */
export type Language = 'en' | 'de';

/**
 * 难度等级 (1-5)
 * @enum {1 | 2 | 3 | 4 | 5}
 */
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

/**
 * 词元出现记录
 * 表示文本中某个词汇的具体出现位置和状态
 */
export interface TokenOccurrence {
  /** 唯一标识符 */
  id: string;
  /** 所属词位组 ID */
  lexemeGroupId: string;
  /** 表面形式（原文中的实际词形） */
  surfaceForm: string;
  /** 词位（基础词形） */
  lemma: string;
  /** 客观难度等级 */
  objectiveDifficulty: DifficultyLevel;
  /** 在原文中的起始索引（0-based） */
  startIndex: number;
  /** 在原文中的结束索引（0-based，不包含） */
  endIndex: number;
  /** 是否已被用户解析/学习 */
  isResolved: boolean;
  /** 是否为当前激活状态 */
  isActive: boolean;
  /** 类型：普通词元或复习词元 */
  kind: 'normal' | 'review';
  /** 关联的记忆卡片 ID（可选） */
  cardId?: string;
  /** 是否为复习模式（可选） */
  isReview?: boolean;
  /** 是否为复合词 */
  isCompound: boolean;
  /** 复合词组成部分（可选） */
  compoundParts?: string[];
  /**
   * v1.2.0 Stage 4 hotfix: 对齐状态 (alignment status), 由 v1.1.0 alignmentValidator 写入.
   * - 'perfect': 原始 LLM 输出已完美对齐, 无需校正
   * - 'corrected': 通过 fuzzy 匹配后位置已校正
   * - 'fallback': 校正失败, 已重新搜索/使用最佳候选
   * - 'dropped': 仍无法定位, 该 token 已从渲染中隐藏 (兜底)
   * - 'unknown': alignment 阶段未拿到该 token 的结果 (e.g. mock / 兼容旧数据),
   *             InteractivePassage 视同 'perfect' 处理 (不显示 tooltip)
   */
  alignmentStatus?: 'perfect' | 'corrected' | 'fallback' | 'dropped' | 'unknown';
  /**
   * v1.2.0: 原始偏移量 (alignment status 校正前的字符位移).
   * 仅当 alignmentStatus 为 'corrected' / 'fallback' 时有值, 其它为 0.
   */
  originalOffset?: number;
}

/**
 * 词位组
 * 将同一词位的多个出现记录分组管理
 */
export interface LexemeGroup {
  /** 唯一标识符 */
  id: string;
  /** 词位（基础词形） */
  lemma: string;
  /** 客观难度等级 */
  objectiveDifficulty: DifficultyLevel;
  /** 关联的词元出现记录 ID 列表 */
  occurrences: string[];
}

/**
 * 语法知识点
 * 表示文本中识别出的语法结构和规则
 */
export interface GrammarPoint {
  /** 唯一标识符 */
  id: string;
  /** 语法点文本内容 */
  text: string;
  /** 语法类型分类 */
  type: string;
  /** 难度等级 */
  difficulty: DifficultyLevel;
  /** 详细解释（中文） */
  explanation: string;
  /** 例句列表 */
  examples: string[];
  /** 在原文中的起始索引 */
  startIndex: number;
  /** 在原文中的结束索引 */
  endIndex: number;
  /** 是否为当前激活状态 */
  isActive: boolean;
}

/**
 * 复合词组成部分
 */
export interface CompoundPart {
  /** 组成部分文本 */
  text: string;
  /** 含义解释 */
  meaning: string;
}

/**
 * 复合词解析结果
 */
export interface CompoundWord {
  /** 词位 */
  lemma: string;
  /** 组成部分列表 */
  parts: CompoundPart[];
  /** 词源说明（可选） */
  etymology?: string;
}

/**
 * 阅读文章
 * 包含文本内容、词元解析、语法点等完整阅读数据
 */
export interface Passage {
  /** 唯一标识符 */
  id: string;
  /** 语言类型 */
  language: Language;
  /** 难度等级 */
  difficulty: DifficultyLevel;
  /** 原文文本 */
  text: string;
  /** 文章标题（可选） */
  title?: string;
  /** 词元出现记录列表 */
  tokens: TokenOccurrence[];
  /** 词位组列表 */
  lexemeGroups: LexemeGroup[];
  /** 语法知识点列表 */
  grammarPoints: GrammarPoint[];
  /**
   * v2.2.0 Stage 1 (D4): 文章来源标签.
   * - 'llm': 由 LLM 真实生成
   * - 'mock': 演示数据 (LLM 不可用 / fallback)
   * - 'mixed': LLM 生成但部分字段 (如 grammarPoints) 来自 mock
   * undefined 表示旧数据, UI 视同 'mock' 处理 (保守显示).
   */
  source?: 'llm' | 'mock' | 'mixed';
}

/**
 * 答题评分等级
 * @enum {'correct' | 'partial' | 'wrong'}
 */
export type AnswerGrade = 'correct' | 'partial' | 'wrong';

/**
 * 答题评估结果
 */
export interface AnswerEvaluation {
  /** 评分等级 */
  grade: AnswerGrade;
  /** 反馈信息 */
  feedback: string;
  /** 提示信息（可选） */
  hint?: string;
  /** 评估来源 (v1.5.3: 诚实标注, 让用户知道反馈来自 LLM 还是启发式) */
  source?: 'llm' | 'heuristic' | 'error';
}

/**
 * 补救学习片段
 * 为错误答题提供的补救学习内容
 */
export interface RemedySnippet {
  /** 简单例句 */
  simpleSentence: string;
  /** 例句翻译 */
  sentenceTranslation: string;
  /** 词汇释义 */
  gloss: GlossPayload;
}

/**
 * 词汇释义载荷
 */
export interface GlossPayload {
  /** 词汇文本 */
  word: string;
  /** 词性 */
  partOfSpeech: string;
  /** 定义列表 */
  definitions: string[];
  /** 例句列表（可选） */
  examples?: string[];
  /** 来源标签 */
  sourceLabel: string;
  /** LLM 生成的解释（可选） */
  llmExplanation?: string;
}

/**
 * 记忆卡片
 * 基于间隔重复算法（FSRS）的学习卡片
 */
export interface MemoryCard {
  /** 唯一标识符 */
  id: string;
  /** 所属词位组 ID */
  lexemeGroupId: string;
  /** 词位 */
  lemma: string;
  /** 客观难度等级 */
  objectiveDifficulty: DifficultyLevel;
  /** 语言类型（v1.5.2: 用于精确过滤复习卡片，替代正则推断） */
  language?: Language;
  /** 首次学习时间戳（不可变，创建时设定） */
  firstLearnedAt: number;
  /**
   * 最近一次复习时间戳（v1.5.2: 修复 FSRS last_review 语义）
   * v1.5.3 fix V2-P3-006: 改为必填 — schedulerAdapter 始终赋值, 消费者无需处理 undefined.
   */
  lastReviewAt: number;
  /** 下次复习时间戳 */
  due: number;
  /** FSRS 稳定性参数 */
  stability: number;
  /** FSRS 难度参数 */
  difficulty: number;
  /** 已过去天数 */
  elapsedDays: number;
  /** 计划间隔天数 */
  scheduledDays: number;
  /** 复习次数 */
  reps: number;
  /** 遗忘次数 */
  lapses: number;
  /** 状态：新卡片/学习中/复习中/重新学习 */
  status: 'new' | 'learning' | 'review' | 'relearning';
  /**
   * v1.5.3 fix V3-P2-008: FSRS learning_steps (学习步骤索引).
   * 表示 Learning 态卡片当前所处的学习步骤 (0=第一步, 1=第二步, ...).
   * 之前硬编码为 1 且未持久化, 导致 FSRS 多步学习机制失效.
   */
  learningSteps: number;
}

/**
 * 复习更新记录
 */
export interface ReviewUpdate {
  /** 更新后的记忆卡片 */
  card: MemoryCard;
  /** 下次复习时间 */
  nextReviewAt: number;
}

/**
 * 用户评分
 * @enum {'again' | 'hard' | 'good' | 'easy'}
 */
export type Rating = 'again' | 'hard' | 'good' | 'easy';

/**
 * LLM 提供商类型
 *
 * v2.1.1 Stage 3 (D3): 收窄为 4 个有实现的 provider, 移除 kimi/qwen/minimax
 * (这些 provider 在 llm-proxy.js 后端未实现, UI 展示会误导用户).
 * 旧用户的 kimi/qwen/minimax 设置由 useSettingsStore.persist.migrate 自动迁移为 mock.
 *
 * @enum {'mock' | 'openai' | 'anthropic' | 'deepseek'}
 */
export type LLMProvider = 'mock' | 'openai' | 'anthropic' | 'deepseek';

/**
 * LLM 难度评估结果
 *
 * 由 difficultyEvaluator 返回, 包含三维度评分 + 归一化等级 + LLM 解释
 */
export interface DifficultyEvaluation {
  /** 词位 */
  lemma: string;
  /** 语言类型 */
  language: Language;
  /** 难度等级 (1-5) */
  level: DifficultyLevel;
  /** 原始分数 (0-100) */
  rawScore: number;
  /** 形态复杂度评分 (1-5) */
  morphological: number;
  /** 抽象程度评分 (1-5) */
  abstractness: number;
  /** 频率百分位 (1-100) */
  frequencyPercentile: number;
  /** LLM 解释（可选） */
  reasoning?: string;
  /** 是否由真实 LLM 评估 */
  isLLMEvaluated: boolean;
}

/**
 * LLM 设置配置
 *
 * v2.1.1 Stage 4 (D2): 移除 apiKey/baseUrl 字段.
 * v1.3.0 proxy 架构迁移后, API key 在后端 server/llm-proxy.js 的 .env 中,
 * baseUrl 由后端 provider factory 决定, 前端不再需要这两个字段.
 */
export interface LLMSettings {
  /** 提供商类型 */
  provider: LLMProvider;
  /** 模型名称 */
  model: string;
  /** 温度参数 */
  temperature: number;
  /** 是否启用 */
  enabled: boolean;
  /** 请求超时时间（秒） */
  timeout: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 启用流式响应 */
  streaming: boolean;
  /**
   * v1.2.0: JSON 解析失败时的最大尝试次数 (含 jsonrepair 自动修复).
   * 默认 3, 范围 1-5. 失败超过此次数后走 mock fallback.
   */
  jsonMaxAttempts?: number;
}

/**
 * LLM 响应结果
 */
export interface LLMResponse {
  /** 原始文本响应 */
  text: string;
  /** 解析后的对象（可选） */
  parsed?: unknown;
  /** 错误信息（可选） */
  error?: string;
  /** 是否回退到 mock（可选） */
  fallbackToMock?: boolean;
}

/**
 * 阅读会话
 * 表示一次完整的阅读学习会话
 */
export interface ReadingSession {
  /** 唯一标识符 */
  id: string;
  /** 语言类型 */
  language: Language;
  /** 难度等级 */
  difficulty: DifficultyLevel;
  /** 阅读文章 */
  passage: Passage;
  /** 会话开始时间戳 */
  startedAt: number;
  /** 已解析的词元 ID 集合 */
  resolvedTokens: Set<string>;
  /** 当前激活的词元出现记录 ID（null 表示无激活） */
  activeOccurrenceId: string | null;
  /**
   * v1.5.2 fix P1-5: 是否为历史重读会话.
   * true = 从历史记录重读 (loadFromHistory), 不应触发 addCardFromToken,
   *   避免记忆库已清空时用全新 firstLearnedAt/reps=0 重建卡片, 丢失 FSRS 进度.
   * false/undefined = 正常新会话 (loadSession), resolved token 正常建卡.
   */
  isReplay?: boolean;
}

/**
 * 字典词条事实数据 (Stage 2: wiktextract 集成)
 *
 * 由 DictionaryAdapter.fetchEntry 返回, 表示从字典 API (wiktextract)
 * 抓取的结构化事实信息, 用于"字典 API 负责结构性事实, LLM 负责中文改写"
 * 的分工模式 (项目设计总结第七节).
 */
export interface DictionaryEntry {
  /** 词位 */
  lemma: string;
  /** 语言类型 */
  language: Language;
  /** 词性 (英文规范: 'noun' | 'verb' | 'adj' | 'adv' | ...) */
  partOfSpeech: string;
  /** 词源 (简述) */
  etymology?: string;
  /** 英文/德文原义 (未经 LLM 改写) */
  definitions: string[];
  /** 真实例句 (原语言) */
  examples?: string[];
  /** 语法信息 (德语为主) */
  grammaticalInfo?: {
    /** 德语名词性别: der / die / das */
    gender?: string;
    /** 复数形式 */
    plural?: string;
    /** 格变化 (nominative / accusative / dative / genitive 等) */
    cases?: string[];
    /** 德语可分前缀 */
    separablePrefix?: string;
  };
  /** 数据来源 (用于诚实标注) */
  source: 'wiktextract' | 'mock';
}

/**
 * 字典查询适配器接口
 */
export interface DictionaryAdapter {
  /**
   * 查询指定词条, 优先走 wiktextract, 失败时回退到 mock
   *
   * @param lemma 词形 (lemma)
   * @param language 语种
   * @returns 词条事实数据, 词条不存在时返回 null
   */
  fetchEntry(lemma: string, language: Language): Promise<DictionaryEntry | null>;

  /** 清空查询缓存 (供测试 / 用户主动刷新使用) */
  clearCache(): void;
}