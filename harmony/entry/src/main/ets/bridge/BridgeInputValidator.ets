/**
 * BridgeInputValidator (v0.2.0-harmony)
 *
 * JSBridge 输入校验纯函数模块 (论文驱动 arXiv:1410.7756 — HTML5 hybrid app 安全加固).
 *
 * 设计原则:
 * - 所有方法为 static 纯函数, 0 副作用, 0 I/O (不调用 hilog / 不访问 preferences / 不抛错).
 * - 校验失败由调用方 (HarmonyBridge) 决定如何处理 (hilog.warn + return).
 * - 严格白名单 / 正则 / 范围校验, 拒绝任何超出预期的输入, 防止 JSBridge 代码注入攻击.
 *
 * 与 src/platform/bridgeInputValidator.ts (TypeScript mirror) 签名一一对应,
 * 后者为 vitest 测试目标 (vitest 无法运行 .ets 文件).
 *
 * ArkTS 约束: 0 any / 0 对象字面量类型 / 0 var (沿用 v0.1.0-harmony 约束).
 */
import type { ReminderPayload } from './types';
import type { MemoryCardRecord } from '../data/MemoryCardSchema';

/** preferences 键白名单 (5 个). */
const PREFERENCES_KEY_WHITELIST: string[] = [
  'app_language',
  'notifications_config',
  'theme',
  'review_direction',
  'streak_data',
];

/** intensity 合法枚举 (3 个). */
const INTENSITY_WHITELIST: string[] = ['light', 'medium', 'heavy'];

/** launch query 合法格式正则 (仅 action=startReview 或 action=openCard&cardId=<safe>). */
const LAUNCH_QUERY_REGEX: RegExp =
  /^(action=startReview|action=openCard&cardId=[a-zA-Z0-9_-]+)$/;

/** cardId 长度上限. */
const CARD_ID_MAX_LENGTH: number = 128;

/** preferences value 长度上限. */
const PREFERENCES_VALUE_MAX_LENGTH: number = 8192;

/** objectiveDifficulty 范围 (DifficultyLevel 1-5). */
const OBJECTIVE_DIFFICULTY_MIN: number = 1;
const OBJECTIVE_DIFFICULTY_MAX: number = 5;

/** TTS 文本长度上限. */
const SPEECH_TEXT_MAX_LENGTH: number = 4096;

/** TTS rate 合法枚举 (4 档). */
const SPEECH_RATE_WHITELIST: number[] = [0.5, 1.0, 1.5, 2.0];

/** TTS language 合法枚举. */
const SPEECH_LANGUAGE_WHITELIST: string[] = ['de-DE', 'en-US'];

/** reminderAgent 定时提醒: 最大调度提前量 (1 年), 防止异常远期时间堆积. */
const REMINDER_MAX_LEAD_MS: number = 366 * 24 * 60 * 60 * 1000;

export class BridgeInputValidator {
  /**
   * 校验触觉反馈强度.
   * @param intensity 仅接受 'light' | 'medium' | 'heavy' (大小写敏感).
   */
  static validateIntensity(intensity: string): boolean {
    if (typeof intensity !== 'string') {
      return false;
    }
    return INTENSITY_WHITELIST.includes(intensity);
  }

  /**
   * 校验提醒载荷.
   * @param payload dueAt > 0 且 cardId 非空且长度 <= 128.
   */
  static validateReminderPayload(payload: ReminderPayload): boolean {
    if (payload === null || payload === undefined) {
      return false;
    }
    if (typeof payload.dueAt !== 'number' || payload.dueAt <= 0) {
      return false;
    }
    if (typeof payload.cardId !== 'string' || payload.cardId.length === 0) {
      return false;
    }
    if (payload.cardId.length > CARD_ID_MAX_LENGTH) {
      return false;
    }
    return true;
  }

  /**
   * 校验 preferences 键 (白名单 5 个).
   */
  static validatePreferencesKey(key: string): boolean {
    if (typeof key !== 'string') {
      return false;
    }
    return PREFERENCES_KEY_WHITELIST.includes(key);
  }

  /**
   * 校验 preferences 值长度 (<= 8192).
   */
  static validatePreferencesValue(value: string): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    return value.length <= PREFERENCES_VALUE_MAX_LENGTH;
  }

  /**
   * 校验鸿蒙启动跳转 query 字符串.
   * 仅允许 'action=startReview' 或 'action=openCard&cardId=<safe-chars>'.
   */
  static validateLaunchQuery(query: string): boolean {
    if (typeof query !== 'string') {
      return false;
    }
    return LAUNCH_QUERY_REGEX.test(query);
  }

  /**
   * 校验记忆卡片记录 (16 字段类型 + 范围校验).
   * - id 非空
   * - objectiveDifficulty 1-5
   * - language 'en' | 'de' | ''
   */
  static validateCardRecord(card: MemoryCardRecord): boolean {
    if (card === null || card === undefined) {
      return false;
    }
    // 16 字段类型校验
    if (typeof card.id !== 'string') {
      return false;
    }
    if (typeof card.lexemeGroupId !== 'string') {
      return false;
    }
    if (typeof card.lemma !== 'string') {
      return false;
    }
    if (typeof card.objectiveDifficulty !== 'number') {
      return false;
    }
    if (typeof card.language !== 'string') {
      return false;
    }
    if (typeof card.firstLearnedAt !== 'number') {
      return false;
    }
    if (typeof card.lastReviewAt !== 'number') {
      return false;
    }
    if (typeof card.due !== 'number') {
      return false;
    }
    if (typeof card.stability !== 'number') {
      return false;
    }
    if (typeof card.difficulty !== 'number') {
      return false;
    }
    if (typeof card.elapsedDays !== 'number') {
      return false;
    }
    if (typeof card.scheduledDays !== 'number') {
      return false;
    }
    if (typeof card.reps !== 'number') {
      return false;
    }
    if (typeof card.lapses !== 'number') {
      return false;
    }
    if (typeof card.status !== 'string') {
      return false;
    }
    if (typeof card.learningSteps !== 'number') {
      return false;
    }
    // 范围校验
    if (card.id.length === 0) {
      return false;
    }
    if (
      card.objectiveDifficulty < OBJECTIVE_DIFFICULTY_MIN ||
      card.objectiveDifficulty > OBJECTIVE_DIFFICULTY_MAX
    ) {
      return false;
    }
    if (card.language !== 'en' && card.language !== 'de' && card.language !== '') {
      return false;
    }
    return true;
  }

  /**
   * 校验卡片 ID (非空且长度 <= 128).
   */
  static validateCardId(cardId: string): boolean {
    if (typeof cardId !== 'string') {
      return false;
    }
    if (cardId.length === 0) {
      return false;
    }
    return cardId.length <= CARD_ID_MAX_LENGTH;
  }

  /**
   * 校验 TTS 文本.
   *
   * 规则: typeof string && length > 0 && length <= 4096.
   *
   * @param text 待朗读文本.
   */
  static validateSpeechText(text: string): boolean {
    if (typeof text !== 'string') {
      return false;
    }
    if (text.length === 0) {
      return false;
    }
    return text.length <= SPEECH_TEXT_MAX_LENGTH;
  }

  /**
   * 校验 TTS 语速.
   *
   * 规则: rate ∈ {0.5, 1.0, 1.5, 2.0} (4 档枚举).
   *
   * @param rate 朗读语速.
   */
  static validateSpeechRate(rate: number): boolean {
    if (typeof rate !== 'number') {
      return false;
    }
    return SPEECH_RATE_WHITELIST.includes(rate);
  }

  /**
   * 校验 TTS 语言.
   *
   * 规则: language ∈ {'de-DE', 'en-US'}.
   *
   * @param language BCP 47 语言标签.
   */
  static validateSpeechLanguage(language: string): boolean {
    if (typeof language !== 'string') {
      return false;
    }
    return SPEECH_LANGUAGE_WHITELIST.includes(language);
  }

  /**
   * 校验 reminderAgent 定时提醒触发时间 (v0.5.0-harmony Stage 3).
   *
   * 规则: 必须为未来时间 (triggerAt > nowMs) 且提前量 <= 1 年.
   * 过去时间被拒绝 — 防止"未来提醒"被误当作立即通知发布 (安全契约).
   *
   * @param triggerAt 期望触发时间戳 (ms, epoch).
   * @param nowMs 当前时间戳 (ms, epoch); 传入 -1 时内部取 Date.now().
   */
  static validateReminderTime(triggerAt: number, nowMs: number): boolean {
    if (typeof triggerAt !== 'number' || !isFinite(triggerAt)) {
      return false;
    }
    const now: number = nowMs >= 0 ? nowMs : Date.now();
    if (triggerAt <= now) {
      return false;
    }
    return triggerAt - now <= REMINDER_MAX_LEAD_MS;
  }

  /**
   * 校验 reminderId (非空且长度 <= 128, 字符集为安全标识符).
   *
   * @param reminderId Web 侧传入的提醒标识 (如 review-daily).
   */
  static validateReminderId(reminderId: string): boolean {
    if (typeof reminderId !== 'string') {
      return false;
    }
    if (reminderId.length === 0 || reminderId.length > CARD_ID_MAX_LENGTH) {
      return false;
    }
    return /^[a-zA-Z0-9._-]+$/.test(reminderId);
  }
}
