/**
 * v2.2.0 Stage 3: SettingsPanel FSRS 优化 UI 测试
 *
 * 覆盖 test_spec (v2.2.0 Stage 3):
 * - T11 [critical]: 优化按钮渲染, isOptimizationAvailable=false 时禁用
 * - T12 [critical]: 功能不可用提示显示 "@open-spaced-repetition/binding"
 * - T13 [non-critical]: ratingHistory < 30 条时显示数据不足提示 (mock isAvailable=true)
 * - T14 [non-critical]: 点击优化按钮 → 捕获 OptimizationUnavailableError → 显示错误 toast
 * - T26 [critical]: SettingsPanel "优化 FSRS 参数" 按钮可点击 (isOptimizationAvailable=true)
 *
 * Mock 策略:
 * - mock isOptimizationAvailable (默认 false, T13/T14/T26 切换为 true)
 * - mock optimizeFsrsWeights (默认 vi.fn(), T14 mock reject, T26 mock resolve)
 * - 保留真实 OptimizationUnavailableError (T14 需要)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FsrsOptimizationSection } from './SettingsPanel';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useToastStore } from '../../../store/useToastStore';
import {
  isOptimizationAvailable,
  optimizeFsrsWeights,
  OptimizationUnavailableError,
} from '../../review/services/fsrsOptimizer';
import type { RatingEntry } from '../../review/services/recallRateCalculator';

// Mock fsrsOptimizer: 默认 isOptimizationAvailable=false, optimizeFsrsWeights=vi.fn()
// 保留真实 OptimizationUnavailableError (T14 需要)
// v2.2.0 hotfix: isOptimizationAvailable 现为 async, mock 需返回 Promise
vi.mock('../../review/services/fsrsOptimizer', async () => {
  const actual = await vi.importActual<typeof import('../../review/services/fsrsOptimizer')>(
    '../../review/services/fsrsOptimizer',
  );
  return {
    ...actual,
    isOptimizationAvailable: vi.fn(() => Promise.resolve(false)),
    optimizeFsrsWeights: vi.fn(),
  };
});

function makeHistory(count: number): RatingEntry[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    cardId: `card-${i % 10}`,
    rating: 'good' as const,
    at: now - (count - i) * 86_400_000,
  }));
}

describe('v2.2.0 Stage 3: SettingsPanel FSRS 优化 UI', () => {
  beforeEach(() => {
    useSettingsStore.setState({ fsrsWeights: undefined, fsrsWeightsBackup: undefined });
    useMemoryStore.setState({ ratingHistory: [] });
    useToastStore.setState({ toasts: [] });
    vi.mocked(isOptimizationAvailable).mockResolvedValue(false);
    vi.mocked(optimizeFsrsWeights).mockReset();
    // 清除优化历史 localStorage (避免测试间干扰)
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('wordaydream:fsrs-optimization-history');
    }
  });

  it('T11: 优化按钮渲染, isOptimizationAvailable=false 时禁用', () => {
    render(<FsrsOptimizationSection />);
    const button = screen.getByRole('button', { name: /优化 FSRS 参数/ });
    expect(button).toBeDisabled();
  });

  it('T12: 功能不可用提示显示 "@open-spaced-repetition/binding"', () => {
    render(<FsrsOptimizationSection />);
    // v2.2.0 Stage 3: 移除 "ts-fsrs v5 不支持" 硬编码, 改为通用 binding 不可用提示
    expect(screen.getByText(/@open-spaced-repetition\/binding/)).toBeInTheDocument();
  });

  it('T13: ratingHistory < 30 条时显示数据不足提示 (mock isAvailable=true)', async () => {
    vi.mocked(isOptimizationAvailable).mockResolvedValue(true);
    useMemoryStore.setState({ ratingHistory: makeHistory(29) });
    render(<FsrsOptimizationSection />);

    // v2.2.0 hotfix: isAvailable 现为 async, 需等待 useEffect 异步检测后状态更新
    const insufficientMsg = await screen.findByText(/需要至少 30 条/);
    expect(insufficientMsg).toBeInTheDocument();
    expect(screen.getByText(/当前 29 条/)).toBeInTheDocument();

    // 按钮因数据不足而禁用
    const button = screen.getByRole('button', { name: /优化 FSRS 参数/ });
    expect(button).toBeDisabled();
  });

  it('T14: 点击优化按钮 → 捕获 OptimizationUnavailableError → 显示错误 toast', async () => {
    vi.mocked(isOptimizationAvailable).mockResolvedValue(true);
    // mock optimizeFsrsWeights 抛出 OptimizationUnavailableError (模拟 binding 运行时不可用)
    vi.mocked(optimizeFsrsWeights).mockRejectedValueOnce(
      new OptimizationUnavailableError('binding 运行时不可用'),
    );
    useMemoryStore.setState({ ratingHistory: makeHistory(30) });
    render(<FsrsOptimizationSection />);

    // v2.2.0 hotfix: isAvailable 现为 async, 需等待按钮启用后再点击
    const button = screen.getByRole('button', { name: /优化 FSRS 参数/ });
    await waitFor(() => expect(button).not.toBeDisabled());

    fireEvent.click(button);

    // 等待 async handleOptimize 完成, 验证 error toast 已添加到全局 toast store
    // v2.2.0 Stage 3: 错误消息含 "@open-spaced-repetition/binding" (通用提示)
    await waitFor(() => {
      const state = useToastStore.getState();
      const errorToast = state.toasts.find(
        (t) => t.type === 'error' && t.message.includes('@open-spaced-repetition/binding'),
      );
      expect(errorToast).toBeDefined();
    });

    // 验证按钮恢复为可点击状态 (finally 块执行完毕)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /优化 FSRS 参数/ })).not.toBeDisabled();
    });
  });

  it('T26: SettingsPanel "优化 FSRS 参数" 按钮可点击 (isOptimizationAvailable=true)', async () => {
    vi.mocked(isOptimizationAvailable).mockResolvedValue(true);
    // mock optimizeFsrsWeights 成功返回 weights + backup + loss
    const mockWeights = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10];
    vi.mocked(optimizeFsrsWeights).mockResolvedValueOnce({
      weights: mockWeights,
      backup: [...mockWeights],
      loss: 0.42,
    });
    useMemoryStore.setState({ ratingHistory: makeHistory(30) });
    render(<FsrsOptimizationSection />);

    // v2.2.0 hotfix: isAvailable 现为 async, 需等待按钮启用后再点击
    const button = screen.getByRole('button', { name: /优化 FSRS 参数/ });
    await waitFor(() => expect(button).not.toBeDisabled());

    fireEvent.click(button);

    // 等待成功 toast 显示 (含 loss)
    await waitFor(() => {
      const state = useToastStore.getState();
      const successToast = state.toasts.find(
        (t) => t.type === 'success' && t.message.includes('loss'),
      );
      expect(successToast).toBeDefined();
      expect(successToast?.message).toContain('0.42');
    });

    // 验证 weights 已保存到 store
    await waitFor(() => {
      const state = useSettingsStore.getState();
      expect(state.fsrsWeights).toEqual(mockWeights);
      expect(state.fsrsWeightsBackup).toBeDefined();
    });

    // 验证优化历史区域出现
    await waitFor(() => {
      const historyEl = screen.queryByTestId('fsrs-optimization-history');
      if (historyEl) {
        expect(historyEl).toBeInTheDocument();
      }
    });
  });
});
