/**
 * Levenshtein 距离算法 (Stage 2: Alignment Validator)
 *
 * 计算两个 string 之间的编辑距离 — 把 a 转换为 b 所需的最少
 * 单字符编辑 (insert / delete / substitute) 次数.
 *
 * 设计目标:
 * - O(m*n) 时间 / O(m*n) 空间 DP, 无外部依赖
 * - 同步实现, 可在 LLM 响应解析后立即调用
 * - < 100 LOC
 *
 * 与 v1.0.0 关系:
 * - v1.0.0 无 Levenshtein 需求
 * - v1.1.0 Stage 2 引入, 给 alignmentValidator 的 fuzzy match 用
 *
 * 引用:
 * - https://en.wikipedia.org/wiki/Levenshtein_distance
 */

/**
 * 计算 a 与 b 之间的 Levenshtein 编辑距离
 *
 * 边界:
 * - a === b -> 0
 * - a === '' -> b.length (全部 insert)
 * - b === '' -> a.length (全部 delete)
 *
 * 性能:
 * - 时间 O(m*n), 空间 O(m*n) — 用一维滚动数组可降到 O(min(m, n)),
 *   但本项目场景下 text < 5KB, 简单二维数组更易读且足够快
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // dp[i][j] = a 前 i 个字符变为 b 前 j 个字符的最少编辑次数
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );
  // 边界: a 前 i 个字符 -> '' 需要 i 次 delete
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  // 边界: '' -> b 前 j 个字符需要 j 次 insert
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        // 字符相同, 无需编辑
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        // 1 + min(删除 a[i-1], 插入 b[j-1], 替换 a[i-1] -> b[j-1])
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[a.length][b.length];
}
