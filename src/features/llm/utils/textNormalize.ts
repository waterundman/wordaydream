/**
 * Text Normalization Utilities (Stage 1: Prompt 优化 + text 清洗)
 *
 * 用于 LLM 输出的 passage text 清洗, 主要解决:
 * - Windows 换行 (\r\n) / 老 Mac 换行 (\r) 兼容
 * - 零宽空格 (U+200B, U+FEFF) 残留
 * - 孤立 markdown 字符行 (如单独一行的 `**`, `#`, `-`)
 * - 首尾空白
 *
 * 同时提供 normalizeTextPreservingOffsets 用于在 normalize 后
 * 重算 tokens / grammarPoints 的 startIndex/endIndex 偏移.
 *
 * 设计约束:
 * - 不破坏内部标点 (引号, 破折号, German umlauts äöüß)
 * - 不破坏中文 (BMP) 字符边界
 * - 输出 deterministic (同输入必同输出)
 */

const ZERO_WIDTH_CHARS = /[\u200B\uFEFF]/g;

/**
 * 判断一行是否为孤立的 markdown 字符行
 *
 * 规则: trim 后只含 `*`, `#`, `-` 三种字符
 * (空行不算, 因为空行有段落分隔的语义价值)
 */
function isIsolatedMarkdownLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  return /^[#\-*]+$/.test(trimmed);
}

/**
 * 清洗 LLM 输出的 passage text
 *
 * 处理顺序:
 * 1. \r\n -> \n
 * 2. \r -> \n
 * 3. 移除零宽空格 (U+200B, U+FEFF)
 * 4. 移除孤立的 markdown 字符行
 * 5. 移除首尾空白
 *
 * 不破坏: 内部标点, 中文 BMP 字符, 表情符号
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(ZERO_WIDTH_CHARS, '')
    .split('\n')
    .filter((line) => !isIsolatedMarkdownLine(line))
    .join('\n')
    .trim();
}

interface CharWithIndex {
  /** 保留下来的字符 */
  ch: string;
  /** 该字符在原始 text 中的位置 (用于构造 offsetMap) */
  oldIdx: number;
}

/**
 * 字符级预处理: 转换行尾 + 移除零宽空格
 *
 * 返回每个保留下来的字符, 以及它在原始 text 中的位置.
 * 注意: \r\n -> \n 时, \n 映射到原始 text 中 \n 的位置 (而非 \r),
 * 这样保证 offsetMap 严格递增且一一对应保留下来的字符.
 */
function preprocessChars(text: string): CharWithIndex[] {
  const result: CharWithIndex[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\r' && text[i + 1] === '\n') {
      // \r\n -> \n, 取 \n 的原位置
      result.push({ ch: '\n', oldIdx: i + 1 });
      i++;
    } else if (ch === '\r') {
      // 单独 \r -> \n
      result.push({ ch: '\n', oldIdx: i });
    } else if (ch === '\u200B' || ch === '\uFEFF') {
      // 零宽空格, 跳过 (不进 result)
      continue;
    } else {
      result.push({ ch, oldIdx: i });
    }
  }
  return result;
}

const WHITESPACE = /\s/;

/**
 * normalizeText + 同时计算 offsetMap
 *
 * offsetMap[newIdx] = oldIdx
 * 即: normalized text 中第 newIdx 个字符, 在原 text 中的位置
 *
 * 用法: 给定原 text 中的 token range [oldStart, oldEnd] (exclusive end),
 *       可在 O(log n) 内算出新 range:
 *         newStart = lowerBound(offsetMap, oldStart)
 *         newEnd   = lowerBound(offsetMap, oldEnd)
 *       (见本文件导出的 remapOffset)
 *
 * 关键属性:
 * - offsetMap 严格递增 (因为我们顺序处理 oldIdx)
 * - 长度 == normalized.length
 * - normalized 与 normalizeText(text) 输出一致
 */
export function normalizeTextPreservingOffsets(
  text: string
): { normalized: string; offsetMap: number[] } {
  if (!text) return { normalized: '', offsetMap: [] };

  // Step 1: 字符级预处理
  const chars = preprocessChars(text);

  // Step 2: 按 \n 切分成行 (每行包含尾部的 \n, 最后一行可能不含)
  const lines: CharWithIndex[][] = [];
  let current: CharWithIndex[] = [];
  for (const c of chars) {
    current.push(c);
    if (c.ch === '\n') {
      lines.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }

  // Step 3: 过滤孤立的 markdown 行 (整行删除, 含其尾部 \n)
  const keptLines = lines.filter(
    (line) => !isIsolatedMarkdownLine(line.map((c) => c.ch).join(''))
  );

  // Step 4: 拼接保留的行
  const keptChars: CharWithIndex[] = [];
  for (const line of keptLines) {
    for (const c of line) {
      keptChars.push(c);
    }
  }

  // Step 5: 找到首尾的非空白位置 (用于 trim)
  let start = 0;
  while (start < keptChars.length && WHITESPACE.test(keptChars[start].ch)) {
    start++;
  }
  let end = keptChars.length;
  while (end > start && WHITESPACE.test(keptChars[end - 1].ch)) {
    end--;
  }

  // Step 6: 构建结果
  const normalizedChars: string[] = [];
  const offsetMap: number[] = [];
  for (let i = start; i < end; i++) {
    normalizedChars.push(keptChars[i].ch);
    offsetMap.push(keptChars[i].oldIdx);
  }

  return { normalized: normalizedChars.join(''), offsetMap };
}

/**
 * 在严格递增数组中找 target 的 lowerBound
 * 返回最小下标 i, 使得 arr[i] >= target
 *
 * offsetMap 严格递增, 所以 binary search 是 O(log n)
 */
function lowerBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * 把一个 old position 映射到 normalized text 中的 position
 *
 * 用法:
 *   const { normalized, offsetMap } = normalizeTextPreservingOffsets(text);
 *   const newStart = remapOffset(token.startIndex, offsetMap);
 *   const newEnd   = remapOffset(token.endIndex, offsetMap);
 *   normalized.substring(newStart, newEnd) // 应当 == token.surfaceForm
 */
export function remapOffset(oldIndex: number, offsetMap: number[]): number {
  return lowerBound(offsetMap, oldIndex);
}
