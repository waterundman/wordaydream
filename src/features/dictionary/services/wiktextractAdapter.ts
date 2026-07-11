/**
 * wiktextract 字典查询适配器 (Stage 2: 字典 API 集成)
 *
 * 实现设计文档第七节定义的"字典 API + LLM"分工模式:
 * - 本适配器负责提供"结构性事实": 词性, 词源, 语法标注, 真实例句
 * - LLM 负责将字典释义翻译/改写为自然流畅的中文
 *
 * 数据源选型 (项目设计总结第七节): Wiktionary REST API
 * - 端点: https://<lang>.wiktionary.org/api/rest_v1/page/definition/{lemma}
 * - 优点: 免费, CORS 支持, 覆盖英/德, 不需要解析 wikitext
 * - 备选 (未选): 直接解析 wikitext (脆弱, CORS 风险)
 *
 * Fallback 策略 (项目设计总结第七节): 字典查询失败时, 不得抛错给 UI 层,
 * 必须回退到 mock 词典 + 控制台警告, 保证演示可用性.
 *
 * Mock 词典: 覆盖 10 个常用英语词 + 10 个常用德语词, 包含词性, 词源,
 * 真实例句, 德语语法信息, 与 v0.2.0 已有 mock 数据保持一致风格.
 */

import type {
  DictionaryAdapter,
  DictionaryEntry,
  Language,
} from '../../../types';
import { LRUCache } from './cache';

/* eslint-disable @typescript-eslint/no-magic-numbers */

const WIKTIONARY_REST_BASE: Record<Language, string> = {
  en: 'https://en.wiktionary.org/api/rest_v1/page/definition',
  de: 'https://de.wiktionary.org/api/rest_v1/page/definition',
};

const REQUEST_TIMEOUT_MS = 4000;
const CACHE_CAPACITY = 100;

/* ============================================================
 * Mock 词典 (离线兜底数据)
 * ============================================================ */

const MOCK_DICTIONARY: Record<Language, Record<string, DictionaryEntry>> = {
  en: {
    apple: {
      lemma: 'apple',
      language: 'en',
      partOfSpeech: 'noun',
      etymology: '源自古英语 "æppel", 与日耳曼语族同源 (German Apfel, Swedish äpple).',
      definitions: [
        'A round fruit with red, green, or yellow skin and a whitish interior, growing on trees of the genus Malus.',
        'The tree that bears this fruit.',
      ],
      examples: [
        'She bit into a crisp red apple.',
        'Apple trees line the country road.',
      ],
      source: 'mock',
    },
    walk: {
      lemma: 'walk',
      language: 'en',
      partOfSpeech: 'verb',
      etymology: '源自古英语 "wealcan" (滚动, 转动), 经中古英语演变为"行走"义.',
      definitions: [
        'To move at a regular and fairly slow pace by lifting and setting down each foot in turn.',
        'To travel on foot for recreation or exercise.',
      ],
      examples: [
        'They walked along the beach at sunset.',
        'I walk to work every morning.',
      ],
      source: 'mock',
    },
    discover: {
      lemma: 'discover',
      language: 'en',
      partOfSpeech: 'verb',
      etymology: '源自古法语 "descouvrir" (揭开遮盖物), 拉丁词根 dis- + cooperire.',
      definitions: [
        'To find something or someone unexpectedly or in the course of a search.',
        'To become aware of a fact or situation.',
      ],
      examples: [
        'Columbus is credited with discovering the New World in 1492.',
        'Scientists have discovered a new species of deep-sea fish.',
      ],
      source: 'mock',
    },
    revolution: {
      lemma: 'revolution',
      language: 'en',
      partOfSpeech: 'noun',
      etymology: '源自拉丁语 "revolutio" (滚动, 翻转), 后期引申为天体运行, 政治变革.',
      definitions: [
        'A forcible overthrow of a government or social order, in favour of a new system.',
        'A dramatic and wide-reaching change in ideas, methods, or practices.',
        'The orbiting of one celestial body around another; one complete orbit.',
      ],
      examples: [
        'The industrial revolution transformed European society.',
        'The digital revolution has reshaped how we communicate.',
      ],
      source: 'mock',
    },
    quintessential: {
      lemma: 'quintessential',
      language: 'en',
      partOfSpeech: 'adjective',
      etymology: '源自中世纪拉丁语 "quintessentialis", 与亚里士多德"第五元素" ( quinta essentia ) 概念相关.',
      definitions: [
        'Representing the most perfect or typical example of a quality or class.',
      ],
      examples: [
        'She was the quintessential teacher: patient, wise, and inspiring.',
      ],
      source: 'mock',
    },
    run: {
      lemma: 'run',
      language: 'en',
      partOfSpeech: 'verb',
      etymology: '源自古英语 "rinnan" / "irnan" (流动, 奔跑), 与德语 rinnen 同源.',
      definitions: [
        'Move at a speed faster than a walk, never having both or all feet on the ground at the same time.',
        'Operate or function; cause to operate or function.',
        'Extend or stretch in a particular direction.',
      ],
      examples: [
        'The dog ran across the field after the ball.',
        'The river runs through the valley for miles.',
      ],
      source: 'mock',
    },
    house: {
      lemma: 'house',
      language: 'en',
      partOfSpeech: 'noun',
      etymology: '源自古英语 "hus", 原始日耳曼语 *husą, 与古高地德语 hus 同源.',
      definitions: [
        'A building for human habitation, especially one that is lived in by a family or small group of people.',
        'A building in which people meet for a particular purpose (e.g. opera house).',
      ],
      examples: [
        'Their house sits on a quiet street at the edge of town.',
        'We visited the museum house where the poet once lived.',
      ],
      source: 'mock',
    },
    beautiful: {
      lemma: 'beautiful',
      language: 'en',
      partOfSpeech: 'adjective',
      etymology: '中古英语 "beauté" (美) + 形容词后缀 -ful.',
      definitions: [
        'Pleasing the senses or mind aesthetically.',
        'Of a very high standard; excellent.',
      ],
      examples: [
        'The sunset over the ocean was absolutely beautiful.',
        'What a beautiful piece of music.',
      ],
      source: 'mock',
    },
    understand: {
      lemma: 'understand',
      language: 'en',
      partOfSpeech: 'verb',
      etymology: '源自古英语 "understandan", 字面意思"站在…之中", 引申为领会.',
      definitions: [
        'Perceive the intended meaning of (words, a language, or a speaker).',
        'Be aware of the significance or explanation of something.',
      ],
      examples: [
        'I don\'t understand what you\'re trying to say.',
        'It took her a moment to understand the joke.',
      ],
      source: 'mock',
    },
    knowledge: {
      lemma: 'knowledge',
      language: 'en',
      partOfSpeech: 'noun',
      etymology: '中古英语 "knowleche" 知晓, 承认, 来自古英语 "cnaw" (知道) + 后缀.',
      definitions: [
        'Information, understanding, or skills gained through experience or education.',
        'The state of being aware of something.',
      ],
      examples: [
        'A good teacher shares both knowledge and curiosity.',
        'Self-knowledge is the beginning of wisdom.',
      ],
      source: 'mock',
    },
  },
  de: {
    Haus: {
      lemma: 'Haus',
      language: 'de',
      partOfSpeech: 'Substantiv (Neutrum)',
      etymology: '源自古高地德语 "hūs", 原始日耳曼语 *husą, 与英语 house 同源.',
      definitions: [
        'Ein Gebäude, das Menschen als Wohnung dient.',
      ],
      examples: [
        'Das Haus am See gehört meinen Großeltern.',
        'Sie verließ das Haus früh am Morgen.',
      ],
      grammaticalInfo: {
        gender: 'das',
        plural: 'die Häuser',
        cases: ['Nominativ: das Haus', 'Akkusativ: das Haus', 'Dativ: dem Haus(e)', 'Genitiv: des Hauses'],
      },
      source: 'mock',
    },
    laufen: {
      lemma: 'laufen',
      language: 'de',
      partOfSpeech: 'Verb',
      etymology: '源自古高地德语 "loufan", 原始日耳曼语 *hlaupaną.',
      definitions: [
        'Sich mit schneller Schrittgeschwindigkeit fortbewegen.',
        'Funktionieren, in Betrieb sein.',
      ],
      examples: [
        'Er läuft jeden Morgen fünf Kilometer.',
        'Die Maschine läuft seit Stunden ohne Probleme.',
      ],
      grammaticalInfo: {
        separablePrefix: undefined,
        cases: ['Präsens: läuft', 'Präteritum: lief', 'Perfekt: ist gelaufen'],
      },
      source: 'mock',
    },
    entdecken: {
      lemma: 'entdecken',
      language: 'de',
      partOfSpeech: 'Verb',
      etymology: '由前缀 ent- (去除, 反) + decken (覆盖) 构成, 字面"揭开遮盖".',
      definitions: [
        'Etwas Verborgenes, Unbekanntes finden oder wahrnehmen.',
      ],
      examples: [
        'Kolumbus entdeckte 1492 die Neue Welt.',
        'Im Urlaub entdeckte sie ihre Liebe zur Fotografie.',
      ],
      grammaticalInfo: {
        cases: ['Präsens: entdeckt', 'Präteritum: entdeckte', 'Perfekt: hat entdeckt'],
      },
      source: 'mock',
    },
    Revolution: {
      lemma: 'Revolution',
      language: 'de',
      partOfSpeech: 'Substantiv (Femininum)',
      etymology: '借自法语 "révolution", 拉丁语 revolutio (滚动, 翻转).',
      definitions: [
        'Ein grundlegender, oft gewaltsamer politischer und gesellschaftlicher Umbruch.',
        'Eine umwälzende Neuerung.',
      ],
      examples: [
        'Die industrielle Revolution veränderte ganz Europa.',
        'Die Französische Revolution begann 1789.',
      ],
      grammaticalInfo: {
        gender: 'die',
        plural: 'die Revolutionen',
        cases: ['Nominativ: die Revolution', 'Akkusativ: die Revolution', 'Dativ: der Revolution', 'Genitiv: der Revolution'],
      },
      source: 'mock',
    },
    Vollendung: {
      lemma: 'Vollendung',
      language: 'de',
      partOfSpeech: 'Substantiv (Femininum)',
      etymology: 'vollenden (完成) 的名词化, 由前缀 voll- + Endung 构成.',
      definitions: [
        'Das Zu-Ende-Bringen einer Sache.',
        'Ein Zustand höchster Vollkommenheit.',
      ],
      examples: [
        'Mit dem letzten Pinselstrich erreichte das Kunstwerk seine Vollendung.',
      ],
      grammaticalInfo: {
        gender: 'die',
        plural: 'die Vollendungen (selten)',
        cases: ['Nominativ: die Vollendung', 'Akkusativ: die Vollendung', 'Dativ: der Vollendung', 'Genitiv: der Vollendung'],
      },
      source: 'mock',
    },
    verstehen: {
      lemma: 'verstehen',
      language: 'de',
      partOfSpeech: 'Verb',
      etymology: '由前缀 ver- + stehen 构成, 字面"站在另一方角度看", 引申为理解.',
      definitions: [
        'Den Sinn von etwas erfassen; begreifen.',
        'Sich auf etwas verstehen: Kenntnisse in etwas haben.',
      ],
      examples: [
        'Ich verstehe nicht, was du meinst.',
        'Er versteht etwas von klassischer Musik.',
      ],
      grammaticalInfo: {
        cases: ['Präsens: versteht', 'Präteritum: verstand', 'Perfekt: hat verstanden'],
      },
      source: 'mock',
    },
    Krankenhaus: {
      lemma: 'Krankenhaus',
      language: 'de',
      partOfSpeech: 'Substantiv (Neutrum)',
      etymology: '德语复合词: Kranken (病人, 复数) + Haus (房子). 典型"复合词拆分"展示案例.',
      definitions: [
        'Eine Einrichtung, in der Kranke behandelt und gepflegt werden.',
      ],
      examples: [
        'Sie wurde ins Krankenhaus eingeliefert.',
        'Das neue Krankenhaus verfügt über 500 Betten.',
      ],
      grammaticalInfo: {
        gender: 'das',
        plural: 'die Krankenhäuser',
        cases: ['Nominativ: das Krankenhaus', 'Akkusativ: das Krankenhaus', 'Dativ: dem Krankenhaus', 'Genitiv: des Krankenhauses'],
      },
      source: 'mock',
    },
    schön: {
      lemma: 'schön',
      language: 'de',
      partOfSpeech: 'Adjektiv',
      etymology: '源自古高地德语 "scōni", 原始日耳曼语 *skauniz (可观的, 漂亮的).',
      definitions: [
        'Eine ästhetisch ansprechende Erscheinung habend.',
        'Angenehm, erfreulich.',
      ],
      examples: [
        'Das Wetter heute ist wirklich schön.',
        'Sie hat eine schöne Stimme.',
      ],
      source: 'mock',
    },
    Wissen: {
      lemma: 'Wissen',
      language: 'de',
      partOfSpeech: 'Substantiv (Neutrum)',
      etymology: '源自古高地德语 "wizzan", 原始日耳曼语 *witaną (知道).',
      definitions: [
        'Die Gesamtheit der Kenntnisse, die jemand auf einem bestimmten Gebiet hat.',
        'Sicheres Bewusstsein von etwas.',
      ],
      examples: [
        'Ihr Wissen über die Geschichte des 20. Jahrhunderts ist beeindruckend.',
        'Wissen ist Macht.',
      ],
      grammaticalInfo: {
        gender: 'das',
        cases: ['Nominativ: das Wissen', 'Akkusativ: das Wissen', 'Dativ: dem Wissen', 'Genitiv: des Wissens'],
      },
      source: 'mock',
    },
    gehen: {
      lemma: 'gehen',
      language: 'de',
      partOfSpeech: 'Verb',
      etymology: '源自古高地德语 "gēn", 原始日耳曼语 *gāną.',
      definitions: [
        'Sich zu Fuß fortbewegen.',
        'Eine bestimmte Richtung oder ein Ziel einschlagen.',
        'Funktionieren, in Ordnung sein.',
      ],
      examples: [
        'Wir gehen heute Abend ins Kino.',
        'Wie geht es dir?',
      ],
      grammaticalInfo: {
        cases: ['Präsens: geht', 'Präteritum: ging', 'Perfekt: ist gegangen'],
      },
      source: 'mock',
    },
  },
};

/* ============================================================
 * 内部: Wiktionary REST API 响应类型 (简化版, 仅取所需字段)
 * ============================================================ */

interface WiktionaryDefinitionGroup {
  partOfSpeech: string;
  languageCode: string;
  definitions?: Array<{
    definition?: string;
    examples?: string[];
  }>;
}

interface WiktionaryResponse {
  [languageCode: string]: WiktionaryDefinitionGroup[];
}

/* ============================================================
 * Adapter 实现
 * ============================================================ */

export class WiktextractAdapter implements DictionaryAdapter {
  private readonly cache: LRUCache<DictionaryEntry>;
  private readonly inflight: Map<string, Promise<DictionaryEntry | null>>;

  constructor() {
    this.cache = new LRUCache<DictionaryEntry>({ capacity: CACHE_CAPACITY });
    this.inflight = new Map();
  }

  /**
   * 查询词条
   *
   * 流程:
   * 1. 规范化输入 (trim + toLowerCase 作为缓存 key 的一部分)
   * 2. 命中缓存直接返回
   * 3. 并发去重: 同一 key 已有 in-flight 请求, 等待同一 promise
   * 4. 调 Wiktionary REST API, 解析 JSON
   * 5. 解析失败 / 词条不存在 / 网络错误 -> 回退 mock, 控制台警告
   */
  async fetchEntry(
    lemma: string,
    language: Language
  ): Promise<DictionaryEntry | null> {
    const normalized = lemma.trim();
    if (!normalized) return null;

    const cacheKey = this.buildCacheKey(normalized, language);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 并发去重: 同一请求只发一次
    const existing = this.inflight.get(cacheKey);
    if (existing) return existing;

    const promise = this.queryRemoteOrMock(normalized, language, cacheKey)
      .finally(() => {
        this.inflight.delete(cacheKey);
      });
    this.inflight.set(cacheKey, promise);
    return promise;
  }

  clearCache(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  /**
   * 远程查询 + mock fallback
   */
  private async queryRemoteOrMock(
    lemma: string,
    language: Language,
    cacheKey: string
  ): Promise<DictionaryEntry | null> {
    try {
      const entry = await this.fetchFromWiktionary(lemma, language);
      if (entry) {
        this.cache.set(cacheKey, entry);
        return entry;
      }
    } catch (err) {
      // 不抛错给 UI 层, 只在控制台记录
      // eslint-disable-next-line no-console
      console.warn(
        `[wiktextractAdapter] remote query failed for "${lemma}" (${language}); falling back to mock.`,
        err instanceof Error ? err.message : err
      );
    }
    return this.fallbackToMock(lemma, language, cacheKey);
  }

  /**
   * Wiktionary REST API 查询
   */
  private async fetchFromWiktionary(
    lemma: string,
    language: Language
  ): Promise<DictionaryEntry | null> {
    const base = WIKTIONARY_REST_BASE[language];
    const url = `${base}/${encodeURIComponent(lemma)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Api-User-Agent': 'Wordaydream/0.3.0 (language learning demo)',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 404) {
      // 词条确实不存在, 显式返回 null
      return null;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as WiktionaryResponse;
    const entry = this.parseWiktionaryResponse(data, lemma, language);
    return entry;
  }

  /**
   * 解析 Wiktionary REST API 返回的 JSON
   *
   * 响应结构示例:
   * {
   *   "en": [
   *     { "partOfSpeech": "noun", "definitions": [{ "definition": "...", "examples": ["..."] }] }
   *   ]
   * }
   */
  private parseWiktionaryResponse(
    data: WiktionaryResponse,
    lemma: string,
    language: Language
  ): DictionaryEntry | null {
    // 取与目标语言匹配的分组
    const groups = data[language];
    if (!Array.isArray(groups) || groups.length === 0) {
      return null;
    }

    // 优先取第一个非空定义组
    const group = groups.find(
      (g) => Array.isArray(g.definitions) && g.definitions.length > 0
    );
    if (!group) {
      return null;
    }

    const definitions: string[] = [];
    const examples: string[] = [];
    for (const def of group.definitions ?? []) {
      if (def.definition) {
        // 去除 wikitext 残留的方括号引用标记 [1], [编辑] 等
        const clean = def.definition
          .replace(/\[\d+\]/g, '')
          .replace(/\[\s*edit\s*\w*\s*\]/gi, '')
          .trim();
        if (clean) definitions.push(clean);
      }
      if (Array.isArray(def.examples)) {
        for (const ex of def.examples) {
          const clean = ex
            .replace(/\[\d+\]/g, '')
            .replace(/\[\s*edit\s*\w*\s*\]/gi, '')
            .trim();
          if (clean) examples.push(clean);
        }
      }
    }

    if (definitions.length === 0) {
      return null;
    }

    return {
      lemma,
      language,
      partOfSpeech: this.normalizePartOfSpeech(group.partOfSpeech),
      definitions: definitions.slice(0, 3),
      examples: examples.slice(0, 2),
      source: 'wiktextract',
    };
  }

  /**
   * 词性归一化
   *
   * Wiktionary 返回的词性可能不统一, 这里做基础规范化:
   * - "noun" / "Noun" / "Substantiv" -> "noun" / "Substantiv (...性别)"
   */
  private normalizePartOfSpeech(pos: string | undefined): string {
    if (!pos) return 'unknown';
    const trimmed = pos.trim();
    if (!trimmed) return 'unknown';
    // 德语词性在 Wiktionary REST API 中可能附带性别括号, 原样保留更准确
    return trimmed;
  }

  /**
   * Mock 词典 fallback
   */
  private fallbackToMock(
    lemma: string,
    language: Language,
    cacheKey: string
  ): DictionaryEntry | null {
    // 先按原始大小写查 (德语名词首字母大写), 再按 lowercase 查
    const table = MOCK_DICTIONARY[language];
    const direct = table[lemma] ?? table[lemma.toLowerCase()];
    if (direct) {
      this.cache.set(cacheKey, direct);
      return direct;
    }

    // 未命中时, 返回一个"未知词"占位 entry (避免 UI 拿到 null 渲染空白)
    return {
      lemma,
      language,
      partOfSpeech: 'unknown',
      definitions: ['(演示数据未覆盖该词)'],
      source: 'mock',
    };
  }

  private buildCacheKey(lemma: string, language: Language): string {
    return `${language}::${lemma.toLowerCase()}`;
  }
}

/* ============================================================
 * 默认单例 (供 glossAdapter 等模块直接引用)
 * ============================================================ */

let defaultAdapter: WiktextractAdapter | null = null;

export function getDictionaryAdapter(): WiktextractAdapter {
  if (!defaultAdapter) {
    defaultAdapter = new WiktextractAdapter();
  }
  return defaultAdapter;
}

/**
 * 便于测试/调试: 重置默认单例
 */
export function resetDictionaryAdapter(): void {
  defaultAdapter = null;
}
