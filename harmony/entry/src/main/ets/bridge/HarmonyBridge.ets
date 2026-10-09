/**
 * HarmonyBridge (v1.6.3 S1 — B1 上帝文件拆分后 facade)
 *
 * ArkTS 侧通过 registerJavaScriptProxy 注入到 window.harmonyBridge 的原生 bridge.
 * 方法签名与 src/platform/harmonyBridge.ts 的 HarmonyBridge TS interface 一一对应.
 *
 * 拆分后的职责边界 (v1.6.3 S1):
 * - facade 保留: 单例 / refreshContext / 方法注册面 (方法名即契约, Index.ets 的
 *   registerJavaScriptProxy 按名反射 facade 实例, 故 20 个契约方法名全部保留),
 *   launch 域 (handleHarmonyLaunch / notifyWebReady / notifyWebContentReady /
 *   resumePendingLaunches / 超时复位) 与体量小的 triggerHapticFeedback.
 * - 低风险纯请求-响应域下沉到 bridge/delegates/:
 *   CardBridgeDelegate (RDB 卡片镜像/查询)、PrefsBridgeDelegate (preferences 读写)、
 *   SpeechBridgeDelegate (TTS 朗读控制)、NotifyBridgeDelegate (通知/提醒/服务卡片刷新).
 *   BridgeMethodRegistry.ets 仍是唯一方法真源; 契约面 (方法名/签名) 不变.
 * - 委托的 context 由本 facade.refreshContext 同源刷新, 委托不自持陈旧 context.
 *
 * Contract: 所有方法 try/catch 兜底, 异常返回空值不抛错 (ArkTS 侧异常不传播到 Web).
 * 具体实现语义见各委托文件 (逐字迁自拆分前 HarmonyBridge.ets).
 */
import vibrator from '@ohos.vibrator';
import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import type {
  ReminderPayload,
  NotifyReviewCompletedResult,
  NotificationPermissionResult,
  ScheduleReminderResult,
  CancelReminderResult,
} from './types';
import type { MemoryCardRecord } from '../data/MemoryCardSchema';
import type { SpeakPayload } from '../tts/TextToSpeechService';
import { BridgeInputValidator } from './BridgeInputValidator';
import {
  WEB_CONTROLLER_STORAGE_KEY,
  WEB_CONTENT_READY_STORAGE_KEY,
  WEB_HANDLER_READY_STORAGE_KEY,
  WEB_READY_GENERATION_STORAGE_KEY,
} from './BridgeMethodRegistry';
import { CardBridgeDelegate } from './delegates/CardBridgeDelegate';
import { PrefsBridgeDelegate } from './delegates/PrefsBridgeDelegate';
import { SpeechBridgeDelegate } from './delegates/SpeechBridgeDelegate';
import { NotifyBridgeDelegate } from './delegates/NotifyBridgeDelegate';

const DOMAIN: number = 0x0001;
const TAG: string = 'HarmonyBridge';

/** H4: 单次 launch 派发等待 runJavaScript 结算的上限, 超时强制复位 FIFO. */
const LAUNCH_DISPATCH_TIMEOUT_MS: number = 8000;

/** H4: launch 队列上限, 超限时丢弃最旧 query (Web 长期不可用防无界增长). */
const MAX_PENDING_LAUNCH_QUERIES: number = 16;

export class HarmonyBridge {
  private static instance: HarmonyBridge | null = null;
  private context: common.Context;
  private cardDelegate: CardBridgeDelegate;
  private prefsDelegate: PrefsBridgeDelegate;
  private speechDelegate: SpeechBridgeDelegate;
  private notifyDelegate: NotifyBridgeDelegate;
  private pendingLaunchQueries: Array<string> = [];
  private launchDispatchInProgress: boolean = false;
  private launchDispatchTimerId: number = -1;

  private constructor(context: common.Context) {
    this.context = context;
    this.cardDelegate = new CardBridgeDelegate(context);
    this.prefsDelegate = new PrefsBridgeDelegate(context);
    // SpeechBridgeDelegate 无 context (TextToSpeechService 为无 context 单例).
    this.speechDelegate = new SpeechBridgeDelegate();
    // NotifyBridgeDelegate 复用 card/prefs 委托的同一条 RDB / prefs 访问路径.
    this.notifyDelegate = new NotifyBridgeDelegate(
      context,
      this.cardDelegate,
      this.prefsDelegate
    );
  }

  /**
   * 单例入口. H5: 单例生命周期长于单次 context, 已有实例时刷新 context 引用,
   * 避免用已销毁的 UIAbility context 去读 preferences / 打开 RDB.
   */
  static getInstance(context: common.Context): HarmonyBridge {
    if (HarmonyBridge.instance === null) {
      HarmonyBridge.instance = new HarmonyBridge(context);
    } else {
      HarmonyBridge.instance.refreshContext(context);
    }
    return HarmonyBridge.instance;
  }

  /**
   * H5: 刷新单例 context (同引用直接返回; 换引用时同源刷新所有持 context 委托,
   * 丢弃绑定旧 context 的 prefs 缓存).
   * 调用点: HarmonyBridge.getInstance — Index.ets 桥注册处每次传入
   * getUIContext().getHostContext() 的最新 context, EntryAbility 侧同样可调用.
   */
  refreshContext(newContext: common.Context): void {
    if (newContext === null || newContext === undefined) {
      hilog.warn(DOMAIN, TAG, 'refreshContext skipped: empty context');
      return;
    }
    if (this.context === newContext) {
      return;
    }
    this.context = newContext;
    this.cardDelegate.refreshContext(newContext);
    this.prefsDelegate.refreshContext(newContext);
    this.notifyDelegate.refreshContext(newContext);
    hilog.info(DOMAIN, TAG, 'HarmonyBridge context refreshed');
  }

  // ===========================================================================
  // 契约方法 (方法名即契约面, registerJavaScriptProxy 按名反射) — 转发到域委托.
  // ===========================================================================

  /** 获取当前到期卡片数 (供首页角标 / 通知展示). 见 CardBridgeDelegate. */
  async getDueCardsCount(): Promise<number> {
    return await this.cardDelegate.getDueCardsCount();
  }

  /** Web → 鸿蒙 relationalStore 镜像 (upsert). 见 CardBridgeDelegate. */
  async upsertCard(card: MemoryCardRecord): Promise<void> {
    return await this.cardDelegate.upsertCard(card);
  }

  /** Web → 鸿蒙 relationalStore 镜像 (delete). 见 CardBridgeDelegate. */
  async deleteCard(lexemeGroupId: string): Promise<void> {
    return await this.cardDelegate.deleteCard(lexemeGroupId);
  }

  /** 鸿蒙 → Web 卡片恢复 (R-1 闭环核心, 返回 JSON 字符串). 见 CardBridgeDelegate. */
  async getAllCards(): Promise<string> {
    return await this.cardDelegate.getAllCards();
  }

  /** 查询最近复习过的卡片 (返回 JSON 字符串). 见 CardBridgeDelegate. */
  async getRecentlyReviewedCards(limit: number): Promise<string> {
    return await this.cardDelegate.getRecentlyReviewedCards(limit);
  }

  /** 查询今日复习统计 (返回 JSON 字符串). 见 CardBridgeDelegate. */
  async getTodayReviewStats(): Promise<string> {
    return await this.cardDelegate.getTodayReviewStats();
  }

  /** 读取 preferences 键值 (null = 键不存在). 见 PrefsBridgeDelegate. */
  async readPreferences(key: string): Promise<string | null> {
    return await this.prefsDelegate.readPreferences(key);
  }

  /** 写入 preferences 键值. 见 PrefsBridgeDelegate. */
  async writePreferences(key: string, value: string): Promise<void> {
    return await this.prefsDelegate.writePreferences(key, value);
  }

  /** 朗读文本 ('' = 已派发, 非空 = 拒绝/失败原因). 见 SpeechBridgeDelegate. */
  async speak(payload: SpeakPayload): Promise<string> {
    return await this.speechDelegate.speak(payload);
  }

  /** 立即停止朗读 (fire-and-forget). 见 SpeechBridgeDelegate. */
  stopSpeech(): void {
    this.speechDelegate.stopSpeech();
  }

  /** 查询原生 TTS 引擎是否可用. 见 SpeechBridgeDelegate. */
  async isSpeechSupported(): Promise<boolean> {
    return await this.speechDelegate.isSpeechSupported();
  }

  /** 列出可用 TTS 引擎 (返回 JSON 字符串). 见 SpeechBridgeDelegate. */
  async getSpeechEngines(): Promise<string> {
    return await this.speechDelegate.getSpeechEngines();
  }

  /** 注册本地复习提醒 (真实 NotificationService 调用). 见 NotifyBridgeDelegate. */
  async registerReminder(payload: ReminderPayload): Promise<void> {
    return await this.notifyDelegate.registerReminder(payload);
  }

  /** Stage 2: 复习完成后主动刷新所有已持久化的服务卡片. 见 NotifyBridgeDelegate. */
  async notifyReviewCompleted(): Promise<NotifyReviewCompletedResult> {
    return await this.notifyDelegate.notifyReviewCompleted();
  }

  /** Stage 3: 请求通知权限 (三态: granted / denied / error). 见 NotifyBridgeDelegate. */
  async requestNotificationPermission(): Promise<NotificationPermissionResult> {
    return await this.notifyDelegate.requestNotificationPermission();
  }

  /** Stage 3: 调度 reminderAgent 定时提醒 (无权益安全降级). 见 NotifyBridgeDelegate. */
  async scheduleReviewReminder(
    reminderId: string,
    triggerAt: number
  ): Promise<ScheduleReminderResult> {
    return await this.notifyDelegate.scheduleReviewReminder(reminderId, triggerAt);
  }

  /** Stage 3: 取消 reminderAgent 定时提醒 (幂等). 见 NotifyBridgeDelegate. */
  async cancelReviewReminder(reminderId: string): Promise<CancelReminderResult> {
    return await this.notifyDelegate.cancelReviewReminder(reminderId);
  }

  // ===========================================================================
  // launch 域 + 触感: 留在 facade (体量小 / 与冷启动链路强耦合).
  // ===========================================================================

  /**
   * 触发触觉反馈 (线性马达振动).
   * 真实 @ohos.vibrator 调用.
   *
   * 注意: 需要 ohos.permission.VIBRATE 权限 (module.json5 未声明,
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
      // H4: 队列封顶, 超限丢最旧并记 warn (query 明文不入日志, M2).
      if (this.pendingLaunchQueries.length >= MAX_PENDING_LAUNCH_QUERIES) {
        this.pendingLaunchQueries.shift();
        hilog.warn(
          DOMAIN,
          TAG,
          'launch queue overflow: dropped oldest, queueSize=%{public}d',
          this.pendingLaunchQueries.length
        );
      }
      this.pendingLaunchQueries.push(query);
      hilog.info(
        DOMAIN,
        TAG,
        'handleHarmonyLaunch queued: queueSize=%{public}d',
        this.pendingLaunchQueries.length
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
      // v1.6.0 D1: R-1 恢复走原生推送 (拉取通道在 API 22 实机不可用, 见
      // getAllCards JSDoc). content-ready 即控制器就绪, 异步读 RDB 后经
      // runJavaScript 推送 (该通道已由 FIFO openCard 派发实证可靠).
      // Web 端 __applyNativeCardRestore 自带"store 非空不覆盖"守卫,
      // 重复 content-ready / 页面重载场景幂等安全.
      this.pushCardsToWeb();
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
   * v1.6.0 D1: R-1 恢复推送 — 读 RDB 全量卡片, runJavaScript 推给 Web.
   *
   * 全程 try/catch 兜底, 失败仅 warn 不抛 (与拉取路径静默降级语义一致);
   * Web 端空 store 守卫保证推送幂等. 推送载荷为 JSON 字符串
   * (runJavaScript 已实证可用, 且字符串参数经 JSON.stringify 转义安全注入).
   */
  private async pushCardsToWeb(): Promise<void> {
    try {
      const controller: webview.WebviewController | undefined =
        AppStorage.get<webview.WebviewController>(WEB_CONTROLLER_STORAGE_KEY);
      if (controller === undefined || controller === null) {
        hilog.warn(
          DOMAIN,
          TAG,
          'pushCardsToWeb skipped: webController not ready'
        );
        return;
      }
      const cards: MemoryCardRecord[] =
        await this.cardDelegate.getAllCardsRaw();
      if (cards.length === 0) {
        hilog.info(DOMAIN, TAG, 'pushCardsToWeb skipped: empty store');
        return;
      }
      const payload: string = JSON.stringify(cards);
      const jsCode: string =
        'window.__applyNativeCardRestore && window.__applyNativeCardRestore(' +
        JSON.stringify(payload) +
        ');';
      await controller.runJavaScript(jsCode);
      hilog.info(
        DOMAIN,
        TAG,
        'pushCardsToWeb dispatched: count=%{public}d bytes=%{public}d',
        cards.length,
        payload.length
      );
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'pushCardsToWeb failed: code=%{public}d msg=%{public}s',
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
    // H4: runJavaScript 永不结算 (Web 崩溃 / 文档切换) 时定时器兜底复位,
    // 否则 launchDispatchInProgress 永久为 true -> FIFO 队列卡死.
    this.launchDispatchTimerId = setTimeout(() => {
      this.launchDispatchTimerId = -1;
      if (!this.launchDispatchInProgress) {
        return;
      }
      hilog.warn(
        DOMAIN,
        TAG,
        'Harmony launch dispatch settle timeout: forcing reset, queueSize=%{public}d',
        this.pendingLaunchQueries.length
      );
      this.launchDispatchInProgress = false;
      this.resumePendingLaunches();
    }, LAUNCH_DISPATCH_TIMEOUT_MS);
    try {
      controller.runJavaScript(jsCode)
        .then((_result: string) => {
          this.clearLaunchDispatchTimer();
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
            'Harmony launch dispatched: remaining=%{public}d',
            this.pendingLaunchQueries.length
          );
          this.resumePendingLaunches();
        })
        .catch((e: BusinessError) => {
          this.clearLaunchDispatchTimer();
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
      this.clearLaunchDispatchTimer();
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

  /** H4: 清除派发超时定时器 (结算路径统一调用). */
  private clearLaunchDispatchTimer(): void {
    if (this.launchDispatchTimerId >= 0) {
      clearTimeout(this.launchDispatchTimerId);
      this.launchDispatchTimerId = -1;
    }
  }
}