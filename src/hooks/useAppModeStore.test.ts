/**
 * useAppModeStore 测试 (v2.1.0 Stage 1, Contract 61)
 *
 * 覆盖 test_spec:
 * - T1 [unit, critical]: recordPreviousMode 记录当前 currentMode 为 previousMode
 *   验证: setMode('reading') → recordPreviousMode() → previousMode === 'reading'
 * - T2 [unit, critical]: returnToPrevious 回到 previousMode (若存在), 否则回 home; 清空 previousMode
 *   验证: previousMode='reading' → returnToPrevious() → currentMode === 'reading', previousMode === null
 *         previousMode=null → returnToPrevious() → currentMode === 'home' (DEFAULT_APP_MODE)
 *
 * 额外覆盖:
 * - T3: reset() 同时清空 previousMode
 * - T4: 闭环场景 setMode(reading) → recordPreviousMode → setMode(review) → returnToPrevious → reading
 *
 * 实现策略:
 * - useAppModeStore 不持久化 (无 persist middleware), 无需 vi.resetModules()
 * - beforeEach 调用 reset() 重置状态, 避免单例状态跨测试泄漏
 * - 直接通过 getState() 调用 store 方法, 不渲染组件 (纯 store 单元测试)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppModeStore, DEFAULT_APP_MODE } from './useAppModeStore';

beforeEach(() => {
  // useAppModeStore 是单例, 状态会跨测试泄漏, 每个测试前 reset
  useAppModeStore.getState().reset();
});

describe('useAppModeStore v2.1.0 (Contract 61)', () => {
  describe('T1: recordPreviousMode', () => {
    it('T1a: 记录 currentMode=reading 为 previousMode', () => {
      useAppModeStore.getState().setMode('reading');
      expect(useAppModeStore.getState().currentMode).toBe('reading');
      expect(useAppModeStore.getState().previousMode).toBeNull();

      useAppModeStore.getState().recordPreviousMode();

      expect(useAppModeStore.getState().previousMode).toBe('reading');
      // recordPreviousMode 不改变 currentMode
      expect(useAppModeStore.getState().currentMode).toBe('reading');
    });

    it('T1b: 记录 currentMode=home 为 previousMode', () => {
      useAppModeStore.getState().setMode('home');
      useAppModeStore.getState().recordPreviousMode();

      expect(useAppModeStore.getState().previousMode).toBe('home');
      expect(useAppModeStore.getState().currentMode).toBe('home');
    });

    it('T1c: 记录 currentMode=wordlist 为 previousMode', () => {
      useAppModeStore.getState().setMode('wordlist');
      useAppModeStore.getState().recordPreviousMode();

      expect(useAppModeStore.getState().previousMode).toBe('wordlist');
    });

    it('T1d: 多次调用 recordPreviousMode 覆盖旧值', () => {
      useAppModeStore.getState().setMode('reading');
      useAppModeStore.getState().recordPreviousMode();
      expect(useAppModeStore.getState().previousMode).toBe('reading');

      useAppModeStore.getState().setMode('wordlist');
      useAppModeStore.getState().recordPreviousMode();

      // 覆盖为最新的 currentMode
      expect(useAppModeStore.getState().previousMode).toBe('wordlist');
    });
  });

  describe('T2: returnToPrevious', () => {
    it('T2a: previousMode=reading 时回到 reading 并清空 previousMode', () => {
      useAppModeStore.getState().setMode('reading');
      useAppModeStore.getState().recordPreviousMode();
      useAppModeStore.getState().setMode('review');

      // 此时 currentMode=review, previousMode=reading
      expect(useAppModeStore.getState().currentMode).toBe('review');
      expect(useAppModeStore.getState().previousMode).toBe('reading');

      useAppModeStore.getState().returnToPrevious();

      expect(useAppModeStore.getState().currentMode).toBe('reading');
      expect(useAppModeStore.getState().previousMode).toBeNull();
    });

    it('T2b: previousMode=null 时回 home (DEFAULT_APP_MODE)', () => {
      // 初始状态: currentMode=home, previousMode=null
      useAppModeStore.getState().setMode('review');
      // previousMode 仍为 null (未调用 recordPreviousMode)
      expect(useAppModeStore.getState().previousMode).toBeNull();

      useAppModeStore.getState().returnToPrevious();

      expect(useAppModeStore.getState().currentMode).toBe(DEFAULT_APP_MODE);
      expect(useAppModeStore.getState().previousMode).toBeNull();
    });

    it('T2c: 二次 returnToPrevious 回 home (previousMode 已被清空)', () => {
      useAppModeStore.getState().setMode('reading');
      useAppModeStore.getState().recordPreviousMode();
      useAppModeStore.getState().setMode('review');

      // 第一次 returnToPrevious: 回 reading, 清空 previousMode
      useAppModeStore.getState().returnToPrevious();
      expect(useAppModeStore.getState().currentMode).toBe('reading');
      expect(useAppModeStore.getState().previousMode).toBeNull();

      // 第二次 returnToPrevious: previousMode=null → 回 home
      useAppModeStore.getState().returnToPrevious();
      expect(useAppModeStore.getState().currentMode).toBe(DEFAULT_APP_MODE);
      expect(useAppModeStore.getState().previousMode).toBeNull();
    });

    it('T2d: previousMode=wordlist 时回到 wordlist', () => {
      useAppModeStore.getState().setMode('wordlist');
      useAppModeStore.getState().recordPreviousMode();
      useAppModeStore.getState().setMode('review');

      useAppModeStore.getState().returnToPrevious();

      expect(useAppModeStore.getState().currentMode).toBe('wordlist');
      expect(useAppModeStore.getState().previousMode).toBeNull();
    });
  });

  describe('T3: reset 清空 previousMode', () => {
    it('T3a: reset 同时清空 currentMode 和 previousMode', () => {
      useAppModeStore.getState().setMode('reading');
      useAppModeStore.getState().recordPreviousMode();
      useAppModeStore.getState().setMode('review');

      // 确认有状态
      expect(useAppModeStore.getState().currentMode).toBe('review');
      expect(useAppModeStore.getState().previousMode).toBe('reading');

      useAppModeStore.getState().reset();

      expect(useAppModeStore.getState().currentMode).toBe(DEFAULT_APP_MODE);
      expect(useAppModeStore.getState().previousMode).toBeNull();
    });
  });

  describe('T4: 闭环场景 (阅读 → 复习 → 阅读)', () => {
    it('T4a: setMode(reading) → recordPreviousMode → setMode(review) → returnToPrevious → reading', () => {
      // 1. 用户在 reading 模式
      useAppModeStore.getState().setMode('reading');
      expect(useAppModeStore.getState().currentMode).toBe('reading');

      // 2. 进入复习前记录 previousMode (模拟 startReview 调用)
      useAppModeStore.getState().recordPreviousMode();
      expect(useAppModeStore.getState().previousMode).toBe('reading');

      // 3. 进入复习模式 (App.tsx useEffect 触发 setMode('review'))
      useAppModeStore.getState().setMode('review');
      expect(useAppModeStore.getState().currentMode).toBe('review');
      expect(useAppModeStore.getState().previousMode).toBe('reading');

      // 4. 复习结束, exitReview 调用 returnToPrevious
      useAppModeStore.getState().returnToPrevious();

      // 5. 回到 reading (闭环修复成功, 而非强制 home)
      expect(useAppModeStore.getState().currentMode).toBe('reading');
      expect(useAppModeStore.getState().previousMode).toBeNull();
    });

    it('T4b: 从 home 进入复习 → 结束 → 回 home (无 previousMode 记录时回默认)', () => {
      // 1. 用户在 home (默认)
      expect(useAppModeStore.getState().currentMode).toBe('home');

      // 2. 从 home 进入复习 (recordPreviousMode 记录 home)
      useAppModeStore.getState().recordPreviousMode();
      useAppModeStore.getState().setMode('review');
      expect(useAppModeStore.getState().previousMode).toBe('home');

      // 3. 复习结束 returnToPrevious → 回 home
      useAppModeStore.getState().returnToPrevious();
      expect(useAppModeStore.getState().currentMode).toBe('home');
      expect(useAppModeStore.getState().previousMode).toBeNull();
    });
  });
});
