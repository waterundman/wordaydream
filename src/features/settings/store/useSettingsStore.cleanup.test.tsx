/**
 * v2.1.1 Stage 4 (D2): Settings store 清理测试 (移除 apiKey/baseUrl)
 *
 * 覆盖 test_spec:
 * - T23 [unit, critical]: LLMSettings 类型不含 apiKey 字段
 * - T24 [unit, critical]: LLMSettings 类型不含 baseUrl 字段
 * - T25 [unit, critical]: useSettingsStore 不含 setApiKey/setBaseUrl 方法
 * - T26 [unit, critical]: migrate v6→v7 旧 apiKey/baseUrl 被删除
 * - T27 [unit, critical]: SettingsPanel 不渲染 API key 输入框
 * - T28 [unit, critical]: SettingsPanel 不渲染"保存"按钮
 *
 * T26 实现细节:
 * - zustand persist 的 migrate 在 store 创建时自动执行
 * - 通过 localStorage.setItem 写入 v6 数据 + vi.resetModules + dynamic import
 *   触发 persist 读取 + migrate, 验证 fresh store 的 llm 状态
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useSettingsStore } from './useSettingsStore';
import { SettingsPanel } from '../components/SettingsPanel';
import { isOptimizationAvailable } from '../../review/services/fsrsOptimizer';

// Mock fsrsOptimizer: 避免 isOptimizationAvailable 创建真实 FSRS 实例 (与 SettingsPanel.test.tsx 一致)
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

const STORAGE_KEY = 'wordaydream:settings';

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  // 重置 store 到默认状态, 避免上一个测试的 state 泄漏
  useSettingsStore.getState().resetAll();
  vi.mocked(isOptimizationAvailable).mockResolvedValue(false);
});

// T23/T24: LLMSettings 不含 apiKey/baseUrl
describe('T23/T24: LLMSettings 不含 apiKey/baseUrl', () => {
  it('T23: defaultLLM 不含 apiKey 字段', () => {
    const { llm } = useSettingsStore.getState();
    expect(llm).not.toHaveProperty('apiKey');
  });

  it('T24: defaultLLM 不含 baseUrl 字段', () => {
    const { llm } = useSettingsStore.getState();
    expect(llm).not.toHaveProperty('baseUrl');
  });

  it('LLMSettings 运行时 keys 不含 apiKey/baseUrl', () => {
    const llm = useSettingsStore.getState().llm;
    const keys = Object.keys(llm);
    expect(keys).not.toContain('apiKey');
    expect(keys).not.toContain('baseUrl');
  });
});

// T25: useSettingsStore 不含 setApiKey/setBaseUrl
describe('T25: useSettingsStore 不含 setApiKey/setBaseUrl', () => {
  it('store 不含 setApiKey 方法', () => {
    const store = useSettingsStore.getState();
    expect(store).not.toHaveProperty('setApiKey');
  });

  it('store 不含 setBaseUrl 方法', () => {
    const store = useSettingsStore.getState();
    expect(store).not.toHaveProperty('setBaseUrl');
  });
});

// T26: migrate v6→v7 旧 apiKey/baseUrl 被删除
describe('T26: migrate v6→v7 旧 apiKey/baseUrl 被删除', () => {
  /**
   * 辅助: 模拟 v6 持久化数据 (含 apiKey/baseUrl), 触发 persist migrate, 返回 fresh store
   */
  async function reloadStoreWithV6Data(): Promise<typeof useSettingsStore> {
    const v6Data = {
      state: {
        llm: {
          provider: 'openai',
          apiKey: 'sk-old-key',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          temperature: 0.5,
          enabled: true,
          timeout: 30,
          maxRetries: 2,
          streaming: false,
          jsonMaxAttempts: 3,
        },
        difficulty: 2,
        theme: 'light',
        totalSecondsToday: 0,
        lastSessionDate: null,
        fsrsWeights: undefined,
        fsrsWeightsBackup: undefined,
      },
      version: 6,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v6Data));

    // 重置模块缓存, 强制 persist 重新读取 localStorage + 执行 migrate
    vi.resetModules();
    const mod = await import('./useSettingsStore');
    return mod.useSettingsStore;
  }

  it('v6 数据含 apiKey, migrate 到 v7 后 apiKey 被删除', async () => {
    const fresh = await reloadStoreWithV6Data();
    const llm = fresh.getState().llm;
    expect(llm).not.toHaveProperty('apiKey');
  });

  it('v6 数据含 baseUrl, migrate 到 v7 后 baseUrl 被删除', async () => {
    const fresh = await reloadStoreWithV6Data();
    const llm = fresh.getState().llm;
    expect(llm).not.toHaveProperty('baseUrl');
  });

  it('migrate 后 provider/model 等合法字段保留', async () => {
    const fresh = await reloadStoreWithV6Data();
    const llm = fresh.getState().llm;
    expect(llm.provider).toBe('openai');
    expect(llm.model).toBe('gpt-4o-mini');
    expect(llm.enabled).toBe(true);
    expect(llm.temperature).toBe(0.5);
  });
});

// T27/T28: SettingsPanel UI 清理
describe('T27/T28: SettingsPanel UI 清理', () => {
  beforeEach(() => {
    // 设置 provider 为 openai (非 mock), 确保 "连接配置" 区域会渲染
    // (API key 输入框原本只在该区域出现, 移除后应不存在)
    useSettingsStore.setState({
      llm: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.5,
        enabled: true,
        timeout: 30,
        maxRetries: 2,
        streaming: false,
        jsonMaxAttempts: 3,
      },
    });
  });

  it('T27: 不渲染 API 密钥输入框', () => {
    render(<SettingsPanel />);
    expect(screen.queryByLabelText('API 密钥')).toBeNull();
    // 额外验证: label 文本也不存在
    expect(screen.queryByText('API 密钥')).toBeNull();
  });

  it('T28: 不渲染"保存"按钮', () => {
    render(<SettingsPanel />);
    expect(screen.queryByText('保存')).toBeNull();
    // 额外验证: "完成" 按钮存在 (替代原来的 "保存")
    expect(screen.getByText('完成')).toBeInTheDocument();
  });
});
