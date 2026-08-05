import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';

const DOMAIN: number = 0x0001;
const TAG: string = 'WebTest';

@Entry
@Component
struct WebTest {
  private controller: webview.WebviewController = new webview.WebviewController();

  build() {
    Column() {
      Text('JavaScript Execution Test')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .margin({ top: 20, bottom: 10 })

      Button('Open DevTools')
        .onClick(() => {
          hilog.info(DOMAIN, TAG, 'DevTools button clicked');
        })
        .margin({ bottom: 10 })

      Web({ src: $rawfile('dist/index-test.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.All)
        .cacheMode(CacheMode.None)
        .width('100%')
        .height('80%')
        .onControllerAttached(() => {
          hilog.info(DOMAIN, TAG, 'Test Web controller attached');
        })
        .onPageBegin((event) => {
          hilog.info(DOMAIN, TAG, 'Test page begin: %{public}s', event?.url ?? 'null');
        })
        .onPageEnd(() => {
          hilog.info(DOMAIN, TAG, 'Test page loaded');
        })
        .onErrorReceive((event) => {
          hilog.error(
            DOMAIN,
            TAG,
            'Test error: code=%{public}d msg=%{public}s',
            event.error.getErrorCode(),
            event.error.getErrorInfo()
          );
        })
        .onConsole((event) => {
          hilog.info(
            DOMAIN,
            TAG,
            'Console: %{public}s',
            event?.message?.getMessage() ?? 'null'
          );
          return false;
        })
    }
    .width('100%')
    .height('100%')
  }
}
