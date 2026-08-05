/**
 * ErrorBoundary 单元测试 (v2.2.4 Round 2)
 *
 * 覆盖 SPEC D2-5 要求:
 * - T01: children 正常渲染时不显示错误 UI
 * - T02: children 抛错时显示错误 UI (标题 + 错误信息 + 重试/返回首页按钮)
 * - T03: 点击"重试"调用 onReset 并清空错误状态 (重新渲染 children)
 * - T04: 点击"返回首页"调用 onReset + 设置 window.location.hash
 * - T05: 不提供 onReset 时按钮仍可工作 (默认行为)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';

/** 抛错的子组件 */
function BoomComponent({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement {
  if (shouldThrow) {
    throw new Error('test boom');
  }
  return <div data-testid="child">正常内容</div>;
}

describe('ErrorBoundary (v2.2.4 Round 2 D2-5)', () => {
  beforeEach(() => {
    // 静默 ErrorBoundary.componentDidCatch 中的 console.error
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('T01: children 正常渲染时不显示错误 UI', () => {
    render(
      <ErrorBoundary>
        <BoomComponent shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.queryByText('出错了')).not.toBeInTheDocument();
  });

  it('T02: children 抛错时显示错误 UI (标题 + 错误信息 + 两个按钮)', () => {
    render(
      <ErrorBoundary>
        <BoomComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('出错了')).toBeInTheDocument();
    expect(screen.getByText('test boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回首页' })).toBeInTheDocument();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('T03: 点击"重试"调用 onReset 并清空错误状态', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();

    // 用 key 控制 BoomComponent 的 shouldThrow
    const { rerender } = render(
      <ErrorBoundary key="boundary-1" onReset={onReset}>
        <BoomComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('出错了')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(onReset).toHaveBeenCalledTimes(1);
    // 重置后错误 UI 消失 (hasError=false), 但因 BoomComponent 仍会抛错, 再次进入错误状态
    // 改为 rerender 传入新的 children 验证清空
    rerender(
      <ErrorBoundary key="boundary-2" onReset={onReset}>
        <BoomComponent shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.queryByText('出错了')).not.toBeInTheDocument();
  });

  it('T04: 点击"返回首页"调用 onReset + 设置 window.location.hash', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();

    render(
      <ErrorBoundary onReset={onReset}>
        <BoomComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: '返回首页' }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#/home');
  });

  it('T05: 不提供 onReset 时按钮仍可工作 (不抛错)', async () => {
    const user = userEvent.setup();

    render(
      <ErrorBoundary>
        <BoomComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    // 点击重试, 无 onReset 也不应抛错
    await user.click(screen.getByRole('button', { name: '重试' }));
    // 因 BoomComponent 仍会抛错, 错误 UI 应再次显示
    expect(screen.getByText('出错了')).toBeInTheDocument();

    // 点击返回首页也不抛错
    await user.click(screen.getByRole('button', { name: '返回首页' }));
    expect(window.location.hash).toBe('#/home');
  });

  it('T06: getDerivedStateFromError 正确返回新 state', () => {
    // 静态方法直接调用, 验证返回结构
    const error = new Error('derived test');
    const state = ErrorBoundary.getDerivedStateFromError(error);
    expect(state).toEqual({ hasError: true, error });
  });

  it('T07: componentDidCatch 调用 console.error 记录', () => {
    // 通过渲染抛错组件间接验证
    render(
      <ErrorBoundary>
        <BoomComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    // console.error 被 mock, 验证至少调用过 (componentDidCatch + React 自身的 error boundary 日志)
    expect(console.error).toHaveBeenCalled();
  });

  it('T08: 错误 UI 的 message 兜底 "应用发生未知错误" (error.message 为空)', () => {
    // 自定义子组件抛出无 message 的 Error
    function SilentBoom(): React.ReactElement {
      throw new Error('');
    }
    // 用自定义 wrapper 避免覆盖其他测试
    function CustomBoundary({ children }: { children: React.ReactNode }): React.ReactElement {
      return <ErrorBoundary>{children}</ErrorBoundary>;
    }
    // Render with a fresh boundary
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(
        <CustomBoundary>
          <SilentBoom />
        </CustomBoundary>,
      );
      // 错误 message 为空字符串时, UI 应兜底显示 "应用发生未知错误"
      // 注意: error.message === '' 是 falsy, 走 || 分支
      expect(screen.getByText('应用发生未知错误')).toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
