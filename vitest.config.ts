import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vitest 配置 (Wordaydream v1.0.0+ 数据层 / 跨 stage 集成测试)
 *
 * - jsdom 环境: 组件测试 (DifficultySuggestion / InteractivePassage / PassagePipeline)
 *   需要 DOM API
 * - setup 文件: 引入 @testing-library/jest-dom matchers
 * - globals: false (显式 import { describe, it, expect } from 'vitest')
 * - include glob: 覆盖 `src/**\/*.{test,spec}.{ts,tsx}` 全文件类型, 自动包含
 *   - `src/__tests__/`
 *   - `src/__integration__` (v1.2.0 新增, 跨 stage 集成测试)
 *   - `src/features/**\/__tests__/`
 *   - `src/features/**\/*.{test,spec}.{ts,tsx}` (单元 / 组件测试)
 * - 与 vite.config.ts 平行, 不复用 plugins 之外的字段
 *
 * v0.1.0-harmony Stage 2: 新增 pwaRegisterStubPlugin.
 * vitest 配置不加载 vite-plugin-pwa, 但 src/platform/swRegistration.ts 内的
 * `import('virtual:pwa-register')` 会被 Vite import-analysis 静态扫描.
 * 提供一个 no-op stub 让静态解析通过; 测试内 vi.mock 仍可覆盖为 spy.
 * 镜像 vite.config.ts 的 harmonyPwaStubPlugin 模式.
 */
function pwaRegisterStubPlugin(): Plugin {
  const virtualModuleId = 'virtual:pwa-register';
  const resolvedId = `\0${virtualModuleId}`;
  return {
    name: 'pwa-register-stub',
    enforce: 'pre',
    resolveId(id) {
      if (id === virtualModuleId) return resolvedId;
      return null;
    },
    load(id) {
      if (id === resolvedId) {
        return 'export function registerSW() { return () => {} }';
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), pwaRegisterStubPlugin()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'src/__integration__/**/*.{test,spec}.{ts,tsx}',
      'netlify/edge-functions/**/*.{test,spec}.{ts,tsx}',
      // v0.5.0-harmony Stage 1: 覆盖 scripts 下的版本对齐校验单测 (.mjs)
      'scripts/**/*.{test,spec}.{ts,tsx,mjs}',
    ],
    // v0.5.0-harmony Stage 3: 排除 node --test 套件 (vitest 收集会报 "No test suite found").
    // 它们由各自 npm script (node --test) 运行, 不属于 vitest 收集范围.
    exclude: ['scripts/hvigor-output.test.mjs', 'scripts/verify-harmony-build.test.mjs'],
    css: false,
    pool: 'threads',
  },
});
