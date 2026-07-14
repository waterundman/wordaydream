/**
 * v2.2.0 Stage 1 (D4): SettingsPanel LLM 状态指示器测试.
 *
 * 覆盖 test_spec:
 * - T08 [critical]: SettingsPanel 渲染 LLM 状态指示器
 *   - llm.enabled=true && provider!='mock' → "LLM 已启用"
 *   - llm.enabled=false 或 provider='mock' → "演示模式"
 *
 * Mock 策略:
 * - mock fsrsOptimizer.isOptimizationAvailable 返回 false (与 ts-fsrs v5.4.1 一致)
 * - 重置 useSettingsStore / useMemoryStore / useToastStore / useWordlistStore
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useToastStore } from '../../../store/useToastStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';

// Mock fsrsOptimizer: isOptimizationAvailable=false (与 ts-fsrs v5.4.1 一致)
// v2.2.0 hotfix: isOptimizationAvailable 现为 async, mock 需返回 Promise
vi.mock('../../review/services/fsrsOptimizer', async () => {
  const actual = await vi.importActual<typeof import('../../review/services/fsrsOptimizer')>(
    '../../review/services/fsrsOptimizer',
  );
  return {
    ...actual,
    isOptimizationAvailable: vi.fn(() => Promise.resolve(false)),
  };
});

function resetStores() {
  useSettingsStore.setState({
    llm: {
      provider: 'mock',
      model: '',
      temperature: 0.5,
      enabled: false,
      timeout: 30,
      maxRetries: 2,
      streaming: false,
    },
    isTesting: false,
    testResult: null,
    fsrsWeights: undefined,
    fsrsWeightsBackup: undefined,
    settingsOpen: true,
  });
  useMemoryStore.setState({ ratingHistory: [], cards: new Map() });
  useToastStore.setState({ toasts: [] });
  useWordlistStore.setState({
    progress: {},
    linearMode: false,
    schemaVersion: 2,
    dailyGoal: { words: 10, sessions: 1, date: new Date().toDateString() },
  });
}

describe('v2.2.0 Stage 1 (D4): SettingsPanel LLM 状态指示器', () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    cleanup();
  });

  it('T08a [critical]: llm.enabled=true + provider="openai" → 显示 "LLM 已启用"', () => {
    useSettingsStore.setState((s) => ({
      llm: {
        ...s.llm,
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
    }));

    render(<SettingsPanel />);

    const indicator = screen.getByTestId('llm-status-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toContain('LLM 已启用');
    expect(indicator.textContent).toContain('openai');
  });

  it('T08b [critical]: llm.enabled=false → 显示 "演示模式"', () => {
    useSettingsStore.setState((s) => ({
      llm: {
        ...s.llm,
        enabled: false,
        provider: 'openai',
      },
    }));

    render(<SettingsPanel />);

    const indicator = screen.getByTestId('llm-status-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toContain('演示模式');
    expect(indicator.textContent).toContain('LLM 未启用');
  });

  it('T08c [critical]: llm.enabled=true + provider="mock" → 显示 "演示模式"', () => {
    useSettingsStore.setState((s) => ({
      llm: {
        ...s.llm,
        enabled: true,
        provider: 'mock',
      },
    }));

    render(<SettingsPanel />);

    const indicator = screen.getByTestId('llm-status-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toContain('演示模式');
    expect(indicator.textContent).not.toContain('LLM 已启用');
  });

  it('T08d: llm.enabled=true + provider="deepseek" → 显示 "LLM 已启用 (deepseek)"', () => {
    useSettingsStore.setState((s) => ({
      llm: {
        ...s.llm,
        enabled: true,
        provider: 'deepseek',
        model: 'deepseek-chat',
      },
    }));

    render(<SettingsPanel />);

    const indicator = screen.getByTestId('llm-status-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toContain('LLM 已启用');
    expect(indicator.textContent).toContain('deepseek');
  });
});
