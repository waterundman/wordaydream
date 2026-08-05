/**
 * T03: InstallPromptButton 鸿蒙降级测试 (v0.1.0-harmony Stage 2)
 *
 * 验证: supportsInstallPrompt=false 时 InstallPromptButton 渲染 null (不抛错).
 *
 * Mock 策略:
 * - vi.mock('../detect') → detectPlatform 返回 supportsInstallPrompt=false
 * - useOfflineModeStore.setState 注入有效 installPromptEvent
 *   (确保是 platform 检查而非 event 缺失导致 null 渲染)
 * - 断言 queryByTestId('install-prompt-button') 不在文档中
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock detectPlatform: 鸿蒙环境, supportsInstallPrompt=false.
// vi.mock 被 vitest 提升到所有 import 之前, 保证 ReadingSessionPage 拿到 mock.
vi.mock('../detect', () => ({
  detectPlatform: () => ({
    isHarmonyOS: () => true,
    supportsServiceWorker: () => false,
    supportsSpeechSynthesis: () => false,
    supportsInstallPrompt: () => false,
    getNativeBridge: () => null,
  }),
}));

import { render, screen, cleanup } from '@testing-library/react';
import { InstallPromptButton } from '../../components/InstallPromptButton';
import { useOfflineModeStore } from '../../features/llm/store/offlineMode';

describe('T03 [critical]: InstallPromptButton 鸿蒙降级', () => {
  afterEach(() => {
    cleanup();
    useOfflineModeStore.setState({ installPromptEvent: null });
  });

  it('supportsInstallPrompt=false + 有效 installPromptEvent → 渲染 null', () => {
    // 注入一个有效的 BeforeInstallPromptEvent stub
    // (如果没有 platform 检查, 按钮应该会渲染)
    const mockEvent = {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({
        outcome: 'dismissed' as const,
        platform: 'web',
      }),
      platforms: ['web'],
      preventDefault: vi.fn(),
    };
    useOfflineModeStore.setState({ installPromptEvent: mockEvent });

    render(<InstallPromptButton />);

    // platform 检查命中 → 不渲染按钮
    expect(screen.queryByTestId('install-prompt-button')).not.toBeInTheDocument();
  });

  it('supportsInstallPrompt=false + 无 installPromptEvent → 渲染 null (不抛错)', () => {
    useOfflineModeStore.setState({ installPromptEvent: null });

    const { container } = render(<InstallPromptButton />);

    expect(container.firstChild).toBeNull();
  });
});
