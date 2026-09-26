/**
 * HarmonyBridge TS interface (v0.1.0-harmony Stage 2)
 *
 * 声明 ArkTS (Index.ets 的 registerJavaScriptProxy) 注入到
 * window.harmonyBridge 的 API 签名. Web 端 window.harmonyBridge === undefined
 * 时所有调用静默跳过 (由 detectPlatform.getNativeBridge() 返回 null 守卫).
 *
 * 方法集合与 harmony/entry/src/main/ets/bridge/BridgeMethodRegistry.ets 的
 * BRIDGE_SYNC_METHODS / BRIDGE_ASYNC_METHODS 对齐 (bridgeRegistry.test.ts 双向守护);
 * 原生侧仍保留但 Web 侧无调用方的方法 (getDueCardsCount /
 * getRecentlyReviewedCards / getTodayReviewStats 服务卡片与推送自用) 不在此声明.
 */

/** 提醒任务载荷, 由 registerReminder 透传给 notificationAgent. */
export interface ReminderPayload {
  /** 触发时间戳 (ms, epoch). */
  dueAt: number;
  /** 关联的记忆卡片 ID. */
  cardId: string;
}

/**
 * Stage 3: 鸿蒙 relationalStore 卡片记录的 Web 端镜像接口 (16 字段).
 *
 * 重复声明为 re-export, 以便业务代码从 harmonyBridge.ts 单一入口 import
 * (bridgeInputValidator.ts 内同名接口定义用于校验函数签名).
 *
 * 字段与 ArkTS MemoryCardRecord (harmony/entry/.../MemoryCardSchema.ets) 严格对齐:
 * - objectiveDifficulty: number (1-5), 对应 Web DifficultyLevel 数值联合类型
 * - language: string ('en' | 'de' | ''), '' 表示 undefined (RDB 默认空字符串)
 * - status: string, 对应 Web MemoryCard['status'] 联合类型
 *
 * JSBridge 序列化无字段丢失 (16 字段全为 JSON 安全的 string/number 类型).
 */
export interface MemoryCardRecordBridge {
  id: string;
  lexemeGroupId: string;
  lemma: string;
  objectiveDifficulty: number;  // 1-5
  language: string;  // 'en' | 'de' | ''
  firstLearnedAt: number;
  lastReviewAt: number;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  status: string;
  learningSteps: number;
}

/**
 * Stage 1 v0.3.0-harmony: TTS 朗读载荷.
 *
 * 字段与 ArkTS SpeakPayload (harmony/entry/.../tts/TextToSpeechService.ets) 一一对应.
 * 由 BridgeInputValidator.validateSpeechText / validateSpeechLanguage / validateSpeechRate 守卫.
 *
 * - text: 必填, 长度 1-4096.
 * - language: BCP 47 枚举, de-DE (德语) / en-US (英语).
 * - rate: 4 档枚举 0.5 / 1.0 / 1.5 / 2.0, 直接映射到 utterance.rate.
 * - voiceId: 可选, 多引擎场景下指定 voice; 省略时由 selectVoiceByLang 自动选择.
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
 * Stage 1 v0.3.0-harmony: TTS 引擎信息.
 *
 * 字段与 ArkTS SpeechEngineInfo (harmony/entry/.../tts/TextToSpeechService.ets) 一一对应.
 * HarmonyBridge.getSpeechEngines 返回其 JSON 字符串形态 (API 22 跨桥契约),
 * 供 Web 端解析后展示引擎选择 UI.
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
 * Stage 2 (v0.5.0-harmony): notifyReviewCompleted 返回结果.
 *
 * 字段与 ArkTS NotifyReviewCompletedResult (harmony/entry/.../bridge/types.ets) 对应.
 * - ok: 是否成功触发刷新 (或静默降级).
 * - noop: 非鸿蒙 / 无桥环境的安全 no-op 标记 (Web 端返回 {ok:true, noop:true}).
 * - reason: 失败原因 (ok=false 时携带).
 */
export interface NotifyReviewCompletedResult {
  /** 是否成功 (或已安全 no-op). */
  ok: boolean;
  /** 是否为非鸿蒙 / 无桥环境的安全 no-op (不触发原生刷新). */
  noop?: boolean;
  /** 失败原因 (ok=false 时携带). */
  reason?: string;
}

/**
 * Stage 3 (v0.5.0-harmony): 通知权限请求结果.
 *
 * 字段与 ArkTS NotificationPermissionResult (bridge/types.ets) 对应:
 * - state: granted / denied / error 三态.
 * - noop: 非鸿蒙 / 无桥环境的安全 no-op 标记 (Web 端返回 granted + noop).
 * - reason: denied/error 时的补充说明.
 */
export interface NotificationPermissionResult {
  state: 'granted' | 'denied' | 'error';
  noop?: boolean;
  reason?: string;
}

/**
 * Stage 3 (v0.5.0-harmony): reminderAgent 定时提醒调度结果.
 *
 * 字段与 ArkTS ScheduleReminderResult (bridge/types.ets) 对应. 安全降级契约:
 * 无桥 no-op 返回 {skipped:true, noop:true}; 权益不可用原生返回
 * {skipped:true, reason}, 绝不真实发布.
 */
export interface ScheduleReminderResult {
  skipped: boolean;
  noop?: boolean;
  reason?: string;
  systemReminderId?: number;
}

/** Stage 3 (v0.5.0-harmony): 取消定时提醒结果 (幂等, 不存在视为成功). */
export interface CancelReminderResult {
  ok: boolean;
  noop?: boolean;
  reason?: string;
}

/**
 * ArkTS 注入的原生 bridge.
 * 方法签名遵循 BridgeMethodRegistry.ets 的 BRIDGE_SYNC/ASYNC_METHODS 列表.
 *
 * v1.6.0 D1 实机契约 (API 22): async JSProxy 复杂返回值 (数组/对象) 无法跨桥
 * (Web 端 resolve 得到 number), 列表型/结构型返回统一为 JSON 字符串.
 */
export interface HarmonyBridge {
  /** 注册本地提醒 (notificationAgent / reminderAgent). */
  registerReminder(payload: ReminderPayload): Promise<void>;
  /** 读取 preferences 键值 (返回 null 表示键不存在). */
  readPreferences(key: string): Promise<string | null>;
  /** 写入 preferences 键值. */
  writePreferences(key: string, value: string): Promise<void>;
  /** 触发触觉反馈 (线性马达振动). */
  triggerHapticFeedback(intensity: 'light' | 'medium' | 'heavy'): void;
  /** 通知原生侧当前页面已安装启动请求处理器. */
  notifyWebReady(): void;
  /** 通知原生侧 React 已提交当前页面内容，可撤下原生加载层. */
  notifyWebContentReady(): void;
  /**
   * Stage 3: Web → 鸿蒙 relationalStore 镜像 (upsert).
   *
   * 由 useMemoryStore.rateCard / addCardFromToken fire-and-forget 调用,
   * ArkTS 侧 INSERT OR REPLACE 按 id 主键冲突替换.
   * 异常由 .catch silent skip, 不阻塞 Web 主流程.
   */
  upsertCard(card: MemoryCardRecordBridge): Promise<void>;
  /**
   * Stage 3: Web → 鸿蒙 relationalStore 镜像 (delete).
   *
   * 参数是 Web Map 的 lexemeGroupId，不是 RDB 主键 id.
   */
  deleteCard(lexemeGroupId: string): Promise<void>;
  /**
   * Stage 3: 鸿蒙 → Web 卡片恢复 (R-1 闭环核心).
   *
   * 由 useMemoryStore.onRehydrateStorage 在 localStorage 为空时调用恢复.
   * 返回顺序: due ASC (MemoryCardStore.getAllCards SQL ORDER BY).
   *
   * v1.6.0 D1 实机契约 (API 22): async JSProxy 复杂返回值 (数组/对象) 无法
   * 跨桥 (Web 端 resolve 得到 number), 原生侧序列化为 JSON 字符串传输;
   * Web 侧经 parseBridgeRecords 解析 (useMemoryStore.ts), 兼容旧数组形态.
   * getRecentlyReviewedCards / getTodayReviewStats / getSpeechEngines 同契约,
   * 前三者 Web 侧当前无调用方, 故未在 interface 暴露.
   */
  getAllCards(): Promise<string>;
  /**
   * Stage 1 v0.3.0-harmony: 朗读文本 (命令型异步).
   *
   * 由 ReadingSessionPage.handleTogglePlay 调用, 走鸿蒙 @ohos.textToSpeech 原生路径.
   * ArkTS 侧先经 BridgeInputValidator 三段校验 (text/language/rate), 失败 hilog.warn;
   * 异常 try/catch 兜底不抛到 Web (M8 契约纠偏).
   *
   * @returns '' = 已派发; 非空 = 拒绝/失败原因字符串.
   */
  speak(payload: SpeakPayload): Promise<string>;
  /**
   * Stage 1 v0.3.0-harmony: 立即停止朗读.
   *
   * 同步调用 TextToSpeechService.getInstance().stop(). 异常 try/catch 兜底.
   */
  stopSpeech(): void;
  /**
   * Stage 1 v0.3.0-harmony: 查询原生 TTS 引擎是否可用.
   *
   * 调用 TextToSpeechService.getInstance().isSupported(). 异常返回 false (不抛异常).
   */
  isSpeechSupported(): Promise<boolean>;
  /**
   * Stage 1 v0.3.0-harmony: 列出可用 TTS 引擎.
   *
   * 调用 TextToSpeechService.getInstance().getEngines().
   * 返回 SpeechEngineInfo[] 的 JSON 字符串 (v1.6.0 D1 API 22 契约),
   * 异常返回 '[]' (不抛异常).
   */
  getSpeechEngines(): Promise<string>;
  /**
   * Stage 2 (v0.5.0-harmony): 复习完成后主动刷新所有已持久化的服务卡片.
   *
   * 由 useReviewSessionStore.completeReview 完成路径 fire-and-forget 调用.
   * 可选: 非鸿蒙 / 旧版原生桥可能未注入, Web 侧以 no-op 安全降级.
   */
  notifyReviewCompleted?(): Promise<NotifyReviewCompletedResult>;
  /**
   * Stage 3 (v0.5.0-harmony): 请求通知权限 (三态 granted / denied / error).
   *
   * 由设置面板通知开关首次开启时调用. 可选: 旧版原生桥可能未注入.
   */
  requestNotificationPermission?(): Promise<NotificationPermissionResult>;
  /**
   * Stage 3 (v0.5.0-harmony): 调度 reminderAgent 定时提醒.
   *
   * reminderId 为 Web 侧标识 (安全标识符字符集); triggerAt 必须为未来时间.
   * 权益不可用时原生返回 {skipped:true, reason} (安全降级契约).
   */
  scheduleReviewReminder?(
    reminderId: string,
    triggerAt: number
  ): Promise<ScheduleReminderResult>;
  /**
   * Stage 3 (v0.5.0-harmony): 取消 reminderAgent 定时提醒 (幂等).
   */
  cancelReviewReminder?(reminderId: string): Promise<CancelReminderResult>;
}

/**
 * 全局 Window 类型扩展: 声明 ArkTS 注入的 harmonyBridge 以及
 * Web 端消费的 handleHarmonyLaunch 回调.
 *
 * Web 端 window.harmonyBridge === undefined; 鸿蒙端由 ArkTS 注入实例.
 * window.handleHarmonyLaunch 由 Web 端在初始化时挂载 (供 ArkTS 通过
 * controller.runJavaScript 反向调用, 派发卡片跳转 query).
 *
 * 与 vite-env.d.ts 的 ambient `interface Window` 声明合并,
 * 替代业务代码中 as unknown as 断言访问.
 */
declare global {
  interface Window {
    harmonyBridge?: HarmonyBridge;
    /**
     * Stage 5: Web 端挂载的卡片跳转派发回调.
     *
     * 由 ArkTS 侧 HarmonyBridge.handleHarmonyLaunch 通过
     * controller.runJavaScript 反向调用. Web 端实现负责解析 query
     * (action=startReview 等) 并通过 useUrlHashSync 跳转 hash 路由.
     * 未挂载时 ArkTS 侧通过 `typeof === 'function'` 守卫保留启动请求.
     */
    handleHarmonyLaunch?: (query: string) => void;
    /**
     * v1.6.0 D1: 原生卡片恢复推送接收器 (R-1 恢复的实机通道).
     *
     * 由 useMemoryStore 在模块加载时挂载, ArkTS 侧 pushCardsToWeb 经
     * controller.runJavaScript 反向调用, 载荷为 getAllCards 同契约的 JSON 字符串.
     */
    __applyNativeCardRestore?: (json: string) => void;
  }
}

import { detectPlatform } from './detect';

/**
 * Stage 2 (v0.5.0-harmony): 复习完成后主动刷新服务卡片 (Web 侧入口).
 *
 * 非鸿蒙 / 无原生桥环境安全 no-op: 直接返回 {ok:true, noop:true}, 绝不抛错,
 * 不影响复习主流程. 鸿蒙且原生桥提供 notifyReviewCompleted 时, 委派原生侧
 * FormRefresher.refreshAllForms 主动刷新所有已持久化 formId 的服务卡片.
 *
 * 返回约定与 ArkTS NotifyReviewCompletedResult 对齐: {ok:true} 或 {ok:false, reason}.
 * 任何形式的同步 / 异步异常均被捕获并转为 {ok:false, reason}, 不向上传播.
 */
export async function notifyReviewCompleted(): Promise<NotifyReviewCompletedResult> {
  try {
    const cap = detectPlatform();
    const bridge = cap.getNativeBridge();
    if (
      !cap.isHarmonyOS() ||
      bridge === null ||
      typeof bridge.notifyReviewCompleted !== 'function'
    ) {
      // 非鸿蒙 / 无桥: 安全 no-op.
      return { ok: true, noop: true };
    }
    const res = await bridge.notifyReviewCompleted();
    if (res && typeof res.ok === 'boolean') {
      return res.ok ? { ok: true } : { ok: false, reason: res.reason };
    }
    return { ok: true };
  } catch (e) {
    const reason: string = e instanceof Error ? e.message : String(e);
    console.warn('[harmonyBridge] notifyReviewCompleted failed:', reason);
    return { ok: false, reason };
  }
}

/**
 * Stage 3 (v0.5.0-harmony): 请求通知权限 (Web 侧入口).
 *
 * 非鸿蒙 / 无原生桥环境安全 no-op: 返回 {state:'granted', noop:true} (视为
 * Web 端无需授权), 绝不抛错. denied/error 由调用方 (设置面板) 决定引导提示.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  try {
    const cap = detectPlatform();
    const bridge = cap.getNativeBridge();
    if (
      !cap.isHarmonyOS() ||
      bridge === null ||
      typeof bridge.requestNotificationPermission !== 'function'
    ) {
      return { state: 'granted', noop: true };
    }
    const res = await bridge.requestNotificationPermission();
    if (res && typeof res.state === 'string') {
      return res;
    }
    return { state: 'granted' };
  } catch (e) {
    const reason: string = e instanceof Error ? e.message : String(e);
    console.warn('[harmonyBridge] requestNotificationPermission failed:', reason);
    return { state: 'error', reason };
  }
}

/**
 * Stage 3 (v0.5.0-harmony): 调度 reminderAgent 定时提醒 (Web 侧入口).
 *
 * 非鸿蒙 / 无原生桥环境安全 no-op: 返回 {skipped:true, noop:true}.
 * 原生权益不可用时同样返回 skipped — 安全降级契约, 绝不真实发布.
 */
export async function scheduleReviewReminder(
  reminderId: string,
  triggerAt: number
): Promise<ScheduleReminderResult> {
  try {
    const cap = detectPlatform();
    const bridge = cap.getNativeBridge();
    if (
      !cap.isHarmonyOS() ||
      bridge === null ||
      typeof bridge.scheduleReviewReminder !== 'function'
    ) {
      return { skipped: true, noop: true };
    }
    const res = await bridge.scheduleReviewReminder(reminderId, triggerAt);
    if (res && typeof res.skipped === 'boolean') {
      return res;
    }
    return { skipped: true };
  } catch (e) {
    const reason: string = e instanceof Error ? e.message : String(e);
    console.warn('[harmonyBridge] scheduleReviewReminder failed:', reason);
    return { skipped: true, reason };
  }
}

/**
 * Stage 3 (v0.5.0-harmony): 取消 reminderAgent 定时提醒 (Web 侧入口).
 *
 * 非鸿蒙 / 无原生桥环境安全 no-op: 返回 {ok:true, noop:true} (幂等成功).
 */
export async function cancelReviewReminder(reminderId: string): Promise<CancelReminderResult> {
  try {
    const cap = detectPlatform();
    const bridge = cap.getNativeBridge();
    if (
      !cap.isHarmonyOS() ||
      bridge === null ||
      typeof bridge.cancelReviewReminder !== 'function'
    ) {
      return { ok: true, noop: true };
    }
    const res = await bridge.cancelReviewReminder(reminderId);
    if (res && typeof res.ok === 'boolean') {
      return res;
    }
    return { ok: true };
  } catch (e) {
    const reason: string = e instanceof Error ? e.message : String(e);
    console.warn('[harmonyBridge] cancelReviewReminder failed:', reason);
    return { ok: false, reason };
  }
}
