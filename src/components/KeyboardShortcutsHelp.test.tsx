/**
 * KeyboardShortcutsHelp 单元测试 (v1.0.0 Stage 1 — T06)
 *
 * 覆盖:
 * - T06: 复习页段的 1/2/3/4 键位从 useShortcutsStore 实时读取; 改键 (easy→'9')
 *   后打开面板, 简单 (Easy) 行显示 override 后的键位 '9', 且不再显示默认 '4'.
 * - 默认 (未改键) 时 简单 (Easy) 行显示 '4'.
 *
 * 测试策略:
 * - 渲染组件, 通过 window '?' keydown 打开面板 (复用组件内置的开关逻辑)
 * - 用 store.getState().setRatingKey 改键后重新渲染, 验证键位文本随 store 变化
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';
import { useShortcutsStore } from '../features/shortcuts/store/useShortcutsStore';

function openPanel() {
  // 组件内置: window '?' keydown 切换可见
  fireEvent.keyDown(window, { key: '?' });
}

function easyRowKey(): string | null | undefined {
  const desc = screen.getByText('简单 (Easy)');
  const row = desc.parentElement as HTMLElement | null;
  return row?.querySelector('kbd')?.textContent ?? null;
}

describe('KeyboardShortcutsHelp (T06)', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    useShortcutsStore.getState().resetRatingKeys();
  });

  it('T06a: 默认键位 — 简单 (Easy) 行显示 "4"', () => {
    render(<KeyboardShortcutsHelp />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openPanel();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(easyRowKey()).toBe('4');
  });

  it('T06b: 改键 easy→"9" 后, 简单 (Easy) 行显示 "9" 且不再显示 "4"', () => {
    const r = useShortcutsStore.getState().setRatingKey('easy', '9');
    expect(r.ok).toBe(true);

    render(<KeyboardShortcutsHelp />);
    openPanel();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // override 后的键位
    expect(easyRowKey()).toBe('9');

    // 默认 '4' 已不再属于 简单 (Easy) 行
    const desc = screen.getByText('简单 (Easy)');
    const row = desc.parentElement as HTMLElement;
    expect(row.querySelector('kbd')?.textContent).not.toBe('4');

    // 其余评级键位保持默认
    const againDesc = screen.getByText('重来 (Again)');
    expect((againDesc.parentElement as HTMLElement).querySelector('kbd')?.textContent).toBe('1');
  });
});
