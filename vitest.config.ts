import { defineConfig } from 'vitest/config';
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
 *   - `src/__integration__/` (v1.2.0 新增, 跨 stage 集成测试)
 *   - `src/features/**\/__tests__/`
 *   - `src/features/**\/*.{test,spec}.{ts,tsx}` (单元 / 组件测试)
 * - 与 vite.config.ts 平行, 不复用 plugins 之外的字段
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'src/__integration__/**/*.{test,spec}.{ts,tsx}',
      'netlify/edge-functions/**/*.{test,spec}.{ts,tsx}',
    ],
    css: false,
    pool: 'threads',
  },
});
