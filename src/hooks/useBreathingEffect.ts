/**
 * v0.4.0-harmony Stage 4 (D4): rAF 消除 — 改用 CSS @keyframes 驱动.
 *
 * 旧实现 (v1.5.2) 用 requestAnimationFrame 在每一帧 JS 内计算 sin 曲线并写
 * `transform` / `opacity`, 主线程持续占用. 现改为:
 * - 动画完全交给 CSS @keyframes breathe (见 src/styles/animations.css)
 * - hook 仅做: enabled 时遍历 [data-breathing] 元素, 写入 `--breathing-delay`
 *   CSS 变量 (每个元素 index * 200ms 递增, 与旧实现 delay 行为对齐)
 * - 不再持有任何 rAF handle, 不再监听 visibilitychange (compositor 自动暂停)
 *
 * 行为对齐:
 * - duration / intensity / delay 仍接收 (向后兼容签名), 但 intensity 被忽略
 *   (CSS 已固化 1.02 / 0.96, 用户无自定义需求且可避免运行时改 keyframes)
 * - delay 仍生效: 作为 *首元素* 的基础延迟, 后续元素以 200ms 步进累加
 * - enabled=false 时清空 CSS 变量, 动画自然停止 (CSS 仍加载但无 target)
 *
 * 合成层友好性: transform / opacity 由 compositor 直接驱动, 主线程 0 开销.
 */
import { useEffect } from 'react';

interface BreathingConfig {
  duration?: number;
  intensity?: number;
  delay?: number;
}

export function useBreathingEffect(
  enabled: boolean = true,
  config: BreathingConfig = {}
) {
  // duration / intensity 在 CSS 固化, 这里仅为签名兼容, 不再读取.
  const { delay = 0 } = config;

  useEffect(() => {
    const elements = document.querySelectorAll('[data-breathing]');
    if (!enabled || elements.length === 0) return;

    // 为每个元素设置 --breathing-delay (基础 delay + index * 200ms),
    // 与 v1.5.2 的 elementDelay = delay + index * 200 行为一致.
    elements.forEach((el, index) => {
      const elementDelay = delay + index * 200;
      (el as HTMLElement).style.setProperty(
        '--breathing-delay',
        `${elementDelay}ms`
      );
    });

    return () => {
      elements.forEach((el) => {
        (el as HTMLElement).style.removeProperty('--breathing-delay');
      });
    };
  }, [enabled, delay]);
}
