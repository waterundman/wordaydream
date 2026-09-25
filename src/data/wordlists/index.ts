/**
 * v1.6.0 词表按需加载入口
 *
 * 设计:
 * - 动态 import 按需加载, 首屏只加载当前等级词表
 * - 内存缓存, 同一 language:difficulty 只加载一次
 * - C1 (difficulty=5) 无词表, 返回 null
 * - 德语词表在 v1.6.1 加入
 */

import type { DifficultyLevel, Language } from '../../types';
import { getAllCsvEntries } from './csvStorage';

export interface WordlistEntry {
  lemma: string;
  pos: string;
  translation: string;
  cefr: string;
  /** v2: 优先级 1(核心高频)/2(常用)/3(边缘), 决定学习队列顺序. 可选, 旧词表无此字段时排序按默认 2. */
  priority?: 1 | 2 | 3;
  /** v2: 主题簇标签 (core/family/food/...), 让同批 targetWords 同主题. 可选. */
  topic?: string;
  /** v1.6.1 Stage 2: 与此词语义混淆的 lemma 数组 (双向标注). 可选, v1 词表无此字段时 getUnlearnedWordsSync 跳过过滤. */
  semanticConflicts?: string[];
  /**
   * v1.6.2: 例句 (真实语料, 非人工编造). 可选 —— 词表内并非每个词条都能匹配到合格例句,
   * 覆盖率见 docs/vault/v1.6.2-EXAMPLE-LAYER-REPORT.md. UI 一律「存在才渲染」.
   */
  example?: string;
  /** v1.6.2: 例句中文译文. 与 example **同时存在或同时缺失** (verify-wordlists R1 强制). 可选. */
  exampleTranslation?: string;
  /**
   * v1.6.2: 例句出处, 形如 `<source>:<id>` (如 `tatoeba:413789`).
   * 存在的理由是**许可合规**: Tatoeba 数据为 CC-BY 2.0 FR, 署名是许可条件而非可选项.
   * 来源不可考时记 `unknown` —— 不伪造 id.
   */
  exampleSource?: string;
}

export interface Wordlist {
  language: Language;
  level: string;  // 'A1' | 'A2' | 'B1' | 'B2'
  difficulty: DifficultyLevel;
  version: string;
  total: number;
  words: WordlistEntry[];
}

// 按需加载器映射: key = `${language}:${difficulty}`
// 注: JSON 模块的推导类型是宽类型 (language: string / difficulty: number),
//     无法直接满足 Wordlist 契约 (Language union / DifficultyLevel 1-5);
//     词表 JSON 由生成脚本保证结构, 此处统一 as 收窄.
const wordlistLoaders: Record<string, () => Promise<{ default: Wordlist }>> = {
  'en:1': () => import('./en/a1.json') as Promise<{ default: Wordlist }>,
  'en:2': () => import('./en/a2.json') as Promise<{ default: Wordlist }>,
  'en:3': () => import('./en/b1.json') as Promise<{ default: Wordlist }>,
  'en:4': () => import('./en/b2.json') as Promise<{ default: Wordlist }>,
  // v1.6.1 Stage 3: 德语 A1 词表落地 (A2-B2 留 v1.6.2)
  'de:1': () => import('./de/a1.json') as Promise<{ default: Wordlist }>,
  // v1.9.0 Stage 1: 德语 A2 词表落地 (B1-B2 留后续版本)
  'de:2': () => import('./de/a2.json') as Promise<{ default: Wordlist }>,
  // v1.9.0 Stage 3: 德语 B1 词表落地 (B2 留后续版本)
  'de:3': () => import('./de/b1.json') as Promise<{ default: Wordlist }>,
  // v1.9.0 Stage 3: 德语 B2 词表落地 (C1 留不落地)
  'de:4': () => import('./de/b2.json') as Promise<{ default: Wordlist }>,
  // v2.2.0 Stage 2 (D2): CSV 批量导入词表 (动态条目, 从 IndexedDB 合并所有 CSV)
  // 用 { default: ... } 包装以匹配 Record 类型契约 (loadWordlist 访问 module.default)
  'custom:csv': async () => {
    const entries = await getAllCsvEntries();
    return {
      default: {
        language: 'en' as Language,
        level: 'custom',
        difficulty: 1 as DifficultyLevel,
        version: '1.0.0',
        total: entries.length,
        words: entries,
      },
    };
  },
};

// 内存缓存
const cache = new Map<string, Wordlist>();

/**
 * 加载指定语言+难度的词表
 * @returns 词表对象, 或 null (C1 自由阅读 / 未支持语种)
 */
export async function loadWordlist(
  language: Language,
  difficulty: DifficultyLevel
): Promise<Wordlist | null> {
  const key = `${language}:${difficulty}`;
  if (cache.has(key)) return cache.get(key)!;

  const loader = wordlistLoaders[key];
  if (!loader) return null;  // C1 或未支持语种

  const module = await loader();
  const wordlist = module.default;
  cache.set(key, wordlist);
  return wordlist;
}

/**
 * 同步获取已缓存的词表 (用于不需要异步的派生查询)
 * @returns 词表对象, 或 null (未加载 / C1 / 未支持)
 */
export function getCachedWordlist(
  language: Language,
  difficulty: DifficultyLevel
): Wordlist | null {
  const key = `${language}:${difficulty}`;
  return cache.get(key) ?? null;
}

/**
 * 预加载词表 (启动时或难度切换时调用)
 */
export async function preloadWordlist(
  language: Language,
  difficulty: DifficultyLevel
): Promise<void> {
  await loadWordlist(language, difficulty);
}

/**
 * 测试/调试用: 清空缓存
 */
export function clearWordlistCache(): void {
  cache.clear();
}
