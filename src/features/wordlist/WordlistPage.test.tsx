/**
 * WordlistPage 组件测试 (v1.6.0 Stage 2)
 *
 * 覆盖 test_spec:
 * - T06: WordlistPage 渲染: 显示当前等级词表, 默认隐藏释义
 * - T07: 状态筛选: 全部/未学/学习中/已掌握 正确过滤
 * - T08: 搜索: 按 lemma 或 translation 匹配
 * - T09: 点击单词: 展开/收起释义
 * - T10: C1 (难度5): 显示"自由阅读模式, 无词表"
 *
 * 设计:
 * - mock `data/wordlists` 模块返回受控词表数据 (5 词)
 * - 使用真实 store + setState 控制 difficulty / language / progress
 * - @testing-library/react + vitest
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WordlistPage } from './WordlistPage';
import { useSettingsStore } from '../settings/store/useSettingsStore';
import { useReadingSessionStore } from '../reading/store/useReadingSessionStore';
import { useWordlistStore } from './store/useWordlistStore';
import type { DifficultyLevel } from '../../types';

vi.mock('../../data/wordlists', () => {
  const mockWordlist = {
    language: 'en' as const,
    level: 'A2',
    difficulty: 2 as const,
    version: '1.0.0',
    total: 5,
    words: [
      { lemma: 'have', pos: 'verb', translation: '有', cefr: 'A2' },
      { lemma: 'be', pos: 'verb', translation: '是', cefr: 'A2' },
      { lemma: 'go', pos: 'verb', translation: '去', cefr: 'A2' },
      { lemma: 'see', pos: 'verb', translation: '看见', cefr: 'A2' },
      { lemma: 'find', pos: 'verb', translation: '找到', cefr: 'A2' },
    ],
  };
  return {
    loadWordlist: vi.fn(async () => mockWordlist),
    getCachedWordlist: vi.fn(() => mockWordlist),
    clearWordlistCache: vi.fn(),
    preloadWordlist: vi.fn(),
  };
});

beforeEach(() => {
  useSettingsStore.setState({ difficulty: 2 });
  useReadingSessionStore.setState({
    lastConfig: { language: 'en' as const, difficulty: 2 as const },
  });
  useWordlistStore.setState({ progress: {} });
});

describe('WordlistPage', () => {
  it('T06: renders wordlist with lemmas visible, translations hidden by default', async () => {
    render(<WordlistPage onGoHome={() => {}} />);

    // Wait for wordlist to render
    await waitFor(() => expect(screen.getByText('have')).toBeInTheDocument());

    // Lemmas are displayed
    expect(screen.getByText('have')).toBeInTheDocument();
    expect(screen.getByText('be')).toBeInTheDocument();
    expect(screen.getByText('go')).toBeInTheDocument();
    expect(screen.getByText('see')).toBeInTheDocument();
    expect(screen.getByText('find')).toBeInTheDocument();

    // Translations are hidden by default
    expect(screen.queryByText('有')).not.toBeInTheDocument();
    expect(screen.queryByText('是')).not.toBeInTheDocument();
    expect(screen.queryByText('去')).not.toBeInTheDocument();
  });

  it('T07: status filter tabs correctly filter words', async () => {
    // Set up progress: 1 mastered + 2 learning + 2 unseen
    useWordlistStore.setState({
      progress: {
        'en:have': {
          status: 'mastered',
          encounterCount: 2,
          lastEncounterPassageId: null,
          firstEncounteredAt: 0,
          lastEncounteredAt: 0,
        },
        'en:be': {
          status: 'learning',
          encounterCount: 0,
          lastEncounterPassageId: null,
          firstEncounteredAt: 0,
          lastEncounteredAt: 0,
        },
        'en:go': {
          status: 'learning',
          encounterCount: 0,
          lastEncounterPassageId: null,
          firstEncounteredAt: 0,
          lastEncounteredAt: 0,
        },
        // see and find are unseen (no progress entry)
      },
    });

    render(<WordlistPage onGoHome={() => {}} />);
    await waitFor(() => expect(screen.getByText('have')).toBeInTheDocument());

    // Click "未学" filter tab (use exact text to distinguish from row status labels)
    const unseenTab = screen.getByText('未学 2');
    fireEvent.click(unseenTab);

    // Only unseen words (see, find) should be visible
    expect(screen.getByText('see')).toBeInTheDocument();
    expect(screen.getByText('find')).toBeInTheDocument();
    // Mastered and learning words should be hidden
    expect(screen.queryByText('have')).not.toBeInTheDocument();
    expect(screen.queryByText('be')).not.toBeInTheDocument();
    expect(screen.queryByText('go')).not.toBeInTheDocument();
  });

  it('T08: search filters by lemma or translation', async () => {
    render(<WordlistPage onGoHome={() => {}} />);
    await waitFor(() => expect(screen.getByText('have')).toBeInTheDocument());

    const searchInput = screen.getByLabelText('搜索词表');

    // Search by lemma "go"
    fireEvent.change(searchInput, { target: { value: 'go' } });
    expect(screen.getByText('go')).toBeInTheDocument();
    expect(screen.queryByText('have')).not.toBeInTheDocument();
    expect(screen.queryByText('be')).not.toBeInTheDocument();
    expect(screen.queryByText('see')).not.toBeInTheDocument();
    expect(screen.queryByText('find')).not.toBeInTheDocument();

    // Search by translation "有" (translation of "have")
    fireEvent.change(searchInput, { target: { value: '有' } });
    expect(screen.getByText('have')).toBeInTheDocument();
    expect(screen.queryByText('go')).not.toBeInTheDocument();
    expect(screen.queryByText('be')).not.toBeInTheDocument();
  });

  it('T09: clicking a word toggles translation visibility', async () => {
    render(<WordlistPage onGoHome={() => {}} />);
    await waitFor(() => expect(screen.getByText('have')).toBeInTheDocument());

    // Translation is hidden initially
    expect(screen.queryByText('有')).not.toBeInTheDocument();

    // Click on "have" lemma to expand
    fireEvent.click(screen.getByText('have'));

    // Translation should now be visible
    expect(screen.getByText('有')).toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(screen.getByText('have'));

    // Translation should be hidden again
    expect(screen.queryByText('有')).not.toBeInTheDocument();
  });

  it('T10: C1 (difficulty 5) shows free reading mode placeholder', async () => {
    useSettingsStore.setState({ difficulty: 5 });

    render(<WordlistPage onGoHome={() => {}} />);

    // Placeholder text should be displayed
    expect(screen.getByText('自由阅读模式, 无词表')).toBeInTheDocument();

    // No word list items should be visible
    expect(screen.queryByText('have')).not.toBeInTheDocument();
    expect(screen.queryByText('be')).not.toBeInTheDocument();

    // No filter tabs or search should be present
    expect(screen.queryByLabelText('搜索词表')).not.toBeInTheDocument();
  });
});

/**
 * v2.1.0 Stage 4 (Contract 67): WordlistPage header 切换控件测试
 *
 * 覆盖 test_spec:
 * - T17: 语言 tab 切换 (EN/DE) — 点击 DE 调用 setLastConfig({language:'de', difficulty:2})
 * - T18: 难度 dot 切换 (A1/A2/B1/B2, 不含 C1) — 点击 B1 调用 setDifficulty(3)
 *
 * 设计:
 * - 使用真实 store + setState, 通过 setState 替换 setter 为 vi.fn() spy
 * - vitest css: false → CSS module 类名为 undefined, 用 aria-pressed 属性验证 active 态
 * - 每个 test 结束后恢复原始 setter, 避免污染其他测试
 */

describe('WordlistPage levelTabs (v2.1.0 Stage 4 Contract 67)', () => {
  let originalSetLastConfig: ReturnType<typeof useReadingSessionStore.getState>['setLastConfig'];
  let originalSetDifficulty: ReturnType<typeof useSettingsStore.getState>['setDifficulty'];

  beforeEach(() => {
    useSettingsStore.setState({ difficulty: 2 });
    useReadingSessionStore.setState({
      lastConfig: { language: 'en' as const, difficulty: 2 as DifficultyLevel },
    });
    useWordlistStore.setState({ progress: {} });

    originalSetLastConfig = useReadingSessionStore.getState().setLastConfig;
    originalSetDifficulty = useSettingsStore.getState().setDifficulty;
  });

  afterEach(() => {
    useReadingSessionStore.setState({ setLastConfig: originalSetLastConfig });
    useSettingsStore.setState({ setDifficulty: originalSetDifficulty });
  });

  it('T17a: 默认 EN tab active (aria-pressed=true), DE tab inactive', async () => {
    render(<WordlistPage onGoHome={() => {}} />);

    const enBtn = screen.getByRole('button', { name: 'EN' });
    const deBtn = screen.getByRole('button', { name: 'DE' });

    expect(enBtn).toHaveAttribute('aria-pressed', 'true');
    expect(deBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('T17b: 点击 DE tab → setLastConfig 被调用, 参数为 { language: "de", difficulty: 2 }', async () => {
    const setLastConfigSpy = vi.fn();
    useReadingSessionStore.setState({ setLastConfig: setLastConfigSpy });

    render(<WordlistPage onGoHome={() => {}} />);

    const deBtn = screen.getByRole('button', { name: 'DE' });
    fireEvent.click(deBtn);

    expect(setLastConfigSpy).toHaveBeenCalledTimes(1);
    expect(setLastConfigSpy).toHaveBeenCalledWith({ language: 'de', difficulty: 2 });
  });

  it('T17c: 点击当前已 active 的 EN tab → 不调用 setLastConfig', async () => {
    const setLastConfigSpy = vi.fn();
    useReadingSessionStore.setState({ setLastConfig: setLastConfigSpy });

    render(<WordlistPage onGoHome={() => {}} />);

    const enBtn = screen.getByRole('button', { name: 'EN' });
    fireEvent.click(enBtn);

    expect(setLastConfigSpy).not.toHaveBeenCalled();
  });

  it('T18a: A2 dot (difficulty=2) active (aria-pressed=true)', async () => {
    render(<WordlistPage onGoHome={() => {}} />);

    const a2Dot = screen.getByRole('button', { name: 'A2' });
    expect(a2Dot).toHaveAttribute('aria-pressed', 'true');

    const a1Dot = screen.getByRole('button', { name: 'A1' });
    expect(a1Dot).toHaveAttribute('aria-pressed', 'false');
  });

  it('T18b: 点击 B1 dot → setDifficulty 被调用, 参数为 3', async () => {
    const setDifficultySpy = vi.fn();
    useSettingsStore.setState({ setDifficulty: setDifficultySpy });

    render(<WordlistPage onGoHome={() => {}} />);

    const b1Dot = screen.getByRole('button', { name: 'B1' });
    fireEvent.click(b1Dot);

    expect(setDifficultySpy).toHaveBeenCalledTimes(1);
    expect(setDifficultySpy).toHaveBeenCalledWith(3);
  });

  it('T18c: 渲染 4 个难度 dot (A1/A2/B1/B2), 不渲染 C1', async () => {
    render(<WordlistPage onGoHome={() => {}} />);

    expect(screen.getByRole('button', { name: 'A1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'B1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'B2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'C1' })).not.toBeInTheDocument();
  });
});
