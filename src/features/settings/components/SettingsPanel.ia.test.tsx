/**
 * v1.6.4 Stage 1 — SettingsPanel 三层信息架构 (IA) 测试.
 *
 * 覆盖 test_spec:
 * - T02 [critical]: 常显层 (非折叠) 顶层区块数 ≤ 6
 * - 附带锁定三条目标 IA 不变量:
 *   1. 折叠层恰 2 个 (LLM 高级 / 数据与高级), 均默认折叠;
 *   2. 折叠组头必须带「一句后果说明」(非装饰性文案), 且 0 emoji;
 *   3. 原本平铺的功能区块标题全部仍在 DOM 且落在 `<details>` 内; 并且 `llm.enabled`
 *      的**交互式开关在 DOM 中恰 1 个** (常显层「语言模型」区块内, 点击确实翻转 store),
 *      折叠层 A 只留非交互状态行, 预设模板也不再顺带写 `enabled`.
 *
 * 可查询标记口径:
 * - 常显层区块: `data-settings-level="top"` (SettingsPanel 内 4 处: 语言模型 / 外观主题 /
 *   课程模式 / 复习提醒; 复习提醒仅鸿蒙端渲染). 该属性是常显层的**唯一**稳定标记 ——
 *   不再额外叠加 `data-testid`, 因为 `notifications-section` 已有 testid,
 *   一个元素只能挂一个 testid, 叠加会导致标记不一致.
 * - 折叠层: 原生 `<details data-collapsible="open|closed">` (testid
 *   `settings-group-llm-advanced` / `settings-group-data-advanced`).
 *
 * 折叠态可见性口径: 用原生 `<details>`, 折叠时内容仍在 DOM (只是不渲染),
 * 因此 `getByText` 仍能找到 —— 这正是 5 个锁定测试文件断言不变的前提.
 * 「非折叠」的判定因此以「不在 `<details>` 内」为准 (`el.closest('details') === null`).
 *
 * Mock 策略与 SettingsPanel.status.test.tsx 保持一致 (fsrsOptimizer 不可用).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useToastStore } from '../../../store/useToastStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';
import { useOfflineModeStore } from '../../llm/store/offlineMode';
import { detectPlatform, _resetPlatformCache } from '../../../platform/detect';

// Mock fsrsOptimizer: isOptimizationAvailable=false (与 status / cache 测试一致)
vi.mock('../../review/services/fsrsOptimizer', async () => {
  const actual = await vi.importActual<typeof import('../../review/services/fsrsOptimizer')>(
    '../../review/services/fsrsOptimizer',
  );
  return {
    ...actual,
    isOptimizationAvailable: vi.fn(() => Promise.resolve(false)),
  };
});

/** 常显层顶层区块数上限 (SPEC §S1 验收: ≤ 6). */
const MAX_TOP_LEVEL = 6;

/** 原始平铺区块的功能标题 (v1.6.4 前共 16 个顶层 section); 全部必须仍在 DOM 中. */
const LEGACY_SECTION_TITLES = [
  '语言模型',
  '外观主题',
  '课程模式',
  'FSRS 参数优化',
  'AI 释义缓存',
  '词库管理',
  '错词导出',
  '错词导入',
  '快捷键',
  '配置迁移',
  '高级参数',
  'LLM 高级参数',
  '数据与高级',
  '预设模板',
] as const;

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

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
    difficulty: 2,
  });
  useMemoryStore.setState({ ratingHistory: [], cards: new Map() });
  useToastStore.setState({ toasts: [] });
  useWordlistStore.setState({
    progress: {},
    linearMode: false,
    schemaVersion: 2,
    dailyGoal: { words: 10, sessions: 1, date: new Date().toDateString() },
  });
  useOfflineModeStore.setState({ installPromptEvent: null });
}

/** 常显层区块 (data-settings-level="top"). */
function topLevelSections(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-settings-level="top"]'));
}

/** 折叠层 (<details data-collapsible>). */
function collapsibleGroups(container: HTMLElement): HTMLDetailsElement[] {
  return Array.from(container.querySelectorAll<HTMLDetailsElement>('details[data-collapsible]'));
}

describe('v1.6.4 Stage 1 T02: SettingsPanel 三层 IA', () => {
  beforeEach(() => {
    _resetPlatformCache();
    resetStores();
  });

  afterEach(() => {
    cleanup();
    _resetPlatformCache();
  });

  it('T02a [critical]: Web 端常显层顶层区块数 ≤ 6 (且 ≥ 3), 语言模型 / 外观主题 / 课程模式常显且不在折叠容器内', () => {
    // jsdom 默认 Web 环境: 无 ArkWeb UA / 无 harmonyBridge → supportsNotifications=false
    expect(detectPlatform().supportsNotifications()).toBe(false);

    const { container } = render(<SettingsPanel />);
    const top = topLevelSections(container);

    // 上限 (SPEC 验收)
    expect(top.length).toBeLessThanOrEqual(MAX_TOP_LEVEL);
    // 下限: 语言模型 / 外观主题 / 课程模式 必须常显
    expect(top.length).toBeGreaterThanOrEqual(3);

    const text = top.map((el) => el.textContent ?? '').join(' | ');
    expect(text).toContain('语言模型');
    expect(text).toContain('外观主题');
    expect(text).toContain('课程模式');

    // 常显层区块本身不得是折叠容器
    for (const el of top) {
      expect(el.tagName).not.toBe('DETAILS');
      expect(el.closest('details')).toBeNull();
    }
  });

  it('T02b [critical]: 折叠层恰 2 个, 均默认折叠, 且不污染常显层计数', () => {
    const { container } = render(<SettingsPanel />);
    const groups = collapsibleGroups(container);

    expect(groups).toHaveLength(2);

    const ids = groups.map((g) => g.getAttribute('data-testid'));
    expect(ids).toEqual(['settings-group-llm-advanced', 'settings-group-data-advanced']);

    // 默认折叠: data-collapsible=closed 且无 open 属性; aria-expanded 同步为 false
    for (const g of groups) {
      expect(g.getAttribute('data-collapsible')).toBe('closed');
      expect(g.hasAttribute('open')).toBe(false);
      const summary = g.querySelector('summary');
      expect(summary?.getAttribute('aria-expanded')).toBe('false');
    }

    // 折叠层不计入常显层
    for (const g of groups) {
      expect(g.hasAttribute('data-settings-level')).toBe(false);
    }
    expect(topLevelSections(container).length).toBeLessThanOrEqual(MAX_TOP_LEVEL);
  });

  it('T02c [critical]: 折叠组头带「后果说明」(非装饰性文案) 且 0 emoji', () => {
    const { container } = render(<SettingsPanel />);

    for (const g of collapsibleGroups(container)) {
      const summary = g.querySelector('summary') as HTMLElement;
      const summaryText = summary.textContent ?? '';

      // 两行结构: 标题 + 后果说明; 说明行必须存在且非空
      const description = summary.querySelector('span > span:nth-child(2)');
      const descriptionText = description?.textContent?.trim() ?? '';
      expect(descriptionText.length).toBeGreaterThan(10);
      // 后果说明需点明「展开/关闭后会发生什么」, 而不是纯功能名
      expect(descriptionText).toMatch(/关闭|展开|不可撤销|保持/);

      // 0 emoji 硬约束
      expect(EMOJI_RE.test(summaryText)).toBe(false);
    }

    // LLM 路由的后果说明必须点出「单 Key 用户保持关闭」这类裁定信息
    const llmGroup = container.querySelector('[data-testid="settings-group-llm-advanced"]');
    expect(llmGroup?.textContent).toContain('单 Key');
  });

  it('T02d [critical]: 原平铺区块标题仍在 DOM; 除 3 个常显区块外全部落在 <details> 内, 5 个数据类区块都在折叠层 B', () => {
    render(<SettingsPanel />);

    for (const title of LEGACY_SECTION_TITLES) {
      const node = screen.getByText(title);
      expect(node).toBeInTheDocument();

      // 常显层的 3 个标题之外, 其余功能必须落在 <details> 内
      const isAlwaysVisible = title === '语言模型' || title === '外观主题' || title === '课程模式';
      if (!isAlwaysVisible) {
        expect(node.closest('details')).not.toBeNull();
      }
    }

    // 折叠层 B 收纳了数据类区块
    for (const testId of [
      'fsrs-optimization-section',
      'gloss-cache-section',
      'csv-wordlist-management-section',
      'wrong-words-export-section',
      'wrong-words-import-section',
    ]) {
      const node = screen.getByTestId(testId);
      const group = node.closest('details');
      expect(group?.getAttribute('data-testid')).toBe('settings-group-data-advanced');
    }
  });

  it('T02e [critical]: 常显层内恰 1 个「启用 LLM 路由」开关 (点击确实翻转 store); 折叠层 A 无第二个开关, 只留非交互状态行', () => {
    const { container } = render(<SettingsPanel />);
    const top = topLevelSections(container);

    // 状态指示器恰 1 个, 且位于常显层内
    const indicators = screen.getAllByTestId('llm-status-indicator');
    expect(indicators).toHaveLength(1);
    expect(indicators[0].closest('[data-settings-level="top"]')).not.toBeNull();

    const topText = top.map((el) => el.textContent ?? '').join(' | ');
    // 常显层不再暴露 LLM **调参**控件 (随机性 / 超时属折叠层 A)
    expect(topText).not.toContain('随机性');
    expect(topText).not.toContain('超时时间');

    // llm.enabled 的交互式开关全仓恰 1 个, 且必须在常显层「语言模型」区块内
    // (v1.6.4 Stage 1 P3: 原实现在折叠层 A 又放了一个 switch → 3 个写入点未收敛)
    const enabledSwitches = screen.getAllByRole('switch', { name: '启用 LLM 路由' });
    expect(enabledSwitches).toHaveLength(1);
    expect(enabledSwitches[0].closest('[data-settings-level="top"]')).not.toBeNull();
    expect(enabledSwitches[0].closest('details')).toBeNull();

    // 它确实是写入点: 点击后 store 的 llm.enabled 翻转
    expect(useSettingsStore.getState().llm.enabled).toBe(false);
    fireEvent.click(enabledSwitches[0]);
    expect(useSettingsStore.getState().llm.enabled).toBe(true);

    // 折叠层 A 只留「状态行」(非交互), 且文案指回常显层开关
    const routeStatus = screen.getByTestId('llm-route-status');
    expect(routeStatus.closest('details')?.getAttribute('data-testid')).toBe(
      'settings-group-llm-advanced',
    );
    expect(routeStatus.querySelector('button')).toBeNull();
    expect(routeStatus.textContent).toContain('常显层');

    // 调参控件仍在 DOM, 但都在折叠层 A 内
    for (const label of ['随机性', '超时时间']) {
      const node = screen.getByText(new RegExp(label));
      expect(node.closest('details')?.getAttribute('data-testid')).toBe(
        'settings-group-llm-advanced',
      );
    }
  });

  it('T02i [critical]: 预设模板不再静默改写 llm.enabled (预设语义 = provider/model/temperature)', () => {
    useSettingsStore.setState((s) => ({
      llm: { ...s.llm, provider: 'mock', model: '', temperature: 0.5, enabled: false },
    }));
    render(<SettingsPanel />);

    // v1.6.4 前: 应用「OpenAI 快速」会顺带把 enabled 置 true (第二个写入点).
    // 现在预设只组合 provider / model / temperature.
    fireEvent.click(screen.getByRole('button', { name: /OpenAI 快速/ }));

    const after = useSettingsStore.getState().llm;
    expect(after.provider).toBe('openai');
    expect(after.model).toBe('gpt-4o-mini');
    expect(after.temperature).toBe(0.3);
    expect(after.enabled).toBe(false);
  });

  it('T02f [critical]: 鸿蒙端常显层恰 4 个区块 (多出「复习提醒」), 仍 ≤ 6, 且复习提醒不在折叠层内', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 12; HarmonyOS) ArkWeb/5.0.0',
      configurable: true,
    });
    _resetPlatformCache();
    expect(detectPlatform().supportsNotifications()).toBe(true);

    try {
      const { container } = render(<SettingsPanel />);
      const top = topLevelSections(container);

      expect(top.length).toBeLessThanOrEqual(MAX_TOP_LEVEL);
      expect(top).toHaveLength(4);

      const notifications = container.querySelector('[data-testid="notifications-section"]');
      expect(notifications?.getAttribute('data-settings-level')).toBe('top');
      // 复习提醒是常显层, 不在折叠层内
      expect(notifications?.closest('details')).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'userAgent', { value: '', configurable: true });
    }
  });

  it('T02g: 语境化 — 未捕获 PWA 安装事件时不渲染「应用安装」空块', () => {
    // Web 端但 installPromptEvent 为 null: 旧实现会渲染只有标题的「空块」
    const { container } = render(<SettingsPanel />);
    expect(container.querySelector('[data-testid="install-prompt-section"]')).toBeNull();
    expect(screen.queryByText('应用安装')).toBeNull();
  });

  it('T02h: 死配置面收编 — jsonMaxAttempts 的 range 控件与 difficulty 的 5 个 CEFR 按钮均在折叠层 B 内', () => {
    const { container } = render(<SettingsPanel />);
    const dataGroup = container.querySelector('[data-testid="settings-group-data-advanced"]');
    expect(dataGroup).not.toBeNull();

    // JSON 重试次数: range 控件位于折叠层 B 内
    const jsonAttempts = container.querySelector('#settings-json-attempts') as HTMLInputElement;
    expect(jsonAttempts).not.toBeNull();
    expect(jsonAttempts.closest('details')?.getAttribute('data-testid')).toBe(
      'settings-group-data-advanced',
    );

    // 难度等级: 5 个 CEFR 按钮 (aria-pressed) 全部位于折叠层 B 内
    const difficultyButtons = Array.from(
      dataGroup!.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
    );
    expect(difficultyButtons).toHaveLength(5);
    expect(difficultyButtons.map((b) => b.textContent)).toEqual([
      'A1',
      'A2',
      'B1',
      'B2',
      'C1',
    ]);
  });

  it('T02j: 常显层标记完备 — panel 内除 header / actions 外的非折叠顶层区块都必须带 data-settings-level', () => {
    // T02a/T02f 只数带 data-settings-level="top" 的区块 (标记自选), 会漏掉「新增了
    // 常显区块但忘了打标记」的情形. 这里反向锁定: panel 的直接子元素里, 除 header 与
    // 底部 actions 之外, 不允许存在未标记的非折叠顶层区块 —— 于是 ≤ 6 的上限对所有
    // 常显区块都成立, 而不只是对已标记的那些.
    const { container } = render(<SettingsPanel />);
    const panel = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel).not.toBeNull();

    const unmarked = Array.from(panel.children).filter(
      (el) => el.tagName !== 'DETAILS' && el.getAttribute('data-settings-level') === null,
    );
    // 恰 2 个: 标题头 (含「设置」h2) + 底部 actions (恢复默认 / 完成)
    expect(unmarked).toHaveLength(2);
    expect(unmarked[0].querySelector('h2')?.textContent).toBe('设置');
    expect(unmarked[1].textContent).toContain('恢复默认');

    // 常显区块总数 (已标记的) ≤ 6; 2 个折叠层不计入常显计数
    const marked = panel.querySelectorAll('[data-settings-level]').length;
    expect(marked).toBeLessThanOrEqual(MAX_TOP_LEVEL);
  });
});