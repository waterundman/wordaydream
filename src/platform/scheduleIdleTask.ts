/**
 * v0.4.0-harmony Stage 4 (D4): requestIdleCallback 调度工具
 *
 * 用于将非关键的计算任务 (如成就评估、统计聚合) 延迟到浏览器空闲时段执行,
 * 避免阻塞首屏渲染 / 用户交互主线.
 *
 * 设计:
 * - 优先用原生 requestIdleCallback (Chrome 47+ / Firefox 55+ / Safari 17.4+)
 * - 不支持时降级到 setTimeout(0) (等效于 macrotask 调度, 仍让出当前 task)
 * - 提供 scheduleIdleTask(fn) 简化调用, 不返回 handle (调用方不需要 cancel)
 * - 任务异常不会抛到主线程 (catch + console.warn 兜底, 避免未处理的 Promise rejection)
 *
 * 使用场景:
 *   - 成就 checkAndUnlock (用户操作后的非阻塞评估, 可延迟 100ms)
 *   - 分析数据聚合 (非首屏关键路径)
 *   - 预计算缓存 (用户感知不到延迟的后台任务)
 *
 * 不适用:
 *   - 用户感知到的关键路径 (如 LLM 响应解析 / 路由切换 / 答题评估)
 *   - 必须严格顺序执行的逻辑
 */

/**
 * 将任务调度到浏览器空闲时段执行.
 *
 * - 支持原生 requestIdleCallback 时用之 (idle 阶段执行)
 * - 不支持时降级到 setTimeout(0) (macrotask, 让出当前调用栈)
 * - 任务内的异常被 catch 后 console.warn, 不影响调用方
 *
 * @param fn 待执行的空闲任务
 */
export function scheduleIdleTask(fn: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => {
      try {
        fn();
      } catch (e) {
        console.warn('[scheduleIdleTask] task failed:', e);
      }
    });
    return;
  }
  // 降级: setTimeout(0) 让出当前调用栈, 在下一个 macrotask 执行
  setTimeout(() => {
    try {
      fn();
    } catch (e) {
      console.warn('[scheduleIdleTask] task failed:', e);
    }
  }, 0);
}
