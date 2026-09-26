import { UIAbility, AbilityConstant, Want, common } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { HarmonyBridge } from '../bridge/HarmonyBridge';
import { ReminderAgentService } from '../notification/ReminderAgentService';
import { MemoryCardStore } from '../data/MemoryCardStore';
import {
  DEBUG_SEED_QUERY,
  seedDebugCardsForRun,
} from '../data/DebugSeedCards';
import { TextToSpeechService } from '../tts/TextToSpeechService';

const DOMAIN: number = 0x0001;
const TAG: string = 'EntryAbility';

/**
 * 服务卡片刷新通道说明:
 * 卡片渲染进程与主 Ability 进程隔离, emitter 事件无法跨进程投递, 故本文件
 * 不再发布 widget refresh 事件. 真实刷新链路由 Web 侧复习完成触发:
 * harmonyBridge.notifyReviewCompleted -> FormRefresher.refreshAllForms ->
 * formProvider.updateForm (卡片提供方进程读取 RDB 后回写 FormBindingData).
 */
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'onCreate');
    this.handleLaunchWant(want);
    // Stage 3: 启动时对账恢复 reminderAgent 定时提醒 (fire-and-forget).
    // 仅在权益可用时实际补发; 无权益时内部安全跳过 (isSupported 探测缓存).
    this.restoreRemindersOnStartup();
  }

  /** Stage 3: reminderAgent 提醒启动对账 (幂等, 全程 try/catch 兜底). */
  private restoreRemindersOnStartup(): void {    try {
      const ctx: common.Context = this.context as common.Context;
      ReminderAgentService.getInstance()
        .initialize(ctx)
        .then(async (): Promise<void> => {
          const outcome = await ReminderAgentService.getInstance().restoreOnStartup();
          hilog.info(
            DOMAIN,
            TAG,
            'restoreRemindersOnStartup: ok=%{public}d restored=%{public}d skipped=%{public}d',
            outcome.ok ? 1 : 0,
            outcome.restored,
            outcome.skipped ? 1 : 0
          );
        })
        .catch((e: BusinessError) => {
          hilog.warn(
            DOMAIN,
            TAG,
            'restoreRemindersOnStartup failed (non-fatal): code=%{public}d msg=%{public}s',
            e.code,
            e.message
          );
        });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'restoreRemindersOnStartup init failed (non-fatal): msg=%{public}s',
        err.message
      );
    }
  }

  /**
   * Stage 4: 运行验证 seed (仅 debuggable 构建).
   *
   * hdc shell aa start --ps query action=debugSeed 触发; release 构建或
   * store 初始化失败时安全跳过. 卡片写入 RDB 后, Web 端既有 getAllCards
   * 恢复链路自然拿到 seed 数据, 无需 Web 侧改动.
   */
  private seedDebugCards(): void {
    try {
      const appInfo = this.context.applicationInfo;
      const debuggable: boolean = appInfo !== undefined && appInfo.debug === true;
      if (!debuggable) {
        hilog.warn(
          DOMAIN,
          TAG,
          'seedDebugCards skipped: not a debuggable build'
        );
        return;
      }
      const ctx: common.Context = this.context as common.Context;
      const store: MemoryCardStore = MemoryCardStore.getInstance();
      store.initialize(ctx)
        .then(async (): Promise<void> => {
          const result = await seedDebugCardsForRun(store, Date.now());
          hilog.info(
            DOMAIN,
            TAG,
            'seedDebugCards done: skipped=%{public}d inserted=%{public}d',
            result.skipped ? 1 : 0,
            result.inserted
          );
        })
        .catch((e: BusinessError) => {
          hilog.warn(
            DOMAIN,
            TAG,
            'seedDebugCards failed (non-fatal): code=%{public}d msg=%{public}s',
            e.code,
            e.message
          );
        });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'seedDebugCards init failed (non-fatal): msg=%{public}s',
        err.message
      );
    }
  }

  /**
   * Stage 5: 处理元服务分享卡片 / 桌面服务卡片唤起时的二次进入.
   *
   * want.parameters.query 形如:
   *   - 'action=startReview'  (分享卡片一键开始复习)
   *   - 'action=openCard&cardId=xxx' (定向打开指定卡片)
   *
   * 派发流程:
   *   EntryAbility.onNewWant
   *     -> HarmonyBridge.handleHarmonyLaunch(query)
   *       -> AppStorage.get<webview.WebviewController>('webController')
   *       -> controller.runJavaScript('window.handleHarmonyLaunch(query)')
   *         -> Web 端 useUrlHashSync 处理 hash 跳转 (#/review 等)
   *
   * 若 webController 尚未就绪 (Web 组件未完成 onControllerAttached),
   * HarmonyBridge.handleHarmonyLaunch 会以 warn 日志跳过, 不抛错.
   */
  onNewWant(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'onNewWant');
    this.handleLaunchWant(want);
  }

  private handleLaunchWant(want: Want): void {
    try {
      const parameters: Record<string, Object> | undefined = want.parameters;
      if (parameters === undefined || parameters === null) {
        hilog.warn(
          DOMAIN,
          TAG,
          'handleLaunchWant: no parameters, skip dispatch'
        );
        return;
      }
      const queryObj: Object | undefined = parameters.query;
      if (queryObj === undefined || queryObj === null) {
        hilog.warn(
          DOMAIN,
          TAG,
          'handleLaunchWant: no query parameter, skip dispatch'
        );
        return;
      }
      const query: string = `${queryObj}`;
      // 日志脱敏: 仅输出 action 段 (不含 cardId 等用户数据明文).
      // 运行验证脚本断言子串 'dispatching query=action=openCard' 由 action 段
      // 完整保留 (scripts/harmony/seed-and-verify.mjs A6), 不得改动前缀格式.
      const queryAction: string = query.split('&')[0];
      hilog.info(
        DOMAIN,
        TAG,
        'handleLaunchWant: dispatching query=%{public}s',
        queryAction
      );

      // Stage 4: 运行验证 seed 入口 (仅 debuggable 构建).
      // 'action=debugSeed' 不在 LAUNCH_QUERY_REGEX 白名单内, 无法到达 Web 派发;
      // 此处在原生层拦截, 向 RDB 预置 5 张到期卡, 供运行验证脚本正向验证
      // RDB 恢复 -> FIFO 消费 -> 复习页链路. release 构建直接跳过.
      if (query === DEBUG_SEED_QUERY) {
        this.seedDebugCards();
        return;
      }

      // HarmonyBridge.handleHarmonyLaunch 内部从 AppStorage 读取
      // webController (由 Index.ets onControllerAttached 注入), 并通过
      // runJavaScript 派发到 window.handleHarmonyLaunch.
      const ctx: common.Context = this.context as common.Context;
      const bridge: HarmonyBridge = HarmonyBridge.getInstance(ctx);
      bridge.handleHarmonyLaunch(query);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'handleLaunchWant failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err: BusinessError) => {
      if (err.code) {
        hilog.error(
          DOMAIN,
          TAG,
          'loadContent failed, code=%{public}d msg=%{public}s',
          err.code,
          err.message
        );
        return;
      }
      hilog.info(DOMAIN, TAG, 'loadContent success');
      // HarmonyBridge 注册已移至 Index.ets 的 Web 组件
      // onControllerAttached 回调, 确保 controller 与 Web 组件共享后再调用
      // registerJavaScriptProxy (修复 controller 未共享导致
      // registerJavaScriptProxy 静默失败问题).
      // Stage 5: onControllerAttached 同时把 controller 写入 AppStorage,
      //   供 EntryAbility.onNewWant -> HarmonyBridge.handleHarmonyLaunch 使用.
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageDestroy');
    try {
      TextToSpeechService.getInstance().shutdown();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'TTS shutdown failed during window destroy: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  onForeground(): void {
    hilog.info(DOMAIN, TAG, 'onForeground');
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, 'onBackground');
  }
}
