/**
 * TextToSpeechService (v0.3.0-harmony)
 *
 * 封装 @ohos.textToSpeech Kit, 提供鸿蒙原生 TTS 朗读能力.
 *
 * 设计要点:
 * - 单例模式 (getInstance), 全局唯一, 由 HarmonyBridge.speak 调用.
 * - 单活动朗读: 新 speak 明确 reject 并 stop 旧请求，所有 Promise 必须结算.
 * - 回调隔离: API 22 SpeakListener 的 requestId 必须匹配 pending requestId，
 *   过期 onStop/onComplete/onError 不得影响新请求.
 * - 引擎创建代次: 并发 createEngine 或 shutdown 后，过期实例立即释放.
 * - 防御性写法: createEngine / speak / listVoices 调用均包裹 try/catch，
 *   由 HarmonyBridge 统一隔离向 Web 端传播的异常.
 * - createEngine 懒加载, 首次 speak / isSupported 调用时初始化; shutdown 后
 *   engine 置 null, 下次调用重新创建.
 *
 * ArkTS 适配: 无 any / 无对象字面量类型 / 无 var / 用 interface 而非 type alias.
 * 异步初始化用 async/await；speak Promise 由 API 22 listener 回调结算.
 */
import { textToSpeech } from '@kit.CoreSpeechKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';

const DOMAIN: number = 0x0001;
const TAG: string = 'TextToSpeechService';
/**
 * 应用自定义 TTS 错误码 (非系统返回码).
 *
 * 取 textToSpeech 模块码段 (1002300xxx) 的 9xx 空闲号位, 避开已文档化的系统
 * 错误码; 经 HarmonyBridge 透传给 Web 端时按 message 文案区分场景.
 */
/** 旧朗读请求被新请求抢占 (speak 入口单活动). */
const ERROR_SPEECH_SUPERSEDED: number = 1002300991;
/** 朗读中服务被销毁 (onWindowStageDestroy / shutdown). */
const ERROR_SERVICE_SHUTDOWN: number = 1002300992;
/** 引擎缺失或启动朗读失败. */
const ERROR_SPEECH_FAILED: number = 1002300993;
const NO_ACTIVE_REQUEST: string = '';

/**
 * TTS 朗读载荷.
 *
 * 字段与 src/platform/harmonyBridge.ts 的 SpeakPayload TS interface 一一对应:
 * - text: 必填, 长度上限 4096 (由 BridgeInputValidator.validateSpeechText 守卫).
 * - language: 'de-DE' | 'en-US' (由 validateSpeechLanguage 守卫).
 * - rate: 0.5 | 1.0 | 1.5 | 2.0 四档 (由 validateSpeechRate 守卫).
 * - voiceId: 可选, 多引擎场景下指定 voice.
 */
export interface SpeakPayload {
  /** 待朗读文本, 长度上限 4096. */
  text: string;
  /** BCP 47 语言标签. */
  language: 'de-DE' | 'en-US';
  /** 朗读语速 (4 档枚举). */
  rate: 0.5 | 1.0 | 1.5 | 2.0;
  /** 可选 voice ID, 多引擎场景下指定. */
  voiceId?: string;
}

/**
 * TTS 引擎信息 (对外暴露).
 *
 * 字段与 src/platform/harmonyBridge.ts 的 SpeechEngineInfo TS interface 一一对应.
 * 由 getEngines 返回, 供 Web 端展示引擎选择 UI.
 */
export interface SpeechEngineInfo {
  /** 引擎唯一标识. */
  engineId: string;
  /** 引擎显示名称. */
  engineName: string;
  /** 引擎支持的语言列表 (BCP 47). */
  supportedLanguages: string[];
  /** 引擎是否在线 (true=云端, false=离线). */
  isOnline: boolean;
}

/** 单个活动朗读的 Promise 状态；requestId 同时用于过滤过期引擎回调. */
interface PendingSpeech {
  requestId: string;
  resolve: () => void;
  reject: (error: BusinessError) => void;
}

export class TextToSpeechService {
  private static instance: TextToSpeechService | null = null;

  /** TTS 引擎实例 (懒加载, shutdown 后置 null). */
  private engine: textToSpeech.TextToSpeechEngine | null = null;

  /** 引擎是否已初始化 (避免重复 createEngine). */
  private engineReady: boolean = false;

  /** 当前引擎语言 (API 22: language 在 createEngine 时绑定, 变更需重建引擎). */
  private currentLanguage: string = '';

  /** 引擎创建代次；shutdown 或并发重建会使较早的异步创建结果失效. */
  private engineGeneration: number = 0;

  /** 同语言的并发调用共享一次初始化，避免重复创建和相互淘汰。 */
  private engineInitPromise: Promise<void> | null = null;

  /** engineInitPromise 正在创建的语言。 */
  private initializingLanguage: string = '';

  /** speak 请求 ID 自增计数器 (API 22: SpeakParams.requestId 必填且唯一). */
  private requestCounter: number = 0;

  /** 最后一次 speak 意图；用于取消仍在等待 createEngine 的旧调用. */
  private latestSpeakRequestId: string = NO_ACTIVE_REQUEST;

  /** 全局只允许一个活动朗读；任何替换、停止或销毁都必须结算它. */
  private pendingSpeech: PendingSpeech | null = null;

  private constructor() {}

  /** 单例入口. */
  static getInstance(): TextToSpeechService {
    if (TextToSpeechService.instance === null) {
      TextToSpeechService.instance = new TextToSpeechService();
    }
    return TextToSpeechService.instance;
  }

  /**
   * 异步初始化 TTS 引擎 (懒加载).
   *
   * API 22 的 language 在创建时绑定。同语言的并发调用共享 engineInitPromise；
   * 跨语言调用以 engineGeneration 淘汰旧初始化结果。
   */
  private async createEngine(language: string = 'en-US'): Promise<void> {
    if (this.engineReady && this.engine !== null && this.currentLanguage === language) {
      return;
    }

    const activeInit: Promise<void> | null = this.engineInitPromise;
    if (activeInit !== null && this.initializingLanguage === language) {
      await activeInit;
      return;
    }

    const generation: number = this.engineGeneration + 1;
    this.engineGeneration = generation;
    const initPromise: Promise<void> = this.initializeEngine(language, generation);
    this.engineInitPromise = initPromise;
    this.initializingLanguage = language;

    try {
      await initPromise;
    } finally {
      if (this.engineInitPromise === initPromise) {
        this.engineInitPromise = null;
        this.initializingLanguage = '';
      }
    }
  }

  private async initializeEngine(language: string, generation: number): Promise<void> {
    if (this.engine !== null) {
      // speak 入口已结算旧请求；这里仅停止和销毁旧语言引擎。
      try {
        this.engine.stop();
      } catch (_e) {
        // stop 失败不阻止释放旧引擎。
      }
      try {
        this.engine.shutdown();
      } catch (_e) {
        // 忽略旧引擎 shutdown 异常，继续重建。
      }
      this.engine = null;
      this.engineReady = false;
      this.currentLanguage = '';
    }

    let createdEngine: textToSpeech.TextToSpeechEngine | null = null;
    try {
      // API 22: person=0 默认音色；online=1 表示离线引擎。
      const engineInfo: textToSpeech.CreateEngineParams = {
        language: language,
        person: 0,
        online: 1,
      };
      createdEngine = await textToSpeech.createEngine(engineInfo);

      if (generation !== this.engineGeneration) {
        // shutdown 或更新一代的 createEngine 已经发生，禁止旧结果覆盖当前引擎。
        try {
          createdEngine.shutdown();
        } catch (_e) {
          // 已失效实例仅做尽力释放。
        }
        return;
      }

      // API 22 要求先 setListener 再 speak；稳定监听器按 requestId 分发。
      createdEngine.setListener(this.createListener());
      this.engine = createdEngine;
      this.engineReady = true;
      this.currentLanguage = language;
      hilog.info(DOMAIN, TAG, 'createEngine done: lang=%{public}s', language);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'createEngine failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      if (createdEngine !== null) {
        try {
          createdEngine.shutdown();
        } catch (_e) {
          // 初始化失败实例仅做尽力释放。
        }
      }
      if (generation === this.engineGeneration) {
        this.engine = null;
        this.engineReady = false;
        this.currentLanguage = '';
      }
    }
  }

  /**
   * 命令型异步 speak.
   *
   * Promise 在入口立即创建并登记，因此新 speak/stop/shutdown 即使发生在
   * createEngine 完成前，也能立即结算旧请求。引擎准备和启动在 startSpeech
   * 中异步执行，且只允许仍匹配 pending requestId 的请求调用 engine.speak.
   *
   * @param payload 朗读载荷 (已由 BridgeInputValidator 三段校验通过).
   */
  speak(payload: SpeakPayload): Promise<void> {
    const requestId: string = this.generateRequestId();
    this.latestSpeakRequestId = requestId;
    this.interruptPendingSpeech();

    const speakPromise: Promise<void> = new Promise<void>(
      (resolve: () => void, reject: (error: BusinessError) => void) => {
        const pending: PendingSpeech = {
          requestId: requestId,
          resolve: resolve,
          reject: reject,
        };
        this.pendingSpeech = pending;
      }
    );

    this.startSpeech(requestId, payload);
    return speakPromise;
  }

  /** 等待共享引擎初始化，并仅为仍处于活动状态的 requestId 启动朗读。 */
  private async startSpeech(requestId: string, payload: SpeakPayload): Promise<void> {
    try {
      await this.createEngine(payload.language);

      if (!this.isPendingRequest(requestId)) {
        hilog.info(
          DOMAIN,
          TAG,
          'skip superseded speech after engine init: requestId=%{public}s',
          requestId
        );
        return;
      }

      const engine: textToSpeech.TextToSpeechEngine | null = this.engine;
      if (engine === null) {
        this.rejectRequest(
          requestId,
          ERROR_SPEECH_FAILED,
          'TTS engine is not available'
        );
        return;
      }

      // API 22: SpeakParams 仅含 requestId + extraParams, text 单独传入 speak().
      // rate / voiceId 透传到 extraParams (引擎支持时生效, 不支持时忽略).
      const extraParams: Record<string, Object> = {
        'rate': payload.rate,
      };
      if (payload.voiceId !== undefined && payload.voiceId.length > 0) {
        extraParams['voiceId'] = payload.voiceId;
      }
      const speakParams: textToSpeech.SpeakParams = {
        requestId: requestId,
        extraParams: extraParams,
      };

      // speak 返回 void；后续由 requestId 匹配的 listener 回调结算 Promise。
      engine.speak(payload.text, speakParams);
    } catch (e) {
      const err: Error = e as Error;
      this.rejectRequest(requestId, ERROR_SPEECH_FAILED, err.message);
      hilog.error(
        DOMAIN,
        TAG,
        'startSpeech failed: requestId=%{public}s msg=%{public}s',
        requestId,
        err.message
      );
    }
  }

  /**
   * 立即停止朗读.
   *
   * 无论 engine.stop 是否触发回调或抛错，finally 都会 resolve 当前活动请求；
   * 同时清空 latestSpeakRequestId，取消仍在等待引擎创建的请求。
   */
  stop(): void {
    this.latestSpeakRequestId = NO_ACTIVE_REQUEST;
    try {
      if (this.engine === null) {
        hilog.warn(DOMAIN, TAG, 'stop skipped: engine not available');
        return;
      }
      this.engine.stop();
      hilog.info(DOMAIN, TAG, 'stop dispatched');
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'stop failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    } finally {
      this.resolvePending();
    }
  }

  /**
   * 销毁引擎 + 释放资源.
   *
   * 先 reject 活动 Promise，并递增 engineGeneration 使在途 createEngine 失效；
   * 再停止和销毁引擎。下次 speak / isSupported 会创建新一代引擎。
   */
  shutdown(): void {
    this.latestSpeakRequestId = NO_ACTIVE_REQUEST;
    this.engineGeneration = this.engineGeneration + 1;
    this.engineInitPromise = null;
    this.initializingLanguage = '';
    this.rejectPending(
      ERROR_SERVICE_SHUTDOWN,
      'Speech cancelled because the TTS service is shutting down'
    );
    try {
      if (this.engine !== null) {
        try {
          this.engine.stop();
        } catch (_e) {
          // shutdown 仍会继续释放资源。
        }
        this.engine.shutdown();
        hilog.info(DOMAIN, TAG, 'shutdown done');
      }
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'shutdown failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    } finally {
      this.engine = null;
      this.engineReady = false;
      this.currentLanguage = '';
    }
  }

  /**
   * 查询原生 TTS 引擎是否可用.
   *
   * 已有引擎直接返回 true；若 speak 正在初始化某种语言，则等待该初始化，
   * 不得另行创建默认 en-US 引擎并抢占用户朗读。
   */
  async isSupported(): Promise<boolean> {
    try {
      if (this.engine === null) {
        const activeInit: Promise<void> | null = this.engineInitPromise;
        if (activeInit !== null) {
          await activeInit;

          // activeInit 可能被跨语言 speak 淘汰；若已有替代初始化，继续等待它。
          const replacementInit: Promise<void> | null = this.engineInitPromise;
          if (
            this.engine === null &&
            replacementInit !== null &&
            replacementInit !== activeInit
          ) {
            await replacementInit;
          }
        } else {
          await this.createEngine();
        }
      }
      const supported: boolean = this.engine !== null;
      hilog.info(
        DOMAIN,
        TAG,
        'isSupported -> %{public}s',
        supported ? 'true' : 'false'
      );
      return supported;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'isSupported failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return false;
    }
  }

  /**
   * 列出可用 TTS 语音 (对外仍以引擎信息形态暴露).
   *
   * 防御性 (R-TTS-2): listVoices 需要引擎侧支持且可能因设备/权限抛错,
   * try/catch 兜底返回空数组.
   *
   * @returns 语音映射出的引擎信息数组, 异常或无可用语音时返回 [].
   */
  async getEngines(): Promise<SpeechEngineInfo[]> {
    try {
      // API 22: listEngines / EngineInfo 已移除, 改用 listVoices (since 5.1.1/19)
      // 返回 VoiceInfo[] (language/person/style/gender/description).
      // VoiceInfo 无 engineId/engineName, 做最佳映射保留"列出可用语音"语义.
      const query: textToSpeech.VoiceQuery = {
        requestId: this.generateRequestId(),
        online: 1,
      };
      const voices: textToSpeech.VoiceInfo[] = await textToSpeech.listVoices(query);
      const engines: SpeechEngineInfo[] = [];
      for (let i: number = 0; i < voices.length; i++) {
        const v: textToSpeech.VoiceInfo = voices[i];
        const info: SpeechEngineInfo = {
          engineId: `${v.language}_${v.person}`,
          engineName: v.description.length > 0 ? v.description : `${v.language}-${v.person}`,
          supportedLanguages: [v.language],
          isOnline: false,
        };
        engines.push(info);
      }
      hilog.info(
        DOMAIN,
        TAG,
        'getEngines done: count=%{public}d',
        engines.length
      );
      return engines;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getEngines failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return [];
    }
  }

  /**
   * 创建 API 22 SpeakListener。每个完成类回调都必须匹配当前 requestId，
   * 防止旧引擎的延迟 onStop/onComplete 错误结算新的 speak Promise.
   *
   * setListener 在 createEngine 完成时注册，保证任何 speak 前监听器已就绪。
   */
  private createListener(): textToSpeech.SpeakListener {
    return {
      onStart: (requestId: string, _response: textToSpeech.StartResponse) => {
        if (this.isPendingRequest(requestId)) {
          hilog.info(
            DOMAIN,
            TAG,
            'speak onStart: requestId=%{public}s',
            requestId
          );
        } else {
          hilog.warn(
            DOMAIN,
            TAG,
            'ignore stale onStart: requestId=%{public}s',
            requestId
          );
        }
      },
      onComplete: (requestId: string, _response: textToSpeech.CompleteResponse) => {
        hilog.info(
          DOMAIN,
          TAG,
          'speak onComplete: requestId=%{public}s',
          requestId
        );
        this.resolveRequest(requestId);
      },
      onStop: (requestId: string, _response: textToSpeech.StopResponse) => {
        hilog.info(
          DOMAIN,
          TAG,
          'speak onStop: requestId=%{public}s',
          requestId
        );
        this.resolveRequest(requestId);
      },
      onError: (requestId: string, errorCode: number, errorMessage: string) => {
        hilog.error(
          DOMAIN,
          TAG,
          'speak onError: requestId=%{public}s code=%{public}d msg=%{public}s',
          requestId,
          errorCode,
          errorMessage
        );
        this.rejectRequest(requestId, errorCode, errorMessage);
      },
    };
  }

  /** 新 speak 使用：先 reject 旧请求，再尽力 stop 旧音频。 */
  private interruptPendingSpeech(): void {
    const pending: PendingSpeech | null = this.pendingSpeech;
    if (pending === null) {
      return;
    }

    this.rejectRequest(
      pending.requestId,
      ERROR_SPEECH_SUPERSEDED,
      'Speech request was superseded by a newer request'
    );
    if (this.engine !== null) {
      try {
        this.engine.stop();
      } catch (e) {
        const err: BusinessError = e as BusinessError;
        hilog.warn(
          DOMAIN,
          TAG,
          'stop superseded speech failed: code=%{public}d msg=%{public}s',
          err.code,
          err.message
        );
      }
    }
  }

  /** requestId 匹配时 resolve；过期回调只记录并忽略。 */
  private resolveRequest(requestId: string): void {
    const pending: PendingSpeech | null = this.pendingSpeech;
    if (pending === null || pending.requestId !== requestId) {
      hilog.warn(DOMAIN, TAG, 'ignore stale completion: requestId=%{public}s', requestId);
      return;
    }
    this.pendingSpeech = null;
    if (this.latestSpeakRequestId === requestId) {
      this.latestSpeakRequestId = NO_ACTIVE_REQUEST;
    }
    pending.resolve();
  }

  /** stop 的兜底结算：resolve 当前活动请求。 */
  private resolvePending(): void {
    const pending: PendingSpeech | null = this.pendingSpeech;
    if (pending !== null) {
      this.resolveRequest(pending.requestId);
    }
  }

  /** requestId 匹配时 reject；过期错误不能影响新请求。 */
  private rejectRequest(
    requestId: string,
    errorCode: number,
    errorMessage: string
  ): void {
    const pending: PendingSpeech | null = this.pendingSpeech;
    if (pending === null || pending.requestId !== requestId) {
      return;
    }
    this.pendingSpeech = null;
    if (this.latestSpeakRequestId === requestId) {
      this.latestSpeakRequestId = NO_ACTIVE_REQUEST;
    }
    pending.reject(this.createBusinessError(errorCode, errorMessage));
  }

  /** shutdown / 引擎切换的兜底结算：reject 当前活动请求。 */
  private rejectPending(errorCode: number, errorMessage: string): void {
    const pending: PendingSpeech | null = this.pendingSpeech;
    if (pending !== null) {
      this.rejectRequest(pending.requestId, errorCode, errorMessage);
    }
  }

  private isPendingRequest(requestId: string): boolean {
    return this.pendingSpeech !== null && this.pendingSpeech.requestId === requestId;
  }

  private createBusinessError(errorCode: number, errorMessage: string): BusinessError {
    const error: BusinessError = {
      code: errorCode,
      message: errorMessage,
      data: undefined,
    } as BusinessError;
    return error;
  }

  /** 生成唯一 requestId (API 22: SpeakParams.requestId / VoiceQuery.requestId 必填且唯一). */
  private generateRequestId(): string {
    this.requestCounter = this.requestCounter + 1;
    return `tts_${Date.now()}_${this.requestCounter}`;
  }
}
