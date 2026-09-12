/**
 * isEditableTarget 纯函数单测 (v0.8.0-harmony Stage 1, SPEC §3 焦点守卫)
 *
 * 验证评分键焦点守卫的边界处理: input/textarea/select/contenteditable 视为可编辑,
 * 应忽略评分键; body/button/普通 div 视为非可编辑, 评分键生效.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { isEditableTarget, useGlobalShortcuts } from './useGlobalShortcuts';
import { useShortcutsStore } from '../../shortcuts/store/useShortcutsStore';

describe('isEditableTarget 焦点守卫', () => {
  it('INPUT 元素 → true', () => {
    const el = document.createElement('input');
    expect(isEditableTarget(el)).toBe(true);
  });

  it('TEXTAREA 元素 → true', () => {
    const el = document.createElement('textarea');
    expect(isEditableTarget(el)).toBe(true);
  });

  it('SELECT 元素 → true', () => {
    const el = document.createElement('select');
    expect(isEditableTarget(el)).toBe(true);
  });

  it('contenteditable 元素 → true', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    document.body.appendChild(el);
    expect(isEditableTarget(el)).toBe(true);
    document.body.removeChild(el);
  });

  it('contenteditable 的可编辑后代 → true (isContentEditable 继承)', () => {
    const parent = document.createElement('div');
    parent.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    parent.appendChild(child);
    document.body.appendChild(parent);
    expect(isEditableTarget(child)).toBe(true);
    document.body.removeChild(parent);
  });

  it('body 元素 → false (焦点在 body 时评分键生效)', () => {
    expect(isEditableTarget(document.body)).toBe(false);
  });

  it('普通 div (非 contenteditable) → false', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
  });

  it('BUTTON 元素 → false', () => {
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
  });

  it('null 目标 → false', () => {
    expect(isEditableTarget(null)).toBe(false);
  });

  it('window (非 HTMLElement) → false (焦点在 body/无焦点时评分键生效)', () => {
    // window 不是 HTMLElement, 守卫视为非可编辑
    expect(isEditableTarget(window as unknown as EventTarget)).toBe(false);
  });
});

/**
 * T05 (v1.0.0 Stage 1): useGlobalShortcuts 订阅 store 键位, 改键后即时生效.
 * 不删既有 isEditableTarget 用例. 每个 it 渲染独立 hook 实例, 由全局 cleanup 卸载.
 */
describe('useGlobalShortcuts 评分键位 (T05)', () => {
  beforeEach(() => {
    // 清空 localStorage + 恢复默认键位, 避免跨测试持久化/改键污染
    if (typeof window !== 'undefined') window.localStorage.clear();
    useShortcutsStore.getState().resetRatingKeys();
  });

  function press(key: string, target: EventTarget = window) {
    const el =
      target instanceof Window ? window : (target as Element);
    act(() => {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true } as KeyboardEventInit),
      );
    });
  }

  it('T05a: 默认键位 1-4 触发对应评级 onRate', () => {
    const onRate = vi.fn();
    const onEscape = vi.fn();
    renderHook(() =>
      useGlobalShortcuts({
        ratingEnabled: true,
        handlers: { onRate, onEscape },
      }),
    );

    press('1');
    expect(onRate).toHaveBeenCalledWith('again');
    press('2');
    expect(onRate).toHaveBeenCalledWith('hard');
    press('3');
    expect(onRate).toHaveBeenCalledWith('good');
    press('4');
    expect(onRate).toHaveBeenCalledWith('easy');
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('T05b: 改键 easy→"9" 后按 "9" 触发 onRate("easy"), 按 "4" 不再触发', () => {
    const onRate = vi.fn();
    const onEscape = vi.fn();
    renderHook(() =>
      useGlobalShortcuts({
        ratingEnabled: true,
        handlers: { onRate, onEscape },
      }),
    );

    // 改键: easy 从 '4' → '9' (真实场景在 React 事件处理器内, 即 act 上下文)
    let r: { ok: boolean; reason?: string };
    act(() => {
      r = useShortcutsStore.getState().setRatingKey('easy', '9');
    });
    expect(r!.ok).toBe(true);

    // 旧键 '4' 不再触发 (订阅即时生效)
    onRate.mockClear();
    press('4');
    expect(onRate).not.toHaveBeenCalled();

    // 新键 '9' 触发 'easy'
    press('9');
    expect(onRate).toHaveBeenCalledTimes(1);
    expect(onRate).toHaveBeenCalledWith('easy');
  });

  it('T05c: Escape 触发 onEscape 且不触发 onRate (改键前后一致)', () => {
    const onRate = vi.fn();
    const onEscape = vi.fn();
    renderHook(() =>
      useGlobalShortcuts({
        ratingEnabled: true,
        handlers: { onRate, onEscape },
      }),
    );

    press('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onRate).not.toHaveBeenCalled();

    // 改键后 Escape 行为不变
    act(() => {
      useShortcutsStore.getState().setRatingKey('good', 'x');
    });
    press('Escape');
    expect(onEscape).toHaveBeenCalledTimes(2);
    expect(onRate).not.toHaveBeenCalled();
  });

  it('T05d: 焦点在 INPUT 时可编辑目标忽略评分键', () => {
    const onRate = vi.fn();
    const onEscape = vi.fn();
    renderHook(() =>
      useGlobalShortcuts({
        ratingEnabled: true,
        handlers: { onRate, onEscape },
      }),
    );

    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: '1', bubbles: true } as KeyboardEventInit),
      );
    });
    document.body.removeChild(input);

    expect(onRate).not.toHaveBeenCalled();
  });
});

