import { UIAbility, AbilityConstant, Want, common } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError, emitter } from '@kit.BasicServicesKit';
import { HarmonyBridge } from '../bridge/HarmonyBridge';
import { TextToSpeechService } from '../tts/TextToSpeechService';

const DOMAIN: number = 0x0001;
const TAG: string = 'EntryAbility';

/**
 * Stage 4: emitter event id 用于实时刷新服务卡片.
 * ReviewCardWidget.aboutToAppear 注册 emitter.on 同 id 监听.
 */
const WIDGET_REFRESH_EVENT_ID: number = 10001;

/** Stage 4: 5 分钟节流 (鸿蒙系统 updateForm 限制). */
const WIDGET_REFRESH_THROTTLE_MS: number = 5 * 60 * 1000;

export default class EntryAbility extends UIAbility {
  /**
   * Stage 4: 上次 widget refresh 时间戳 (5min 节流).
   * 0 表示从未触发过.
   */
  private lastWidgetRefresh: number = 0;

  onCreate(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'onCreate');
    this.handleLaunchWant(want);
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
      hilog.info(
        DOMAIN,
        TAG,
        'handleLaunchWant: dispatching query=%{public}s',
        query
      );
      // HarmonyBridge.handleHarmonyLaunch 内部从 AppStorage 读取
      // webController (由 Index.ets onControllerAttached 注入), 并通过
      // runJavaScript 派发到 window.handleHarmonyLaunch.
      const ctx: common.Context = this.context as common.Context;
      const bridge: HarmonyBridge = HarmonyBridge.getInstance(ctx);
      bridge.handleHarmonyLaunch(query);

      // Stage 4: 实时刷新服务卡片 (绕过 60min 系统刷新限制).
      // 仅在 review 相关 query 触发 (用户从卡片进入复习 / 打开卡片,
      // 复习完成回到桌面时卡片应展示最新数据).
      // 5 分钟节流由 publishWidgetRefresh 内部保证 (鸿蒙系统 updateForm 限制).
      if (
        query.startsWith('action=startReview') ||
        query.startsWith('action=openCard')
      ) {
        this.publishWidgetRefresh();
      }
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

  /**
   * Stage 4: 发布 widget refresh 事件 (emitter).
   *
   * 由 onNewWant 在 action=startReview / action=openCard 等场景调用,
   * ReviewCardWidget.aboutToAppear 注册的 emitter.on 监听本事件后调用 refreshCardData.
   *
   * 5 分钟节流 (鸿蒙系统 updateForm 限制): 5 分钟内最多 1 次, 超频时 hilog.warn 跳过.
   * emitter.emit 同步投递 (不阻塞主流程, 内部仅派发到本进程 listener).
   *
   * 真机验证项:
   * - emitter 跨进程 (EntryAbility 主进程 ↔ widget 宿主进程) 是否生效;
   *   若不生效需改用 commonEventManager.publish + FormExtensionAbility 订阅.
   * - 5min 节流是否与系统 updateForm 限制一致 (系统可能更严格).
   */
  private publishWidgetRefresh(): void {
    try {
      const now: number = Date.now();
      if (now - this.lastWidgetRefresh < WIDGET_REFRESH_THROTTLE_MS) {
        hilog.warn(
          DOMAIN,
          TAG,
          'Widget refresh throttled (5min limit), skip'
        );
        return;
      }
      this.lastWidgetRefresh = now;
      emitter.emit({ eventId: WIDGET_REFRESH_EVENT_ID });
      hilog.info(
        DOMAIN,
        TAG,
        'Widget refresh event emitted (eventId=%{public}d)',
        WIDGET_REFRESH_EVENT_ID
      );
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'emitter.emit widget_refresh failed: code=%{public}d msg=%{public}s',
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
      // Stage 3: HarmonyBridge 注册已移至 Index.ets 的 Web 组件
      // onControllerAttached 回调, 确保 controller 与 Web 组件共享后再调用
      // registerJavaScriptProxy (修复 Stage 1 遗留的 controller 未共享导致
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
