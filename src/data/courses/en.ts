/**
 * v2.3.0 Stage 1 — 英语课程静态定义
 *
 * 面向中文母语者的英语课程 (sourceLanguage='zh', targetLanguage='en').
 * 4 个 Module (A1-B2), 每个 Module 5 个 Lesson, 每个 Lesson 15 个 targetLemmas.
 *
 * - theme 取自 passageGenerator 主题池 (src/features/llm/config/prompts.ts DIFFICULTY_CONSTRAINTS[level].exampleTopics)
 * - targetLemmas 按 Lesson 主题优选自 src/data/wordlists/en/{level}.json (每 Lesson 15 词, 同级不重复)
 *
 * Course.id 格式: '{targetLang}-from-{sourceLang}' → 'en-from-zh'
 * Module.id 格式: '{targetLang}-{cefrLower}' → 'en-a1'
 * Lesson.id 格式: '{moduleId}-{themeSlug}' → 'en-a1-a-child-playing-in-a-park'
 */

import type { CompletionCriteria, Course, Lesson } from '../../features/course/types';

/** 默认复习正确率阈值 */
const DEFAULT_MIN_REVIEW_ACCURACY = 0.7;

/**
 * 根据 targetLemmas 数量生成默认完成判定标准.
 * - minWordsEncountered = ceil(len * 0.8)
 * - minWordsLearned     = ceil(len * 0.5)
 * - minReviewAccuracy   = 0.7
 * - requiredSessionTypes = ['reading']
 */
function defaultCriteria(lemmaCount: number): CompletionCriteria {
  return {
    minWordsEncountered: Math.ceil(lemmaCount * 0.8),
    minWordsLearned: Math.ceil(lemmaCount * 0.5),
    minReviewAccuracy: DEFAULT_MIN_REVIEW_ACCURACY,
    requiredSessionTypes: ['reading'],
  };
}

/** theme → themeSlug: lowercase + 空格转连字符 */
function themeSlug(theme: string): string {
  return theme.toLowerCase().replace(/\s+/g, '-');
}

/** 构建 Lesson 对象 (id 自动拼接 moduleId + themeSlug) */
function buildLesson(
  moduleId: string,
  order: number,
  title: string,
  theme: string,
  lemmas: string[]
): Lesson {
  return {
    id: `${moduleId}-${themeSlug(theme)}`,
    moduleId,
    title,
    theme,
    targetLemmas: lemmas,
    order,
    completionCriteria: defaultCriteria(lemmas.length),
  };
}

// ============================================================================
// Module: en-a1 (A1 — Beginner)
// theme 来源: DIFFICULTY_CONSTRAINTS[1].exampleTopics
// lemma 来源: 按主题优选自 en/a1.json (15 词)
// ============================================================================

const enA1Lessons: Lesson[] = [
  buildLesson('en-a1', 1, 'Playing in the Park', 'a child playing in a park', [
    'lose', 'win', 'player', 'draw', 'match', 'game', 'party', 'music', 'film', 'radio',
    'movie', 'sport', 'tv', 'television', 'song',
  ]),
  buildLesson('en-a1', 2, 'Family Dinner Together', 'a family having dinner together', [
    'child', 'family', 'mother', 'father', 'parent', 'girl', 'boy', 'wife', 'son', 'brother',
    'daughter', 'sister', 'baby', 'husband', 'cousin',
  ]),
  buildLesson('en-a1', 3, 'A Day with a Pet', 'a day with a pet at home', [
    'animal', 'dog', 'fish', 'bird', 'horse', 'chicken', 'cat', 'cow', 'mouse', 'snake',
    'pig', 'sheep', 'spider', 'bear', 'deer',
  ]),
  buildLesson('en-a1', 4, 'A Morning at School', 'a morning at school', [
    'student', 'book', 'word', 'learn', 'history', 'course', 'class', 'paper', 'test', 'letter',
    'page', 'university', 'college', 'teach', 'subject',
  ]),
  buildLesson('en-a1', 5, 'Friends on the Weekend', 'friends meeting on the weekend', [
    'help', 'friend', 'member', 'partner', 'neighbour', 'camera', 'sing', 'painting', 'photograph', 'football',
    'dance', 'festival', 'photo', 'theatre', 'birthday',
  ]),
];

// ============================================================================
// Module: en-a2 (A2 — Elementary)
// theme 来源: DIFFICULTY_CONSTRAINTS[2].exampleTopics
// lemma 来源: 按主题优选自 en/a2.json (15 词)
// ============================================================================

const enA2Lessons: Lesson[] = [
  buildLesson('en-a2', 1, 'A Trip to the Market', 'a trip to the market', [
    'sale', 'store', 'cash', 'fish', 'cook', 'taste', 'plate', 'knife', 'boil', 'lemon',
    'nut', 'beef', 'fork', 'spoon', 'bean',
  ]),
  buildLesson('en-a2', 2, 'An Ordinary Workday', 'an ordinary workday', [
    'pay', 'officer', 'lawyer', 'manager', 'soldier', 'colleague', 'journalist', 'boss', 'engineer', 'secretary',
    'chef', 'share', 'save', 'program', 'data',
  ]),
  buildLesson('en-a2', 3, 'A Chat with a Neighbor', 'a chat with a neighbor', [
    'talk', 'question', 'text', 'mail', 'mobile', 'chat', 'smartphone', 'care', 'support', 'relationship',
    'argue', 'guest', 'please', 'welcome', 'dear',
  ]),
  buildLesson('en-a2', 4, 'The Morning Commute', 'the morning commute', [
    'drive', 'ship', 'ride', 'train', 'engine', 'bridge', 'truck', 'wheel', 'passenger', 'underground',
    'petrol', 'motorcycle', 'fall', 'rise', 'hold',
  ]),
  buildLesson('en-a2', 5, 'An Afternoon Coffee Break', 'an afternoon coffee break', [
    'biscuit', 'recipe', 'run', 'film', 'photograph', 'gift', 'fishing', 'drawing', 'golf', 'soccer',
    'basketball', 'camping', 'need', 'hope', 'serious',
  ]),
];

// ============================================================================
// Module: en-b1 (B1 — Intermediate)
// theme 来源: DIFFICULTY_CONSTRAINTS[3].exampleTopics
// lemma 来源: 按主题优选自 en/b1.json (15 词)
// ============================================================================

const enB1Lessons: Lesson[] = [
  buildLesson('en-b1', 1, 'A News-Style Vignette', 'a short news-style vignette', [
    'political', 'policy', 'election', 'vote', 'legal', 'politics', 'religion', 'court', 'custom', 'economic',
    'tax', 'economy', 'share', 'trade', 'financial',
  ]),
  buildLesson('en-b1', 2, 'A Personal Reflection', 'a personal reflection on a change', [
    'like', 'need', 'fear', 'hate', 'proud', 'glad', 'mood', 'lonely', 'calm', 'disappointed',
    'grateful', 'frightened', 'experience', 'wonder', 'doubt',
  ]),
  buildLesson('en-b1', 3, 'A Travel Observation', 'a travel observation', [
    'fuel', 'port', 'neighbourhood', 'seed', 'global', 'leaf', 'sand', 'fire', 'result', 'theory',
    'still', 'state', 'level', 'official', 'current',
  ]),
  buildLesson('en-b1', 4, 'A Workplace Anecdote', 'a workplace anecdote', [
    'staff', 'client', 'profession', 'account', 'management', 'profit', 'invest', 'marketing', 'announce', 'program',
    'file', 'software', 'battery', 'keyboard', 'robot',
  ]),
  buildLesson('en-b1', 5, 'A Cultural Experience Abroad', 'a cultural experience abroad', [
    'poem', 'poetry', 'photography', 'sculpture', 'analysis', 'sample', 'academic', 'literature', 'conclusion', 'experiment',
    'definition', 'central', 'private', 'standard', 'various',
  ]),
];

// ============================================================================
// Module: en-b2 (B2 — Upper Intermediate)
// theme 来源: DIFFICULTY_CONSTRAINTS[4].exampleTopics
// lemma 来源: 按主题优选自 en/b2.json (15 词)
// ============================================================================

const enB2Lessons: Lesson[] = [
  buildLesson('en-b2', 1, 'An Editorial on a Civic Issue', 'an editorial on a civic issue', [
    'military', 'minister', 'citizen', 'freedom', 'justice', 'parliament', 'democracy', 'refugee', 'immigration', 'stock',
    'firm', 'account', 'investment', 'budget', 'insurance',
  ]),
  buildLesson('en-b2', 2, 'An Essay on Memory', 'a thoughtful essay excerpt on memory', [
    'assume', 'judgement', 'feel', 'anger', 'survey', 'concept', 'sample', 'academic', 'thesis', 'hypothesis',
    'very', 'former', 'chief', 'federal', 'material',
  ]),
  buildLesson('en-b2', 3, 'A Scientific Finding', 'a discussion of a scientific finding', [
    'cell', 'gene', 'patient', 'hurt', 'wound', 'pill', 'cure', 'fever', 'ambulance', 'surgery',
    'depression', 'screen', 'file', 'cable', 'password',
  ]),
  buildLesson('en-b2', 4, 'A Reflection on Time', 'a philosophical reflection on time', [
    'time', 'spring', 'amount', 'leave', 'stand', 'hold', 'catch', 'close', 'exit', 'significant',
    'executive', 'entire', 'tough', 'civil', 'critical',
  ]),
  buildLesson('en-b2', 5, 'A Literary Analysis', 'a literary analysis passage', [
    'resident', 'potential', 'willing', 'annual', 'broad', 'domestic', 'conservative', 'industrial', 'overall', 'representative',
    'mass', 'plus', 'dramatic', 'brief', 'joint',
  ]),
];

// ============================================================================
// Course: en-from-zh
// ============================================================================

export const enCourse: Course = {
  id: 'en-from-zh',
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  title: 'English for Chinese Speakers',
  modules: [
    {
      id: 'en-a1',
      courseId: 'en-from-zh',
      cefrLevel: 'A1',
      title: 'English A1 — Beginner',
      lessons: enA1Lessons,
      prerequisiteModuleIds: [],
    },
    {
      id: 'en-a2',
      courseId: 'en-from-zh',
      cefrLevel: 'A2',
      title: 'English A2 — Elementary',
      lessons: enA2Lessons,
      prerequisiteModuleIds: ['en-a1'],
    },
    {
      id: 'en-b1',
      courseId: 'en-from-zh',
      cefrLevel: 'B1',
      title: 'English B1 — Intermediate',
      lessons: enB1Lessons,
      prerequisiteModuleIds: ['en-a2'],
    },
    {
      id: 'en-b2',
      courseId: 'en-from-zh',
      cefrLevel: 'B2',
      title: 'English B2 — Upper Intermediate',
      lessons: enB2Lessons,
      prerequisiteModuleIds: ['en-b1'],
    },
  ],
};
