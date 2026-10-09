/**
 * SpeechBridgeDelegate (v1.6.3 S1 — B1 上帝文件拆分)
 *
 * TTS 域委托: Web → 鸿蒙 textToSpeech 朗读控制.
 * 由 HarmonyBridge facade 持有并转发; 桥接契约面 (方法名/签名) 不变.
 *
 * 无 context: TextToSpeechService 为无 context 单例, 委托不参与 refreshContext.
 * 返回约定 (M8): speak '' = 已派发, 非空 = 拒绝/失败原因; 返回 string 而非对象,
 * 与 v1.6.0 D1 的 API 22 基本类型跨桥契约一致.
 * Contract: 所有方法 try/catch 兜底, 异常返回原因串 / false / '[]' 不抛错.
 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { BridgeInputValidator } from '../BridgeInputValidator';
import { TextToSpeechService } from '../../tts/TextToSpeechService';
import type {
  SpeakPayload,
  SpeechEngineInfo,
} from '../../tts/TextToSpeechService';

const DOMAIN: number = 0x0001;
const TAG: string = 'HarmonyBridge';

export class SpeechBridgeDelegate {
  /**
   * 朗读文本 (命令型异步).
   *
   * 流程:
   * 1. 三段校验 (validateSpeechText / validateSpeechLanguage / validateSpeechRate),
   *    失败 hilog.warn + 返回原因字符串 (不抛到 Web).
   * 2. 调用 TextToSpeechService.getInstance().speak(payload).
   * 3. try/catch 兜底, 异常 hilog.warn + 返回原因字符串.
   *
   * @param payload 朗读载荷 (text / language / rate / voiceId?).
   */
  async speak(payload: SpeakPayload): Promise<string> {
    try {
      if (payload === null || payload === undefined) {
        hilog.warn(DOMAIN, TAG, 'speak rejected: null payload');
        return 'null payload';
      }
      if (!BridgeInputValidator.validateSpeechText(payload.text)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'speak rejected: invalid text (len=%{public}d)',
          typeof payload.text === 'string' ? payload.text.length : -1
        );
        return 'invalid text';
      }
      if (!BridgeInputValidator.validateSpeechLanguage(payload.language)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'speak rejected: invalid language=%{public}s',
          payload.language
        );
        return 'invalid language';
      }
      if (!BridgeInputValidator.validateSpeechRate(payload.rate)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'speak rejected: invalid rate=%{public}f',
          payload.rate
        );
        return 'invalid rate';
      }
      await TextToSpeechService.getInstance().speak(payload);
      hilog.info(
        DOMAIN,
        TAG,
        'speak dispatched: textLen=%{public}d lang=%{public}s rate=%{public}f',
        payload.text.length,
        payload.language,
        payload.rate
      );
      return '';
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'speak failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return err.message;
    }
  }

  /**
   * 立即停止朗读.
   *
   * 同步调用 TextToSpeechService.getInstance().stop().
   * try/catch 兜底, 异常 hilog.warn + return (fire-and-forget).
   */
  stopSpeech(): void {
    try {
      TextToSpeechService.getInstance().stop();
      hilog.info(DOMAIN, TAG, 'stopSpeech dispatched');
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'stopSpeech failed (fire-and-forget fallback): code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 查询原生 TTS 引擎是否可用.
   *
   * 调用 TextToSpeechService.getInstance().isSupported().
   * try/catch 兜底, 异常 return false (不抛到 Web).
   */
  async isSpeechSupported(): Promise<boolean> {
    try {
      const supported: boolean =
        await TextToSpeechService.getInstance().isSupported();
      hilog.info(
        DOMAIN,
        TAG,
        'isSpeechSupported -> %{public}s',
        supported ? 'true' : 'false'
      );
      return supported;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'isSpeechSupported failed (fallback false): code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return false;
    }
  }

  /**
   * 列出可用 TTS 引擎.
   *
   * 调用 TextToSpeechService.getInstance().getEngines().
   * 返回 SpeechEngineInfo[] 的 JSON 字符串 (v1.6.0 D1 契约), 异常返回 '[]'.
   */
  async getSpeechEngines(): Promise<string> {
    try {
      const engines: SpeechEngineInfo[] =
        await TextToSpeechService.getInstance().getEngines();
      hilog.info(
        DOMAIN,
        TAG,
        'getSpeechEngines done: count=%{public}d',
        engines.length
      );
      return JSON.stringify(engines);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'getSpeechEngines failed (fallback []): code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return '[]';
    }
  }
}