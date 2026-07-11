/**
 * 9 个 store 持久化迁移静态扫描测试 (T05)
 *
 * 覆盖 test_spec:
 * - T05 [static, critical]: 9 个 store 全部使用 zustand/middleware 的 persist
 *   验证 1: 每个 store 文件都 `import { persist, createJSONStorage } from 'zustand/middleware'`
 *   验证 2: 每个 store 文件都不再 `from '.../lib/persistenceMiddleware'`
 *
 * 扫描 9 个目标 store (路径与代码实际一致):
 *  1. src/features/settings/store/useSettingsStore.ts
 *  2. src/features/achievements/store/useAchievementStore.ts
 *  3. src/features/streak/store/useStreakStore.ts
 *  4. src/features/review/store/useMemoryStore.ts
 *  5. src/features/reading/store/useReadingSessionStore.ts
 *  6. src/features/reading/store/useReadingHistoryStore.ts
 *  7. src/features/review/store/useReviewSessionStore.ts
 *  8. src/features/analytics/store/useAnalyticsStore.ts
 *  9. src/store/useToastStore.ts
 */
import { describe, expect, it } from 'vitest';

/**
 * 通过 Vite 的 import.meta.glob 以 raw 模式加载 9 个 store 文件源码。
 * 在 Vitest (Vite-based) 下, `{ as: 'raw' }` 会返回字符串内容,
 * 不需要 fs / path, 也不需要 node types。
 *
 * 路径以本文件 (src/__tests__/persistMigration.test.ts) 为基准:
 *  ../ -> src/
 *  ../../ -> 项目根 (仅 useToastStore 跨 features, 位于 src/store/)
 */
const STORE_SOURCES = import.meta.glob<string>(
  [
    '../features/settings/store/useSettingsStore.ts',
    '../features/achievements/store/useAchievementStore.ts',
    '../features/streak/store/useStreakStore.ts',
    '../features/review/store/useMemoryStore.ts',
    '../features/reading/store/useReadingSessionStore.ts',
    '../features/reading/store/useReadingHistoryStore.ts',
    '../features/review/store/useReviewSessionStore.ts',
    '../features/analytics/store/useAnalyticsStore.ts',
    '../store/useToastStore.ts',
  ],
  { query: '?raw', import: 'default' },
);

const STORE_PATHS = Object.keys(STORE_SOURCES).sort();

describe('Stage 2 persist migration (T05 static scan)', () => {
  it('扫描路径覆盖全部 9 个 store', () => {
    expect(STORE_PATHS).toHaveLength(9);
    expect(STORE_PATHS.some((p) => p.endsWith('useSettingsStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useAchievementStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useStreakStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useMemoryStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useReadingSessionStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useReadingHistoryStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useReviewSessionStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useAnalyticsStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useToastStore.ts'))).toBe(true);
  });

  it.each(STORE_PATHS)('%s 使用 zustand/middleware 的 persist', async (relPath) => {
    const loader = STORE_SOURCES[relPath];
    expect(loader, `${relPath} 应当可加载`).toBeDefined();
    const content = (await loader!()) as unknown as string;

    // 验证 1: import 来自 zustand/middleware
    expect(
      content,
      `${relPath} 必须从 'zustand/middleware' 导入 persist`,
    ).toMatch(/from\s+['"]zustand\/middleware['"]/);

    // 验证 2: 不再 import 旧的 persistenceMiddleware
    expect(
      content,
      `${relPath} 不应再 import lib/persistenceMiddleware`,
    ).not.toMatch(/from\s+['"].*persistenceMiddleware['"]/);

    // 验证 3: 文件中出现 persist( 包裹 (确保是 zustand/middleware 的 persist)
    expect(
      content,
      `${relPath} 必须调用 persist( 包裹 store initializer`,
    ).toMatch(/persist\s*\(/);
  });
});
