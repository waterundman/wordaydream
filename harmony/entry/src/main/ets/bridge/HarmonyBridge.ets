/**
 * HarmonyBridge (v0.1.0-harmony Stage 3)
 *
 * ArkTS 侧通过 registerJavaScriptProxy 注入到 window.harmonyBridge 的原生 bridge.
 * 方法签名与 src/platform/harmonyBridge.ts 的 HarmonyBridge TS interface 一一对应:
 *   - getDueCardsCount(): Promise<number>
 *   - registerReminder(payload: ReminderPayload): Promise<void>
 *   - readPreferences(key: string): Promise<string | null>
 *   - writePreferences(key: string, value: string): Promise<void>
 *   - triggerHapticFeedback(intensity: string): void
 *   - handleHarmonyLaunch(query: string): void  (Stage 5)
 *
 * Stage 3 实现状态:
 * - getDueCardsCount: 占位返回 0 (Stage 6 已实现真实 relationalStore 读取)
 * - registerReminder: 占位 hilog.info (Stage 7 实现真实 notificationManager.publish)
 * - readPreferences / writePreferences: 真实 @ohos.data.preferences 调用
 * - triggerHapticFeedback: 真实 @ohos.vibrator 调用
 *
 * Stage 5 实现状态:
 * - handleHarmonyLaunch: 真实 AppStorage + runJavaScript 派发 (供 EntryAbility.onNewWant
 *   处理元服务分享卡片 / 桌面服务卡片唤起时的 ArkWeb 跳转).
 *
 * Stage 6 实现状态:
 * - getDueCardsCount: 真实 MemoryCardStore.getDueCardsCount(Date.now()) 读取 RDB
 *   (wordaydream_memory.db / wordaydream_memory_cards 表, WHERE due <= now).
 *
 * Stage 7 实现状态:
 * - registerReminder: 真实 NotificationService.scheduleReviewReminder 调用,
 *   读取 preferences (app_language + notifications_config) 获取语言 + 时间窗,
 *   通过 MemoryCardStore.getDueCardsCount 获取到期卡片数, 发布本地通知.
 *
 * Contract: 所有方法 try/catch 兜底, 异常返回空值不抛错 (ArkTS 侧异常不传播到 Web).
 */
import { preferences } from '@kit.ArkData';
import vibrator from '@ohos.vibrator';
import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import type { ReminderPayload } from './types';
import type { MemoryCardRecord, TodayReviewStats } from '../data/MemoryCardSchema';
import { MemoryCardStore } from '../data/MemoryCardStore';
import { NotificationService, NotificationWindow } from '../notification/NotificationService';
import { BridgeInputValidator } from './BridgeInputValidator';
import {
  WEB_CONTROLLER_STORAGE_KEY,
  WEB_CONTENT_READY_STORAGE_KEY,
  WEB_HANDLER_READY_STORAGE_KEY,
  WEB_READY_GENERATION_STORAGE_KEY,
} from './BridgeMethodRegistry';
import { TextToSpeechService } from '../tts/TextToSpeechService';
import type { SpeakPayload, SpeechEngineInfo } from '../tts/TextToSpeechService';

const DOMAIN: number = 0x0001;
const TAG: string = 'HarmonyBridge';
const PREFS_NAME: string = 'wordaydream_prefs';

export class HarmonyBridge {
  private static instance: HarmonyBridge | null = null;
  private context: common.Context;
  private prefsName: string = PREFS_NAME;
  private cachedPrefs: preferences.Preferences | null = null;
  private pendingLaunchQueries: Array<string> = [];
  private launchDispatchInProgress: boolean = false;

  private constructor(context: common.Context) {
    this.context = context;
  }

  /** 单例入口 (幂等, context 仅首次调用时使用). */
  static getInstance(context: common.Context): HarmonyBridge {
    if (HarmonyBridge.instance === null) {
      HarmonyBridge.instance = new HarmonyBridge(context);
    }
    return HarmonyBridge.instance;
  }

  /** 缓存 preferences 实例 (避免每次 read/write 重新 getPreferences). */
  private async getPrefs(): Promise<preferences.Preferences> {
    if (this.cachedPrefs !== null) {
      return this.cachedPrefs;
    }
    try {
      this.cachedPrefs =
        await preferences.getPreferences(this.context, this.prefsName);
      return this.cachedPrefs;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getPreferences failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      throw new Error(err.message);
    }
  }

  /** 每次 RDB 操作均等待共享初始化任务，首次失败时允许后续调用重试. */
  private async getMemoryCardStore(): Promise<MemoryCardStore> {
    const store: MemoryCardStore = MemoryCardStore.getInstance();
    await store.initialize(this.context);
    return store;
  }

  /**
   * 获取当前到期卡片数 (供首页角标 / 通知展示).
   *
   * Stage 6: 实现真实 MemoryCardStore.getDueCardsCount(Date.now()) 读取 RDB
   * (wordaydream_memory_cards 表, WHERE due <= now). 异常兜底返回 0.
   */
  async getDueCardsCount(): Promise<number> {
    try {
      const store: MemoryCardStore = await this.getMemoryCardStore();
      const count: number =
        await store.getDueCardsCount(Date.now());
      hilog.info(
        DOMAIN,
        TAG,
        'getDueCardsCount (Stage 6) -> %{public}d',
        count
      );
      return count;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getDueCardsCount failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return 0;
    }
  }

  /**
   * 注册本地复习提醒 (Stage 7: 真实 NotificationService 调用).
   *
   * 流程:
   * 1. 读取 preferences 'app_language' (默认 'en') 作为通知文案语言.
   * 2. 读取 preferences 'notifications_config' (JSON: {enabled, startHour, endHour}),
   *    默认 {enabled:true, startHour:8, endHour:22}.
   * 3. 通过 MemoryCardStore.getDueCardsCount(payload.dueAt) 获取到期卡片数.
   * 4. 调用 NotificationService.scheduleReviewReminder 发布本地通知.
   *
   * 异常 try/catch 兜底返回 void (ArkTS 侧异常不传播到 Web).
   */
  async registerReminder(payload: ReminderPayload): Promise<void> {
    try {
      if (!BridgeInputValidator.validateReminderPayload(payload)) {
        hilog.warn(DOMAIN, TAG, 'registerReminder rejected: invalid payload');
        return;
      }
      // 1. 读取语言偏好 (默认 'en')
      const langValue: string | null = await this.readPreferences('app_language');
      const language: string = langValue !== null ? langValue : 'en';

      // 2. 读取通知时间窗配置 (默认 8:00-22:00, enabled=true)
      const win: NotificationWindow = await this.readNotificationWindow();

      // 3. 获取到期卡片数 (供通知文案展示 "有 N 个词汇到期")
      const store: MemoryCardStore = await this.getMemoryCardStore();
      const dueCount: number =
        await store.getDueCardsCount(payload.dueAt);

      // 4. 调度通知 (NotificationService 内部 try/catch 兜底)
      await NotificationService.getInstance().scheduleReviewReminder(
        payload.dueAt,
        dueCount,
        language,
        win
      );

      hilog.info(
        DOMAIN,
        TAG,
        'registerReminder (Stage 7): dueAt=%{public}d cardId=%{public}s dueCount=%{public}d lang=%{public}s',
        payload.dueAt,
        payload.cardId,
        dueCount,
        language
      );
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'registerReminder failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 读取通知时间窗配置 (Stage 7).
   *
   * 从 preferences 'notifications_config' 读取 JSON 字符串, 解析为 NotificationWindow.
   * 键不存在 / 解析失败 / 字段缺失时返回默认 {enabled:true, startHour:8, endHour:22}.
   */
  private async readNotificationWindow(): Promise<NotificationWindow> {
    const defaultWin: NotificationWindow = {
      enabled: true,
      startHour: 8,
      endHour: 22,
    };
    try {
      const raw: string | null = await this.readPreferences('notifications_config');
      if (raw === null || raw.length === 0) {
        return defaultWin;
      }
      const obj: Record<string, object> = JSON.parse(raw) as Record<string, object>;
      const enabled: boolean =
        typeof obj.enabled === 'boolean' ? obj.enabled : true;
      const startHour: number =
        typeof obj.startHour === 'number' && obj.startHour >= 0 && obj.startHour <= 23
          ? Math.floor(obj.startHour)
          : 8;
      const endHour: number =
        typeof obj.endHour === 'number' && obj.endHour >= 0 && obj.endHour <= 23
          ? Math.floor(obj.endHour)
          : 22;
      const win: NotificationWindow = { enabled, startHour, endHour };
      return win;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'readNotificationWindow fallback to default: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return defaultWin;
    }
  }

  /**
   * 读取 preferences 键值 (返回 null 表示键不存在).
   * Stage 3: 真实 @ohos.data.preferences 调用.
   */
  async readPreferences(key: string): Promise<string | null> {
    try {
      if (!BridgeInputValidator.validatePreferencesKey(key)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'readPreferences rejected: invalid key=%{public}s',
          key
        );
        return null;
      }
      const prefs: preferences.Preferences = await this.getPrefs();
      const exists: boolean = await prefs.has(key);
      if (!exists) {
        hilog.info(
          DOMAIN,
          TAG,
          'readPreferences: key=%{public}s -> null (not found)',
          key
        );
        return null;
      }
      // API 22: prefs.get 返回 ValueType 联合类型, 需 typeof 收窄到 string.
      const raw: preferences.ValueType = await prefs.get(key, '');
      const value: string = typeof raw === 'string' ? raw : '';
      hilog.info(
        DOMAIN,
        TAG,
        'readPreferences: key=%{public}s -> (value len=%{public}d)',
        key,
        value.length
      );
      return value;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'readPreferences failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return null;
    }
  }

  /**
   * 写入 preferences 键值.
   * Stage 3: 真实 @ohos.data.preferences 调用.
   */
  async writePreferences(key: string, value: string): Promise<void> {
    try {
      if (
        !BridgeInputValidator.validatePreferencesKey(key) ||
        !BridgeInputValidator.validatePreferencesValue(value)
      ) {
        hilog.warn(
          DOMAIN,
          TAG,
          'writePreferences rejected: invalid key or value (key=%{public}s)',
          key
        );
        return;
      }
      const prefs: preferences.Preferences =
        await preferences.getPreferences(this.context, this.prefsName);
      await prefs.put(key, value);
      await prefs.flush();
      hilog.info(
        DOMAIN,
        TAG,
        'writePreferences: key=%{public}s (value len=%{public}d) flushed',
        key,
        value.length
      );
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'writePreferences failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 触发触觉反馈 (线性马达振动).
   * Stage 3: 真实 @ohos.vibrator 调用.
   *
   * 注意: 需要 ohos.permission.VIBRATE 权限 (Stage 1 module.json5 未声明,
   *   缺权限时 vibrator.startVibration 抛 SecurityException, 由 catch 兜底为空值返回).
   *   intensity: 'light' | 'medium' | 'heavy' -> 映射振动持续时间 (ms).
   */
  triggerHapticFeedback(intensity: string): void {
    try {
      if (!BridgeInputValidator.validateIntensity(intensity)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'triggerHapticFeedback rejected: invalid intensity=%{public}s',
          intensity
        );
        return;
      }
      const durationMs: number =
        intensity === 'heavy' ? 50 : intensity === 'medium' ? 30 : 10;
      // API 22: startVibration 需要 (effect, attribute) 两个参数, attribute.usage
      // 指明振动用途 ('touch' 适用于触觉反馈).
      vibrator
        .startVibration(
          { type: 'time', duration: durationMs },
          { usage: 'touch' }
        )
        .then(() => {
          hilog.info(
            DOMAIN,
            TAG,
            'triggerHapticFeedback done: intensity=%{public}s',
            intensity
          );
        })
        .catch((e: BusinessError) => {
          hilog.error(
            DOMAIN,
            TAG,
            'triggerHapticFeedback vibrator rejected: code=%{public}d msg=%{public}s',
            e.code,
            e.message
          );
        });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'triggerHapticFeedback failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 派发鸿蒙原生跳转到 ArkWeb (供 EntryAbility.onNewWant 调用).
   *
   * Stage 5: 处理元服务分享卡片 / 桌面服务卡片唤起时的跳转:
   *   1. 从 AppStorage 读取 webController (由 Index.ets onControllerAttached 注入).
   *   2. 转义 query 字符串中的引号, 防止注入.
   *   3. 调用 controller.runJavaScript 派发到 Web 端 window.handleHarmonyLaunch.
   *   4. Web 端 useUrlHashSync 解析 query (action=startReview 等) 后跳转 hash 路由.
   *
   * query 格式示例:
   *   - 'action=startReview'         (分享卡片一键开始复习)
   *   - 'action=openCard&cardId=xxx' (定向打开指定卡片)
   *
   * 若 webController 尚未就绪 (Web 组件未完成 onControllerAttached),
   * 以 warn 日志跳过, 不抛错 (典型场景: 冷启动时 onNewWant 先于
   * onControllerAttached 触发, 此时无法派发, 由 Web 端首次加载逻辑兜底).
   */
  handleHarmonyLaunch(query: string): void {
    try {
      if (!BridgeInputValidator.validateLaunchQuery(query)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'handleHarmonyLaunch rejected: invalid query=%{public}s',
          query
        );
        return;
      }
      hilog.info(
        DOMAIN,
        TAG,
        'handleHarmonyLaunch queued: query=%{public}s queueSize=%{public}d',
        query,
        this.pendingLaunchQueries.push(query)
      );
      this.resumePendingLaunches();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'handleHarmonyLaunch failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * Confirm that the current trusted Web page installed handleHarmonyLaunch.
   *
   * This is deliberately separate from Index.onPageEnd: a shell can finish
   * loading without executing the application bundle. Keep the generation
   * monotonic across reloads so an older failed dispatch cannot suppress a
   * retry triggered by a newer Web context.
   */
  notifyWebReady(): void {
    try {
      const previousGeneration: number =
        AppStorage.get<number>(WEB_READY_GENERATION_STORAGE_KEY) ?? 0;
      const readyGeneration: number = previousGeneration + 1;
      AppStorage.setOrCreate<boolean>(WEB_HANDLER_READY_STORAGE_KEY, true);
      AppStorage.setOrCreate<number>(
        WEB_READY_GENERATION_STORAGE_KEY,
        readyGeneration
      );
      hilog.info(
        DOMAIN,
        TAG,
        'Web launch handler ready: generation=%{public}d',
        readyGeneration
      );
      this.resumePendingLaunches();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'notifyWebReady failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * Confirm that React committed visible application content.
   *
   * The native shell keeps its loading/error layer independent from launch
   * dispatch readiness: module initialization can install the launch handler
   * before React successfully renders the page.
   */
  notifyWebContentReady(): void {
    try {
      AppStorage.setOrCreate<boolean>(WEB_CONTENT_READY_STORAGE_KEY, true);
      hilog.info(DOMAIN, TAG, 'Web content ready');
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'notifyWebContentReady failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * Dispatch queued native launch actions in FIFO order.
   *
   * A query remains queued until ArkWeb confirms that the Web handler ran.
   * Missing readiness, missing controllers, and runJavaScript failures preserve
   * the action until a readiness handshake or controller transition retries it.
   */
  resumePendingLaunches(): void {
    if (
      this.launchDispatchInProgress ||
      this.pendingLaunchQueries.length === 0
    ) {
      return;
    }

    const webHandlerReady: boolean =
      AppStorage.get<boolean>(WEB_HANDLER_READY_STORAGE_KEY) ?? false;
    if (!webHandlerReady) {
      hilog.info(
        DOMAIN,
        TAG,
        'resumePendingLaunches waiting for Web readiness: queueSize=%{public}d',
        this.pendingLaunchQueries.length
      );
      return;
    }

    const controller: webview.WebviewController | undefined = AppStorage.get<
      webview.WebviewController
    >(WEB_CONTROLLER_STORAGE_KEY);
    if (controller === undefined || controller === null) {
      hilog.warn(
        DOMAIN,
        TAG,
        'resumePendingLaunches waiting for webController: queueSize=%{public}d',
        this.pendingLaunchQueries.length
      );
      return;
    }

    const readyGeneration: number =
      AppStorage.get<number>(WEB_READY_GENERATION_STORAGE_KEY) ?? 0;

    const query: string = this.pendingLaunchQueries[0];
    const queryLiteral: string = JSON.stringify(query);
    const jsCode: string =
      "(function () { if (typeof window.handleHarmonyLaunch !== 'function') {" +
      " throw new Error('Harmony launch handler is not ready'); }" +
      " window.handleHarmonyLaunch(" + queryLiteral +
      "); return 'dispatched'; })();";

    this.launchDispatchInProgress = true;
    try {
      controller.runJavaScript(jsCode)
        .then((_result: string) => {
          if (
            this.pendingLaunchQueries.length > 0 &&
            this.pendingLaunchQueries[0] === query
          ) {
            this.pendingLaunchQueries.shift();
          }
          this.launchDispatchInProgress = false;
          hilog.info(
            DOMAIN,
            TAG,
            'Harmony launch dispatched: query=%{public}s remaining=%{public}d',
            query,
            this.pendingLaunchQueries.length
          );
          this.resumePendingLaunches();
        })
        .catch((e: BusinessError) => {
          this.launchDispatchInProgress = false;
          hilog.warn(
            DOMAIN,
            TAG,
            'Harmony launch retained after ArkWeb rejection: code=%{public}d msg=%{public}s',
            e.code,
            e.message
          );
          const currentGeneration: number =
            AppStorage.get<number>(WEB_READY_GENERATION_STORAGE_KEY) ?? 0;
          if (currentGeneration !== readyGeneration) {
            this.resumePendingLaunches();
          }
        });
    } catch (e) {
      this.launchDispatchInProgress = false;
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'Harmony launch retained after dispatch failure: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      const currentGeneration: number =
        AppStorage.get<number>(WEB_READY_GENERATION_STORAGE_KEY) ?? 0;
      if (currentGeneration !== readyGeneration) {
        this.resumePendingLaunches();
      }
    }
  }

  /**
   * Stage 3: Web → 鸿蒙 relationalStore 镜像 (upsert).
   *
   * 1. 校验 16 字段 (BridgeInputValidator.validateCardRecord), 失败 hilog.warn + return.
   * 2. 调用 MemoryCardStore.upsertCard (Stage 6 已有方法, INSERT OR REPLACE).
   * 3. hilog.info 记录成功日志.
   */
  async upsertCard(card: MemoryCardRecord): Promise<void> {
    try {
      if (!BridgeInputValidator.validateCardRecord(card)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'upsertCard rejected: invalid card (id=%{public}s)',
          card?.id ?? ''
        );
        return;
      }
      const store: MemoryCardStore = await this.getMemoryCardStore();
      await store.upsertCard(card);
      hilog.info(
        DOMAIN,
        TAG,
        'upsertCard done: id=%{public}s due=%{public}d',
        card.id,
        card.due
      );
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'upsertCard failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * Stage 3: Web → 鸿蒙 relationalStore 镜像 (delete).
   *
   * Web 传入的键是 MemoryCard Map key (lexemeGroupId), 并非 RDB 主键 id.
   * 1. 校验 lexemeGroupId (复用 ID 格式校验), 失败 hilog.warn + return.
   * 2. 调用 MemoryCardStore.deleteCardByLexemeGroupId.
   * 3. hilog.info 记录成功日志.
   */
  async deleteCard(lexemeGroupId: string): Promise<void> {
    try {
      if (!BridgeInputValidator.validateCardId(lexemeGroupId)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'deleteCard rejected: invalid lexemeGroupId'
        );
        return;
      }
      const store: MemoryCardStore = await this.getMemoryCardStore();
      await store.deleteCardByLexemeGroupId(lexemeGroupId);
      hilog.info(
        DOMAIN,
        TAG,
        'deleteCard done: lexemeGroupId=%{public}s',
        lexemeGroupId
      );
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'deleteCard failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * Stage 3: 鸿蒙 → Web 卡片恢复 (R-1 闭环核心).
   *
   * 返回所有卡片 (按 due 升序), 供 Web 端 onRehydrateStorage 在
   * localStorage 为空时调用恢复. 异常返回空数组.
   */
  async getAllCards(): Promise<MemoryCardRecord[]> {
    try {
      const store: MemoryCardStore = await this.getMemoryCardStore();
      const cards: MemoryCardRecord[] =
        await store.getAllCards();
      hilog.info(
        DOMAIN,
        TAG,
        'getAllCards done: count=%{public}d',
        cards.length
      );
      return cards;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getAllCards failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return [];
    }
  }

  /**
   * Stage 3: 查询最近复习过的卡片 (Web 端 dashboard 展示).
   *
   * 1. 校验 limit: Number.isInteger(limit) && limit > 0 && limit <= 100, 失败返回 [].
   * 2. 调用 MemoryCardStore.getRecentlyReviewedCards(limit) (Stage 3 新增).
   * 3. 异常返回空数组.
   */
  async getRecentlyReviewedCards(limit: number): Promise<MemoryCardRecord[]> {
    try {
      if (
        !Number.isInteger(limit) ||
        limit <= 0 ||
        limit > 100
      ) {
        hilog.warn(
          DOMAIN,
          TAG,
          'getRecentlyReviewedCards rejected: invalid limit=%{public}d',
          limit
        );
        return [];
      }
      const store: MemoryCardStore = await this.getMemoryCardStore();
      const cards: MemoryCardRecord[] =
        await store.getRecentlyReviewedCards(limit);
      hilog.info(
        DOMAIN,
        TAG,
        'getRecentlyReviewedCards done: limit=%{public}d count=%{public}d',
        limit,
        cards.length
      );
      return cards;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getRecentlyReviewedCards failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return [];
    }
  }

  /**
   * Stage 3: 查询今日复习统计 (服务卡片进度环 + Web dashboard).
   *
   * 调用 MemoryCardStore.getTodayReviewStats(Date.now()) (Stage 3 新增).
   * 异常返回默认 stats {dueCount:0, reviewedCount:0, totalCount:0}.
   */
  async getTodayReviewStats(): Promise<TodayReviewStats> {
    const defaultStats: TodayReviewStats = {
      dueCount: 0,
      reviewedCount: 0,
      totalCount: 0,
    };
    try {
      const store: MemoryCardStore = await this.getMemoryCardStore();
      const stats: TodayReviewStats =
        await store.getTodayReviewStats(Date.now());
      hilog.info(
        DOMAIN,
        TAG,
        'getTodayReviewStats done: due=%{public}d reviewed=%{public}d total=%{public}d',
        stats.dueCount,
        stats.reviewedCount,
        stats.totalCount
      );
      return stats;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getTodayReviewStats failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return defaultStats;
    }
  }

  /**
   * Stage 1 v0.3.0-harmony: 朗读文本 (命令型异步).
   *
   * 流程:
   * 1. 三段校验 (validateSpeechText / validateSpeechLanguage / validateSpeechRate),
   *    失败 hilog.warn + return (不抛到 Web).
   * 2. 调用 TextToSpeechService.getInstance().speak(payload).
   * 3. try/catch 兜底, 异常 hilog.warn + return (fire-and-forget 模式).
   *
   * @param payload 朗读载荷 (text / language / rate / voiceId?).
   */
  async speak(payload: SpeakPayload): Promise<void> {
    try {
      if (payload === null || payload === undefined) {
        hilog.warn(DOMAIN, TAG, 'speak rejected: null payload');
        return;
      }
      if (!BridgeInputValidator.validateSpeechText(payload.text)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'speak rejected: invalid text (len=%{public}d)',
          typeof payload.text === 'string' ? payload.text.length : -1
        );
        return;
      }
      if (!BridgeInputValidator.validateSpeechLanguage(payload.language)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'speak rejected: invalid language=%{public}s',
          payload.language
        );
        return;
      }
      if (!BridgeInputValidator.validateSpeechRate(payload.rate)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'speak rejected: invalid rate=%{public}f',
          payload.rate
        );
        return;
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
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'speak failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      throw new Error(err.message);
    }
  }

  /**
   * Stage 1 v0.3.0-harmony: 立即停止朗读.
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
   * Stage 1 v0.3.0-harmony: 查询原生 TTS 引擎是否可用.
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
   * Stage 1 v0.3.0-harmony: 列出可用 TTS 引擎.
   *
   * 调用 TextToSpeechService.getInstance().getEngines().
   * try/catch 兜底, 异常 return [] (不抛到 Web).
   */
  async getSpeechEngines(): Promise<SpeechEngineInfo[]> {
    try {
      const engines: SpeechEngineInfo[] =
        await TextToSpeechService.getInstance().getEngines();
      hilog.info(
        DOMAIN,
        TAG,
        'getSpeechEngines done: count=%{public}d',
        engines.length
      );
      return engines;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'getSpeechEngines failed (fallback []): code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return [];
    }
  }
}
