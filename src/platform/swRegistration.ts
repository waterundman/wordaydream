/**
 * registerServiceWorker (v0.1.0-harmony Stage 2)
 *
 * 从 main.tsx 抽出 SW 注册逻辑, 集中处理鸿蒙 ArkWeb 降级.
 *
 * 行为:
 * 1. detectPlatform().supportsServiceWorker() === false → 直接返回 (鸿蒙降级)
 * 2. 'serviceWorker' in navigator === false → 直接返回 (环境不支持)
 * 3. import.meta.env.PROD === false → 直接返回 (dev 模式跳过)
 * 4. dynamic import('virtual:pwa-register') → registerSW({ immediate: true })
 *
 * 失败静默忽略 (virtual:pwa-register 在沙箱 / dev 不可用时不抛错).
 */
import { detectPlatform } from './detect';

export async function registerServiceWorker(): Promise<void> {
  if (!detectPlatform().supportsServiceWorker()) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch {
    // virtual:pwa-register 在 dev / 沙箱不可用, 静默忽略
  }
}
