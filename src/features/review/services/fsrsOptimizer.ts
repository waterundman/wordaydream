import { fsrs, Rating as FsrsRating } from 'ts-fsrs';
import type { FSRS } from 'ts-fsrs';
// v2.2.0 hotfix: 类型用 import type (编译时擦除, 不触发运行时加载)
// 避免 @open-spaced-repetition/binding 静态 import 导致浏览器端模块图崩溃 (P0 白屏)
import type {
  FSRSBindingItem as FSRSBindingItemClass,
  FSRSBindingReview as FSRSBindingReviewClass,
} from '@open-spaced-repetition/binding';
import { DEFAULT_FSRS_WEIGHTS } from './schedulerAdapter';
import type { RatingEntry } from './recallRateCalculator';

// v2.2.0 hotfix: 动态 import 缓存 — 避免重复 import + 记录加载失败
type BindingModule = typeof import('@open-spaced-repetition/binding');
let bindingModuleCache: BindingModule | null = null;
let bindingLoadAttempted = false;

/**
 * v2.2.0 hotfix: 动态加载 @open-spaced-repetition/binding.
 *
 * 浏览器端该包需要 WASM 版本 (binding-wasm32-wasi), 可能未安装.
 * Node.js (测试环境) 用原生绑定 (win32-x64-msvc).
 * 加载失败时返回 null, 调用方降级为"优化不可用".
 */
async function loadBinding(): Promise<BindingModule | null> {
  if (bindingModuleCache) return bindingModuleCache;
  if (bindingLoadAttempted) return null; // 之前加载失败, 不重试

  bindingLoadAttempted = true;
  try {
    bindingModuleCache = await import('@open-spaced-repetition/binding');
    return bindingModuleCache;
  } catch {
    // 浏览器端 WASM 未安装 或 Node.js 原生绑定缺失
    return null;
  }
}

/** @internal 测试用: 重置 binding 缓存 (避免测试间模块级缓存污染) */
export function _resetBindingCacheForTesting(): void {
  bindingModuleCache = null;
  bindingLoadAttempted = false;
}

/**
 * v1.8.0 Stage 2: 自定义错误类 — FSRS 参数优化功能不可用.
 * UI 捕获此错误时显示 "功能不可用" 提示而非通用错误.
 *
 * v2.2.0 Stage 3: 优化功能现已通过 @open-spaced-repetition/binding 启用,
 * 此错误类保留作向后兼容 (UI 仍可能 catch 此类型). 在优化器可用环境下
 * optimizeFsrsWeights 不再抛出此错误.
 */
export class OptimizationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimizationUnavailableError';
    Object.setPrototypeOf(this, OptimizationUnavailableError.prototype);
  }
}

/**
 * v2.2.0 Stage 3: 创建临时 FSRS 实例用于运行时检测.
 * 保留 v1.8.0 Stage 2 的 probe 实例逻辑以兼容既有调用路径.
 */
function createProbeInstance(): FSRS {
  return fsrs({
    w: DEFAULT_FSRS_WEIGHTS,
    enable_fuzz: true,
    request_retention: 0.85,
    maximum_interval: 36500,
  });
}

/**
 * v2.2.0 Stage 3 + hotfix: 检查优化功能是否可用 (async).
 *
 * 动态加载 binding 模块, 检测 computeParameters 可调用性.
 * 浏览器端 WASM 未安装时返回 false (降级为"优化不可用").
 *
 * 注意: ts-fsrs v6 未发布, 优化器通过独立的 @open-spaced-repetition/binding
 * 包提供 (SPEC 中提到的 @open-spaced-repetition/fsrs-rs-nodejs 实际包名为 binding).
 *
 * @returns true 若 binding 加载成功且 computeParameters 可调用
 */
export async function isOptimizationAvailable(): Promise<boolean> {
  try {
    createProbeInstance(); // ts-fsrs probe (不影响 binding)
    const binding = await loadBinding();
    if (!binding) return false;
    return typeof binding.computeParameters === 'function';
  } catch {
    return false;
  }
}

/**
 * v1.8.0 Stage 2: ratingHistory → FSRS review log 格式转换 (扁平数组).
 *
 * 保留此函数用于向后兼容 (Contract: 行为不变). v2.2.0 Stage 3 起
 * optimizeFsrsWeights 改用 convertToTrainSet (返回 FSRSBindingItem[] 按卡片分组),
 * 此函数导出以供测试与外部复用.
 *
 * @param ratingHistory 评分历史记录 (按时间正序)
 * @returns 扁平 review log 格式数组 { rating, delta_t }[]
 */
export function convertToReviewLog(
  ratingHistory: RatingEntry[]
): Array<{ rating: number; delta_t: number }> {
  type CardReview = { rating: number; at: number };
  const byCard = new Map<string, CardReview[]>();
  for (const entry of ratingHistory) {
    const list = byCard.get(entry.cardId) ?? [];
    list.push({ rating: ratingToFsrsGrade(entry.rating), at: entry.at });
    byCard.set(entry.cardId, list);
  }

  const reviews: Array<{ rating: number; delta_t: number }> = [];
  for (const list of byCard.values()) {
    list.sort((a, b) => a.at - b.at);
    for (let i = 0; i < list.length; i++) {
      const delta_t =
        i === 0 ? 0 : Math.max(0, Math.round((list[i].at - list[i - 1].at) / 86_400_000));
      reviews.push({ rating: list[i].rating, delta_t });
    }
  }
  return reviews;
}

function ratingToFsrsGrade(rating: RatingEntry['rating']): number {
  switch (rating) {
    case 'again':
      return FsrsRating.Again;
    case 'hard':
      return FsrsRating.Hard;
    case 'good':
      return FsrsRating.Good;
    case 'easy':
      return FsrsRating.Easy;
  }
}

/**
 * v2.2.0 Stage 3: ratingHistory → FSRSBindingItem[] (按卡片分组).
 *
 * @open-spaced-repetition/binding 的 computeParameters 需要
 * Array<FSRSBindingItem>, 每个 FSRSBindingItem 包含一张卡片的完整复习历史
 * (按时间正序, delta_t = 距上次复习的天数).
 *
 * @param ratingHistory 评分历史记录
 * @param binding 动态加载的 binding 模块 (提供 FSRSBindingItem / FSRSBindingReview 类)
 * @returns 按卡片分组的 FSRSBindingItem 数组
 */
function convertToTrainSet(
  ratingHistory: RatingEntry[],
  binding: BindingModule
): FSRSBindingItemClass[] {
  type CardReview = { rating: number; at: number };
  const byCard = new Map<string, CardReview[]>();
  for (const entry of ratingHistory) {
    const list = byCard.get(entry.cardId) ?? [];
    list.push({ rating: ratingToFsrsGrade(entry.rating), at: entry.at });
    byCard.set(entry.cardId, list);
  }

  const trainSet: FSRSBindingItemClass[] = [];
  for (const list of byCard.values()) {
    list.sort((a, b) => a.at - b.at);
    const reviews: FSRSBindingReviewClass[] = [];
    for (let i = 0; i < list.length; i++) {
      const deltaT =
        i === 0 ? 0 : Math.max(0, Math.round((list[i].at - list[i - 1].at) / 86_400_000));
      reviews.push(new binding.FSRSBindingReview(list[i].rating, deltaT));
    }
    trainSet.push(new binding.FSRSBindingItem(reviews));
  }
  return trainSet;
}

/**
 * v2.2.0 Stage 3: 优化 FSRS weights.
 *
 * 流程:
 * 1. 检查 ratingHistory >= 30 条 (不足抛 Error)
 * 2. 动态加载 binding, 检测 computeParameters 可用性 (不可用抛 OptimizationUnavailableError)
 * 3. 转换 ratingHistory → FSRSBindingItem[] trainSet
 * 4. 调用 computeParameters 训练优化后的 weights
 * 5. 用 FSRSBinding.evaluate 计算 logLoss 作为 loss 指标
 * 6. 返回 { weights, backup, loss }
 *
 * @param ratingHistory 评分历史记录
 * @param onProgress 优化进度回调 (0-1), 可选
 * @returns { weights: 优化后的 weights, backup: 优化前的 weights, loss: logLoss }
 * @throws {Error} 当 ratingHistory < 30 条
 * @throws {OptimizationUnavailableError} 当优化器不可用
 * @throws {Error} 当优化器训练失败 (如 NotEnoughData)
 */
export async function optimizeFsrsWeights(
  ratingHistory: RatingEntry[],
  onProgress?: (progress: number) => void
): Promise<{ weights: number[]; backup: number[]; loss: number }> {
  // 1. 检查 ratingHistory >= 30 条
  if (ratingHistory.length < 30) {
    throw new Error(
      `优化需要至少 30 条 review 记录 (当前 ${ratingHistory.length} 条)`
    );
  }

  // 2. v2.2.0 hotfix: 动态加载 binding, 检测 computeParameters 可用性
  const binding = await loadBinding();
  if (!binding || typeof binding.computeParameters !== 'function') {
    throw new OptimizationUnavailableError(
      'FSRS 参数优化不可用: @open-spaced-repetition/binding 未正确加载. ' +
        '浏览器端需要 @open-spaced-repetition/binding-wasm32-wasi, ' +
        'Node.js 需要 @open-spaced-repetition/binding-win32-x64-msvc.'
    );
  }

  // 3. 转换 ratingHistory → FSRSBindingItem[] trainSet
  const trainSet = convertToTrainSet(ratingHistory, binding);
  const backup = [...DEFAULT_FSRS_WEIGHTS];

  // 4. 调用 computeParameters 训练优化后的 weights
  //    progress 回调适配: binding 的 (current, total) → 项目的 (0-1)
  const weights = await binding.computeParameters(trainSet, {
    enableShortTerm: true,
    numRelearningSteps: 1,
    timeout: 30000,
    progress: (current: number, total: number) => {
      if (onProgress && total > 0) {
        onProgress(Math.min(1, Math.max(0, current / total)));
      }
    },
  });

  // 5. 用 FSRSBinding.evaluate 计算 logLoss 作为 loss 指标
  let loss = 0;
  try {
    const fsrsBinding = new binding.FSRSBinding(weights);
    const evaluation = fsrsBinding.evaluate(trainSet);
    loss = evaluation.logLoss;
  } catch {
    // evaluate 在数据不足时可能失败, loss 回退为 0 (weights 仍可用)
    loss = 0;
  }

  return { weights, backup, loss };
}
