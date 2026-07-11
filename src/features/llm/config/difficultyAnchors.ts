/**
 * 跨语言难度锚点 (Difficulty Anchors)
 *
 * 设计目标: 不依赖 CEFR/Goethe 等外部词表, 通过 few-shot 锚点让 LLM
 * 围绕相对位置做难度判断, 保证英语/德语(以及未来其他语种)归一化等级一致.
 *
 * 每个锚点包含四个维度:
 * - morphological: 词形复杂度 (1-5)
 *     1 = 短小/原形, 5 = 大量派生/复合/屈折变化
 * - abstractness: 概念抽象度 (1-5)
 *     1 = 看得见摸得着, 5 = 高度抽象/学术/哲学
 * - frequencyPercentile: 使用频率相对位置 (1-100)
 *     1 = 母语者最高频, 100 = 罕见/专业
 * - expectedLevel: 归一化难度等级 (1-5)
 *     1 = 入门, 5 = 学术/罕见
 *
 * 扩展新语种时, 只需新增对应 language 的锚点数组, 保持 expectedLevel 在
 * 同等级下使用大致相当的"母语者感知难度"词条即可.
 */

import type { Language, DifficultyLevel } from '../../../types';

export interface DifficultyAnchor {
  /** 词形 (lemma) */
  lemma: string;
  /** 语种 */
  language: Language;
  /** 词形复杂度 1-5 */
  morphological: number;
  /** 概念抽象度 1-5 */
  abstractness: number;
  /** 使用频率相对位置 1-100, 1=最高频 */
  frequencyPercentile: number;
  /** 预期难度等级 1-5 */
  expectedLevel: DifficultyLevel;
  /** 简短释义 (中文), 方便人工审校 */
  gloss?: string;
}

/* eslint-disable @typescript-eslint/no-magic-numbers */

/**
 * 英语锚点
 *
 * 选词原则:
 * - 等级 1: 小学/日常会话高频具体词
 * - 等级 2: 初中/高中常用具体词
 * - 等级 3: 高中/大学中级, 包含少量派生/合成
 * - 等级 4: 大学高级/学术常用, 抽象概念
 * - 等级 5: 学术/专业, 罕见或文学化
 */
const ENGLISH_ANCHORS: DifficultyAnchor[] = [
  // 等级 1
  { lemma: 'apple', language: 'en', morphological: 1, abstractness: 1, frequencyPercentile: 5, expectedLevel: 1, gloss: '苹果' },
  { lemma: 'water', language: 'en', morphological: 1, abstractness: 1, frequencyPercentile: 3, expectedLevel: 1, gloss: '水' },
  { lemma: 'house', language: 'en', morphological: 1, abstractness: 1, frequencyPercentile: 8, expectedLevel: 1, gloss: '房子' },
  { lemma: 'book', language: 'en', morphological: 1, abstractness: 1, frequencyPercentile: 10, expectedLevel: 1, gloss: '书' },

  // 等级 2
  { lemma: 'walk', language: 'en', morphological: 1, abstractness: 1, frequencyPercentile: 25, expectedLevel: 2, gloss: '走' },
  { lemma: 'happy', language: 'en', morphological: 1, abstractness: 2, frequencyPercentile: 30, expectedLevel: 2, gloss: '开心的' },
  { lemma: 'story', language: 'en', morphological: 1, abstractness: 2, frequencyPercentile: 28, expectedLevel: 2, gloss: '故事' },
  { lemma: 'friend', language: 'en', morphological: 1, abstractness: 2, frequencyPercentile: 22, expectedLevel: 2, gloss: '朋友' },

  // 等级 3
  { lemma: 'discover', language: 'en', morphological: 3, abstractness: 2, frequencyPercentile: 50, expectedLevel: 3, gloss: '发现' },
  { lemma: 'consider', language: 'en', morphological: 3, abstractness: 3, frequencyPercentile: 45, expectedLevel: 3, gloss: '考虑' },
  { lemma: 'remember', language: 'en', morphological: 3, abstractness: 2, frequencyPercentile: 48, expectedLevel: 3, gloss: '记住' },
  { lemma: 'ancient', language: 'en', morphological: 2, abstractness: 3, frequencyPercentile: 55, expectedLevel: 3, gloss: '古老的' },

  // 等级 4
  { lemma: 'revolution', language: 'en', morphological: 3, abstractness: 4, frequencyPercentile: 70, expectedLevel: 4, gloss: '革命/变革' },
  { lemma: 'perspective', language: 'en', morphological: 3, abstractness: 4, frequencyPercentile: 68, expectedLevel: 4, gloss: '视角' },
  { lemma: 'consequence', language: 'en', morphological: 3, abstractness: 4, frequencyPercentile: 72, expectedLevel: 4, gloss: '后果' },
  { lemma: 'sophisticated', language: 'en', morphological: 4, abstractness: 4, frequencyPercentile: 75, expectedLevel: 4, gloss: '复杂的/老练的' },

  // 等级 5
  { lemma: 'quintessential', language: 'en', morphological: 5, abstractness: 4, frequencyPercentile: 92, expectedLevel: 5, gloss: '典型的/精髓的' },
  { lemma: 'ephemeral', language: 'en', morphological: 4, abstractness: 5, frequencyPercentile: 94, expectedLevel: 5, gloss: '短暂的' },
  { lemma: 'ubiquitous', language: 'en', morphological: 4, abstractness: 4, frequencyPercentile: 90, expectedLevel: 5, gloss: '无处不在的' },
  { lemma: 'idiosyncratic', language: 'en', morphological: 5, abstractness: 5, frequencyPercentile: 96, expectedLevel: 5, gloss: '独特的/特异的' },
];

/**
 * 德语锚点
 *
 * 选词原则: 与英语同等级锚点保持"母语者感知难度"相当
 * - 等级 1 中包含一个复合词 (Krankenhaus), 体现德语形态特征
 *   但因其词形虽长, 在母语者认知中属高频具体词, 故归入等级 1
 * - 等级 2 包含基础动词原形 (laufen, machen)
 * - 等级 3-4 包含派生/复合抽象词
 * - 等级 5 罕见学术词
 */
const GERMAN_ANCHORS: DifficultyAnchor[] = [
  // 等级 1
  { lemma: 'Haus', language: 'de', morphological: 1, abstractness: 1, frequencyPercentile: 6, expectedLevel: 1, gloss: '房子' },
  { lemma: 'Apfel', language: 'de', morphological: 2, abstractness: 1, frequencyPercentile: 8, expectedLevel: 1, gloss: '苹果' },
  { lemma: 'Wasser', language: 'de', morphological: 1, abstractness: 1, frequencyPercentile: 4, expectedLevel: 1, gloss: '水' },
  { lemma: 'Krankenhaus', language: 'de', morphological: 4, abstractness: 1, frequencyPercentile: 18, expectedLevel: 1, gloss: '医院 (复合词)' },

  // 等级 2
  { lemma: 'laufen', language: 'de', morphological: 2, abstractness: 1, frequencyPercentile: 25, expectedLevel: 2, gloss: '跑/走' },
  { lemma: 'machen', language: 'de', morphological: 2, abstractness: 1, frequencyPercentile: 10, expectedLevel: 2, gloss: '做' },
  { lemma: 'glücklich', language: 'de', morphological: 2, abstractness: 2, frequencyPercentile: 30, expectedLevel: 2, gloss: '幸福的' },
  { lemma: 'Freund', language: 'de', morphological: 1, abstractness: 2, frequencyPercentile: 28, expectedLevel: 2, gloss: '朋友' },

  // 等级 3
  { lemma: 'entdecken', language: 'de', morphological: 3, abstractness: 2, frequencyPercentile: 55, expectedLevel: 3, gloss: '发现' },
  { lemma: 'erinnern', language: 'de', morphological: 3, abstractness: 2, frequencyPercentile: 52, expectedLevel: 3, gloss: '记住' },
  { lemma: 'betrachten', language: 'de', morphological: 3, abstractness: 3, frequencyPercentile: 60, expectedLevel: 3, gloss: '观察/看待' },
  { lemma: 'Geschichte', language: 'de', morphological: 3, abstractness: 2, frequencyPercentile: 35, expectedLevel: 3, gloss: '故事/历史' },

  // 等级 4
  { lemma: 'Revolution', language: 'de', morphological: 3, abstractness: 4, frequencyPercentile: 70, expectedLevel: 4, gloss: '革命' },
  { lemma: 'Perspektive', language: 'de', morphological: 3, abstractness: 4, frequencyPercentile: 72, expectedLevel: 4, gloss: '视角' },
  { lemma: 'Gesellschaft', language: 'de', morphological: 3, abstractness: 4, frequencyPercentile: 45, expectedLevel: 4, gloss: '社会' },
  { lemma: 'Bedeutung', language: 'de', morphological: 3, abstractness: 4, frequencyPercentile: 40, expectedLevel: 4, gloss: '含义' },

  // 等级 5
  { lemma: 'Vollendung', language: 'de', morphological: 4, abstractness: 5, frequencyPercentile: 92, expectedLevel: 5, gloss: '完美/完成 (抽象)' },
  { lemma: 'Vergänglichkeit', language: 'de', morphological: 5, abstractness: 5, frequencyPercentile: 95, expectedLevel: 5, gloss: '短暂/无常' },
  { lemma: 'Unvermeidlichkeit', language: 'de', morphological: 5, abstractness: 5, frequencyPercentile: 96, expectedLevel: 5, gloss: '不可避免性' },
  { lemma: 'Eigenheit', language: 'de', morphological: 3, abstractness: 4, frequencyPercentile: 88, expectedLevel: 5, gloss: '特质/独特性' },
];

/**
 * 所有锚点 (按语种分组存储, 便于扩展)
 *
 * 未来扩展新语种 (如日语 ja, 法语 fr) 时, 只需在下方添加新数组并在
 * ANCHORS_BY_LANGUAGE 中注册即可, 其他代码无需改动.
 */
const ANCHORS_BY_LANGUAGE: Record<Language, DifficultyAnchor[]> = {
  en: ENGLISH_ANCHORS,
  de: GERMAN_ANCHORS,
};

/**
 * 获取指定语种的所有锚点
 */
export function getAnchorsForLanguage(language: Language): DifficultyAnchor[] {
  return ANCHORS_BY_LANGUAGE[language] ?? [];
}

/**
 * 获取指定语种指定等级的锚点
 */
export function getAnchorsByLevel(language: Language, level: DifficultyLevel): DifficultyAnchor[] {
  return getAnchorsForLanguage(language).filter((a) => a.expectedLevel === level);
}

/**
 * 跨语言同等级锚点 (用于 few-shot 校准 prompt)
 *
 * 将同一 expectedLevel 下的英语和德语锚点配对, 让 LLM 看到
 * 跨语言难度参照, 减少语种间尺度漂移.
 */
export function getCrossLanguageAnchorsByLevel(level: DifficultyLevel): {
  en: DifficultyAnchor[];
  de: DifficultyAnchor[];
} {
  return {
    en: getAnchorsByLevel('en', level),
    de: getAnchorsByLevel('de', level),
  };
}

/**
 * 所有锚点 (扁平数组), 主要用于调试/UI 展示
 */
export const DIFFICULTY_ANCHORS: DifficultyAnchor[] = [
  ...ENGLISH_ANCHORS,
  ...GERMAN_ANCHORS,
];
