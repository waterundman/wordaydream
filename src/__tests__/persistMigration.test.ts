/**
 * 10 个 store 持久化迁移静态扫描测试 (T05)
 *
 * 覆盖 test_spec:
 * - T05 [static, critical]: 全部 persist store 使用 zustand/middleware 的 persist
 *   验证 1: 每个 store 文件都 `import { persist, createJSONStorage } from 'zustand/middleware'`
 *   验证 2: 每个 store 文件都不再 `from '.../lib/persistenceMiddleware'`
 *
 * 扫描 10 个目标 store (路径与代码实际一致):
 *  1. src/features/settings/store/useSettingsStore.ts
 *  2. src/features/achievements/store/useAchievementStore.ts
 *  3. src/features/streak/store/useStreakStore.ts
 *  4. src/features/review/store/useMemoryStore.ts
 *  5. src/features/reading/store/useReadingSessionStore.ts
 *  6. src/features/reading/store/useReadingHistoryStore.ts
 *  7. src/features/review/store/useReviewSessionStore.ts
 *  8. src/features/analytics/store/useAnalyticsStore.ts
 *  9. src/features/wordlist/store/useWordlistStore.ts
 * 10. src/features/llm/store/offlineMode.ts
 *
 * v2.2.4 Stage 2 (D2-4): useToastStore 已移除 persist (toast 为瞬时状态, 不持久化),
 * 不再纳入本扫描名单.
 *
 * v2.2.4 Round 2: 名单从 8 扩充到 10, 补全 useWordlistStore + useOfflineModeStore.
 */
import { describe, expect, it } from 'vitest';
import { migrateWordlistToCourse, useWordlistStore } from '../features/wordlist/store/useWordlistStore';
import { useCourseStore } from '../features/course/store/useCourseStore';

/**
 * 通过 Vite 的 import.meta.glob 以 raw 模式加载 10 个 store 文件源码。
 * 在 Vitest (Vite-based) 下, `{ as: 'raw' }` 会返回字符串内容,
 * 不需要 fs / path, 也不需要 node types。
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
    '../features/wordlist/store/useWordlistStore.ts',
    '../features/llm/store/offlineMode.ts',
    '../features/course/store/useCourseStore.ts',
  ],
  { query: '?raw', import: 'default' },
);

const STORE_PATHS = Object.keys(STORE_SOURCES).sort();

describe('Stage 2 persist migration (T05 static scan)', () => {
  it('扫描路径覆盖全部 11 个 store (v2.3.0 Stage 6 新增 useCourseStore)', () => {
    expect(STORE_PATHS).toHaveLength(11);
    expect(STORE_PATHS.some((p) => p.endsWith('useSettingsStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useAchievementStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useStreakStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useMemoryStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useReadingSessionStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useReadingHistoryStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useReviewSessionStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useAnalyticsStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('useWordlistStore.ts'))).toBe(true);
    expect(STORE_PATHS.some((p) => p.endsWith('offlineMode.ts'))).toBe(true);
    // v2.3.0 Stage 6: 新增 useCourseStore 扫描
    expect(STORE_PATHS.some((p) => p.endsWith('useCourseStore.ts'))).toBe(true);
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

  it.each(STORE_PATHS)(
    '%s 不应保留占位 identity migrate (v2.2.4 Round 2 清理)',
    async (relPath) => {
      const loader = STORE_SOURCES[relPath];
      const content = (await loader!()) as unknown as string;
      // 占位 migrate 形如 `migrate: (persistedState) => persistedState`
      expect(
        content,
        `${relPath} 不应保留占位 identity migrate`,
      ).not.toMatch(/migrate:\s*\(\s*\w+\s*\)\s*=>\s*\w+\s*,?\s*$/m);
    },
  );
});

// ============================================================================
// v2.3.0 Stage 6 — useWordlistStore v4→v5 迁移 + useCourseStore persist 扫描
//
// 覆盖 test_spec:
// - T01 [critical]: migrateWordlistToCourse 迁移函数存在, schemaVersion 4→5
// - T02 [critical]: 迁移幂等 — 重复运行不破坏数据
// - T03 [critical]: 迁移后旧用户 progress 保留在 useWordlistStore (不丢失)
// - T04 [non-critical]: 迁移后 useCourseStore currentCourseId=null (引导选课)
// - T05 [critical]: useCourseStore persist 扫描 (key + version)
// - T06 [non-critical]: 迁移函数不抛错 (容错处理未知 lemma / 损坏数据)
//
// 设计决策: Plan 3 (最简安全方案) — 仅升级 schemaVersion, 不分配 progress 到
// useCourseStore.lessonProgress. 详见 useWordlistStore.ts 中 migrateWordlistToCourse 注释.
// ============================================================================

describe('Stage 6 useWordlistStore v4→v5 迁移 (Plan 3)', () => {
  it('T01: migrateWordlistToCourse 迁移函数存在且 schemaVersion 4→5', () => {
    expect(typeof migrateWordlistToCourse).toBe('function');
    const input = { progress: {}, linearMode: true, schemaVersion: 4 };
    const result = migrateWordlistToCourse(input);
    expect(result.schemaVersion).toBe(5);
  });

  it('T01: useWordlistStore persist version=5, name=wordaydream:wordlist', () => {
    const options = useWordlistStore.persist.getOptions();
    expect(options.name).toBe('wordaydream:wordlist');
    expect(options.version).toBe(5);
  });

  it('T01: persist migrate 函数 v4→v5 调用后 schemaVersion=5', () => {
    const migrate = useWordlistStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();
    const result = migrate(
      { progress: { 'en:apple': { status: 'mastered' } }, schemaVersion: 4 },
      4,
    ) as Record<string, unknown>;
    expect(result.schemaVersion).toBe(5);
    // progress 保留 (Plan 3: 不分配)
    expect(result.progress).toEqual({ 'en:apple': { status: 'mastered' } });
  });

  it('T02: 迁移幂等 — 重复运行不破坏数据', () => {
    const input = {
      progress: {
        'en:apple': { status: 'mastered', encounterCount: 3 },
        'de:haus': { status: 'learning', encounterCount: 1 },
      },
      linearMode: true,
      schemaVersion: 4,
      dailyGoal: {
        date: '2026-01-01',
        newWordsTarget: 10,
        newWordsDone: 3,
        reviewsTarget: 5,
        reviewsDone: 2,
      },
    };
    const first = migrateWordlistToCourse(input);
    const second = migrateWordlistToCourse(first);
    expect(second.schemaVersion).toBe(5);
    // progress / linearMode / dailyGoal 全部保留不变
    expect(second.progress).toEqual(input.progress);
    expect(second.linearMode).toBe(true);
    expect(second.dailyGoal).toEqual(input.dailyGoal);
  });

  it('T03: 迁移后旧用户 progress 保留在 useWordlistStore (不丢失)', () => {
    const oldProgress = {
      'en:apple': { status: 'mastered', encounterCount: 3 },
      'de:haus': { status: 'learning', encounterCount: 1 },
      'en:banana': { status: 'learning', encounterCount: 2 },
    };
    const result = migrateWordlistToCourse({ progress: oldProgress, schemaVersion: 4 });
    // Plan 3: progress 原样保留, 不分配到 useCourseStore
    expect(result.progress).toEqual(oldProgress);
    // 3 个 lemma 全部保留
    expect(Object.keys(result.progress as Record<string, unknown>)).toHaveLength(3);
  });

  it('T06: 迁移函数不抛错 (容错处理未知 lemma / 损坏数据)', () => {
    expect(() =>
      migrateWordlistToCourse({
        progress: {
          'en:unknown-word': { status: 'mastered', encounterCount: 5 },
          'malformed-key': null,
          'another-unknown': { status: 'learning', encounterCount: 0 },
        },
        schemaVersion: 4,
      }),
    ).not.toThrow();
  });

  it('T06: 迁移函数对空 state / null / undefined 不抛错', () => {
    expect(() => migrateWordlistToCourse({})).not.toThrow();
    expect(() => migrateWordlistToCourse(null as unknown as Record<string, unknown>)).not.toThrow();
    expect(() =>
      migrateWordlistToCourse(undefined as unknown as Record<string, unknown>),
    ).not.toThrow();
  });

  it('T04: 迁移后 useCourseStore currentCourseId=null (引导选课, non-critical)', () => {
    // Plan 3: useWordlistStore 迁移不影响 useCourseStore 状态.
    // 迁移结果不应包含 useCourseStore 字段 (currentCourseId / lessonProgress).
    const migrated = migrateWordlistToCourse({
      progress: { 'en:apple': { status: 'mastered', encounterCount: 2 } },
      schemaVersion: 4,
    });
    expect(migrated).not.toHaveProperty('currentCourseId');
    expect(migrated).not.toHaveProperty('lessonProgress');
    // useCourseStore 默认状态: currentCourseId=null → 引导选课 (SPEC contract)
    useCourseStore.getState().resetProgress();
    expect(useCourseStore.getState().currentCourseId).toBeNull();
    expect(useCourseStore.getState().lessonProgress).toEqual({});
  });
});

describe('Stage 6 useCourseStore persist 扫描 (T05)', () => {
  it('T05: useCourseStore persist key=wordaydream:course, version=1', () => {
    const options = useCourseStore.persist.getOptions();
    expect(options.name).toBe('wordaydream:course');
    expect(options.version).toBe(1);
  });

  it('T05: useCourseStore 使用 zustand/middleware 的 persist (静态扫描)', async () => {
    // 复用 STORE_SOURCES 中的 useCourseStore 条目
    const courseStorePath = STORE_PATHS.find((p) => p.endsWith('useCourseStore.ts'));
    expect(courseStorePath, 'useCourseStore 应在扫描名单中').toBeDefined();
    const loader = STORE_SOURCES[courseStorePath!];
    const content = (await loader!()) as unknown as string;
    expect(content).toMatch(/from\s+['"]zustand\/middleware['"]/);
    expect(content).toMatch(/persist\s*\(/);
    // 不应 import 旧的 persistenceMiddleware
    expect(content).not.toMatch(/from\s+['"].*persistenceMiddleware['"]/);
  });
});
