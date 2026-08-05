/**
 * v2.3.0 Stage 1 — 德语课程静态定义
 *
 * 面向英语母语者的德语课程 (sourceLanguage='en', targetLanguage='de').
 * 4 个 Module (A1-B2), 每个 Module 6 个 Lesson, 每个 Lesson 15 个 targetLemmas.
 *
 * - theme 取自 passageGenerator 主题池 (src/features/llm/config/prompts.ts DIFFICULTY_CONSTRAINTS[level].exampleTopics)
 * - targetLemmas 从 src/data/wordlists/de/{level}.json 切片 (de 词表远大于 en, 充裕)
 *
 * Course.id 格式: '{targetLang}-from-{sourceLang}' → 'de-from-en'
 * Module.id 格式: '{targetLang}-{cefrLower}' → 'de-a1'
 * Lesson.id 格式: '{moduleId}-{themeSlug}' → 'de-a1-a-child-playing-in-a-park'
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
// Module: de-a1 (A1 — Beginner)
// theme 来源: DIFFICULTY_CONSTRAINTS[1].exampleTopics
// lemma 来源: de/a1.json 前 90 词 (去重: 'sein'/'ihr' 各出现两次, 取首次)
// ============================================================================

const deA1Lessons: Lesson[] = [
  buildLesson('de-a1', 1, 'Playing in the Park', 'a child playing in a park', [
    'Hallo', 'Tschüss', 'danke', 'bitte', 'ja', 'nein', 'Entschuldigung', 'Willkommen', 'Wiedersehen', 'Gruß',
    'Geschenk', 'Einladung', 'ich', 'du', 'er',
  ]),
  buildLesson('de-a1', 2, 'Family Dinner Together', 'a family having dinner together', [
    'sie', 'es', 'wir', 'ihr', 'man', 'mich', 'dich', 'mir', 'dir', 'uns',
    'euch', 'mein', 'dein', 'sein', 'unser',
  ]),
  buildLesson('de-a1', 3, 'A Day with a Pet', 'a day with a pet at home', [
    'euer', 'dieser', 'jener', 'wer', 'was', 'welche', 'alle', 'etwas', 'nichts', 'jemand',
    'eins', 'zwei', 'drei', 'vier', 'fünf',
  ]),
  buildLesson('de-a1', 4, 'A Morning at School', 'a morning at school', [
    'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn',
    'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn', 'zwanzig',
  ]),
  buildLesson('de-a1', 5, 'Friends on the Weekend', 'friends meeting on the weekend', [
    'dreißig', 'vierzig', 'fünfzig', 'hundert', 'tausend', 'Million', 'der', 'die', 'das', 'ein',
    'eine', 'kein', 'keine', 'haben', 'werden',
  ]),
  buildLesson('de-a1', 6, 'A Slow Sunday Morning', 'a slow Sunday morning', [
    'machen', 'tun', 'gehen', 'kommen', 'sprechen', 'lernen', 'studieren', 'verstehen', 'wohnen', 'leben',
    'heißen', 'spielen', 'arbeiten', 'kaufen', 'verkaufen',
  ]),
];

// ============================================================================
// Module: de-a2 (A2 — Elementary)
// theme 来源: DIFFICULTY_CONSTRAINTS[2].exampleTopics
// lemma 来源: de/a2.json 前 90 词
// ============================================================================

const deA2Lessons: Lesson[] = [
  buildLesson('de-a2', 1, 'A Trip to the Market', 'a trip to the market', [
    'verabschieden', 'Begrüßung', 'Verabschiedung', 'Bekanntschaft', 'Bekannter', 'vertraut', 'zuvorkommend', 'sich', 'einander', 'niemand',
    'irgendjemand', 'irgendwas', 'beides', 'derselbe', 'derjenige',
  ]),
  buildLesson('de-a2', 2, 'An Ordinary Workday', 'an ordinary workday', [
    'selbst', 'irgendwer', 'welches', 'wessen', 'irgendwo', 'einer', 'dies', 'meinige', 'deinige', 'erste',
    'zweite', 'dritte', 'vierte', 'fünfte', 'letzte',
  ]),
  buildLesson('de-a2', 3, 'A Chat with a Neighbor', 'a chat with a neighbor', [
    'nächste', 'vorherige', 'folgende', 'halbe', 'Drittel', 'Viertel', 'Hälfte', 'Dutzend', 'hundertst', 'tausendst',
    'doppelt', 'dreifach', 'mehrfach', 'Milliarde', 'Billion',
  ]),
  buildLesson('de-a2', 4, 'The Morning Commute', 'the morning commute', [
    'einmalig', 'jede', 'jeder', 'jedes', 'mancher', 'manche', 'manches', 'einige', 'mehrere', 'beide',
    'solche', 'welcher', 'reden', 'schauen', 'zuhören',
  ]),
  buildLesson('de-a2', 5, 'An Afternoon Coffee Break', 'an afternoon coffee break', [
    'entscheiden', 'wählen', 'auswählen', 'vergleichen', 'beschreiben', 'berichten', 'besprechen', 'diskutieren', 'behaupten', 'versprechen',
    'empfehlen', 'vorschlagen', 'anbieten', 'einladen', 'teilnehmen',
  ]),
  buildLesson('de-a2', 6, 'Preparing Dinner After Work', 'preparing dinner after work', [
    'unterstützen', 'pflegen', 'betreuen', 'retten', 'schützen', 'verletzen', 'heilen', 'reinigen', 'spülen', 'braten',
    'grillen', 'probieren', 'schmecken', 'riechen', 'fühlen',
  ]),
];

// ============================================================================
// Module: de-b1 (B1 — Intermediate)
// theme 来源: DIFFICULTY_CONSTRAINTS[3].exampleTopics
// lemma 来源: de/b1.json 前 90 词
// ============================================================================

const deB1Lessons: Lesson[] = [
  buildLesson('de-b1', 1, 'A News-Style Vignette', 'a short news-style vignette', [
    'akzeptieren', 'ablehnen', 'beweisen', 'vermuten', 'zweifeln', 'überzeugen', 'zustimmen', 'widersprechen', 'debattieren', 'argumentieren',
    'reflektieren', 'analysieren', 'interpretieren', 'beurteilen', 'erforschen',
  ]),
  buildLesson('de-b1', 2, 'A Personal Reflection', 'a personal reflection on a change', [
    'ändern', 'verändern', 'erhalten', 'bekommen', 'erlauben', 'gestatten', 'benötigen', 'erkennen', 'begreifen', 'bemühen',
    'erreichen', 'vermeiden', 'entwickeln', 'verbessern', 'verschlechtern',
  ]),
  buildLesson('de-b1', 3, 'A Travel Observation', 'a travel observation', [
    'erfolgreich', 'erfolgen', 'durchführen', 'verwenden', 'anwenden', 'nutzen', 'berücksichtigen', 'beruhen', 'verursachen', 'bewirken',
    'gelten', 'betreffen', 'umfassen', 'enthalten', 'bestehen',
  ]),
  buildLesson('de-b1', 4, 'A Workplace Anecdote', 'a workplace anecdote', [
    'ergeben', 'verlangen', 'fordern', 'bieten', 'Ansicht', 'Einstellung', 'Überzeugung', 'Argument', 'Gegenargument', 'Beweis',
    'Zweifel', 'Vermutung', 'Behauptung', 'Einwand', 'Kritik',
  ]),
  buildLesson('de-b1', 5, 'A Cultural Experience Abroad', 'a cultural experience abroad', [
    'Lob', 'Erlebnis', 'Eindruck', 'Sichtweise', 'Perspektive', 'Standpunkt', 'Gesichtspunkt', 'Aspekt', 'Ursache', 'Folge',
    'Wirkung', 'Einfluss', 'Zweck', 'Absicht', 'Gelegenheit',
  ]),
  buildLesson('de-b1', 6, 'A Commentary on a New Gadget', 'a commentary on a new gadget', [
    'Chance', 'Risiko', 'Gefahr', 'Vorteil', 'Nachteil', 'Fazit', 'Ergebnis', 'Folgerung', 'Gesellschaft', 'gesellschaftlich',
    'Bevölkerung', 'Bürger', 'Bürgerschaft', 'Staatsbürger', 'Menschheit',
  ]),
];

// ============================================================================
// Module: de-b2 (B2 — Upper Intermediate)
// theme 来源: DIFFICULTY_CONSTRAINTS[4].exampleTopics
// lemma 来源: de/b2.json 前 90 词
// ============================================================================

const deB2Lessons: Lesson[] = [
  buildLesson('de-b2', 1, 'An Editorial on a Civic Issue', 'an editorial on a civic issue', [
    'ermitteln', 'erörtern', 'erarbeiten', 'ausarbeiten', 'abfassen', 'belegen', 'nachweisen', 'fundieren', 'untermauern', 'stützen',
    'fördern', 'beeinträchtigen', 'benachteiligen', 'bevorzugen', 'privilegieren',
  ]),
  buildLesson('de-b2', 2, 'An Essay on Memory', 'a thoughtful essay excerpt on memory', [
    'diskriminieren', 'ausgrenzen', 'integrieren', 'assimilieren', 'reformieren', 'modernisieren', 'optimieren', 'maximieren', 'minimieren', 'standardisieren',
    'normieren', 'regulieren', 'deregulieren', 'subventionieren', 'finanzieren',
  ]),
  buildLesson('de-b2', 3, 'A Scientific Finding', 'a discussion of a scientific finding', [
    'refinanzieren', 'spekulieren', 'hinterfragen', 'relativieren', 'spezifizieren', 'präzisieren', 'konkretisieren', 'generalisieren', 'abstrahieren', 'extrahieren',
    'schlussfolgern', 'urteilen', 'bewerten', 'evaluieren', 'einschätzen',
  ]),
  buildLesson('de-b2', 4, 'A Reflection on Time', 'a philosophical reflection on time', [
    'abschätzen', 'schätzen', 'prognostizieren', 'kalkulieren', 'simulieren', 'akkumulieren', 'aggregieren', 'konsolidieren', 'synchronisieren', 'koordinieren',
    'orchestrieren', 'administrieren', 'delegieren', 'autorisiert', 'legitimieren',
  ]),
  buildLesson('de-b2', 5, 'A Literary Analysis', 'a literary analysis passage', [
    'mandatieren', 'kooperieren', 'kollaborieren', 'korrespondieren', 'interagieren', 'intervenieren', 'partizipieren', 'engagieren', 'rekrutieren', 'implementieren',
    'applizieren', 'installieren', 'konfigurieren', 'konstruieren', 'fabrizieren',
  ]),
  buildLesson('de-b2', 6, 'A Retrospective on a Historical Event', 'a retrospective on a historical event', [
    'generieren', 'kultivieren', 'dominieren', 'prägen', 'lenken', 'beeinflussen', 'wirken', 'voraussetzen', 'annehmen', 'verhindern',
    'verhüten', 'verwirklichen', 'umsetzen', 'durchsetzen', 'vermitteln',
  ]),
];

// ============================================================================
// Course: de-from-en
// ============================================================================

export const deCourse: Course = {
  id: 'de-from-en',
  sourceLanguage: 'en',
  targetLanguage: 'de',
  title: 'German for English Speakers',
  modules: [
    {
      id: 'de-a1',
      courseId: 'de-from-en',
      cefrLevel: 'A1',
      title: 'German A1 — Beginner',
      lessons: deA1Lessons,
      prerequisiteModuleIds: [],
    },
    {
      id: 'de-a2',
      courseId: 'de-from-en',
      cefrLevel: 'A2',
      title: 'German A2 — Elementary',
      lessons: deA2Lessons,
      prerequisiteModuleIds: ['de-a1'],
    },
    {
      id: 'de-b1',
      courseId: 'de-from-en',
      cefrLevel: 'B1',
      title: 'German B1 — Intermediate',
      lessons: deB1Lessons,
      prerequisiteModuleIds: ['de-a2'],
    },
    {
      id: 'de-b2',
      courseId: 'de-from-en',
      cefrLevel: 'B2',
      title: 'German B2 — Upper Intermediate',
      lessons: deB2Lessons,
      prerequisiteModuleIds: ['de-b1'],
    },
  ],
};
