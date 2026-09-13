/**
 * v1.3.0 Stage 1 (词汇点读收口): speakText × speechSynthesis 真实模块集成测试
 * (归属权锚定 currentInitiator — 验证 stale-flag 边界, mock 层无法覆盖)
 *
 * 测试目标:
 * - A [critical·核心回归]: 词级朗读自然结束 → 页级朗读进行中 → 面板卸载
 *   (stopSpeechText) → 不得取消页级朗读 (stale 归属标志已随自然结束清除).
 * - B [critical]: 词级朗读进行中 → stopSpeechText 取消; 再次调用不重复取消.
 * - C [critical]: 词级朗读进行中 (未结束) → 页级直接发起朗读 → stopSpeechText
 *   不取消页级 (initiator='other' ≠ 'word').
 *
 * 与 speakText.cleanup.test.ts 的分工: 那边 mock speechSynthesis 聚焦 speakText
 * 分支逻辑; 本文件加载真实 speechSynthesis (stub window.speechSynthesis 底层),
 * 验证 currentInitiator 打标/清位/归属判定的端到端语义.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { speakText, stopSpeechText, _resetSpeechTextState } from '../speakText';
import {
  speakViaWebSpeechSynthesis,
  _resetSpeechSynthesisCache,
} from '../speechSynthesis';

// --- window.speechSynthesis / SpeechSynthesisUtterance stub (jsdom 未实现) ---

class FakeUtterance {
  text: string;
  rate: number | undefined;
  lang: string | undefined;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const speakSpy = vi.fn();
const cancelSpy = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    'speechSynthesis',
    {
      speak: speakSpy,
      cancel: cancelSpy,
      getVoices: () => [],
    } as unknown as SpeechSynthesis,
  );
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  _resetSpeechSynthesisCache();
  _resetSpeechTextState();
  speakSpy.mockClear();
  cancelSpy.mockClear();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** 取最近一次被 speak 的 utterance (供模拟自然结束). */
function lastUtterance(): FakeUtterance {
  const calls = speakSpy.mock.calls;
  const utt = calls[calls.length - 1]?.[0] as FakeUtterance | undefined;
  if (!utt) throw new Error('no utterance spoken');
  return utt;
}

describe('v1.3.0 Stage 1 — speakText × speechSynthesis 归属权集成 (真实模块)', () => {
  it('A [核心回归]: 词级朗读自然结束 → 页级朗读 → 面板卸载不取消页级', () => {
    // 1. 词级点读 (speakText 打标 'word')
    speakText('apple', 'en');
    expect(speakSpy).toHaveBeenCalledTimes(1);
    // 2. 词级朗读自然结束 (onend → 队列空 → currentInitiator 清位)
    lastUtterance().onend?.();
    // 3. 页级朗读 (直接调 speechSynthesis, initiator 缺省 'other')
    speakViaWebSpeechSynthesis({ text: 'page passage text', language: 'en-US', rate: 1.0 });
    const cancelsAfterPageSpeak = cancelSpy.mock.calls.length;
    // 4. 面板卸载 → stopSpeechText — 核心断言: 不误杀页级朗读
    stopSpeechText();
    expect(cancelSpy.mock.calls.length).toBe(cancelsAfterPageSpeak);
  });

  it('B: 词级朗读进行中 → stopSpeechText 取消一次, 重复调用不重复取消', () => {
    speakText('apple', 'en');
    const cancelsAfterSpeak = cancelSpy.mock.calls.length; // speak 内部清队列已 cancel 过 1 次

    stopSpeechText();
    expect(cancelSpy.mock.calls.length).toBe(cancelsAfterSpeak + 1);

    // 归属已随 stop 清位 → 再次调用为 no-op
    stopSpeechText();
    expect(cancelSpy.mock.calls.length).toBe(cancelsAfterSpeak + 1);
  });

  it('C: 词级朗读未结束 → 页级直接发起 → stopSpeechText 不取消页级', () => {
    speakText('apple', 'en'); // 词级 (initiator 'word')
    speakViaWebSpeechSynthesis({ text: 'page passage text', language: 'en-US', rate: 1.0 }); // 页级插队 (内部会替换全局队列 — 沿 v1.2.0 既有语义)
    const cancelsAfterPageSpeak = cancelSpy.mock.calls.length;

    stopSpeechText(); // 面板卸载 — initiator 已是 'other' → no-op
    expect(cancelSpy.mock.calls.length).toBe(cancelsAfterPageSpeak);
  });
});
