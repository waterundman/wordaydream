/**
 * v0.3.0-harmony Stage 2: Web SpeechSynthesis 封装测试 (T09-T11)
 *
 * 测试目标:
 * - T09 [critical]: loadSpeechSynthesisVoices 监听 onvoiceschanged + 缓存 voices
 * - T10 [critical]: selectVoiceByLang('de-DE') 优先返回 localService=true 且 lang 完全匹配
 * - T11 [critical]: speakViaWebSpeechSynthesis 长文本 (>200 字符) 按句切分为多个 utterance
 *
 * 测试策略 (jsdom 默认无 SpeechSynthesis API):
 * - beforeAll: 注入 window.speechSynthesis mock + 全局 SpeechSynthesisUtterance mock
 * - beforeEach: _resetSpeechSynthesisCache() 重置模块级缓存, 避免用例间污染
 * - afterEach: vi.restoreAllMocks() 恢复 spy
 * - T09: useFakeTimers 模拟 500ms 兜底定时器
 * - T11: 通过 mock utterance.onend 触发队列播放下一个 chunk
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadSpeechSynthesisVoices,
  selectVoiceByLang,
  speakViaWebSpeechSynthesis,
  stopWebSpeechSynthesis,
  setWebSpeechSynthesisEndCallback,
  _resetSpeechSynthesisCache,
} from '../speechSynthesis';
import type { SpeakPayload } from '../harmonyBridge';

// =============================================================================
// Mock 类型: SpeechSynthesisVoice / SpeechSynthesisUtterance
// =============================================================================

interface MockVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

interface MockUtterance {
  text: string;
  lang: string;
  rate: number;
  voice: MockVoice | null;
  voiceURI?: string;
  onend: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onstart: (() => void) | null;
}

// =============================================================================
// Mock 状态: 集中管理 window.speechSynthesis + SpeechSynthesisUtterance
// =============================================================================

let mockVoices: MockVoice[] = [];
let onvoiceschangedHandler: (() => void) | null = null;
const speakCalls: MockUtterance[] = [];
let cancelCalls = 0;

function installSpeechSynthesisMock() {
  mockVoices = [];
  onvoiceschangedHandler = null;
  speakCalls.length = 0;
  cancelCalls = 0;

  // window.speechSynthesis mock
  const synthMock = {
    getVoices: () => mockVoices,
    set onvoiceschanged(fn: (() => void) | null) {
      onvoiceschangedHandler = fn;
    },
    get onvoiceschanged() {
      return onvoiceschangedHandler;
    },
    speak: (u: MockUtterance) => {
      speakCalls.push(u);
    },
    cancel: () => {
      cancelCalls += 1;
    },
    pause: () => {},
    resume: () => {},
  };
  Object.defineProperty(window, 'speechSynthesis', {
    value: synthMock,
    configurable: true,
    writable: true,
  });

  // SpeechSynthesisUtterance 全局 mock
  class MockUtteranceImpl implements MockUtterance {
    text: string;
    lang: string;
    rate: number;
    voice: MockVoice | null = null;
    voiceURI?: string;
    onend: (() => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onstart: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
      this.lang = '';
      this.rate = 1;
    }
  }
  // SpeechSynthesisUtterance 是全局构造器, jsdom 未实现
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: MockUtteranceImpl,
    configurable: true,
    writable: true,
  });
  // 同时挂到 globalThis 供 speechSynthesis.ts 内 `new SpeechSynthesisUtterance()` 解析
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    MockUtteranceImpl;
}

/** 模拟 voiceschanged 事件触发 (ArkWeb / Chrome 加载完 voices 后调用). */
function fireVoicesChanged() {
  if (onvoiceschangedHandler) onvoiceschangedHandler();
}

/** 构造 MockVoice. */
function makeVoice(
  name: string,
  lang: string,
  localService: boolean,
  defaultVoice = false,
): MockVoice {
  return {
    voiceURI: name,
    name,
    lang,
    localService,
    default: defaultVoice,
  };
}

// =============================================================================
// 测试用例
// =============================================================================

describe('Web SpeechSynthesis 封装 (v0.3.0-harmony Stage 2)', () => {
  beforeAll(() => {
    installSpeechSynthesisMock();
  });

  beforeEach(() => {
    _resetSpeechSynthesisCache();
    mockVoices = [];
    speakCalls.length = 0;
    cancelCalls = 0;
    onvoiceschangedHandler = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // T09: loadSpeechSynthesisVoices 监听 onvoiceschanged + 缓存 voices
  // -------------------------------------------------------------------------
  describe('T09 [critical]: loadSpeechSynthesisVoices 监听 + 缓存', () => {
    it('voiceschanged 触发后 → 缓存 voices 并 resolve', async () => {
      const expectedVoices = [
        makeVoice('Google Deutsch', 'de-DE', true),
        makeVoice('Google US English', 'en-US', true),
      ];

      const promise = loadSpeechSynthesisVoices();
      // 模拟 Chrome / ArkWeb 加载完 voices 后触发 voiceschanged
      mockVoices = expectedVoices;
      fireVoicesChanged();

      const voices = await promise;
      expect(voices).toEqual(expectedVoices);
      expect(voices).toHaveLength(2);
    });

    it('立即 getVoices() 返回非空 → 直接缓存 (无需 voiceschanged)', async () => {
      const expectedVoices = [makeVoice('Microsoft Anna', 'en-US', true)];
      mockVoices = expectedVoices;

      const voices = await loadSpeechSynthesisVoices();
      expect(voices).toEqual(expectedVoices);
    });

    it('缓存生效: 第二次调用不再绑定 onvoiceschanged', async () => {
      mockVoices = [makeVoice('V1', 'en-US', true)];
      const first = await loadSpeechSynthesisVoices();
      expect(first).toHaveLength(1);

      // 第二次调用: 即使 voices 变化, 也应返回缓存
      mockVoices = [makeVoice('V2', 'en-US', true), makeVoice('V3', 'en-US', true)];
      const second = await loadSpeechSynthesisVoices();
      expect(second).toEqual(first); // 仍是首次缓存
    });

    it('500ms 兜底定时器: voiceschanged 未触发 → resolve 空数组 (R-TTS-4 缓解)', async () => {
      vi.useFakeTimers();
      const promise = loadSpeechSynthesisVoices();
      // 不触发 voiceschanged, 推进 500ms
      vi.advanceTimersByTime(500);
      const voices = await promise;
      expect(voices).toEqual([]);
    });

    it('window.speechSynthesis 不存在 → resolve 空数组 (Web 端无 API 降级)', async () => {
      const original = window.speechSynthesis;
      Object.defineProperty(window, 'speechSynthesis', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      _resetSpeechSynthesisCache();
      try {
        const voices = await loadSpeechSynthesisVoices();
        expect(voices).toEqual([]);
      } finally {
        // 恢复 mock, 避免污染后续用例
        Object.defineProperty(window, 'speechSynthesis', {
          value: original,
          configurable: true,
          writable: true,
        });
      }
    });
  });

  // -------------------------------------------------------------------------
  // T10: selectVoiceByLang 优先级
  // -------------------------------------------------------------------------
  describe('T10 [critical]: selectVoiceByLang 优先级', () => {
    it('优先级 1: lang 完全匹配 + localService=true', async () => {
      const localVoice = makeVoice('Google Deutsch', 'de-DE', true);
      const remoteVoice = makeVoice('Cloud Deutsch', 'de-DE', false);
      mockVoices = [remoteVoice, localVoice];
      await loadSpeechSynthesisVoices();

      const v = selectVoiceByLang('de-DE');
      expect(v).toBe(localVoice);
    });

    it('优先级 2: 无 localService=true 时, lang 完全匹配 (任意 localService)', async () => {
      const remoteVoice = makeVoice('Cloud Deutsch', 'de-DE', false);
      mockVoices = [remoteVoice];
      await loadSpeechSynthesisVoices();

      const v = selectVoiceByLang('de-DE');
      expect(v).toBe(remoteVoice);
    });

    it('优先级 3: 无完全匹配时, lang 前缀匹配 (de-AT 匹配 de-DE 查询的前缀 de)', async () => {
      const austrianVoice = makeVoice('Austrian Voice', 'de-AT', true);
      mockVoices = [austrianVoice];
      await loadSpeechSynthesisVoices();

      const v = selectVoiceByLang('de-DE');
      expect(v).toBe(austrianVoice);
    });

    it('无任何匹配 → 返回 null', async () => {
      mockVoices = [makeVoice('Japanese Voice', 'ja-JP', true)];
      await loadSpeechSynthesisVoices();

      const v = selectVoiceByLang('de-DE');
      expect(v).toBeNull();
    });

    it('en-US 查询: 优先返回 en-US + localService=true', async () => {
      const localEn = makeVoice('Google US English', 'en-US', true);
      const remoteEn = makeVoice('Cloud US English', 'en-US', false);
      const localDe = makeVoice('Google Deutsch', 'de-DE', true);
      mockVoices = [remoteEn, localDe, localEn];
      await loadSpeechSynthesisVoices();

      const v = selectVoiceByLang('en-US');
      expect(v).toBe(localEn);
    });
  });

  // -------------------------------------------------------------------------
  // T11: speakViaWebSpeechSynthesis 长文本切分 + 队列播放
  // -------------------------------------------------------------------------
  describe('T11 [critical]: speakViaWebSpeechSynthesis 长文本切分', () => {
    it('短文本 (<=200 字符) → 单个 utterance', () => {
      const text = 'Hello world. This is a short text.';
      const payload: SpeakPayload = {
        text,
        language: 'en-US',
        rate: 1.0,
      };

      speakViaWebSpeechSynthesis(payload);
      expect(speakCalls).toHaveLength(1);
      expect(speakCalls[0].text).toBe(text);
      expect(speakCalls[0].rate).toBe(1.0);
      expect(speakCalls[0].lang).toBe('en-US');
    });

    it('长文本 (>200 字符) → 按句切分为多个 utterance', () => {
      // 构造 4 个句子, 累积 > 200 字符
      const sentence1 = 'The quick brown fox jumps over the lazy dog at sunrise.';
      const sentence2 = 'She decided to take a long walk through the quiet forest nearby.';
      const sentence3 = 'Birds were singing softly in the tall green trees above her head.';
      const sentence4 = 'The afternoon sun cast long shadows across the winding dirt path.';
      const longText = `${sentence1} ${sentence2} ${sentence3} ${sentence4}`;
      expect(longText.length).toBeGreaterThan(200);

      const payload: SpeakPayload = {
        text: longText,
        language: 'en-US',
        rate: 1.5,
      };

      speakViaWebSpeechSynthesis(payload);
      // 初始: 仅第一个 chunk 被 speak
      expect(speakCalls).toHaveLength(1);
      expect(speakCalls[0].rate).toBe(1.5);
      expect(speakCalls[0].lang).toBe('en-US');
      expect(speakCalls[0].text.length).toBeLessThanOrEqual(200);

      // 触发 onend 链, 累积所有 chunk
      let totalChunks = speakCalls.length;
      let safety = 10;
      while (speakCalls.length > 0 && speakCalls[speakCalls.length - 1].onend && safety > 0) {
        const last = speakCalls[speakCalls.length - 1];
        const before = speakCalls.length;
        last.onend?.();
        safety -= 1;
        if (speakCalls.length === before) break; // 队列已空, callback 被调用
        totalChunks = speakCalls.length;
      }

      // 总共 speak 了至少 2 个 chunk (证明长文本被切分)
      expect(totalChunks).toBeGreaterThanOrEqual(2);
      // 每个 chunk 长度 <= 200 (除非单句超长)
      for (const u of speakCalls) {
        expect(u.text.length).toBeLessThanOrEqual(200);
      }
    });

    it('单句超过 200 字符 → 硬切分为 200 字符块', () => {
      const longSentence = 'a'.repeat(450); // 单句无标点, 长度 450
      const payload: SpeakPayload = {
        text: longSentence,
        language: 'en-US',
        rate: 1.0,
      };

      speakViaWebSpeechSynthesis(payload);
      // 450 / 200 = 2.25 → 3 块
      // 注意: 第一个 chunk 立即 speak, 后续 chunk 在队列中等待 onend
      // speakCalls 仅记录已被 speak 的 utterance, 初始只有第一个
      expect(speakCalls).toHaveLength(1);
      expect(speakCalls[0].text.length).toBeLessThanOrEqual(200);
    });

    it('队列播放: onend 触发后播放下一个 chunk', () => {
      const sentence1 = 'First sentence here with some words.';
      const sentence2 = 'Second sentence here with more words.';
      const sentence3 = 'Third sentence here with even more words.';
      const longText = `${sentence1} ${sentence2} ${sentence3} ${'padding '.repeat(30)}`;
      expect(longText.length).toBeGreaterThan(200);

      speakViaWebSpeechSynthesis({ text: longText, language: 'en-US', rate: 1.0 });
      // 初始: 第一个 chunk 已 speak
      expect(speakCalls).toHaveLength(1);

      // 触发第一个 utterance 的 onend → 播放第二个
      const firstUtterance = speakCalls[0];
      firstUtterance.onend?.();
      expect(speakCalls).toHaveLength(2);

      // 触发第二个 onend → 播放第三个
      const secondUtterance = speakCalls[1];
      secondUtterance.onend?.();
      expect(speakCalls).toHaveLength(3);
    });

    it('所有 chunk 播放完毕 → 调用 onPlaybackEndCallback', () => {
      let endCalled = 0;
      setWebSpeechSynthesisEndCallback(() => {
        endCalled += 1;
      });

      const text = 'Short text.';
      speakViaWebSpeechSynthesis({ text, language: 'en-US', rate: 1.0 });
      expect(speakCalls).toHaveLength(1);

      // 触发唯一 chunk 的 onend → 队列空 → 调用 endCallback
      speakCalls[0].onend?.();
      expect(endCalled).toBe(1);
    });

    it('stopWebSpeechSynthesis: 清空队列 + 调用 cancel()', () => {
      const longText = `${'a '.repeat(150)}`; // 300 字符
      speakViaWebSpeechSynthesis({ text: longText, language: 'en-US', rate: 1.0 });
      expect(speakCalls).toHaveLength(1);

      const cancelCountBefore = cancelCalls;
      stopWebSpeechSynthesis();
      expect(cancelCalls).toBeGreaterThan(cancelCountBefore);

      // 触发已取消 utterance 的 onend (不应继续播放下一个 chunk)
      const firstUtterance = speakCalls[0];
      // stopWebSpeechSynthesis 会清空 onend 回调
      expect(firstUtterance.onend).toBeNull();
      // 即使调用 onend (模拟竞态), 也不应继续 speak
      firstUtterance.onend?.();
      expect(speakCalls).toHaveLength(1);
    });

    it('stopWebSpeechSynthesis 后 setWebSpeechSynthesisEndCallback(null) 清除回调', () => {
      let endCalled = 0;
      setWebSpeechSynthesisEndCallback(() => {
        endCalled += 1;
      });

      speakViaWebSpeechSynthesis({ text: 'test', language: 'en-US', rate: 1.0 });
      stopWebSpeechSynthesis();
      setWebSpeechSynthesisEndCallback(null);

      // 队列已空, 但回调已清除 → endCalled 不变
      // (stopWebSpeechSynthesis 已 cancel, 不会再有 onend 触发)
      expect(endCalled).toBe(0);
    });

    it('voice 选择: speakViaWebSpeechSynthesis 调用 selectVoiceByLang 设置 utterance.voice', async () => {
      const localVoice = makeVoice('Google US English', 'en-US', true);
      mockVoices = [localVoice];
      await loadSpeechSynthesisVoices();

      speakViaWebSpeechSynthesis({ text: 'Hello', language: 'en-US', rate: 1.0 });
      expect(speakCalls[0].voice).toBe(localVoice);
    });
  });
});
