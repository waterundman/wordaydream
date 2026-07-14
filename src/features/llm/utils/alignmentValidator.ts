/**
 * Alignment Validator (Stage 2: 核心校验层)
 *
 * 验证 + 校正 LLM 输出的 char interval, 保证 token / grammarPoint 的
 * startIndex / endIndex 与 surfaceForm 100% 对齐.
 *
 * 设计灵感: Google LangExtract 5 步对齐协议
 *
 * v2.2.3 Stage 1 (D1-1): 6 步协议 (在 Step 4 / Step 5 之间插入 Step 4.5 宽松匹配层)
 *
 * 6 步协议 (按顺序):
 *   1. exact match      text.slice(start, end) === surfaceForm      -> 'perfect'
 *   2. case-insensitive 切片的 lower === surfaceForm 的 lower        -> 'corrected'
 *   3. fuzzy match      Levenshtein(sliced, surfaceForm) <= 2        -> 'corrected'
 *   4. word-boundary    regex word-boundary match of surfaceForm    -> 'fallback'
 *   4.5 loose match     trim / lowercase / stem / indexOf 宽松匹配   -> 'fallback'
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
 *   v2.2.3 Stage 1 (D1-1): 改为可选, 词干化匹配 (Step 4.5 策略 3) 无法保留原 offset
 * - surfaceForm: 校正后的 content (与校正后的 start..end 切片一致)
 */
export interface AlignmentResult {
  start: number;
  end: number;
  status: AlignmentStatus;
  originalOffset?: { start: number; end: number };
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
 * v2.2.3 Stage 1 (D1-1): 简单词干化匹配
 * 对英文词去 -ing / -ed / -es / -s 后缀后做词边界匹配.
 *
 * 仅对长度 > 4 的英文词生效, 避免短词误匹配 (如 "bed" 去 "ed" 后变 "b").
 * 后缀长度从长到短尝试, 优先匹配更长后缀 (避免 "es" 提前匹配 "ing" 词).
 *
 * 返回 AlignmentResult 或 null (无匹配). 词干化匹配无法保留原 offset,
 * originalOffset 为 undefined.
 */
function tryStemMatch(surfaceForm: string, text: string): AlignmentResult | null {
  if (surfaceForm.length <= 4) return null; // 短词不做词干化
  const lower = surfaceForm.toLowerCase();
  // 按后缀长度从长到短尝试
  const suffixes = ['ing', 'ed', 'es', 's'];
  for (const suffix of suffixes) {
    if (lower.endsWith(suffix) && lower.length > suffix.length + 2) {
      const stem = lower.slice(0, lower.length - suffix.length);
      const stemEscaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stemRe = new RegExp(`(?<![\\p{L}\\p{N}])${stemEscaped}(?![\\p{L}\\p{N}])`, 'iu');
      const stemMatch = stemRe.exec(text);
      if (stemMatch) {
        return {
          start: stemMatch.index,
          end: stemMatch.index + stemMatch[0].length,
          status: 'fallback',
          originalOffset: undefined, // 词干化匹配无法保留原 offset
          surfaceForm: text.substring(stemMatch.index, stemMatch.index + stemMatch[0].length),
        };
      }
    }
  }
  return null;
}

/**
 * 6 步对齐协议 — 验证 + 校正单个 token
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

  // Step 4: first index search — 用词边界正则找第一次出现
  // v2.2.2 Stage 1 (Bug 6): 词边界匹配, 避免子串误匹配 (如 "go" 匹配 "good")
  const escapedSurface = surfaceForm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundaryRe = new RegExp(`(?<![\\p{L}\\p{N}])${escapedSurface}(?![\\p{L}\\p{N}])`, 'iu');
  const match = boundaryRe.exec(text);
  if (match) {
    return {
      start: match.index,
      end: match.index + match[0].length,
      status: 'fallback',
      originalOffset,
      surfaceForm,
    };
  }

  // Step 4.5: v2.2.3 Stage 1 (D1-1) 宽松匹配层
  // 在 Step 4 词边界正则失败后, 尝试多种宽松匹配策略, 减少 token 丢弃率.
  // 所有策略成功均返回 status='fallback', 与 Step 4 一致.

  // 策略 1: trim 后再词边界匹配 (覆盖 LLM 给了前后空格的情况)
  const trimmedSurface = surfaceForm.trim();
  if (trimmedSurface !== surfaceForm) {
    const trimmedEscaped = trimmedSurface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const trimmedRe = new RegExp(`(?<![\\p{L}\\p{N}])${trimmedEscaped}(?![\\p{L}\\p{N}])`, 'iu');
    const trimmedMatch = trimmedRe.exec(text);
    if (trimmedMatch) {
      return {
        start: trimmedMatch.index,
        end: trimmedMatch.index + trimmedMatch[0].length,
        status: 'fallback',
        originalOffset,
        surfaceForm: trimmedSurface,
      };
    }
  }

  // 策略 2: 全小写词边界匹配 (覆盖 LLM 给首字母大写但 text 中是小写的情况)
  // 注: Step 4 已用 'i' flag, 但显式 lowercase 后再匹配, 让 surfaceForm 返回
  //     text 中真实 case (而非 LLM 给的 case), 与 Step 4 略有差异.
  const lowerSurface = surfaceForm.toLowerCase();
  const lowerEscaped = lowerSurface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lowerRe = new RegExp(`(?<![\\p{L}\\p{N}])${lowerEscaped}(?![\\p{L}\\p{N}])`, 'iu');
  const lowerMatch = lowerRe.exec(text);
  if (lowerMatch) {
    return {
      start: lowerMatch.index,
      end: lowerMatch.index + lowerMatch[0].length,
      status: 'fallback',
      originalOffset,
      surfaceForm: text.substring(lowerMatch.index, lowerMatch.index + lowerMatch[0].length),
    };
  }

  // 策略 3: 简单词干化 (去 -ing/-ed/-es/-s 后缀) 后词边界匹配
  // 仅对长度 > 4 的英文词生效, 避免短词误匹配
  const stemResult = tryStemMatch(surfaceForm, text);
  if (stemResult) {
    return stemResult;
  }

  // 策略 4: 最后兜底 — indexOf 子串匹配 (配合 InteractivePassage 边界检查)
  // 注: indexOf 子串匹配可能误匹配 (如 "go" 匹配 "good"), 但比直接丢弃好
  const looseIdx = text.toLowerCase().indexOf(surfaceForm.toLowerCase());
  if (looseIdx >= 0) {
    return {
      start: looseIdx,
      end: looseIdx + surfaceForm.length,
      status: 'fallback',
      originalOffset,
      surfaceForm: text.substring(looseIdx, looseIdx + surfaceForm.length),
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
