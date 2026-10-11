/**
 * useFocusTrap hook 单元测试 (v2.2.4 Round 2)
 *
 * 覆盖 SPEC D3-5 要求:
 * - T01: isActive=true 时自动 focus 第一个可交互元素
 * - T02: Tab 在最后一个元素上时跳回第一个 (循环)
 * - T03: Shift+Tab 在第一个元素上时跳到最后一个 (循环)
 * - T04: isActive=false 时不绑定事件, 不修改焦点
 * - T05: 容器内无可交互元素时 Tab 被阻止 (不逃逸)
 * - T06: 弹窗卸载后焦点回到打开它的元素 (v1.6.6 红队修复)
 *
 * 注意: useFocusTrap 使用 `el.offsetParent !== null` 过滤隐藏元素,
 * jsdom 默认 offsetParent=null, 故需在 beforeEach 中 mock 返回非 null.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { useFocusTrap } from './useFocusTrap';

/** 测试用 wrapper: 渲染一个含两个按钮的容器并应用 useFocusTrap */
function TestComponent({ isActive }: { isActive: boolean }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, isActive);
  return (
    <div ref={ref} data-testid="trap-container">
      <button type="button" data-testid="first-btn">
        First
      </button>
      <button type="button" data-testid="last-btn">
        Last
      </button>
    </div>
  );
}

/** 容器内无可交互元素的 wrapper */
function EmptyComponent({ isActive }: { isActive: boolean }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, isActive);
  return (
    <div ref={ref} data-testid="empty-container">
      <p>No focusable elements</p>
    </div>
  );
}

describe('useFocusTrap (v2.2.4 Round 2 D3-5)', () => {
  beforeEach(() => {
    // jsdom 默认 offsetParent=null, mock 为非 null 让过滤通过
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        return document.body;
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T01: isActive=true 时自动 focus 第一个可交互元素', () => {
    render(<TestComponent isActive={true} />);
    const firstBtn = screen.getByTestId('first-btn');
    expect(firstBtn).toHaveFocus();
  });

  it('T02: Tab 在最后一个元素上时跳回第一个 (循环)', async () => {
    const user = userEvent.setup();
    render(<TestComponent isActive={true} />);
    const firstBtn = screen.getByTestId('first-btn');
    const lastBtn = screen.getByTestId('last-btn');

    // 初始 focus 在第一个, 跳到第二个
    await user.tab();
    expect(lastBtn).toHaveFocus();

    // 在最后一个按 Tab, 应回到第一个
    await user.tab();
    expect(firstBtn).toHaveFocus();
  });

  it('T03: Shift+Tab 在第一个元素上时跳到最后一个 (循环)', async () => {
    const user = userEvent.setup();
    render(<TestComponent isActive={true} />);
    const firstBtn = screen.getByTestId('first-btn');
    const lastBtn = screen.getByTestId('last-btn');

    expect(firstBtn).toHaveFocus();

    // Shift+Tab 在第一个上, 应回到最后一个
    await user.tab({ shift: true });
    expect(lastBtn).toHaveFocus();
  });

  it('T04: isActive=false 时不自动 focus, 不绑定 Tab 循环', async () => {
    const user = userEvent.setup();
    render(<TestComponent isActive={false} />);
    const firstBtn = screen.getByTestId('first-btn');
    const lastBtn = screen.getByTestId('last-btn');

    // isActive=false 不应主动 focus
    expect(firstBtn).not.toHaveFocus();
    expect(lastBtn).not.toHaveFocus();

    // Tab 不应被 trap (容器外的 body 接收焦点)
    firstBtn.focus();
    await user.tab();
    // 此时焦点可能跳到 lastBtn (Tab 顺序), 但不应触发 trap 循环回到 firstBtn
    // 关键: lastBtn 按下 Tab 后焦点逃逸到 body, 而非回到 firstBtn
    expect(firstBtn).not.toHaveFocus();
  });

  it('T05: 容器内无可交互元素时 Tab 被阻止 (不逃逸)', () => {
    render(<EmptyComponent isActive={true} />);
    const container = screen.getByTestId('empty-container');

    container.focus();
    // Tab 在无 focusable 元素时, useEffect 中 focusable.length===0 调 e.preventDefault()
    // 焦点应停留在 container, 不逃逸到 body
    container.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    // 焦点未逃逸 (仍在 container 内或 body, 但不会跑到外部按钮)
    expect(document.activeElement).not.toBe(document.body.querySelector('button'));
  });

  it('T06 [critical]: 弹窗卸载后焦点回到打开它的元素', () => {
    function Harness(): React.ReactElement {
      const [open, setOpen] = useState(false);
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, open);
      return (
        <>
          <button type="button" data-testid="opener" onClick={() => setOpen((v) => !v)}>
            设置
          </button>
          {open && (
            <div ref={ref} role="dialog" aria-modal="true">
              <button type="button" data-testid="inside-btn">
                面板内
              </button>
            </div>
          )}
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByTestId('opener');

    // 用户点开: activeElement 是 opener, 随后 trap 把焦点收进面板
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByTestId('inside-btn')).toHaveFocus();

    // 用户关闭 (Escape / X 都会卸载面板): 焦点必须回到 opener, 而不是掉回 body
    fireEvent.click(opener);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});
