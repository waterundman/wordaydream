/**
 * v2.3.0 Stage 1 — 英语课程静态定义
 *
 * 面向中文母语者的英语课程 (sourceLanguage='zh', targetLanguage='en').
 * 4 个 Module (A1-B2), 每个 Module 5 个 Lesson, 每个 Lesson 15 个 targetLemmas.
 *
 * - theme 取自 passageGenerator 主题池 (src/features/llm/config/prompts.ts DIFFICULTY_CONSTRAINTS[level].exampleTopics)
 * - targetLemmas 从 src/data/wordlists/en/{level}.json 切片 (每 level 80 词, 取前 75)
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
// lemma 来源: en/a1.json 前 75 词
// ============================================================================

const enA1Lessons: Lesson[] = [
  buildLesson('en-a1', 1, 'Playing in the Park', 'a child playing in a park', [
    'be', 'have', 'do', 'go', 'get', 'make', 'know', 'think', 'see', 'come',
    'want', 'look', 'take', 'give', 'work',
  ]),
  buildLesson('en-a1', 2, 'Family Dinner Together', 'a family having dinner together', [
    'call', 'try', 'ask', 'need', 'feel', 'become', 'leave', 'put', 'mean', 'keep',
    'let', 'begin', 'seem', 'help', 'talk',
  ]),
  buildLesson('en-a1', 3, 'A Day with a Pet', 'a day with a pet at home', [
    'turn', 'show', 'play', 'run', 'move', 'live', 'believe', 'hold', 'bring', 'happen',
    'write', 'provide', 'sit', 'stand', 'lose',
  ]),
  buildLesson('en-a1', 4, 'A Morning at School', 'a morning at school', [
    'pay', 'meet', 'include', 'continue', 'set', 'learn', 'change', 'lead', 'understand', 'watch',
    'follow', 'stop', 'create', 'speak', 'read',
  ]),
  buildLesson('en-a1', 5, 'Friends on the Weekend', 'friends meeting on the weekend', [
    'spend', 'grow', 'open', 'walk', 'win', 'offer', 'remember', 'consider', 'appear', 'buy',
    'serve', 'die', 'send', 'expect', 'build',
  ]),
];

// ============================================================================
// Module: en-a2 (A2 — Elementary)
// theme 来源: DIFFICULTY_CONSTRAINTS[2].exampleTopics
// lemma 来源: en/a2.json 前 75 词
// ============================================================================

const enA2Lessons: Lesson[] = [
  buildLesson('en-a2', 1, 'A Trip to the Market', 'a trip to the market', [
    'accept', 'achieve', 'add', 'admit', 'affect', 'agree', 'allow', 'answer', 'arrive', 'avoid',
    'borrow', 'break', 'carry', 'catch', 'choose',
  ]),
  buildLesson('en-a2', 2, 'An Ordinary Workday', 'an ordinary workday', [
    'clean', 'climb', 'close', 'collect', 'complete', 'cook', 'copy', 'dance', 'decide', 'describe',
    'discover', 'discuss', 'drag', 'dream', 'drink',
  ]),
  buildLesson('en-a2', 3, 'A Chat with a Neighbor', 'a chat with a neighbor', [
    'eat', 'enjoy', 'examine', 'explain', 'explore', 'finish', 'fish', 'fix', 'fly', 'forget',
    'forgive', 'guess', 'hang', 'hate', 'hear',
  ]),
  buildLesson('en-a2', 4, 'The Morning Commute', 'the morning commute', [
    'hide', 'hit', 'hope', 'hurt', 'imagine', 'improve', 'jump', 'kick', 'laugh', 'lie',
    'listen', 'look', 'love', 'marry', 'miss',
  ]),
  buildLesson('en-a2', 5, 'An Afternoon Coffee Break', 'an afternoon coffee break', [
    'nod', 'notice', 'obey', 'paint', 'park', 'pick', 'plan', 'practice', 'prepare', 'pretend',
    'pull', 'push', 'rain', 'receive', 'repair',
  ]),
];

// ============================================================================
// Module: en-b1 (B1 — Intermediate)
// theme 来源: DIFFICULTY_CONSTRAINTS[3].exampleTopics
// lemma 来源: en/b1.json 前 75 词
// ============================================================================

const enB1Lessons: Lesson[] = [
  buildLesson('en-b1', 1, 'A News-Style Vignette', 'a short news-style vignette', [
    'abandon', 'accomplish', 'accumulate', 'accuse', 'adapt', 'adjust', 'admire', 'adventure', 'announce', 'apologize',
    'apply', 'appreciate', 'approach', 'argue', 'arrange',
  ]),
  buildLesson('en-b1', 2, 'A Personal Reflection', 'a personal reflection on a change', [
    'arrest', 'assist', 'assure', 'attach', 'attempt', 'attend', 'attract', 'bargain', 'behave', 'blame',
    'bleed', 'blow', 'boast', 'bother', 'bounce',
  ]),
  buildLesson('en-b1', 3, 'A Travel Observation', 'a travel observation', [
    'brave', 'burst', 'calculate', 'cancel', 'capture', 'careful', 'celebrate', 'challenge', 'charge', 'chase',
    'cheat', 'cheer', 'claim', 'clarify', 'classify',
  ]),
  buildLesson('en-b1', 4, 'A Workplace Anecdote', 'a workplace anecdote', [
    'collapse', 'collect', 'commit', 'communicate', 'compare', 'compete', 'complain', 'complete', 'concentrate', 'conclude',
    'confess', 'confuse', 'congratulate', 'connect', 'conquer',
  ]),
  buildLesson('en-b1', 5, 'A Cultural Experience Abroad', 'a cultural experience abroad', [
    'consent', 'consist', 'construct', 'consult', 'contain', 'contribute', 'convince', 'cope', 'correspond', 'crash',
    'crawl', 'create', 'criticize', 'cross', 'crush',
  ]),
];

// ============================================================================
// Module: en-b2 (B2 — Upper Intermediate)
// theme 来源: DIFFICULTY_CONSTRAINTS[4].exampleTopics
// lemma 来源: en/b2.json 前 75 词
// ============================================================================

const enB2Lessons: Lesson[] = [
  buildLesson('en-b2', 1, 'An Editorial on a Civic Issue', 'an editorial on a civic issue', [
    'acknowledge', 'acquire', 'address', 'advocate', 'allocate', 'alter', 'analyze', 'anticipate', 'appeal', 'appliance',
    'arbitrary', 'arouse', 'ascend', 'aspiration', 'assemble',
  ]),
  buildLesson('en-b2', 2, 'An Essay on Memory', 'a thoughtful essay excerpt on memory', [
    'assess', 'assign', 'assumption', 'assure', 'attain', 'authentic', 'baffle', 'ban', 'beneath', 'bewilder',
    'boost', 'bound', 'breed', 'burden', 'campaign',
  ]),
  buildLesson('en-b2', 3, 'A Scientific Finding', 'a discussion of a scientific finding', [
    'candidate', 'capable', 'category', 'cease', 'circumstance', 'coincide', 'collaborate', 'commemorate', 'commence', 'compatible',
    'compensate', 'compile', 'comply', 'comprehensive', 'comprise',
  ]),
  buildLesson('en-b2', 4, 'A Reflection on Time', 'a philosophical reflection on time', [
    'conceal', 'conceive', 'condemn', 'conduct', 'conflict', 'confront', 'conserve', 'constitute', 'contemplate', 'contemporary',
    'contradict', 'controversy', 'convey', 'coordinate', 'correlate',
  ]),
  buildLesson('en-b2', 5, 'A Literary Analysis', 'a literary analysis passage', [
    'correspond', 'counterpart', 'craft', 'credible', 'critique', 'crucial', 'cultivate', 'cumulative', 'curriculum', 'decent',
    'deduce', 'deficiency', 'deliberate', 'demonstrate', 'depict',
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
