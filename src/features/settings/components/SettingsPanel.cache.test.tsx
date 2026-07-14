/**
 * v2.2.0 Stage 4 (D3): SettingsPanel AI 释义缓存区域测试 (T32)
 *
 * 覆盖 test_spec:
 * - T32 [critical]: SettingsPanel 渲染 "AI 释义缓存" 区域 + "清空缓存" 按钮
 *
 * Mock 策略:
 * - mock fsrsOptimizer.isOptimizationAvailable=false (与现有 SettingsPanel 测试一致)
 * - 使用 fake-indexeddb 模拟 IndexedDB (GlossCacheSection 调 getCachedGlossCount)
 * - 不 mock glossPersistentCache: 验证真实异步加载 + 渲染
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SettingsPanel, GlossCacheSection } from './SettingsPanel';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useToastStore } from '../../../store/useToastStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';
import { clearAllCachedGlosses, setCachedGloss } from '../../dictionary/services/glossPersistentCache';

// Mock fsrsOptimizer: isOptimizationAvailable=false (与 SettingsPanel.status.test.tsx 一致)
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

function deleteDb(): Promise<void> {
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('wordaydream-gloss-cache');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

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

describe('v2.2.0 Stage 4 (D3): SettingsPanel AI 释义缓存区域 (T32)', () => {
  beforeEach(async () => {
    resetStores();
    await deleteDb();
    await clearAllCachedGlosses();
  });

  afterEach(async () => {
    cleanup();
    await deleteDb();
    await clearAllCachedGlosses();
  });

  it('T32 [critical]: SettingsPanel 渲染 "AI 释义缓存" 区域 + "清空缓存" 按钮', async () => {
    render(<SettingsPanel />);

    // 区域存在 (data-testid)
    const section = await screen.findByTestId('gloss-cache-section');
    expect(section).toBeInTheDocument();

    // 标题文字
    expect(screen.getByText('AI 释义缓存')).toBeInTheDocument();

    // 缓存信息文字 (含 30 天提示)
    expect(screen.getByText(/缓存 LLM 改写的释义/)).toBeInTheDocument();
    expect(screen.getByText(/30 天自动过期/)).toBeInTheDocument();

    // "清空缓存" 按钮存在 (初始 count=0, 按钮禁用)
    const clearBtn = screen.getByRole('button', { name: /清空缓存/ });
    expect(clearBtn).toBeInTheDocument();
    // 初始 count=0, 按钮应禁用
    expect(clearBtn).toBeDisabled();

    // 显示当前缓存条数 (0 条)
    expect(screen.getByText(/当前缓存 0 条/)).toBeInTheDocument();
  });

  it('T32 补充: 有缓存时按钮可点击, 点击后弹出确认弹窗', async () => {
    // 预先写入 2 条缓存
    await setCachedGloss('en', 'word1', {
      definitions: ['词1'],
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      sourceHash: 'h1',
    });
    await setCachedGloss('en', 'word2', {
      definitions: ['词2'],
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      sourceHash: 'h2',
    });

    render(<GlossCacheSection />);

    // 等待异步 count 加载, 显示 "当前缓存 2 条"
    await waitFor(() => {
      expect(screen.getByText(/当前缓存 2 条/)).toBeInTheDocument();
    });

    // 按钮可点击 (count > 0)
    const clearBtn = screen.getByRole('button', { name: /清空缓存/ });
    expect(clearBtn).not.toBeDisabled();

    // 点击 → 弹出确认弹窗
    fireEvent.click(clearBtn);
    expect(screen.getByText(/确认清空所有 AI 释义缓存/)).toBeInTheDocument();
    // 确认按钮 + 取消按钮
    expect(screen.getByRole('button', { name: '确认清空' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
  });

  it('T32 补充: 确认清空后, 缓存归零 + 显示 success toast', async () => {
    await setCachedGloss('en', 'word1', {
      definitions: ['词1'],
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      sourceHash: 'h1',
    });

    render(<GlossCacheSection />);

    await waitFor(() => {
      expect(screen.getByText(/当前缓存 1 条/)).toBeInTheDocument();
    });

    // 点击 "清空缓存"
    fireEvent.click(screen.getByRole('button', { name: /清空缓存/ }));
    // 点击 "确认清空"
    fireEvent.click(screen.getByRole('button', { name: '确认清空' }));

    // 等待 success toast
    await waitFor(() => {
      const state = useToastStore.getState();
      const successToast = state.toasts.find(
        (t) => t.type === 'success' && t.message.includes('AI 释义缓存已清空'),
      );
      expect(successToast).toBeDefined();
    });

    // count 归零
    await waitFor(() => {
      expect(screen.getByText(/当前缓存 0 条/)).toBeInTheDocument();
    });
  });
});
