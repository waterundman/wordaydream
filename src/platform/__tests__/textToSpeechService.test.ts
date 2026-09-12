/**
 * v0.3.0-harmony Stage 1: TextToSpeechService + HarmonyBridge TTS 扩展测试
 *
 * 测试目标:
 * - BridgeInputValidator 3 个新 validate 方法 (TS mirror, 直接测试真实函数)
 * - TextToSpeechService 单例契约 (TS mock mirror, 守护 ArkTS 单侧行为)
 * - HarmonyBridge.speak/stopSpeech/isSpeechSupported/getSpeechEngines
 *   fire-and-forget + try/catch 兜底契约 (TS mock mirror, 守护 ArkTS 行为)
 *
 * 测试策略 (vitest 无法运行 .ets 文件):
 * - T03/T04/T05: 直接测试 src/platform/bridgeInputValidator.ts 的 3 个新函数
 *   (TS mirror 与 ArkTS BridgeInputValidator.ets 签名一一对应, 校验逻辑完全一致).
 * - T01: 创建 TS mock TextToSpeechService (mirror ArkTS 单例模式 getInstance),
 *   验证两次 getInstance 返回同一实例.
 * - T02/T06/T07/T08: 创建 TS mock HarmonyBridge (mirror ArkTS fire-and-forget
 *   + try/catch 兜底契约), 注入 mock TextToSpeechService, 验证:
 *   - speak 调用 validator 前置校验 (T02)
 *   - speak 异常时 try/catch 兜底不抛到 Web (T06)
 *   - isSpeechSupported 异常时返回 false (T07)
 *   - getSpeechEngines 异常时返回 [] (T08)
 *
 * 覆盖 test_spec (8 cases, T01-T08, all critical/non-critical, framework=vitest).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateSpeechText,
  validateSpeechRate,
  validateSpeechLanguage,
} from '../bridgeInputValidator';
import type { SpeakPayload, SpeechEngineInfo } from '../harmonyBridge';

const PROJECT_ROOT: string = process.cwd();
const TTS_SERVICE_PATH: string = join(
  PROJECT_ROOT,
  'harmony',
  'entry',
  'src',
  'main',
  'ets',
  'tts',
  'TextToSpeechService.ets',
);
const ENTRY_ABILITY_PATH: string = join(
  PROJECT_ROOT,
  'harmony',
  'entry',
  'src',
  'main',
  'ets',
  'entryability',
  'EntryAbility.ets',
);

// =============================================================================
// TS mock TextToSpeechService (mirror ArkTS 单例模式)
// =============================================================================

/**
 * Mock TextToSpeechService (mirror ArkTS harmony/.../tts/TextToSpeechService.ets).
 *
 * 实现 getInstance 单例契约 + speak/stop/isSupported/getEngines 方法签名,
 * 供 HarmonyBridge mock 注入测试. 所有方法可被 vi.spyOn 覆盖.
 */
class MockTextToSpeechService {
  private static instance: MockTextToSpeechService | null = null;

  private constructor() {}

  static getInstance(): MockTextToSpeechService {
    if (MockTextToSpeechService.instance === null) {
      MockTextToSpeechService.instance = new MockTextToSpeechService();
    }
    return MockTextToSpeechService.instance;
  }

  /** 重置单例 (测试间隔离). */
  static resetInstance(): void {
    MockTextToSpeechService.instance = null;
  }

  async createEngine(): Promise<void> {}

  async speak(_payload: SpeakPayload): Promise<void> {}

  stop(): void {}

  shutdown(): void {}

  async isSupported(): Promise<boolean> {
    return true;
  }

  async getEngines(): Promise<SpeechEngineInfo[]> {
    return [];
  }
}

// =============================================================================
// TS mock HarmonyBridge (mirror ArkTS fire-and-forget + try/catch 兜底契约)
// =============================================================================

/**
 * Mock HarmonyBridge (mirror ArkTS harmony/.../bridge/HarmonyBridge.ets 的
 * speak/stopSpeech/isSpeechSupported/getSpeechEngines 4 个新方法).
 *
 * 行为契约 (与 ArkTS 一致):
 * - speak: 三段校验 (validateSpeechText/Language/Rate) + service.speak + try/catch 兜底
 * - stopSpeech: service.stop + try/catch 兜底
 * - isSpeechSupported: service.isSupported + try/catch 兜底 return false
 * - getSpeechEngines: service.getEngines + try/catch 兜底 return []
 */
class MockHarmonyBridge {
  async speak(payload: SpeakPayload): Promise<void> {
    try {
      if (payload === null || payload === undefined) {
        return;
      }
      if (!validateSpeechText(payload.text)) {
        return;
      }
      if (!validateSpeechLanguage(payload.language)) {
        return;
      }
      if (!validateSpeechRate(payload.rate)) {
        return;
      }
      await MockTextToSpeechService.getInstance().speak(payload);
    } catch {
      // fire-and-forget 兜底: 不抛到 Web
    }
  }

  stopSpeech(): void {
    try {
      MockTextToSpeechService.getInstance().stop();
    } catch {
      // fire-and-forget 兜底
    }
  }

  async isSpeechSupported(): Promise<boolean> {
    try {
      return await MockTextToSpeechService.getInstance().isSupported();
    } catch {
      return false;
    }
  }

  async getSpeechEngines(): Promise<SpeechEngineInfo[]> {
    try {
      return await MockTextToSpeechService.getInstance().getEngines();
    } catch {
      return [];
    }
  }
}

interface HarnessPendingSpeech {
  requestId: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * 纯 TS 行为镜像：只表达 ArkTS 服务的 requestId/Promise 结算协议，
 * 让并发、过期回调、stop 与 shutdown 能在无设备环境下确定性回归。
 */
class SingleActiveSpeechHarness {
  private pending: HarnessPendingSpeech | null = null;

  start(requestId: string): Promise<void> {
    const previous: HarnessPendingSpeech | null = this.pending;
    if (previous !== null) {
      this.pending = null;
      previous.reject(new Error('superseded'));
    }

    return new Promise<void>((resolve, reject) => {
      this.pending = {
        requestId,
        resolve,
        reject,
      };
    });
  }

  complete(requestId: string): void {
    const pending: HarnessPendingSpeech | null = this.pending;
    if (pending === null || pending.requestId !== requestId) {
      return;
    }
    this.pending = null;
    pending.resolve();
  }

  fail(requestId: string): void {
    const pending: HarnessPendingSpeech | null = this.pending;
    if (pending === null || pending.requestId !== requestId) {
      return;
    }
    this.pending = null;
    pending.reject(new Error('engine error'));
  }

  stop(): void {
    const pending: HarnessPendingSpeech | null = this.pending;
    if (pending === null) {
      return;
    }
    this.pending = null;
    pending.resolve();
  }

  shutdown(): void {
    const pending: HarnessPendingSpeech | null = this.pending;
    if (pending === null) {
      return;
    }
    this.pending = null;
    pending.reject(new Error('shutdown'));
  }

  activeRequestId(): string | null {
    return this.pending?.requestId ?? null;
  }
}

// =============================================================================
// 测试用例
// =============================================================================

/** 构造全合法 SpeakPayload, 供 T02/T06 复用. */
function makeValidPayload(): SpeakPayload {
  return {
    text: 'Hallo Welt, dies ist ein Test.',
    language: 'de-DE',
    rate: 1.0,
  };
}

describe('TextToSpeechService + HarmonyBridge TTS (v0.3.0-harmony Stage 1)', () => {
  beforeEach(() => {
    MockTextToSpeechService.resetInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    MockTextToSpeechService.resetInstance();
  });

  // -------------------------------------------------------------------------
  // T01: TextToSpeechService 单例
  // -------------------------------------------------------------------------
  describe('T01 [critical]: TextToSpeechService 单例', () => {
    it('getInstance() 两次返回同一实例 (严格相等)', () => {
      const a: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      const b: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      expect(a).toBe(b);
      expect(a).toBeInstanceOf(MockTextToSpeechService);
    });

    it('resetInstance 后再 getInstance 返回新实例 (测试隔离)', () => {
      const a: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      MockTextToSpeechService.resetInstance();
      const b: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      expect(a).not.toBe(b);
    });
  });

  // -------------------------------------------------------------------------
  // T02: speak(payload) 调用 BridgeInputValidator 前置校验
  // -------------------------------------------------------------------------
  describe('T02 [critical]: speak 调用 BridgeInputValidator 前置校验', () => {
    it('合法 payload → 调用 service.speak', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      const speakSpy = vi.spyOn(service, 'speak').mockResolvedValue(undefined);

      await bridge.speak(makeValidPayload());

      expect(speakSpy).toHaveBeenCalledTimes(1);
      expect(speakSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hallo Welt, dies ist ein Test.',
          language: 'de-DE',
          rate: 1.0,
        }),
      );
    });

    it('非法 text (空字符串) → 不调用 service.speak', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      const speakSpy = vi.spyOn(service, 'speak').mockResolvedValue(undefined);

      const payload: SpeakPayload = { text: '', language: 'de-DE', rate: 1.0 };
      await bridge.speak(payload);

      expect(speakSpy).not.toHaveBeenCalled();
    });

    it('非法 language → 不调用 service.speak', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      const speakSpy = vi.spyOn(service, 'speak').mockResolvedValue(undefined);

      const payload: SpeakPayload = {
        text: 'hello',
        language: 'zh-CN' as SpeakPayload['language'],
        rate: 1.0,
      };
      await bridge.speak(payload);

      expect(speakSpy).not.toHaveBeenCalled();
    });

    it('非法 rate → 不调用 service.speak', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      const speakSpy = vi.spyOn(service, 'speak').mockResolvedValue(undefined);

      const payload: SpeakPayload = {
        text: 'hello',
        language: 'en-US',
        rate: 3.0 as SpeakPayload['rate'],
      };
      await bridge.speak(payload);

      expect(speakSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // T03: validateSpeechText
  // -------------------------------------------------------------------------
  describe('T03 [critical]: validateSpeechText', () => {
    it('非字符串入参 → false', () => {
      expect(validateSpeechText(null as unknown as string)).toBe(false);
      expect(validateSpeechText(undefined as unknown as string)).toBe(false);
      expect(validateSpeechText(123 as unknown as string)).toBe(false);
      expect(validateSpeechText({} as unknown as string)).toBe(false);
    });

    it('长度 0 (空字符串) → false', () => {
      expect(validateSpeechText('')).toBe(false);
    });

    it('长度 > 4096 → false', () => {
      expect(validateSpeechText('a'.repeat(4097))).toBe(false);
      expect(validateSpeechText('a'.repeat(10000))).toBe(false);
    });

    it('长度 1-4096 → true', () => {
      expect(validateSpeechText('a')).toBe(true);
      expect(validateSpeechText('Hallo Welt')).toBe(true);
      expect(validateSpeechText('a'.repeat(4096))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // T04: validateSpeechRate
  // -------------------------------------------------------------------------
  describe('T04 [critical]: validateSpeechRate', () => {
    it('0.5 / 1.0 / 1.5 / 2.0 → true', () => {
      expect(validateSpeechRate(0.5)).toBe(true);
      expect(validateSpeechRate(1.0)).toBe(true);
      expect(validateSpeechRate(1.5)).toBe(true);
      expect(validateSpeechRate(2.0)).toBe(true);
    });

    it('其他数值 → false', () => {
      expect(validateSpeechRate(0)).toBe(false);
      expect(validateSpeechRate(0.4)).toBe(false);
      expect(validateSpeechRate(0.75)).toBe(false);
      expect(validateSpeechRate(1.25)).toBe(false);
      expect(validateSpeechRate(2.5)).toBe(false);
      expect(validateSpeechRate(3)).toBe(false);
      expect(validateSpeechRate(-1)).toBe(false);
      expect(validateSpeechRate(NaN)).toBe(false);
      expect(validateSpeechRate(Infinity)).toBe(false);
    });

    it('非数值入参 → false', () => {
      expect(validateSpeechRate(null as unknown as number)).toBe(false);
      expect(validateSpeechRate(undefined as unknown as number)).toBe(false);
      expect(validateSpeechRate('1.0' as unknown as number)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // T05: validateSpeechLanguage
  // -------------------------------------------------------------------------
  describe('T05 [critical]: validateSpeechLanguage', () => {
    it('de-DE / en-US → true', () => {
      expect(validateSpeechLanguage('de-DE')).toBe(true);
      expect(validateSpeechLanguage('en-US')).toBe(true);
    });

    it('zh-CN / fr-FR → false', () => {
      expect(validateSpeechLanguage('zh-CN')).toBe(false);
      expect(validateSpeechLanguage('fr-FR')).toBe(false);
      expect(validateSpeechLanguage('ja-JP')).toBe(false);
      expect(validateSpeechLanguage('es-ES')).toBe(false);
    });

    it('大小写敏感 (DE-de 不合法)', () => {
      expect(validateSpeechLanguage('DE-de')).toBe(false);
      expect(validateSpeechLanguage('DE-DE')).toBe(false);
      expect(validateSpeechLanguage('en-us')).toBe(false);
    });

    it('空字符串 / 非字符串 → false', () => {
      expect(validateSpeechLanguage('')).toBe(false);
      expect(validateSpeechLanguage(null as unknown as string)).toBe(false);
      expect(validateSpeechLanguage(undefined as unknown as string)).toBe(false);
      expect(validateSpeechLanguage(123 as unknown as string)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // T06: HarmonyBridge.speak 异常时 try/catch 兜底, 不抛到 Web
  // -------------------------------------------------------------------------
  describe('T06 [critical]: HarmonyBridge.speak 异常 try/catch 兜底', () => {
    it('service.speak 抛错 → bridge.speak 不抛出 (fire-and-forget)', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      vi.spyOn(service, 'speak').mockRejectedValue(
        new Error('engine crashed') as never,
      );

      // 不应抛出
      await expect(bridge.speak(makeValidPayload())).resolves.toBeUndefined();
    });

    it('service.speak 抛 BusinessError → bridge.speak 静默返回', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      const businessErr = { code: 1001, message: 'TTS engine not ready' };
      vi.spyOn(service, 'speak').mockRejectedValue(businessErr as never);

      await expect(bridge.speak(makeValidPayload())).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // T07: HarmonyBridge.isSpeechSupported 引擎不可用时返回 false
  // -------------------------------------------------------------------------
  describe('T07 [critical]: HarmonyBridge.isSpeechSupported 异常返回 false', () => {
    it('service.isSupported 抛错 → bridge.isSpeechSupported 返回 false', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      vi.spyOn(service, 'isSupported').mockRejectedValue(
        new Error('engine unavailable') as never,
      );

      await expect(bridge.isSpeechSupported()).resolves.toBe(false);
    });

    it('service.isSupported 返回 false → bridge.isSpeechSupported 返回 false', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      vi.spyOn(service, 'isSupported').mockResolvedValue(false);

      await expect(bridge.isSpeechSupported()).resolves.toBe(false);
    });

    it('service.isSupported 返回 true → bridge.isSpeechSupported 返回 true', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      vi.spyOn(service, 'isSupported').mockResolvedValue(true);

      await expect(bridge.isSpeechSupported()).resolves.toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // T08: HarmonyBridge.getSpeechEngines 异常时返回空数组
  // -------------------------------------------------------------------------
  describe('T08 [non-critical]: HarmonyBridge.getSpeechEngines 异常返回 []', () => {
    it('service.getEngines 抛错 → bridge.getSpeechEngines 返回 []', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      vi.spyOn(service, 'getEngines').mockRejectedValue(
        new Error('listEngines not available') as never,
      );

      await expect(bridge.getSpeechEngines()).resolves.toEqual([]);
    });

    it('service.getEngines 返回引擎列表 → bridge 透传', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      const engines: SpeechEngineInfo[] = [
        {
          engineId: 'engine-001',
          engineName: 'Default TTS Engine',
          supportedLanguages: ['de-DE', 'en-US'],
          isOnline: false,
        },
      ];
      vi.spyOn(service, 'getEngines').mockResolvedValue(engines);

      await expect(bridge.getSpeechEngines()).resolves.toEqual(engines);
      await expect(bridge.getSpeechEngines()).resolves.toHaveLength(1);
    });

    it('service.getEngines 返回空数组 → bridge 返回空数组', async () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      vi.spyOn(service, 'getEngines').mockResolvedValue([]);

      await expect(bridge.getSpeechEngines()).resolves.toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 附加契约测试: stopSpeech fire-and-forget
  // -------------------------------------------------------------------------
  describe('stopSpeech fire-and-forget 契约', () => {
    it('service.stop 抛错 → bridge.stopSpeech 不抛出', () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      vi.spyOn(service, 'stop').mockImplementation(() => {
        throw new Error('stop failed');
      });

      expect(() => bridge.stopSpeech()).not.toThrow();
    });

    it('service.stop 正常 → bridge.stopSpeech 调用一次', () => {
      const bridge: MockHarmonyBridge = new MockHarmonyBridge();
      const service: MockTextToSpeechService = MockTextToSpeechService.getInstance();
      const stopSpy = vi.spyOn(service, 'stop').mockImplementation(() => {});

      bridge.stopSpeech();
      expect(stopSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 接口契约测试: SpeakPayload / SpeechEngineInfo 字段对齐
  // -------------------------------------------------------------------------
  describe('SpeakPayload / SpeechEngineInfo 接口契约', () => {
    it('SpeakPayload 必填字段: text / language / rate', () => {
      const payload: SpeakPayload = {
        text: 'test',
        language: 'en-US',
        rate: 1.5,
      };
      expect(payload.text).toBe('test');
      expect(payload.language).toBe('en-US');
      expect(payload.rate).toBe(1.5);
      expect(payload.voiceId).toBeUndefined();
    });

    it('SpeakPayload voiceId 可选字段', () => {
      const payload: SpeakPayload = {
        text: 'test',
        language: 'en-US',
        rate: 1.0,
        voiceId: 'voice-001',
      };
      expect(payload.voiceId).toBe('voice-001');
    });

    it('SpeechEngineInfo 4 字段对齐: engineId / engineName / supportedLanguages / isOnline', () => {
      const info: SpeechEngineInfo = {
        engineId: 'engine-001',
        engineName: 'Default',
        supportedLanguages: ['de-DE', 'en-US'],
        isOnline: false,
      };
      expect(info.engineId).toBe('engine-001');
      expect(info.engineName).toBe('Default');
      expect(info.supportedLanguages).toEqual(['de-DE', 'en-US']);
      expect(info.isOnline).toBe(false);
    });
  });

  describe('单活动朗读 Promise 生命周期', () => {
    it('新 speak 拒绝旧请求，旧回调不能完成新请求', async () => {
      const harness = new SingleActiveSpeechHarness();
      const first: Promise<void> = harness.start('request-1');
      const firstOutcome: Promise<string> = first.then(
        () => 'resolved',
        (error: Error) => `rejected:${error.message}`,
      );

      const second: Promise<void> = harness.start('request-2');

      await expect(firstOutcome).resolves.toBe('rejected:superseded');
      expect(harness.activeRequestId()).toBe('request-2');

      harness.complete('request-1');
      expect(harness.activeRequestId()).toBe('request-2');

      harness.complete('request-2');
      await expect(second).resolves.toBeUndefined();
      expect(harness.activeRequestId()).toBeNull();
    });

    it('过期 error 被忽略，匹配 error 才拒绝活动请求', async () => {
      const harness = new SingleActiveSpeechHarness();
      const active: Promise<void> = harness.start('request-active');
      const activeOutcome: Promise<string> = active.then(
        () => 'resolved',
        (error: Error) => `rejected:${error.message}`,
      );

      harness.fail('request-stale');
      expect(harness.activeRequestId()).toBe('request-active');

      harness.fail('request-active');
      await expect(activeOutcome).resolves.toBe('rejected:engine error');
      expect(harness.activeRequestId()).toBeNull();
    });

    it('stop 即使没有引擎回调也会 resolve pending', async () => {
      const harness = new SingleActiveSpeechHarness();
      const pending: Promise<void> = harness.start('request-stop');

      harness.stop();

      await expect(pending).resolves.toBeUndefined();
      expect(harness.activeRequestId()).toBeNull();
    });

    it('shutdown 会 reject pending，避免窗口销毁后 Promise 悬空', async () => {
      const harness = new SingleActiveSpeechHarness();
      const pending: Promise<void> = harness.start('request-shutdown');
      const outcome: Promise<string> = pending.then(
        () => 'resolved',
        (error: Error) => `rejected:${error.message}`,
      );

      harness.shutdown();

      await expect(outcome).resolves.toBe('rejected:shutdown');
      expect(harness.activeRequestId()).toBeNull();
    });
  });

  describe('ArkTS TTS 生命周期源码契约', () => {
    it('真实服务按 requestId 匹配回调并在替换前 reject 旧请求', () => {
      const source: string = readFileSync(TTS_SERVICE_PATH, 'utf-8');
      expect(source).toContain('interface PendingSpeech');
      expect(source).toContain('private pendingSpeech: PendingSpeech | null');
      expect(source).toContain('private createListener(): textToSpeech.SpeakListener');
      expect(source).toContain('pending.requestId !== requestId');
      expect(source).toContain('this.resolveRequest(requestId)');
      expect(source).toContain('this.rejectRequest(requestId, errorCode, errorMessage)');
      expect(source).toContain('createdEngine.setListener(this.createListener())');

      const interruptStart: number = source.indexOf('private interruptPendingSpeech');
      const resolveStart: number = source.indexOf('private resolveRequest', interruptStart);
      const interruptBlock: string = source.slice(interruptStart, resolveStart);
      expect(interruptStart).toBeGreaterThan(-1);
      expect(interruptBlock.indexOf('this.rejectRequest')).toBeGreaterThan(-1);
      expect(interruptBlock.indexOf('this.engine.stop()')).toBeGreaterThan(
        interruptBlock.indexOf('this.rejectRequest'),
      );

      const speakStart: number = source.indexOf('speak(payload: SpeakPayload)');
      const startSpeechDefinition: number = source.indexOf(
        'private async startSpeech',
        speakStart,
      );
      const speakEntryBlock: string = source.slice(speakStart, startSpeechDefinition);
      expect(speakEntryBlock.indexOf('this.pendingSpeech = pending')).toBeGreaterThan(-1);
      expect(speakEntryBlock.indexOf('this.startSpeech(requestId, payload)')).toBeGreaterThan(
        speakEntryBlock.indexOf('this.pendingSpeech = pending'),
      );
    });

    it('同语言共享初始化，isSupported 不以默认语言抢占在途 speak', () => {
      const source: string = readFileSync(TTS_SERVICE_PATH, 'utf-8');
      expect(source).toContain('private engineInitPromise: Promise<void> | null');
      expect(source).toContain("private initializingLanguage: string = ''");

      const createStart: number = source.indexOf('async createEngine(');
      const initializeStart: number = source.indexOf('private async initializeEngine', createStart);
      const createBlock: string = source.slice(createStart, initializeStart);
      expect(createBlock).toContain(
        'activeInit !== null && this.initializingLanguage === language',
      );
      expect(createBlock).toContain('await activeInit');
      expect(createBlock).toContain('this.engineInitPromise = initPromise');

      const initializeBodyStart: number = source.indexOf(
        'private async initializeEngine',
        initializeStart,
      );
      const speakStart: number = source.indexOf('speak(payload: SpeakPayload)', initializeBodyStart);
      const initializeBlock: string = source.slice(initializeBodyStart, speakStart);
      expect(initializeBlock).not.toContain('this.rejectPending(');

      const supportedStart: number = source.indexOf('async isSupported()');
      const enginesStart: number = source.indexOf('async getEngines()', supportedStart);
      const supportedBlock: string = source.slice(supportedStart, enginesStart);
      expect(supportedBlock).toContain('const activeInit: Promise<void> | null');
      expect(supportedBlock.indexOf('await activeInit')).toBeGreaterThan(-1);
      expect(supportedBlock.indexOf('await this.createEngine()')).toBeGreaterThan(
        supportedBlock.indexOf('await activeInit'),
      );
    });

    it('stop/shutdown 结算 pending，且 shutdown 使在途 createEngine 失效', () => {
      const source: string = readFileSync(TTS_SERVICE_PATH, 'utf-8');
      expect(source).toContain('finally {\n      this.resolvePending();');
      expect(source).toContain('this.rejectPending(\n      ERROR_SERVICE_SHUTDOWN');
      expect(source).toContain('this.engineGeneration = this.engineGeneration + 1');
      expect(source).toContain('generation !== this.engineGeneration');
      expect(source).toMatch(/online:\s*1/);
    });

    it('EntryAbility 窗口销毁时调用 TTS shutdown', () => {
      const source: string = readFileSync(ENTRY_ABILITY_PATH, 'utf-8');
      expect(source).toContain("import { TextToSpeechService } from '../tts/TextToSpeechService'");
      expect(source).toContain('onWindowStageDestroy(): void');
      expect(source).toContain('TextToSpeechService.getInstance().shutdown()');
    });
  });
});
