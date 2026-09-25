/**
 * 路由 chunk 预取 (v1.6.1 Stage 4, P2-2)
 *
 * 问题: 5 个路由都是 `React.lazy` 动态 import, 首次进入某个页面时必须先下载+解析
 * 对应 chunk, 期间 Suspense 会闪一下 `<LoadingFallback/>`。用户在首页停留时其实
 * 有充足的空闲时间可以先把这个 chunk 拉下来。
 *
 * 本模块提供两件事:
 * 1. **空闲预取**: `schedulePrefetch()` 复用 `scheduleIdleTask` (requestIdleCallback),
 *    在首页空闲时按需拉取 reading / wordlist / course。串行执行, 避免一次性打满网络。
 * 2. **意图预取**: `installIntentPrefetch()` 挂一个委托监听, 任何带
 *    `data-prefetch-route="<mode>"` 的元素被 hover / 键盘聚焦时立即预取 —— 用户从
 *    "手移到按钮上"到"点下去"之间通常有几百毫秒, 足够拉完。
 *
 * 安全栅栏:
 * - `navigator.connection.saveData === true` (用户开了省流量) → 完全不做预取
 * - 单次调度上限 3 个 chunk
 * - 预取失败**静默**: chunk 拉不到只 warn, 真正导航时 `lazy` 会重试并走正常错误路径
 * - 已在途/已完成的 mode 不重复 import (in-flight 去重表)
 *
 * 同时把 5 条懒加载工厂集中到 `ROUTE_LOADERS` 作为**单一事实来源** —— App 的
 * `lazy()` 与本模块的预取引用同一个说明符, 因此命中的是同一个 chunk。
 */
import { createElement, type ComponentType } from 'react';
import type { AppMode } from '../hooks/useAppModeStore';
import { scheduleIdleTask } from './scheduleIdleTask';

/** 路由懒加载工厂: App.tsx 的 lazy() 与预取共用, 保证指向同一 chunk。 */
export const ROUTE_LOADERS = {
  home: () => import('../features/home/HomePage').then((m) => ({ default: m.HomePage })),
  reading: () =>
    import('../features/reading/ReadingSessionPage').then((m) => ({ default: m.ReadingSessionPage })),
  review: () =>
    import('../features/review/components/ReviewSessionPage').then((m) => ({
      default: m.ReviewSessionPage,
    })),
  wordlist: () =>
    import('../features/wordlist/WordlistPage').then((m) => ({ default: m.WordlistPage })),
  course: () =>
    import('../features/course/components/CoursePathPage').then((m) => ({
      default: m.CoursePathPage,
    })),
} as const;

type RouteLoader = () => Promise<{ default: unknown }>;

/** 从 loader 推导出组件的 props 类型, 使 createRouteComponent 保持完整类型检查。 */
type LoaderComponent<L extends RouteLoader> = Awaited<ReturnType<L>> extends {
  default: infer C;
}
  ? C
  : never;

/**
 * 一条路由模块的加载记录 (与 `React.lazy` 内部状态机同构)。
 * 状态: pending (加载中) / resolved (已就绪) / rejected (失败)。
 */
interface RouteEntry {
  status: 'pending' | 'resolved' | 'rejected';
  promise: Promise<{ default: unknown }>;
  module?: { default: unknown };
  error?: unknown;
}

/**
 * 路由模块注册表 —— **按 loader 函数身份**索引, 这样预取与渲染共享同一条记录,
 * 同时测试可以注入自己的 loader 而不串味。
 */
const routeEntries = new Map<RouteLoader, RouteEntry>();

/** 取得(必要时发起)某条路由的加载记录。渲染路径用: 已 rejected 的记录**不替换**(否则会无限重试)。 */
function getRouteEntry(loader: RouteLoader): RouteEntry {
  const existing = routeEntries.get(loader);
  if (existing) return existing;

  const entry: RouteEntry = {
    status: 'pending',
    promise: Promise.resolve({ default: null }),
  };
  entry.promise = loader()
    .then((module) => {
      entry.status = 'resolved';
      entry.module = module;
      return module;
    })
    .catch((error: unknown) => {
      entry.status = 'rejected';
      entry.error = error;
      throw error;
    });
  routeEntries.set(loader, entry);
  return entry;
}

/** 预取路径用: 上一次失败留下的 rejected 记录会被替换成一次全新尝试 (用户尚未导航, 重试是安全的)。 */
function retryRouteEntry(loader: RouteLoader): RouteEntry {
  const existing = routeEntries.get(loader);
  if (existing && existing.status === 'rejected') {
    routeEntries.delete(loader);
  }
  return getRouteEntry(loader);
}

/**
 * 构造一个"预取感知"的懒加载路由组件 —— 用来**替代 `React.lazy`**。
 *
 * 为什么不用 `React.lazy` (v1.6.1 Stage 5 实测结论):
 * `React.lazy` 的首次渲染**必定挂起一次**, 即使目标模块早已在模块注册表里 ——
 * 因为它在首次渲染时才调用工厂, 拿到的是一个崭新的 `import()` promise, 于是
 * 先 throw 出去, 等该 promise 落定后再重试。实测 (e2e T17 探针): 即便 chunk 在
 * 点击前就已预取完成, `LoadingFallback` 仍会出现 1 次、可见约 54 ms。
 * 在正常动效下这段闪动被墨迹覆盖层挡住, 但 **reduced-motion 用户会直接看到它**。
 *
 * 本实现把"模块是否已就绪"变成渲染时可知的事实:
 * - 已 resolved → **同步渲染真实组件**, 不挂起, 不闪 fallback
 * - 加载中   → throw promise (与 React.lazy 同构, Suspense 语义不变)
 * - 已失败   → throw error (交给 ErrorBoundary, 与 React.lazy 一致)
 *
 * 类型: 返回类型由 loader 推导, 因此 App 里的 `onStartReading` 等 props 仍有完整检查。
 */
export function createRouteComponent<L extends RouteLoader>(loader: L): LoaderComponent<L> {
  const RouteComponent = (props: Record<string, unknown>) => {
    const entry = routeEntries.get(loader);
    if (entry?.status === 'resolved') {
      // 已预取完成: 同步渲染, 不进入 Suspense
      return createElement(entry.module?.default as ComponentType<Record<string, unknown>>, props);
    }
    if (entry?.status === 'rejected') {
      throw entry.error;
    }
    // 未加载 / 加载中: 发起加载并挂起 (Suspense 会渲染 fallback)
    throw getRouteEntry(loader).promise;
  };
  return RouteComponent as LoaderComponent<L>;
}

/**
 * 预热一条路由模块 —— **与 `createRouteComponent` 共享同一份加载记录**。
 *
 * 这是本模块对外的"预取一个路由"入口: 调用后该 loader 对应的条目变为 resolved,
 * 于是对应路由组件的首渲染走同步路径 (不闪 fallback)。
 * 若上一次尝试是 rejected, 这里会换一条全新记录重试 (用户尚未导航, 重试是安全的)。
 */
export function preloadRoute(loader: RouteLoader): Promise<unknown> {
  return retryRouteEntry(loader).promise;
}

/** 首页空闲时的默认预取目标 (按用户最可能的下一步排序)。 */
export const DEFAULT_PREFETCH_TARGETS: ReadonlyArray<AppMode> = ['reading', 'wordlist', 'course'];

/** 单次调度最多预取的 chunk 数 (SPEC §8.6 缓解措施)。 */
export const PREFETCH_LIMIT = 3;

export interface RoutePrefetcher {
  /** 预取单个路由 chunk。重复调用共享同一个在途 Promise。失败不抛出。 */
  prefetchRoute: (mode: AppMode) => Promise<void>;
  /** 调度一次空闲预取 (串行, 上限 limit)。 */
  schedulePrefetch: (modes: ReadonlyArray<AppMode>, limit?: number) => void;
  /** 清空在途/已完成记录 (测试用)。 */
  reset: () => void;
  /** 已记录的路由数 (测试用)。 */
  size: () => number;
}

/** 用户是否开启了省流量模式 (navigator.connection.saveData)。 */
export function isPrefetchDisabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/**
 * 构造一个预取器。loader 表可注入, 使测试无需 mock 模块即可验证去重/静默失败。
 */
export function createRoutePrefetcher(
  loaders: Record<AppMode, () => Promise<unknown>>,
  options: { isDisabled?: () => boolean } = {},
): RoutePrefetcher {
  const isDisabled = options.isDisabled ?? isPrefetchDisabled;
  const inflight = new Map<AppMode, Promise<void>>();

  function prefetchRoute(mode: AppMode): Promise<void> {
    const existing = inflight.get(mode);
    if (existing) return existing;

    const task = loaders[mode]()
      .then(() => undefined)
      .catch((error: unknown) => {
        // 静默降级: 预取失败不是错误路径, 真正导航时 lazy 会再试一次。
        // 从在途表里移除, 允许后续重试 (例如网络恢复后 hover 再次触发)。
        inflight.delete(mode);
        console.warn(`[routePrefetch] 预取 ${mode} 失败 (已静默降级):`, error);
      });

    inflight.set(mode, task);
    return task;
  }

  function schedulePrefetch(modes: ReadonlyArray<AppMode>, limit: number = PREFETCH_LIMIT): void {
    if (isDisabled()) return;
    const targets = modes.slice(0, Math.max(0, limit));
    if (targets.length === 0) return;

    scheduleIdleTask(() => {
      // 串行: 前一个拉完再拉下一个, 避免空闲时段一次性并发多个 chunk 请求。
      let index = 0;
      const next = (): void => {
        if (index >= targets.length) return;
        const mode = targets[index];
        index += 1;
        if (mode === undefined) return;
        void prefetchRoute(mode).then(next, next);
      };
      next();
    });
  }

  return {
    prefetchRoute,
    schedulePrefetch,
    reset: () => inflight.clear(),
    size: () => inflight.size,
  };
}

/**
 * 应用级预取器 —— 与 `createRouteComponent` 共享同一份加载记录 (`routeEntries`),
 * 所以预取完成之后, 对应路由组件的首渲染是**同步**的, 不会闪 fallback。
 */
export const routePrefetcher = createRoutePrefetcher(
  Object.fromEntries(
    (Object.keys(ROUTE_LOADERS) as AppMode[]).map((mode) => [
      mode,
      () => preloadRoute(ROUTE_LOADERS[mode]),
    ]),
  ) as Record<AppMode, () => Promise<unknown>>,
);

/** 预取单个路由 chunk (应用级便捷导出)。 */
export const prefetchRoute = routePrefetcher.prefetchRoute;

/** 调度空闲预取 (应用级便捷导出)。 */
export const schedulePrefetch = routePrefetcher.schedulePrefetch;

const PREFETCH_ATTR = 'data-prefetch-route';

/**
 * 安装委托式意图预取: hover / 键盘聚焦到 `[data-prefetch-route]` 元素时预取对应路由。
 *
 * 用委托而非给每个组件加 props —— HomePage 的入口按钮分散在 HeroSection / TodayCard /
 * HomePage 多个文件里, 委托让"标记意图"退化成加一个 data 属性。
 *
 * @returns 卸载函数 (供 useEffect cleanup)
 */
export function installIntentPrefetch(prefetcher: RoutePrefetcher = routePrefetcher): () => void {
  if (typeof document === 'undefined') return () => {};
  if (isPrefetchDisabled()) return () => {};

  const handleIntent = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const marked = target.closest(`[${PREFETCH_ATTR}]`);
    if (!marked) return;
    const mode = marked.getAttribute(PREFETCH_ATTR) as AppMode | null;
    if (!mode) return;
    void prefetcher.prefetchRoute(mode);
  };

  // pointerover 覆盖鼠标与触控笔的"悬停"语义; focusin 覆盖键盘 Tab 聚焦。
  document.addEventListener('pointerover', handleIntent);
  document.addEventListener('focusin', handleIntent);
  return () => {
    document.removeEventListener('pointerover', handleIntent);
    document.removeEventListener('focusin', handleIntent);
  };
}
