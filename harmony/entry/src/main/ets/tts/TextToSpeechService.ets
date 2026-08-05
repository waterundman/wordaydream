/**
 * TextToSpeechService (v0.3.0-harmony Stage 1)
 *
 * 封装 @ohos.textToSpeech Kit, 提供鸿蒙原生 TTS 朗读能力.
 *
 * 设计要点:
 * - 单例模式 (getInstance), 全局唯一, 由 HarmonyBridge.speak 调用.
 * - 生命周期分离: speakListener (start/complete/error) 与 stopListener (stop)
 *   独立注入, 避免回调混淆.
 * - 防御性写法 (R-TTS-2): @ohos.textToSpeech Kit 在 API 18 的 speak 方法签名
 *   不确定, createEngine / speak / listEngines 调用均包裹 try/catch,
 *   异常返回安全默认值 (false / void / []) 不抛错, 保证 ArkTS 侧异常
 *   不传播到 Web 端 JSBridge.
 * - createEngine 懒加载, 首次 speak / isSupported 调用时初始化; shutdown 后
 *   engine 置 null, 下次调用重新创建.
 *
 * ArkTS 适配: 无 any / 无对象字面量类型 / 无 var / 用 interface 而非 type alias.
 * 异步用 async/await, 不嵌套 Promise 构造函数.
 */
import { textToSpeech } from '@kit.CoreSpeechKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';

const DOMAIN: number = 0x0001;
const TAG: string = 'TextToSpeechService';

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

/**
 * TTS 朗读监听器 (speak 调用注入).
 *
 * onStart: 朗读开始 (引擎准备就绪).
 * onComplete: 朗读完成 (正常结束).
 * onError: 朗读异常 (引擎错误 / 超时).
 *
 * 防御性: 所有回调 try/catch 兜底, 异常仅 hilog.warn, 不抛到调用方.
 */
interface SpeakListener {
  onStart: () => void;
  onComplete: () => void;
  onError: (errorCode: number, errorMessage: string) => void;
}

/**
 * TTS 停止监听器 (stop 调用注入, 与 SpeakListener 分离避免回调混淆).
 *
 * onStop: 朗读被 stop() 中断 (用户主动停止).
 */
interface StopListener {
  onStop: () => void;
}

export class TextToSpeechService {
  private static instance: TextToSpeechService | null = null;

  /** TTS 引擎实例 (懒加载, shutdown 后置 null). */
  private engine: textToSpeech.TextToSpeechEngine | null = null;

  /** 引擎是否已初始化 (避免重复 createEngine). */
  private engineReady: boolean = false;

  /** 当前引擎语言 (API 22: language 在 createEngine 时绑定, 变更需重建引擎). */
  private currentLanguage: string = '';

  /** speak 请求 ID 自增计数器 (API 22: SpeakParams.requestId 必填且唯一). */
  private requestCounter: number = 0;

  /** 当前 speak Promise 的 resolve / reject (供 onError 回调透传). */
  private currentResolve: (() => void) | null = null;
  private currentReject: ((e: BusinessError) => void) | null = null;

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
   * 防御性 (R-TTS-2): textToSpeech.createEngine 在 API 18 的方法签名不确定,
   * 调用包裹 try/catch, 异常 hilog.error + 置 engineReady=false 不抛错.
   *
   * 幂等: 若 engineReady=true 直接返回, 避免重复创建引擎.
   */
  async createEngine(language: string = 'en-US'): Promise<void> {
    // API 22: CreateEngineParams 无 engineId, language 在创建时绑定.
    // 语言变更时需释放旧引擎并重建, 否则复用现有引擎.
    if (this.engineReady && this.engine !== null && this.currentLanguage === language) {
      return;
    }
    if (this.engine !== null) {
      try {
        this.engine.shutdown();
      } catch (e) {
        // 忽略旧引擎 shutdown 异常, 继续重建.
      }
      this.engine = null;
      this.engineReady = false;
      this.currentLanguage = '';
    }
    try {
      // createEngine 接受 {language, person, online} 配置 (person=0 默认音色, online=1 离线).
      const engineInfo: textToSpeech.CreateEngineParams = {
        language: language,
        person: 0,
        online: 1,
      };
      this.engine = await textToSpeech.createEngine(engineInfo);
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
      this.engine = null;
      this.engineReady = false;
      this.currentLanguage = '';
    }
  }

  /**
   * 命令型异步 speak.
   *
   * 流程:
   * 1. 调用 createEngine 确保引擎就绪 (懒加载).
   * 2. 注入 speakListener (onStart / onComplete / onError) + stopListener (onStop).
   * 3. 调用 engine.speak (R-TTS-2: 签名不确定, try/catch 兜底).
   * 4. 返回 Promise, 由 onComplete / onError / onStop resolve / reject.
   *
   * 防御性: 引擎未就绪 / speak 抛错 / 回调异常均 try/catch, 不抛到 HarmonyBridge.
   *
   * @param payload 朗读载荷 (已由 BridgeInputValidator 三段校验通过).
   */
  async speak(payload: SpeakPayload): Promise<void> {
    try {
      await this.createEngine(payload.language);
      const engine: textToSpeech.TextToSpeechEngine | null = this.engine;
      if (engine === null) {
        hilog.warn(DOMAIN, TAG, 'speak skipped: engine not available');
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
        requestId: this.generateRequestId(),
        extraParams: extraParams,
      };

      // 注入 speakListener (与 stopListener 分离).
      const speakListener: SpeakListener = {
        onStart: () => {
          hilog.info(DOMAIN, TAG, 'speak onStart');
        },
        onComplete: () => {
          hilog.info(DOMAIN, TAG, 'speak onComplete');
          this.resolveCurrent();
        },
        onError: (errorCode: number, errorMessage: string) => {
          hilog.error(
            DOMAIN,
            TAG,
            'speak onError: code=%{public}d msg=%{public}s',
            errorCode,
            errorMessage
          );
          this.rejectCurrent(errorCode, errorMessage);
        },
      };
      const stopListener: StopListener = {
        onStop: () => {
          hilog.info(DOMAIN, TAG, 'speak onStop (user stopped)');
          this.resolveCurrent();
        },
      };

      // API 22: setListener 必须在 speak 之前调用, 否则回调无法接收.
      engine.setListener(this.adaptListener(speakListener, stopListener));

      // speak 返回 void, onComplete / onError / onStop 回调触发后 resolve / reject.
      const speakPromise: Promise<void> = new Promise<void>(
        (resolve: () => void, reject: (e: BusinessError) => void) => {
          this.currentResolve = resolve;
          this.currentReject = reject;
          try {
            // API 22: speak(text, speakParams) 返回 void, 完成由 listener 回调驱动.
            engine.speak(payload.text, speakParams);
          } catch (e2) {
            const err: BusinessError = e2 as BusinessError;
            this.rejectCurrent(err.code, err.message);
          }
        }
      );

      await speakPromise;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'speak failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      // 兜底: 不抛到 HarmonyBridge, 由 HarmonyBridge 的 try/catch 再次兜底.
      this.clearCallbacks();
    }
  }

  /**
   * 立即停止朗读.
   *
   * 调用 engine.stop (同步触发 stopListener.onStop 回调, 进而 resolve speak Promise).
   * 异常 try/catch 兜底 (引擎未就绪 / stop 抛错).
   */
  stop(): void {
    try {
      if (this.engine === null) {
        hilog.warn(DOMAIN, TAG, 'stop skipped: engine not available');
        this.clearCallbacks();
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
      this.clearCallbacks();
    }
  }

  /**
   * 销毁引擎 + 释放资源.
   *
   * 调用 engine.shutdown 释放底层资源, 置 engine=null / engineReady=false.
   * 下次 speak / isSupported 调用时重新 createEngine.
   */
  shutdown(): void {
    try {
      if (this.engine !== null) {
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
      this.clearCallbacks();
    }
  }

  /**
   * 查询原生 TTS 引擎是否可用.
   *
   * 流程: createEngine → engine !== null.
   * 异常返回 false (不抛异常).
   */
  async isSupported(): Promise<boolean> {
    try {
      await this.createEngine();
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
   * 列出可用 TTS 引擎.
   *
   * 防御性 (R-TTS-2): textToSpeech.listEngines 在 API 18 可能不存在,
   * try/catch 兜底返回空数组.
   *
   * @returns 引擎信息数组, 异常或无引擎时返回 [].
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
   * 将内部 SpeakListener + StopListener 适配为 @ohos.textToSpeech 的 SpeakListener.
   *
   * 防御性: 每个回调 try/catch, 异常 hilog.warn 不抛错 (避免引擎回调抛出
   * 影响 ArkTS runtime).
   */
  private adaptListener(
    speakListener: SpeakListener,
    stopListener: StopListener
  ): textToSpeech.SpeakListener {
    return {
      onStart: (requestId: string, response: textToSpeech.StartResponse) => {
        try {
          speakListener.onStart();
        } catch (e) {
          const err: BusinessError = e as BusinessError;
          hilog.warn(
            DOMAIN,
            TAG,
            'onStart callback error: code=%{public}d msg=%{public}s',
            err.code,
            err.message
          );
        }
      },
      onComplete: (requestId: string, response: textToSpeech.CompleteResponse) => {
        try {
          speakListener.onComplete();
        } catch (e) {
          const err: BusinessError = e as BusinessError;
          hilog.warn(
            DOMAIN,
            TAG,
            'onComplete callback error: code=%{public}d msg=%{public}s',
            err.code,
            err.message
          );
        }
      },
      onStop: (requestId: string, response: textToSpeech.StopResponse) => {
        try {
          stopListener.onStop();
        } catch (e) {
          const err: BusinessError = e as BusinessError;
          hilog.warn(
            DOMAIN,
            TAG,
            'onStop callback error: code=%{public}d msg=%{public}s',
            err.code,
            err.message
          );
        }
      },
      onError: (requestId: string, errorCode: number, errorMessage: string) => {
        try {
          speakListener.onError(errorCode, errorMessage);
        } catch (e) {
          const err: BusinessError = e as BusinessError;
          hilog.warn(
            DOMAIN,
            TAG,
            'onError callback error: code=%{public}d msg=%{public}s',
            err.code,
            err.message
          );
        }
      },
    };
  }

  /** resolve 当前 speak Promise (若存在), 并清理回调. */
  private resolveCurrent(): void {
    if (this.currentResolve !== null) {
      const resolve: () => void = this.currentResolve;
      this.clearCallbacks();
      resolve();
    }
  }

  /** reject 当前 speak Promise (若存在), 并清理回调. */
  private rejectCurrent(errorCode: number, errorMessage: string): void {
    if (this.currentReject !== null) {
      const reject: (e: BusinessError) => void = this.currentReject;
      this.clearCallbacks();
      const err: BusinessError = {
        code: errorCode,
        message: errorMessage,
        data: undefined,
      } as BusinessError;
      reject(err);
    }
  }

  /** 清理 speak Promise 的 resolve / reject 引用. */
  private clearCallbacks(): void {
    this.currentResolve = null;
    this.currentReject = null;
  }

  /** 生成唯一 requestId (API 22: SpeakParams.requestId / VoiceQuery.requestId 必填且唯一). */
  private generateRequestId(): string {
    this.requestCounter = this.requestCounter + 1;
    return `tts_${Date.now()}_${this.requestCounter}`;
  }
}
