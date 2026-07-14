/**
 * v1.5.2 Stage 4 (P2_1): Grammar detector 函数化 provider 模式 (llm 路径打通)
 *
 * 沿用 v1.5.0 Stage 3 函数式 provider 模式 — 3 个独立函数 + selector 函数.
 * 本次 Stage 4 升级点:
 * - selectProvider: 真实 LLM provider (openai/anthropic/deepseek/kimi/qwen/minimax)
 *   + enabled=true → 'llm' 路径 (旧版 v1.5.0 全部走 heuristic, 路径不通)
 * - llmDetectGrammarPoints: 加 try/catch 包装, 失败时回退到 mock (而不是抛给上游)
 * - heuristic 路径保持 (作为未知 provider 的安全 fallback, 0 break)
 *
 * 0 breaking change:
 * - 旧 detectGrammarPoints (grammarDetector.ts) 沿用, 不修改签名
 * - selectProvider 默认行为: mock provider 或 disabled → 'mock' (与 v1.5.0 一致)
 * - heuristic 路径仍可访问 (测试友好, 兼容旧调用)
 * - 新增的 'llm' 路径仅在 openai/anthropic/deepseek/kimi/qwen/minimax + enabled 时启用
 *
 * v1.5.2 selector 三分支:
 * - settings.llm.provider === 'mock' || !settings.llm.enabled → 'mock'
 * - openai/anthropic/deepseek/kimi/qwen/minimax + enabled → 'llm'
 * - 其它 (未知 provider) → 'heuristic' (安全 fallback)
 *
 * Fallback 策略 (v1.5.2 加强):
 * - heuristic / mock / llm 任一抛错 → 回退 mockDetectGrammarPoints
 * - mock 抛错 → 返回空数组 (不抛)
 * - llm provider 内部抛错 → 内部 catch 回退 mock (不传给主入口 catch)
 */

import { useSettingsStore } from '../../settings/store/useSettingsStore';
import type { GrammarPoint, Language } from '../../../types';
import { mockGrammarPoints } from './grammarDetector';

/**
 * v1.5.0 Stage 3: Grammar provider 类型 (3 选 1)
 */
export type GrammarProvider = 'heuristic' | 'mock' | 'llm';

/**
 * v1.5.0 Stage 3: Provider 注入容器 (可选参数, 用于测试)
 *
 * 不传时使用 defaultProviders (生产路径). 传时使用注入的 providers (测试路径).
 * 这是 R-8 兑现的关键设计: 双签名 0 破坏 + 测试友好.
 */
export type GrammarProviders = {
  heuristic: (text: string, language: Language) => Promise<GrammarPoint[]>;
  mock: (text: string, language: Language) => Promise<GrammarPoint[]>;
  llm: (text: string, language: Language) => Promise<GrammarPoint[]>;
};

/**
 * v1.5.0 Stage 3: 启发式 provider — 纯字符串规则, 0 LLM, 0 mock
 *
 * 规则:
 * - /\b(was|were)\s+\w+ing\b/gi → 时态 (difficulty 2)
 * - /\bhad\s+\w+ed\b/gi → 时态 (difficulty 3)
 * - /\bcan\s+\w+\b/gi → 情态动词 (difficulty 1)
 * - /\bwhen\s+\w+\b/gi → 时间状语从句 (difficulty 2)
 * - /\bwhat\s+\w+\b/gi → 名词性从句 (difficulty 3)
 *
 * 最多返回 3 个匹配项. 非英文 (de) 输入同样处理 (规则不一定匹配).
 */
export async function heuristicDetectGrammarPoints(
  text: string,
  language: Language,
): Promise<GrammarPoint[]> {
  const rulePatterns: Array<{ regex: RegExp; type: string; difficulty: 1 | 2 | 3 | 4 | 5 }> = [
    { regex: /\b(was|were)\s+\w+ing\b/gi, type: '时态', difficulty: 2 },
    { regex: /\bhad\s+\w+ed\b/gi, type: '时态', difficulty: 3 },
    { regex: /\bcan\s+\w+\b/gi, type: '情态动词', difficulty: 1 },
    { regex: /\bwhen\s+\w+\b/gi, type: '时间状语从句', difficulty: 2 },
    { regex: /\bwhat\s+\w+\b/gi, type: '名词性从句', difficulty: 3 },
  ];

  const points: GrammarPoint[] = [];
  for (const { regex, type, difficulty } of rulePatterns) {
    let match: RegExpExecArray | null;
    // 重置 regex.lastIndex 避免全局正则状态污染
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null && points.length < 3) {
      points.push({
        id: `heuristic-${language}-${match.index}`,
        text: match[0],
        type,
        difficulty,
        explanation: `Detected by heuristic rule: ${regex.source}`,
        examples: [],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        isActive: false,
      });
    }
    if (points.length >= 3) break;
  }

  return points;
}

/**
 * v1.5.0 Stage 3: Mock provider — 复用 grammarDetector.ts mockGrammarPoints
 *
 * 选取前 3 个 mock 知识点, 分配到 text 中的位置 (确定性, 不使用 Math.random).
 * 这是与 grammarDetector.ts mockDetectGrammarPoints 的区别:
 * - 原始: Math.random() 位置
 * - functional: 顺序位置 (lastIndex + 10)
 */
export async function mockDetectGrammarPoints(
  text: string,
  language: Language,
): Promise<GrammarPoint[]> {
  const candidates = mockGrammarPoints[language];
  const count = Math.min(3, candidates.length);
  const selected = candidates.slice(0, count);
  const textLen = text.length;

  let lastIndex = 0;
  return selected.map((gp) => {
    const startIndex = Math.min(lastIndex + 10, Math.max(0, textLen - 10));
    const endIndex = Math.min(startIndex + gp.text.length, textLen);
    lastIndex = endIndex;
    return {
      ...gp,
      startIndex,
      endIndex,
      isActive: false,
    };
  });
}

/**
 * v1.5.0 Stage 3: LLM provider — 委托给 grammarDetector.ts detectGrammarPoints
 *
 * v1.5.2 Stage 4 升级: 加 try/catch 包装, 失败时回退到 mock 知识点的最小占位.
 * - 旧 v1.5.0 行为: 抛错给上游 (主入口 catch 才会处理)
 * - 新 v1.5.2 行为: 内部 catch, 失败时返回 mock 风格的 fallback (source 不变, 仅 provider 内部 fallback)
 * - 真实 LLM 集成沿用 grammarDetector.ts detectGrammarPoints (已含 router + fallback)
 */
export async function llmDetectGrammarPoints(
  text: string,
  language: Language,
): Promise<GrammarPoint[]> {
  try {
    const { detectGrammarPoints } = await import('./grammarDetector');
    return await detectGrammarPoints(text, language);
  } catch {
    // v1.5.2: 失败回退到 mock 知识点最小占位 (不抛给上游)
    const candidates = mockGrammarPoints[language];
    return candidates.slice(0, Math.min(3, candidates.length)).map((gp, i) => ({
      ...gp,
      startIndex: i * 10,
      endIndex: i * 10 + gp.text.length,
      isActive: false,
    }));
  }
}

/**
 * v1.5.0 Stage 3: Provider selector — 根据 settings 选 provider
 *
 * v1.5.2 Stage 4 升级: 真实 LLM provider + enabled → 'llm' 路径打通.
 *
 * 规则 (v1.5.2 三分支):
 * - settings.llm.provider === 'mock' || !settings.llm.enabled → 'mock'
 * - openai/anthropic/deepseek + enabled → 'llm' (新增, 旧版 v1.5.0 走 heuristic)
 *   (v2.1.1 Stage 3 / D3: 已移除 kimi/qwen/minimax, 这些 provider 无后端实现)
 * - 其它 (未知 provider) → 'heuristic' (安全 fallback, 0 break)
 */
export async function selectProvider(): Promise<GrammarProvider> {
  const { llm } = useSettingsStore.getState();
  // 1. mock provider 或 disabled → mock (与 v1.5.0 一致, 0 break)
  if (llm.provider === 'mock' || !llm.enabled) {
    return 'mock';
  }
  // 2. 真实 LLM provider + enabled → llm (v1.5.2 路径打通)
  if (
    llm.provider === 'openai' ||
    llm.provider === 'anthropic' ||
    llm.provider === 'deepseek'
  ) {
    return 'llm';
  }
  // 3. 其它 (未知 provider) → heuristic (安全 fallback, 0 break)
  return 'heuristic';
}

/**
 * v1.5.0 Stage 3: 主入口 — 函数式 provider 模式
 *
 * 流程:
 * 1. selectProvider() 选定 provider
 * 2. 调对应 provider 函数
 * 3. 抛错 → 回退 mockDetectGrammarPoints
 *
 * 0 breaking change: 与 detectGrammarPoints 共存, 调用方按需选用.
 *
 * 参数:
 * - text: 输入文本
 * - language: 语言类型
 * - providers: 可选 provider 注入, 默认为 defaultProviders (生产路径).
 *   测试可通过此参数注入失败 provider, 验证 catch 块回退逻辑.
 */
export async function detectGrammarPointsFunctional(
  text: string,
  language: Language,
  providers: GrammarProviders = defaultGrammarProviders,
): Promise<GrammarPoint[]> {
  const provider = await selectProvider();
  try {
    switch (provider) {
      case 'heuristic':
        return await providers.heuristic(text, language);
      case 'mock':
        return await providers.mock(text, language);
      case 'llm':
        return await providers.llm(text, language);
      default: {
        // 不应到达 (穷尽性检查)
        const _exhaustive: never = provider;
        return _exhaustive;
      }
    }
  } catch {
    // 任一 provider 抛错 → 回退 mock
    try {
      return await providers.mock(text, language);
    } catch {
      // mock 也失败 → 返回空数组 (与原 mockDetectGrammarPoints 行为一致)
      return [];
    }
  }
}

/**
 * v1.5.0 Stage 3: 默认 provider 容器 (生产路径)
 *
 * 注: 必须在 detectGrammarPointsFunctional 之后定义 (JS hoisting) —
 *     detectGrammarPointsFunctional 引用 providers 参数, 不直接引用此 default.
 *     实际上 defaultGrammarProviders 用作可选参数默认值, 在调用时按需解析.
 */
const defaultGrammarProviders: GrammarProviders = {
  heuristic: heuristicDetectGrammarPoints,
  mock: mockDetectGrammarPoints,
  llm: llmDetectGrammarPoints,
};
