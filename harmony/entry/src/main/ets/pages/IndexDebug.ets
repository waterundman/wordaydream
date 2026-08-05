import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { HarmonyBridge } from '../bridge/HarmonyBridge';

const DOMAIN: number = 0x0001;
const TAG: string = 'IndexDebug';
const BRIDGE_NAME: string = 'harmonyBridge';
const BRIDGE_METHODS: string[] = [
  'getDueCardsCount',
  'registerReminder',
  'readPreferences',
  'writePreferences',
  'triggerHapticFeedback',
  'handleHarmonyLaunch',
  'getReviewCardsCount',
  'getLearningCardsCount',
  'getNewCardsCount',
  'getCard',
  'answerCard',
  'getWordlist',
  'setWordlistEnabled',
  'searchWordlists',
  'getDatabaseStats',
  'exportDatabase',
  'importDatabase',
  'getAppVersion',
  'getPlatform',
  'haptic',
  'scheduleReminder',
  'cancelReminder',
  'getActiveReminders',
];

@Entry
@Component
struct IndexDebug {
  private controller: webview.WebviewController = new webview.WebviewController();
  @State private bridgeRegistered: boolean = false;
  @State private pageLoaded: boolean = false;

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'IndexDebug page appearing');
  }

  build() {
    Column() {
      Row() {
        Button('Test Debug Page')
          .onClick(() => {
            this.controller.loadUrl($rawfile('dist/index-debug.html'));
          })
          .margin({ right: 10 })

        Button('Test Original Page')
          .onClick(() => {
            this.controller.loadUrl($rawfile('dist/index.html'));
          })
          .margin({ right: 10 })

        Button('Reload')
          .onClick(() => {
            this.controller.refresh();
          })
      }
      .width('100%')
      .padding(10)
      .justifyContent(FlexAlign.Center)

      Web({ src: $rawfile('dist/index-debug.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.All)
        .cacheMode(CacheMode.None)
        .width('100%')
        .layoutWeight(1)
        .onControllerAttached(() => {
          hilog.info(DOMAIN, TAG, 'Web controller attached');
        })
        .onPageBegin((event: OnPageBeginEvent) => {
          hilog.info(DOMAIN, TAG, 'Page begin: %{public}s', event?.url ?? 'null');
          if (this.bridgeRegistered) {
            return;
          }
          try {
            const ctx: common.Context = getContext(this) as common.Context;
            const bridge: HarmonyBridge = HarmonyBridge.getInstance(ctx);
            this.controller.registerJavaScriptProxy(
              bridge,
              BRIDGE_NAME,
              BRIDGE_METHODS
            );
            this.bridgeRegistered = true;
            hilog.info(DOMAIN, TAG, 'HarmonyBridge registered');
          } catch (e) {
            const err: BusinessError = e as BusinessError;
            hilog.error(DOMAIN, TAG, 'Bridge registration failed: %{public}d %{public}s', err.code, err.message);
          }
        })
        .onPageEnd(() => {
          this.pageLoaded = true;
          hilog.info(DOMAIN, TAG, 'Page loaded successfully');
        })
        .onErrorReceive((event: OnErrorReceiveEvent) => {
          hilog.error(
            DOMAIN,
            TAG,
            'Web error: code=%{public}d msg=%{public}s',
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
    }
    .width('100%')
    .height('100%')
  }
}
