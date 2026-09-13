/**
 * v1.3.0 Stage 1 (词汇点读收口): InlineAnswerPanel 词级朗读生命周期接线测试 (T02 / T03 - 接线层)
 *
 * 测试目标 (接线层, 归属权逻辑本身由 speakText.cleanup.test.ts 覆盖):
 * - T02a [critical]: 面板卸载 → stopSpeechText 被调用 (词级归属时收口朗读).
 * - T02b [non-critical]: 面板卸载始终调用 stopSpeechText; 页级安全由 stopSpeechText 归属权保证
 *   (面板只负责"在卸载/切换时调用", 是否真正取消由 speakText 内部判定).
 * - T03 [critical]: 面板 token 从 A 换到 B → 切换触发 stopSpeechText (取消 A), B 点读正常发出.
 *
 * Mock 策略:
 * - vi.mock('../../../platform/speakText') → spy speakText / stopSpeechText, supportsSpeechText=true.
 * - 复用既有 InlineAnswerPanel 测试的 store / hooks / 子组件 mock 模式.
 * - stub window.matchMedia (hooks 依赖).
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import type { TokenOccurrence } from '../../../types';

// 拦截 speakText 模块, spy 接线行为 (归属权逻辑由平台层测试覆盖).
const speakTextSpy = vi.fn();
const stopSpeechTextSpy = vi.fn();

vi.mock('../../../platform/speakText', () => ({
  speakText: (text: string, language: 'en' | 'de') => speakTextSpy(text, language),
  stopSpeechText: () => stopSpeechTextSpy(),
  supportsSpeechText: () => true,
  _resetSpeechTextState: () => undefined,
}));

// 拦截子组件 / hooks, 避免 jsdom 布局问题
vi.mock('../../evaluation/components/RemedyPanel', () => ({
  RemedyPanel: () => null,
}));
vi.mock('../../review/components/RatingBar', () => ({
  RatingBar: () => null,
}));
vi.mock('../hooks/usePageEntranceAnimation', () => ({
  usePageEntranceAnimation: () => ({ getStyle: () => ({}) }),
}));
vi.mock('../hooks/useVocabPulseAnimation', () => ({
  useVocabPulseAnimation: () => ({ className: '', triggerPulse: vi.fn() }),
}));
vi.mock('../../../hooks/usePanelPosition', () => ({
  usePanelPosition: () => ({ vertical: 'bottom', horizontal: 'center', offsetX: 0 }),
}));

import { InlineAnswerPanel } from './InlineAnswerPanel';
import { useReadingSessionStore } from '../store/useReadingSessionStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';

beforeAll(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }
});

function makeToken(overrides: Partial<TokenOccurrence> = {}): TokenOccurrence {
  return {
    id: 'tok-A',
    lexemeGroupId: 'lg-A',
    surfaceForm: 'apple',
    lemma: 'apple',
    objectiveDifficulty: 3,
    startIndex: 0,
    endIndex: 5,
    isResolved: false,
    isActive: false,
    kind: 'normal',
    isCompound: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  speakTextSpy.mockClear();
  stopSpeechTextSpy.mockClear();

  useReadingSessionStore.setState({
    session: null,
    activeOccurrenceId: null,
    markOccurrenceResolved: vi.fn(),
    setActiveOccurrence: vi.fn(),
  } as never);
  useMemoryStore.setState({
    addCardFromToken: vi.fn(),
    getCardByLexemeGroup: vi.fn(() => undefined),
    rateCard: vi.fn(),
  } as never);
  useWordlistStore.setState({
    recordEncounter: vi.fn(),
  } as never);
});

afterEach(() => {
  cleanup();
});

describe('v1.3.0 Stage 1 — InlineAnswerPanel 词级朗读接线 (T02 / T03)', () => {
  // -------------------------------------------------------------------------
  // T02a: 面板卸载 → stopSpeechText 被调用
  // -------------------------------------------------------------------------
  describe('T02a [critical]: 面板卸载收口词级朗读', () => {
    it('点击发音后卸载面板 → speakText 已发起, 且 stopSpeechText 被调用', () => {
      const token = makeToken({ id: 'A', surfaceForm: 'apple' });
      render(<InlineAnswerPanel token={token} language="en" />);

      // 点击发音按钮 → 发起词级朗读
      fireEvent.click(screen.getByLabelText('朗读单词'));
      expect(speakTextSpy).toHaveBeenCalledWith('apple', 'en');

      // 卸载面板 (父级条件渲染关闭) → 收口
      cleanup();
      expect(stopSpeechTextSpy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // T02b: 卸载始终调用 stopSpeechText (页级安全由 stopSpeechText 归属权保证)
  // -------------------------------------------------------------------------
  describe('T02b [non-critical]: 卸载始终调用, 页级安全由归属权保证', () => {
    it('未点击发音直接卸载 → stopSpeechText 仍被调用 (无词级朗读时不误杀页级)', () => {
      const token = makeToken({ id: 'A', surfaceForm: 'apple' });
      render(<InlineAnswerPanel token={token} language="en" />);

      // 未点击发音, 直接卸载
      cleanup();
      expect(stopSpeechTextSpy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // T03: token A → B 切换 → 取消 A, B 正常发出
  // -------------------------------------------------------------------------
  describe('T03 [critical]: token 切换取消上一词, 新词正常发出', () => {
    it('A 点读后切到 B → 切换触发 stopSpeechText, B 点读正常发出', () => {
      const tokenA = makeToken({ id: 'A', surfaceForm: 'apple' });
      const tokenB = makeToken({ id: 'B', surfaceForm: 'banana' });

      const { rerender } = render(<InlineAnswerPanel token={tokenA} language="en" />);

      // 点击 A 的发音按钮
      fireEvent.click(screen.getByLabelText('朗读单词'));
      expect(speakTextSpy).toHaveBeenCalledWith('apple', 'en');

      // 切换到 token B → token.id 变更触发 cleanup → stopSpeechText (取消 A)
      rerender(<InlineAnswerPanel token={tokenB} language="en" />);
      expect(stopSpeechTextSpy).toHaveBeenCalled();

      // 点击 B 的发音按钮 → 正常发出 B
      fireEvent.click(screen.getByLabelText('朗读单词'));
      expect(speakTextSpy).toHaveBeenCalledWith('banana', 'en');

      // 两次 speak 分别对应 A, B (顺序: A 然后 B)
      expect(speakTextSpy).toHaveBeenCalledTimes(2);
      expect(speakTextSpy.mock.calls[0][0]).toBe('apple');
      expect(speakTextSpy.mock.calls[1][0]).toBe('banana');
    });

    it('同一 token 重渲染 (id 不变) → 不触发 stopSpeechText (不误打断朗读)', () => {
      const tokenA = makeToken({ id: 'A', surfaceForm: 'apple' });

      const { rerender } = render(<InlineAnswerPanel token={tokenA} language="en" />);
      fireEvent.click(screen.getByLabelText('朗读单词'));
      expect(speakTextSpy).toHaveBeenCalledTimes(1);

      // 同 id 重渲染 (父级 re-render 但 token 未变)
      stopSpeechTextSpy.mockClear();
      rerender(<InlineAnswerPanel token={makeToken({ id: 'A', surfaceForm: 'apple' })} language="en" />);
      expect(stopSpeechTextSpy).not.toHaveBeenCalled();
    });
  });
});
