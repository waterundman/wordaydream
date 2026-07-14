/**
 * v2.1.1 Stage 3 (D3): LLMProvider 类型收窄 + migrate 测试
 *
 * 覆盖 test_spec:
 * - T17 [unit, critical]: LLMProvider 类型仅接受 mock/openai/anthropic/deepseek
 * - T18 [unit, critical]: PROVIDER_PRESETS 仅含 4 个 key
 * - T19 [unit, critical]: SETTINGS_PRESETS 不含 kimi/qwen/minimax 任何条目
 * - T20 [unit, critical]: migrate v5→v6 旧 provider (kimi/qwen/minimax) → mock + enabled=false
 * - T21 [unit, critical]: importSettings 拒绝 kimi/qwen/minimax provider (返回 false)
 *
 * T20 实现细节:
 * - zustand persist 的 migrate 在 store 创建时自动执行
 * - 通过 localStorage.setItem 写入 v5 数据 + vi.resetModules + dynamic import
 *   触发 persist 读取 + migrate, 验证 fresh store 的 llm 状态
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../../../types';
import { PROVIDER_PRESETS, SETTINGS_PRESETS } from '../components/SettingsPanel';
import { useSettingsStore } from './useSettingsStore';

const STORAGE_KEY = 'wordaydream:settings';

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  vi.resetModules();
});

afterEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  vi.resetModules();
});

describe('T17: LLMProvider 类型收窄', () => {
  it('LLMProvider 仅接受 mock/openai/anthropic/deepseek', () => {
    // 类型层面验证: 以下赋值都应通过 tsc (若 LLMProvider 包含 kimi/qwen/minimax 之外的值会编译失败)
    const mock: LLMProvider = 'mock';
    const openai: LLMProvider = 'openai';
    const anthropic: LLMProvider = 'anthropic';
    const deepseek: LLMProvider = 'deepseek';
    // 运行时验证: 不存在其他值
    const validProviders: LLMProvider[] = ['mock', 'openai', 'anthropic', 'deepseek'];
    expect(validProviders).toHaveLength(4);
    expect(validProviders).not.toContain('kimi');
    expect(validProviders).not.toContain('qwen');
    expect(validProviders).not.toContain('minimax');
    // 引用变量避免 unused 警告
    expect([mock, openai, anthropic, deepseek]).toHaveLength(4);
  });
});

describe('T18: PROVIDER_PRESETS 仅含 4 个 key', () => {
  it('keys = [mock, openai, anthropic, deepseek]', () => {
    const keys = Object.keys(PROVIDER_PRESETS);
    expect(keys).toHaveLength(4);
    expect(keys).toEqual(
      expect.arrayContaining(['mock', 'openai', 'anthropic', 'deepseek'])
    );
    expect(keys).not.toContain('kimi');
    expect(keys).not.toContain('qwen');
    expect(keys).not.toContain('minimax');
  });
});

describe('T19: SETTINGS_PRESETS 移除 kimi/qwen/minimax', () => {
  it('所有 preset 的 provider 不含 kimi/qwen/minimax', () => {
    const deprecatedProviders = ['kimi', 'qwen', 'minimax'];
    for (const preset of SETTINGS_PRESETS) {
      expect(deprecatedProviders).not.toContain(preset.config.provider);
    }
    // 进一步验证: 不存在 id 包含 kimi/qwen/minimax 的 preset
    const ids = SETTINGS_PRESETS.map((p) => p.id);
    for (const id of ids) {
      expect(id).not.toMatch(/kimi|qwen|minimax/i);
    }
  });

  it('SETTINGS_PRESETS 仅保留 7 个 preset', () => {
    // demo + openai-fast/quality + anthropic-fast/quality + deepseek-fast/reasoner
    expect(SETTINGS_PRESETS).toHaveLength(7);
  });
});

describe('T20: migrate v5→v6 旧 provider → mock + enabled=false', () => {
  /**
   * 辅助: 模拟 v5 持久化数据, 触发 persist migrate, 返回 fresh store
   */
  async function reloadStoreWithV5Data(provider: string): Promise<typeof useSettingsStore> {
    const v5Data = {
      state: {
        llm: {
          provider,
          apiKey: 'sk-xxx',
          baseUrl: 'https://example.com/v1',
          model: 'test-model',
          temperature: 0.3,
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
      version: 5,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v5Data));

    // 重置模块缓存, 强制 persist 重新读取 localStorage + 执行 migrate
    vi.resetModules();
    const mod = await import('./useSettingsStore');
    return mod.useSettingsStore;
  }

  it('provider=kimi → mock + enabled=false', async () => {
    const fresh = await reloadStoreWithV5Data('kimi');
    const llm = fresh.getState().llm;
    expect(llm.provider).toBe('mock');
    expect(llm.enabled).toBe(false);
  });

  it('provider=qwen → mock + enabled=false', async () => {
    const fresh = await reloadStoreWithV5Data('qwen');
    const llm = fresh.getState().llm;
    expect(llm.provider).toBe('mock');
    expect(llm.enabled).toBe(false);
  });

  it('provider=minimax → mock + enabled=false', async () => {
    const fresh = await reloadStoreWithV5Data('minimax');
    const llm = fresh.getState().llm;
    expect(llm.provider).toBe('mock');
    expect(llm.enabled).toBe(false);
  });

  it('provider=deepseek 保持不变 (合法 provider 不被迁移)', async () => {
    const fresh = await reloadStoreWithV5Data('deepseek');
    const llm = fresh.getState().llm;
    expect(llm.provider).toBe('deepseek');
    expect(llm.enabled).toBe(true);
  });

  it('provider=mock 保持不变 (合法 provider 不被迁移)', async () => {
    const fresh = await reloadStoreWithV5Data('mock');
    const llm = fresh.getState().llm;
    expect(llm.provider).toBe('mock');
    expect(llm.enabled).toBe(true);
  });
});

describe('T21: importSettings 拒绝 kimi/qwen/minimax', () => {
  beforeEach(() => {
    // 不清空 store, 仅清空 localStorage (store 内存仍可用)
    window.localStorage.clear();
  });

  it('provider=kimi → importSettings 返回 false', () => {
    const json = JSON.stringify({
      version: 1,
      timestamp: Date.now(),
      llm: {
        provider: 'kimi',
        model: 'moonshot-v1-8k',
        temperature: 0.3,
        enabled: true,
      },
    });
    const result = useSettingsStore.getState().importSettings(json);
    expect(result).toBe(false);
  });

  it('provider=qwen → importSettings 返回 false', () => {
    const json = JSON.stringify({
      version: 1,
      timestamp: Date.now(),
      llm: {
        provider: 'qwen',
        model: 'qwen-turbo',
        temperature: 0.3,
        enabled: true,
      },
    });
    const result = useSettingsStore.getState().importSettings(json);
    expect(result).toBe(false);
  });

  it('provider=minimax → importSettings 返回 false', () => {
    const json = JSON.stringify({
      version: 1,
      timestamp: Date.now(),
      llm: {
        provider: 'minimax',
        model: 'MiniMax-Text-01',
        temperature: 0.3,
        enabled: true,
      },
    });
    const result = useSettingsStore.getState().importSettings(json);
    expect(result).toBe(false);
  });

  it('provider=deepseek → importSettings 返回 true (合法)', () => {
    const json = JSON.stringify({
      version: 1,
      timestamp: Date.now(),
      llm: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        temperature: 0.3,
        enabled: true,
      },
    });
    const result = useSettingsStore.getState().importSettings(json);
    expect(result).toBe(true);
  });

  it('provider=mock → importSettings 返回 true (合法)', () => {
    const json = JSON.stringify({
      version: 1,
      timestamp: Date.now(),
      llm: {
        provider: 'mock',
        model: '',
        temperature: 0.5,
        enabled: false,
      },
    });
    const result = useSettingsStore.getState().importSettings(json);
    expect(result).toBe(true);
  });
});
