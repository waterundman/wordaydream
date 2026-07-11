/**
 * NotificationBanner 单元测试 (v1.2.0 Stage 3 — T01..T03)
 *
 * 覆盖 SPEC 要求 3 个 case:
 * - T01 [critical]: 派发 'llm-fallback' notification -> banner 渲染
 * - T02 [critical]: 点击 X 关闭按钮 -> banner 消失
 * - T03 [critical]: 无 notification -> banner 不渲染
 *
 * 测试策略:
 * - 使用真实 useToastStore (zandbox 渲染), 验证 store -> UI 单向数据流
 * - render 前用 beforeEach 清空 notifications, 避免持久化状态泄漏
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationBanner, LLM_FALLBACK_KEY } from './NotificationBanner';
import { useToastStore } from '../store/useToastStore';

describe('NotificationBanner (Stage 3)', () => {
  beforeEach(() => {
    // 清空通知 (避免持久化 + 跨测试泄漏)
    useToastStore.setState({ notifications: {} });
  });

  it('T01 [critical]: 派发 llm-fallback notification -> banner 渲染', () => {
    // Arrange: 派发持久通知
    useToastStore
      .getState()
      .showNotification(LLM_FALLBACK_KEY, '已切换到预存文本 (LLM 服务暂不可用)');

    // Act
    render(<NotificationBanner />);

    // Assert
    expect(screen.getByTestId('notification-banner')).toBeInTheDocument();
    expect(screen.getByTestId('notification-banner-message')).toHaveTextContent(
      '已切换到预存文本 (LLM 服务暂不可用)',
    );
  });

  it('T02 [critical]: 点击 X 关闭按钮 -> banner 消失', () => {
    // Arrange: 先派发通知
    useToastStore
      .getState()
      .showNotification(LLM_FALLBACK_KEY, '已切换到预存文本');
    render(<NotificationBanner />);
    expect(screen.getByTestId('notification-banner')).toBeInTheDocument();

    // Act: 点击 X
    fireEvent.click(screen.getByTestId('notification-banner-close'));

    // Assert: banner 消失 + store 中通知已删除
    expect(screen.queryByTestId('notification-banner')).not.toBeInTheDocument();
    expect(useToastStore.getState().notifications[LLM_FALLBACK_KEY]).toBeUndefined();
  });

  it('T03 [critical]: 无 notification -> banner 不渲染', () => {
    // Arrange: 确认 store 干净
    expect(useToastStore.getState().notifications[LLM_FALLBACK_KEY]).toBeUndefined();

    // Act
    const { container } = render(<NotificationBanner />);

    // Assert
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('notification-banner')).not.toBeInTheDocument();
  });
});
