/**
 * ShortcutsSection 组件测试 (v1.0.0 Stage 2)
 *
 * 覆盖: 捕获态交互 / 保留键拒绝 / Escape 取消 / 单行恢复默认 / 区块全部重置 / 冒烟渲染.
 *
 * 关于 "捕获不泄漏到全局评分" 的断言语义:
 * useGlobalShortcuts 在 window 的 **bubble** 阶段挂监听; ShortcutsSection 的捕获在
 * window 的 **capture** 阶段 (addEventListener('keydown', handler, true)) 并调用
 * e.stopImmediatePropagation(). 在 jsdom 中, 事件 target===window 时, AT_TARGET 阶段
 * 监听器按**注册顺序**触发 (capture 标志不改变同 target 上的顺序). 因此本测试在点击
 * "修改" (注册 capture 监听) **之后**才挂载探针组件, 保证 capture 监听先注册、先触发,
 * 从而 stopImmediatePropagation 能真正拦截后注册的 bubble 探针 — 使泄漏断言有意义.
 *
 * 为得到有意义的泄漏断言, 首拍按下当前已映射的键 '1' (→ again): 若未被拦截, 探针的
 * onRate('again') 必被调用. 之后再按字面要求的 'q' 完成改键显示校验.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ShortcutsSection } from './ShortcutsSection';
import { useShortcutsStore } from '../../shortcuts/store/useShortcutsStore';
import { useGlobalShortcuts } from '../../reading/hooks/useGlobalShortcuts';
import type { Rating } from '../../../types';

/** 伴生探针: 模拟复习页挂在 window bubble 阶段的全局评分监听 */
function RatingProbe({ onRate }: { onRate: (r: Rating) => void }) {
  useGlobalShortcuts({ ratingEnabled: true, handlers: { onRate } });
  return null;
}

beforeEach(() => {
  if (typeof window !== 'undefined') window.localStorage.clear();
  useShortcutsStore.getState().resetRatingKeys();
});

describe('ShortcutsSection 冒烟渲染', () => {
  it('四行默认显示 1/2/3/4', () => {
    render(<ShortcutsSection />);
    expect(
      within(screen.getByTestId('shortcut-row-again')).getByText('1'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('shortcut-row-hard')).getByText('2'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('shortcut-row-good')).getByText('3'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('shortcut-row-easy')).getByText('4'),
    ).toBeInTheDocument();
  });
});

describe('T01 捕获交互 (改键 + 不泄漏全局评分)', () => {
  it('点击修改 → 捕获提示 → 按 q 写入新键, stopImmediatePropagation 拦截全局评分', () => {
    const onRate = vi.fn();
    render(<ShortcutsSection />);
    const rowAgain = screen.getByTestId('shortcut-row-again');

    // 进入捕获态 (注册 window capture 监听)
    fireEvent.click(screen.getByLabelText('修改 Again 键'));
    expect(within(rowAgain).getByText('按下新按键…')).toBeInTheDocument();

    // 挂载探针 (bubble 监听, 后于 capture 监听注册) — 使泄漏断言有意义
    render(<RatingProbe onRate={onRate} />);

    // (a) 按当前已映射的键 '1' (→ again): 若未被 stopImmediatePropagation 拦截, 探针必触发 onRate
    fireEvent.keyDown(window, { key: '1' });
    expect(onRate).not.toHaveBeenCalled();
    expect(useShortcutsStore.getState().ratingKeys.again).toBe('1');

    // (b) 字面改键 'q': 捕获成功, store 更新, 行内 kbd 显示 q
    fireEvent.click(screen.getByLabelText('修改 Again 键'));
    fireEvent.keyDown(window, { key: 'q' });

    expect(useShortcutsStore.getState().ratingKeys.again).toBe('q');
    expect(within(rowAgain).getByText('q')).toBeInTheDocument();
    // 全局评分始终未被触发
    expect(onRate).not.toHaveBeenCalled();
  });
});

describe('T02 保留键拒绝 + Escape 取消', () => {
  it('捕获态按保留键 S → 行内冲突原因, 键位不变; 按 Escape → 取消且无错误', () => {
    render(<ShortcutsSection />);
    const rowAgain = screen.getByTestId('shortcut-row-again');

    // 保留键 'S' 被拒
    fireEvent.click(screen.getByLabelText('修改 Again 键'));
    fireEvent.keyDown(window, { key: 'S' });

    expect(useShortcutsStore.getState().ratingKeys.again).toBe('1');
    expect(within(rowAgain).getByText(/保留键/)).toBeInTheDocument();
    // 退出捕获态 (不再显示 "按下新按键…")
    expect(within(rowAgain).queryByText('按下新按键…')).toBeNull();

    // Escape 取消: 重新进入捕获 (此时旧错误已被清除, 进入捕获提示), 按 Escape → 退出且无错误
    fireEvent.click(screen.getByLabelText('修改 Again 键'));
    expect(within(rowAgain).getByText('按下新按键…')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useShortcutsStore.getState().ratingKeys.again).toBe('1');
    expect(within(rowAgain).queryByText(/保留键/)).toBeNull();
    expect(within(rowAgain).queryByText('按下新按键…')).toBeNull();
  });
});

describe('T03 恢复默认', () => {
  it('T03a 单行恢复默认 (easy→9 后恢复 →4)', () => {
    render(<ShortcutsSection />);
    const rowEasy = screen.getByTestId('shortcut-row-easy');

    fireEvent.click(screen.getByLabelText('修改 Easy 键'));
    fireEvent.keyDown(window, { key: '9' });
    expect(useShortcutsStore.getState().ratingKeys.easy).toBe('9');
    expect(within(rowEasy).getByText('9')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('恢复 Easy 默认键'));
    expect(useShortcutsStore.getState().ratingKeys.easy).toBe('4');
    expect(within(rowEasy).getByText('4')).toBeInTheDocument();
  });

  it('T03b 区块级全部重置 (多处改键后一键恢复默认)', () => {
    render(<ShortcutsSection />);

    fireEvent.click(screen.getByLabelText('修改 Again 键'));
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.click(screen.getByLabelText('修改 Hard 键'));
    fireEvent.keyDown(window, { key: 'b' });
    fireEvent.click(screen.getByLabelText('修改 Good 键'));
    fireEvent.keyDown(window, { key: 'c' });

    const keys = useShortcutsStore.getState().ratingKeys;
    expect(keys.again).toBe('a');
    expect(keys.hard).toBe('b');
    expect(keys.good).toBe('c');

    fireEvent.click(screen.getByLabelText('恢复全部快捷键默认'));
    const reset = useShortcutsStore.getState().ratingKeys;
    expect(reset.again).toBe('1');
    expect(reset.hard).toBe('2');
    expect(reset.good).toBe('3');
    expect(reset.easy).toBe('4');
  });
});
