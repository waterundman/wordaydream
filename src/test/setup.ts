/**
 * Vitest 全局 setup
 *
 * - 引入 @testing-library/jest-dom 扩展 expect 链 (toBeInTheDocument 等)
 * - 在每个测试文件前清理 localStorage / sessionStorage, 避免持久化状态泄漏
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // localStorage 在某些 jsdom 配置下可能不可用, 静默跳过
    }
  }
});
