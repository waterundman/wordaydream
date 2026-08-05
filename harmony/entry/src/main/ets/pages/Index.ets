import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { HarmonyBridge } from '../bridge/HarmonyBridge';

const DOMAIN: number = 0x0001;
const TAG: string = 'Index';
const BRIDGE_NAME: string = 'harmonyBridge';
const BRIDGE_METHODS: string[] = [
  'getDueCardsCount',
  'registerReminder',
  'readPreferences',
  'writePreferences',
  'triggerHapticFeedback',
  'handleHarmonyLaunch',
  // Stage 3: Web ↔ 鸿蒙 relationalStore 双向同步 (upsertCard/deleteCard + getAllCards/getRecentlyReviewedCards/getTodayReviewStats)
  'upsertCard',
  'deleteCard',
  'getAllCards',
  'getRecentlyReviewedCards',
  'getTodayReviewStats',
];
const WEB_CONTROLLER_STORAGE_KEY: string = 'webController';

/**
 * Stage 2: ArkWeb origin 白名单匹配器 (arXiv:1410.7756 安全加固).
 *
 * 镜像 harmony/server/llm-proxy.js:53-59 的 origin 白名单模式.
 * 仅允许 localhost / 127.0.0.1 / arkweb:// / *.hapogo.com / file:// origin
 * 通过 registerJavaScriptProxy 注入 harmonyBridge, 防止非预期 origin 注入恶意 JS.
 */
function isAllowedArkWebOrigin(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }
  if (/^https?:\/\/localhost(:\d+)?$/.test(url)) {
    return true;
  }
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(url)) {
    return true;
  }
  if (/^arkweb:\/\/.*$/.test(url)) {
    return true;
  }
  if (/^https?:\/\/[a-z0-9-]+\.hapogo\.com(:\d+)?$/.test(url)) {
    return true;
  }
  if (/^file:\/\/.*$/.test(url)) {
    return true;
  }
  return false;
}

// Stage 1: ArkWeb container page.
// Loads the Vite-built Web bundle from rawfile and grants access to
// JavaScript / DOM storage / Web database / file access.
// Stage 3: HarmonyBridge 通过 Web 组件 onControllerAttached 回调注册,
//   解决 Stage 1 遗留的 controller 未与 Web 组件共享导致
//   registerJavaScriptProxy 静默失败问题.
@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  @State pageLoaded: boolean = false;
  private bridgeRegistered: boolean = false;

  aboutToAppear(): void {
    // Stage 5: 把 controller 写入 AppStorage, 供 EntryAbility.onNewWant
    //   -> HarmonyBridge.handleHarmonyLaunch 通过 AppStorage.get
    //   读取并调用 runJavaScript 派发卡片跳转到 ArkWeb.
    AppStorage.setOrCreate<webview.WebviewController>(
      WEB_CONTROLLER_STORAGE_KEY,
      this.controller
    );
  }

  build() {
    Stack() {
      Web({ src: $rawfile('dist/index.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.All)
        .cacheMode(CacheMode.Default)
        .width('100%')
        .height('100%')
        .onControllerAttached(() => {
          hilog.info(DOMAIN, TAG, 'Web controller attached');
        })
        .onPageBegin((event: OnPageBeginEvent) => {
          hilog.info(DOMAIN, TAG, 'Page begin: %{public}s', event?.url ?? 'null');
          if (this.bridgeRegistered) {
            return;
          }
          // rawfile 为本地安全资源, 跳过 origin 白名单检查 (避免 resource:// URL 误判).
          try {
            const ctx: common.Context = getContext(this) as common.Context;
            const bridge: HarmonyBridge = HarmonyBridge.getInstance(ctx);
            this.controller.registerJavaScriptProxy(
              bridge,
              BRIDGE_NAME,
              BRIDGE_METHODS
            );
            this.bridgeRegistered = true;
            hilog.info(DOMAIN, TAG, 'HarmonyBridge registered via onPageBegin');
          } catch (e) {
            const err: BusinessError = e as BusinessError;
            hilog.error(
              DOMAIN,
              TAG,
              'registerJavaScriptProxy failed: code=%{public}d msg=%{public}s',
              err.code,
              err.message
            );
          }
        })
        .onPageEnd(() => {
          this.pageLoaded = true;
          hilog.info(DOMAIN, TAG, 'Web page loaded successfully');
        })
        .onErrorReceive((event: OnErrorReceiveEvent) => {
          hilog.error(
            DOMAIN,
            TAG,
            'Web load error: code=%{public}d desc=%{public}s',
            event.error.getErrorCode(),
            event.error.getErrorInfo()
          );
        })
        .onHttpErrorReceive((event: OnHttpErrorReceiveEvent) => {
          hilog.error(
            DOMAIN,
            TAG,
            'HTTP error: code=%{public}d msg=%{public}s',
            event.response.getResponseCode(),
            event.response.getReasonMessage()
          );
        })
        .onConsole((event: OnConsoleEvent) => {
          const msg: string = event?.message?.getMessage() ?? '';
          const level: number = event?.message?.getMessageLevel() ?? 0;
          hilog.info(DOMAIN, TAG, '[Console:%{public}d] %{public}s', level, msg);
          return false;
        })

      // 加载中遮罩 (Web 页面加载完成前显示)
      if (!this.pageLoaded) {
        Column() {
          LoadingProgress()
            .width(48)
            .height(48)
            .color($r('app.color.start_window_background'))
          Text('Loading...')
            .fontSize(14)
            .fontColor('#6e6d68')
            .margin({ top: 12 })
        }
        .width('100%')
        .height('100%')
        .backgroundColor('#faf9f5')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
      }
    }
  }
}
