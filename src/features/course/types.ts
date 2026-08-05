/**
 * v2.3.0 Stage 1 — 课程化数据模型
 *
 * 三层结构: Course > Module > Lesson
 * - Course: 一门语言对 (如 'German for English Speakers')
 * - Module: 一个 CEFR 等级 (如 A1/B1/B2), 含前置 Module 依赖
 * - Lesson: 一节课, 绑定一个主题 (取自 passageGenerator 主题池) + 一组目标词
 *
 * 参考: LibreLingo Course/Module/Skill 三层结构 + 论文6 Ponnusamy 2020 语境化词汇学习.
 */

/** CEFR 等级 (C1 不纳入课程化, 保留自由阅读) */
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2';

/** 课时解锁/进度状态 */
export type LessonStatus = 'locked' | 'available' | 'in-progress' | 'completed';

/** 会话类型 (课时完成判定用) */
export type SessionType = 'reading' | 'review' | 'practice';

/**
 * 课时完成判定标准
 *
 * 三阈值 + 必需会话类型, 全部满足时课时标记为 'completed'.
 * 默认值 (由课程定义文件计算):
 * - minWordsEncountered = ceil(targetLemmas.length * 0.8)
 * - minWordsLearned     = ceil(targetLemmas.length * 0.5)
 * - minReviewAccuracy   = 0.7
 * - requiredSessionTypes = ['reading']
 */
export interface CompletionCriteria {
  /** 最少遇到 (去重) 的目标词数 */
  minWordsEncountered: number;
  /** 最少学会 (去重) 的目标词数 */
  minWordsLearned: number;
  /** 复习最低正确率 (0-1) */
  minReviewAccuracy: number;
  /** 必需完成的会话类型 */
  requiredSessionTypes: SessionType[];
}

/**
 * 一节课
 *
 * id 格式: '{moduleId}-{themeSlug}' (themeSlug = theme.toLowerCase().replace(/\s+/g, '-'))
 * targetLemmas 从 data/wordlists/{lang}/{level}.json 切片, 上限 15 词.
 */
export interface Lesson {
  /** 唯一标识符, 格式: '{moduleId}-{themeSlug}', 如 'de-a1-animals' */
  id: string;
  /** 所属 Module id */
  moduleId: string;
  /** 人类可读标题, 如 'Animals in Daily Life' */
  title: string;
  /** 主题, 取自 passageGenerator 主题池 (DIFFICULTY_CONSTRAINTS[level].exampleTopics) */
  theme: string;
  /** 目标词元列表, ≤15 词, 从 wordlist 切片 */
  targetLemmas: string[];
  /** 在 Module 内的序号 (1-based) */
  order: number;
  /** 完成判定标准 */
  completionCriteria: CompletionCriteria;
}

/**
 * 一个 CEFR 等级模块
 *
 * id 格式: '{targetLang}-{cefrLower}' (cefrLower = cefrLevel.toLowerCase())
 */
export interface Module {
  /** 唯一标识符, 格式: '{targetLang}-{cefrLower}', 如 'de-a1' */
  id: string;
  /** 所属 Course id */
  courseId: string;
  /** CEFR 等级 */
  cefrLevel: CefrLevel;
  /** 人类可读标题, 如 'German A1 — Beginner' */
  title: string;
  /** 课时列表 (按 order 升序) */
  lessons: Lesson[];
  /** 前置 Module id 列表 (空数组表示无前置, 即入门 Module) */
  prerequisiteModuleIds: string[];
}

/**
 * 一门课程 (一个语言对)
 *
 * id 格式: '{targetLang}-from-{sourceLang}', 如 'de-from-en'
 */
export interface Course {
  /** 唯一标识符, 格式: '{targetLang}-from-{sourceLang}', 如 'de-from-en' */
  id: string;
  /** 源语言 (学习者母语), 如 'en' */
  sourceLanguage: string;
  /** 目标语言 (学习者学习的语言), 如 'de' 或 'en' */
  targetLanguage: string;
  /** 人类可读标题, 如 'German for English Speakers' */
  title: string;
  /** 模块列表 (按 CEFR 等级升序) */
  modules: Module[];
}
