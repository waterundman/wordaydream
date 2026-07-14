import { useEffect, useRef, useState } from 'react';

/**
 * 快捷键作用域
 * @enum {'global' | 'reading' | 'review'}
 */
export type ShortcutScope = 'global' | 'reading' | 'review';

/**
 * 键盘快捷键配置
 */
export interface KeyboardShortcut {
  /** 唯一标识符 */
  id: string;
  /** 按键名称 */
  key: string;
  /** 是否需要 Ctrl/Cmd */
  ctrl?: boolean;
  /** 是否需要 Shift */
  shift?: boolean;
  /** 是否需要 Alt */
  alt?: boolean;
  /** 作用域 */
  scope: ShortcutScope;
  /** 按键处理函数 */
  handler: (e: KeyboardEvent) => void;
  /** 描述说明 */
  description: string;
  /** 是否阻止默认行为 */
  preventDefault?: boolean;
}

/**
 * 快捷键注册表条目
 */
interface ShortcutEntry {
  /** 快捷键配置 */
  shortcut: KeyboardShortcut;
  /** 组件 ID */
  componentId: string;
}

/** 当前活动的快捷键作用域 */
let currentScope: ShortcutScope = 'reading';
/** 活动快捷键注册表 */
const activeShortcuts = new Map<string, ShortcutEntry[]>();
/** 全局键盘事件监听器 */
let globalListener: ((e: KeyboardEvent) => void) | null = null;

/** 在输入框中允许使用的快捷键 */
const ALLOWED_IN_INPUT = ['Escape', '?'];

/**
 * 检查键盘事件是否匹配快捷键配置
 *
 * @param e 键盘事件
 * @param shortcut 快捷键配置
 * @returns 是否匹配
 */
function matchesShortcut(e: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  if (e.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;
  const ctrlOrMeta = e.ctrlKey || e.metaKey;
  if (!!shortcut.ctrl !== ctrlOrMeta) return false;
  if (!!shortcut.shift !== e.shiftKey) return false;
  if (!!shortcut.alt !== e.altKey) return false;
  return true;
}

/**
 * 创建全局键盘事件处理函数
 *
 * @returns 事件处理函数
 */
function createGlobalHandler(): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const isInput =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable);

    for (const [, entries] of activeShortcuts) {
      for (const entry of entries) {
        const s = entry.shortcut;
        if (!matchesShortcut(e, s)) continue;
        if (s.scope !== 'global' && s.scope !== currentScope) continue;

        if (isInput && !ALLOWED_IN_INPUT.includes(s.key)) continue;

        if (s.preventDefault !== false) {
          e.preventDefault();
        }
        s.handler(e);
        return;
      }
    }
  };
}

/**
 * 附加全局键盘事件监听器
 */
function attachGlobalListener() {
  if (!globalListener) {
    globalListener = createGlobalHandler();
    window.addEventListener('keydown', globalListener);
  }
}

/**
 * 分离全局键盘事件监听器
 * 仅当没有活动快捷键时才移除监听器
 */
function detachGlobalListener() {
  if (globalListener && activeShortcuts.size === 0) {
    window.removeEventListener('keydown', globalListener);
    globalListener = null;
  }
}

/**
 * 设置当前活动的快捷键作用域
 *
 * @param scope 作用域
 */
export function setActiveShortcutScope(scope: ShortcutScope) {
  currentScope = scope;
}

/**
 * 注册键盘快捷键
 *
 * @param componentId 组件 ID
 * @param shortcuts 快捷键数组
 */
export function registerKeyboardShortcuts(
  componentId: string,
  shortcuts: KeyboardShortcut[]
) {
  activeShortcuts.set(
    componentId,
    shortcuts.map((s) => ({ shortcut: s, componentId }))
  );
  attachGlobalListener();
}

/**
 * 注销键盘快捷键
 *
 * @param componentId 组件 ID
 */
export function unregisterKeyboardShortcuts(componentId: string) {
  activeShortcuts.delete(componentId);
  detachGlobalListener();
}

/**
 * 键盘快捷键 Hook
 * 自动注册/注销快捷键，并追踪当前按下的键
 *
 * @param componentId 组件 ID
 * @param shortcuts 快捷键数组
 * @returns 当前按下的键集合
 */
export function useKeyboardShortcuts(
  componentId: string,
  shortcuts: KeyboardShortcut[]
): Set<string> {
  const handlersRef = useRef<Map<string, (e: KeyboardEvent) => void>>(new Map());
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const map = new Map<string, (e: KeyboardEvent) => void>();
    for (const s of shortcuts) {
      map.set(s.id, s.handler);
    }
    handlersRef.current = map;
  });

  useEffect(() => {
    if (shortcuts.length === 0) return;

    const wrappers = shortcuts.map((s) => ({
      ...s,
      handler: (e: KeyboardEvent) => {
        handlersRef.current.get(s.id)?.(e);
      },
    }));

    registerKeyboardShortcuts(componentId, wrappers);
    return () => unregisterKeyboardShortcuts(componentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentId, shortcuts.map((s) => s.id).join(',')]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      setPressedKeys((prev) => new Set(prev).add(e.key));
    };
    const onUp = (e: KeyboardEvent) => {
      setPressedKeys((prev) => {
        const next = new Set(prev);
        next.delete(e.key);
        return next;
      });
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  return pressedKeys;
}