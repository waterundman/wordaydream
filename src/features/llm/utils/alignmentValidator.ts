/**
 * Alignment Validator (Stage 2: 核心校验层)
 *
 * 验证 + 校正 LLM 输出的 char interval, 保证 token / grammarPoint 的
 * startIndex / endIndex 与 surfaceForm 100% 对齐.
 *
 * 设计灵感: Google LangExtract 5 步对齐协议
 *
 * 5 步协议 (按顺序):
 *   1. exact match      text.slice(start, end) === surfaceForm      -> 'perfect'
 *   2. case-insensitive 切片的 lower === surfaceForm 的 lower        -> 'corrected'
 *   3. fuzzy match      Levenshtein(sliced, surfaceForm) <= 2        -> 'corrected'
 *   4. first index      text.indexOf(surfaceForm) >= 0              -> 'fallback'
 *   5. not found                                                       -> 'dropped'
 *
 * 调用方过滤 status === 'dropped' 的 token, 不进入渲染.
 *
 * 与 v1.0.0 关系:
 * - v1.0.0 InteractivePassage.tsx L144-159 的 isValidRange 仅丢弃越界,
 *   不校正, 也不 fuzzy
 * - v1.1.0 这里用 alignment validator 兜底 LLM offset 错位
 *
 * 引用:
 * - SPEC v1.1.0/main.md Stage 2
 * - cache/v1.1.0/functional/alignment-validation-research.md
 */

import { levenshtein } from './levenshtein';

/** fuzzy match 允许的最大编辑距离 (含) */
const MAX_FUZZY_DISTANCE = 2;

/**
 * 对齐结果状态:
 * - perfect:   LLM 原 offset 严格匹配, 零修改
 * - corrected: 原 offset 不完美, 但 fuzzy / case 校正后 OK
 * - fallback:  原 offset 完全无效, 改用 text.indexOf 找第一个匹配
 * - dropped:   完全找不到 surfaceForm, 不进入渲染
 */
export type AlignmentStatus = 'perfect' | 'corrected' | 'fallback' | 'dropped';

/**
 * 一次 validateToken 的返回结果
 *
 * - start / end: 校正后的 char offset (给 token 渲染用)
 * - status:      校正类型 (用于 alignmentStats 监控)
 * - originalOffset: LLM 给的原始 offset, 用于调试
 * - surfaceForm: 校正后的 content (与校正后的 start..end 切片一致)
 */
export interface AlignmentResult {
  start: number;
  end: number;
  status: AlignmentStatus;
  originalOffset: { start: number; end: number };
  surfaceForm: string;
}

/**
 * 可被 validateToken 处理的最小 token 形状
 *
 * 设计为 duck-typed: 任何含 startIndex / endIndex / surfaceForm 的对象
 * 都可以传入, 不依赖具体 PassageJsonPayload 类型. 这样 grammarPoint
 * (有 startIndex / endIndex / text) 也能复用 (传 text 作为 surfaceForm).
 */
export interface TokenLike {
  startIndex: number;
  endIndex: number;
  surfaceForm: string;
}

/**
 * 5 步对齐协议 — 验证 + 校正单个 token
 *
 * 输入:
 *   token: { startIndex, endIndex, surfaceForm }
 *   text:  passage 全文 (必须是 normalizedText 之后的字符串)
 *
 * 返回:
 *   AlignmentResult, 包含校正后的 offset + status + 原始 offset 记录
 *
 * 注意:
 * - startIndex / endIndex 越界时, 跳过 exact/case/fuzzy, 直接走 indexOf
 * - endIndex <= startIndex 也视为无效, 走 indexOf
 * - 找不到时返回 { start: 0, end: 0, status: 'dropped' }, 调用方负责过滤
 */
export function validateToken(token: TokenLike, text: string): AlignmentResult {
  const { startIndex, endIndex, surfaceForm } = token;
  const originalOffset = { start: startIndex, end: endIndex };

  // 计算切片 + 范围合法性
  const inRange =
    startIndex >= 0 &&
    endIndex <= text.length &&
    endIndex >= startIndex;
  const sliced = inRange ? text.slice(startIndex, endIndex) : '';

  // Step 1: exact match (case-sensitive)
  if (inRange && sliced === surfaceForm) {
    return {
      start: startIndex,
      end: endIndex,
      status: 'perfect',
      originalOffset,
      surfaceForm,
    };
  }

  // Step 2: case-insensitive match — 用 surfaceForm 原 case 替换切片
  if (inRange && sliced.toLowerCase() === surfaceForm.toLowerCase()) {
    return {
      start: startIndex,
      end: endIndex,
      status: 'corrected',
      originalOffset,
      surfaceForm,
    };
  }

  // Step 3: fuzzy match (Levenshtein <= MAX_FUZZY_DISTANCE)
  // 早期剪枝: 长度差 > MAX 时, 至少需要 |lenA - lenB| 次 insert/delete
  if (
    inRange &&
    sliced.length > 0 &&
    Math.abs(sliced.length - surfaceForm.length) <= MAX_FUZZY_DISTANCE &&
    levenshtein(sliced, surfaceForm) <= MAX_FUZZY_DISTANCE
  ) {
    return {
      start: startIndex,
      end: endIndex,
      status: 'corrected',
      originalOffset,
      surfaceForm,
    };
  }

  // Step 4: first index search — 用 text.indexOf(surfaceForm) 找第一次出现
  const idx = text.indexOf(surfaceForm);
  if (idx >= 0) {
    return {
      start: idx,
      end: idx + surfaceForm.length,
      status: 'fallback',
      originalOffset,
      surfaceForm,
    };
  }

  // Step 5: not found — dropped
  return {
    start: 0,
    end: 0,
    status: 'dropped',
    originalOffset,
    surfaceForm,
  };
}

/**
 * 统计字段: 5 个 (perfect / corrected / fallback / dropped / total)
 *
 * 用于 llmAdapter.console.info('[Alignment]', stats) 上报监控.
 *
 * 注: total 是 results.length, 包含所有 status (含 dropped),
 * 表示 LLM 原 token 数; perfect / corrected / fallback / dropped 是实际分类.
 */
export interface AlignmentStats {
  perfect: number;
  corrected: number;
  fallback: number;
  dropped: number;
  total: number;
}

/**
 * 对一批 AlignmentResult 计数
 */
export function summarizeAlignment(results: AlignmentResult[]): AlignmentStats {
  const stats: AlignmentStats = {
    perfect: 0,
    corrected: 0,
    fallback: 0,
    dropped: 0,
    total: results.length,
  };
  for (const r of results) {
    stats[r.status]++;
  }
  return stats;
}
