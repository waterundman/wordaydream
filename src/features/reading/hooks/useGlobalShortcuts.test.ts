/**
 * isEditableTarget 纯函数单测 (v0.8.0-harmony Stage 1, SPEC §3 焦点守卫)
 *
 * 验证评分键焦点守卫的边界处理: input/textarea/select/contenteditable 视为可编辑,
 * 应忽略评分键; body/button/普通 div 视为非可编辑, 评分键生效.
 */
import { describe, expect, it } from 'vitest';
import { isEditableTarget } from './useGlobalShortcuts';

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
