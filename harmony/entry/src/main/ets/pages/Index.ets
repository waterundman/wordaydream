import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { picker } from '@kit.CoreFileKit';
import { HarmonyBridge } from '../bridge/HarmonyBridge';
import {
  BRIDGE_ASYNC_METHODS,
  BRIDGE_NAME,
  BRIDGE_SYNC_METHODS,
  WEB_CONTENT_READY_STORAGE_KEY,
  WEB_CONTROLLER_STORAGE_KEY,
  WEB_HANDLER_READY_STORAGE_KEY,
} from '../bridge/BridgeMethodRegistry';
import {
  APP_ENTRY_URL,
  isAppOriginRequest,
  isTrustedAppDocument,
  LocalResourceDescriptor,
  resolveLocalResource,
} from './ArkWebLocalResource';

const DOMAIN: number = 0x0001;
const TAG: string = 'Index';
const CONTENT_READY_TIMEOUT_MS: number = 12000;
const CSV_ACCEPT_TYPES: string[] = [
  '.csv',
  '.txt',
  'text/csv',
  'application/csv',
  'text/plain',
];
const CSV_FILE_SUFFIX_FILTER: string = 'CSV / Text|.csv,.txt';

function isCsvTextFileUri(uri: string): boolean {
  const path: string = uri.split('#')[0].split('?')[0].toLowerCase();
  let decodedPath: string = path;
  try {
    decodedPath = decodeURIComponent(path);
  } catch (_) {
    // A malformed escape sequence cannot turn a non-matching URI into a
    // supported file, so checking the original path is still safe.
  }
  return decodedPath.endsWith('.csv') || decodedPath.endsWith('.txt');
}

function requestsCsvTextFile(fileSelector: FileSelectorParam): boolean {
  if (
    fileSelector.getMode() !== FileSelectorMode.FileOpenMode ||
    fileSelector.isCapture()
  ) {
    return false;
  }

  const acceptedTypes: string[] = fileSelector
    .getAcceptType()
    .concat(fileSelector.getMimeTypes());
  return acceptedTypes.some((type: string) => {
    return CSV_ACCEPT_TYPES.includes(type.trim().toLowerCase());
  });
}

/** Build a completed in-memory response so app-origin failures never hit DNS. */
function createTextResponse(
  statusCode: number,
  reason: string,
  body: string
): WebResourceResponse {
  const response: WebResourceResponse = new WebResourceResponse();
  response.setResponseData(body);
  response.setResponseMimeType('text/plain');
  response.setResponseEncoding('utf-8');
  response.setResponseCode(statusCode);
  response.setReasonMessage(reason);
  response.setResponseIsReady(true);
  return response;
}

/**
 * ArkWeb production shell. Packaged rawfiles are exposed only through one
 * synthetic HTTPS origin so HTML, CSS and JavaScript have normal same-origin
 * semantics without enabling file access.
 */
@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  @StorageLink(WEB_CONTENT_READY_STORAGE_KEY) pageLoaded: boolean = false;
  @State loadFailed: boolean = false;
  private bridgeRegistered: boolean = false;
  private currentPageTrusted: boolean = false;
  private documentGeneration: number = 0;
  private contentReadyTimer: number = -1;

  aboutToDisappear(): void {
    this.clearContentReadyTimer();
    this.pageLoaded = false;
    this.currentPageTrusted = false;
    this.unregisterBridge('page disappearing');
  }

  private clearContentReadyTimer(): void {
    if (this.contentReadyTimer >= 0) {
      clearTimeout(this.contentReadyTimer);
      this.contentReadyTimer = -1;
    }
  }

  private scheduleContentReadyTimeout(): void {
    this.clearContentReadyTimer();
    this.contentReadyTimer = setTimeout(() => {
      this.contentReadyTimer = -1;
      if (this.currentPageTrusted && !this.pageLoaded) {
        this.loadFailed = true;
        hilog.error(
          DOMAIN,
          TAG,
          'Web content readiness timed out after %{public}d ms',
          CONTENT_READY_TIMEOUT_MS
        );
      }
    }, CONTENT_READY_TIMEOUT_MS);
  }

  private markCriticalLoadFailure(
    request: WebResourceRequest,
    reason: string
  ): void {
    if (
      !this.pageLoaded &&
      (request.isMainFrame() || isAppOriginRequest(request.getRequestUrl()))
    ) {
      this.clearContentReadyTimer();
      this.loadFailed = true;
      hilog.error(DOMAIN, TAG, 'Critical Web load failure: %{public}s', reason);
    }
  }

  private retryPage(): void {
    this.clearContentReadyTimer();
    this.loadFailed = false;
    this.pageLoaded = false;
    try {
      this.controller.refresh();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      this.loadFailed = true;
      hilog.error(
        DOMAIN,
        TAG,
        'Unable to retry Web page: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  private unregisterBridge(reason: string): void {
    AppStorage.delete(WEB_CONTROLLER_STORAGE_KEY);
    AppStorage.delete(WEB_HANDLER_READY_STORAGE_KEY);
    if (!this.bridgeRegistered) {
      return;
    }
    try {
      this.controller.deleteJavaScriptRegister(BRIDGE_NAME);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'deleteJavaScriptRegister failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
    this.bridgeRegistered = false;
    hilog.info(DOMAIN, TAG, 'HarmonyBridge unregistered: %{public}s', reason);
  }

  private registerBridge(): void {
    if (this.bridgeRegistered) {
      return;
    }
    try {
      const ctx: common.Context =
        this.getUIContext().getHostContext() as common.Context;
      const bridge: HarmonyBridge = HarmonyBridge.getInstance(ctx);
      this.controller.registerJavaScriptProxy(
        bridge,
        BRIDGE_NAME,
        BRIDGE_SYNC_METHODS,
        BRIDGE_ASYNC_METHODS
      );
      this.bridgeRegistered = true;
      hilog.info(DOMAIN, TAG, 'HarmonyBridge registered via onControllerAttached');
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
  }

  private dispatchPendingLaunches(): void {
    const ctx: common.Context =
      this.getUIContext().getHostContext() as common.Context;
    HarmonyBridge.getInstance(ctx).resumePendingLaunches();
  }

  private stopUntrustedNavigation(reason: string): void {
    this.currentPageTrusted = false;
    this.unregisterBridge(reason);
    try {
      this.controller.stop();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'Unable to stop untrusted navigation: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  private interceptLocalRequest(request: WebResourceRequest): WebResourceResponse | null {
    const requestUrl: string = request.getRequestUrl();
    if (!isAppOriginRequest(requestUrl)) {
      return null;
    }

    const method: string = request.getRequestMethod().toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return createTextResponse(405, 'Method Not Allowed', 'Method Not Allowed');
    }

    const resource: LocalResourceDescriptor | null =
      resolveLocalResource(requestUrl);
    if (resource === null) {
      return createTextResponse(404, 'Not Found', 'Not Found');
    }

    const response: WebResourceResponse = new WebResourceResponse();
    response.setResponseData(
      method === 'HEAD' ? '' : $rawfile(resource.rawfilePath)
    );
    response.setResponseMimeType(resource.mimeType);
    if (resource.isText) {
      response.setResponseEncoding('utf-8');
    }
    response.setResponseCode(200);
    response.setReasonMessage('OK');
    response.setResponseIsReady(true);
    return response;
  }

  private finishFileSelection(
    result: FileSelectorResult,
    fileList: string[]
  ): void {
    try {
      result.handleFileList(fileList);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'Unable to complete Web file selection: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  private async selectCsvTextFile(
    result: FileSelectorResult,
    trustedDocumentGeneration: number
  ): Promise<void> {
    try {
      const context: common.UIAbilityContext =
        this.getUIContext().getHostContext() as common.UIAbilityContext;
      const documentPicker: picker.DocumentViewPicker =
        new picker.DocumentViewPicker(context);
      const options: picker.DocumentSelectOptions = {
        fileSuffixFilters: [CSV_FILE_SUFFIX_FILTER],
        maxSelectNumber: 1,
        selectMode: picker.DocumentSelectMode.FILE,
      };
      const selectedUris: string[] = await documentPicker.select(options);
      const fileList: string[] = selectedUris
        .filter((uri: string) => isCsvTextFileUri(uri))
        .slice(0, 1);
      if (
        !this.currentPageTrusted ||
        this.documentGeneration !== trustedDocumentGeneration
      ) {
        hilog.warn(DOMAIN, TAG, 'Discarded picker result after page generation changed');
        this.finishFileSelection(result, []);
        return;
      }
      if (selectedUris.length > 0 && fileList.length === 0) {
        hilog.warn(DOMAIN, TAG, 'Rejected a non-CSV/text picker result');
      }
      this.finishFileSelection(result, fileList);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.info(
        DOMAIN,
        TAG,
        'CSV/text picker closed without a file: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      this.finishFileSelection(result, []);
    }
  }

  private handleFileSelector(event: OnShowFileSelectorEvent): boolean {
    if (
      !this.currentPageTrusted ||
      !requestsCsvTextFile(event.fileSelector)
    ) {
      // Returning true prevents ArkWeb from falling back to an unrestricted
      // picker for multiple files, folders, save requests, capture, or other
      // file types.
      this.finishFileSelection(event.result, []);
      return true;
    }

    this.selectCsvTextFile(event.result, this.documentGeneration);
    return true;
  }

  build() {
    Stack() {
      Web({ src: APP_ENTRY_URL, controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(false)
        .cacheMode(CacheMode.Default)
        .width('100%')
        .height('100%')
        .onControllerAttached(() => {
          hilog.info(DOMAIN, TAG, 'Web controller attached');
          this.registerBridge();
        })
        .onInterceptRequest((event: OnInterceptRequestEvent) => {
          return this.interceptLocalRequest(event.request);
        })
        .onShowFileSelector((event: OnShowFileSelectorEvent) => {
          return this.handleFileSelector(event);
        })
        .onOverrideUrlLoading((request: WebResourceRequest) => {
          const url: string = request.getRequestUrl();
          if (request.isMainFrame() && isTrustedAppDocument(url)) {
            // If an earlier untrusted navigation removed the proxy, registering
            // before this load makes it available in the next document.
            this.registerBridge();
            return false;
          }
          hilog.warn(
            DOMAIN,
            TAG,
            'Blocked ArkWeb frame navigation: %{public}s',
            url
          );
          return true;
        })
        .onPageBegin((event: OnPageBeginEvent) => {
          const url: string = event?.url ?? '';
          this.documentGeneration += 1;
          this.clearContentReadyTimer();
          this.pageLoaded = false;
          this.loadFailed = false;
          this.currentPageTrusted = isTrustedAppDocument(url);
          AppStorage.delete(WEB_CONTROLLER_STORAGE_KEY);
          AppStorage.delete(WEB_HANDLER_READY_STORAGE_KEY);
          hilog.info(DOMAIN, TAG, 'Page begin: %{public}s', url);
          if (!this.currentPageTrusted) {
            this.unregisterBridge('untrusted page');
            hilog.warn(DOMAIN, TAG, 'Native bridge blocked for URL: %{public}s', url);
          } else {
            this.registerBridge();
          }
        })
        .onNavigationEntryCommitted((details: LoadCommittedDetails) => {
          if (!details.isMainFrame || !isTrustedAppDocument(details.url)) {
            hilog.error(
              DOMAIN,
              TAG,
              'Untrusted ArkWeb document committed: %{public}s',
              details.url
            );
            this.stopUntrustedNavigation('untrusted document committed');
          }
        })
        .onPageEnd(() => {
          if (this.currentPageTrusted && this.bridgeRegistered) {
            AppStorage.setOrCreate<webview.WebviewController>(
              WEB_CONTROLLER_STORAGE_KEY,
              this.controller
            );
            this.dispatchPendingLaunches();
            if (!this.pageLoaded && !this.loadFailed) {
              this.scheduleContentReadyTimeout();
            }
          }
          hilog.info(
            DOMAIN,
            TAG,
            'Web shell loaded; awaiting explicit Web handler readiness'
          );
        })
        .onErrorReceive((event: OnErrorReceiveEvent) => {
          this.markCriticalLoadFailure(
            event.request,
            event.error.getErrorInfo()
          );
          hilog.error(
            DOMAIN,
            TAG,
            'Web load error: code=%{public}d desc=%{public}s',
            event.error.getErrorCode(),
            event.error.getErrorInfo()
          );
        })
        .onHttpErrorReceive((event: OnHttpErrorReceiveEvent) => {
          this.markCriticalLoadFailure(
            event.request,
            event.response.getReasonMessage()
          );
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
          if (this.loadFailed) {
            Text('Unable to load the app')
              .fontSize(18)
              .fontWeight(FontWeight.Medium)
              .fontColor('#30302d')
            Text('Please check the app package and try again.')
              .fontSize(14)
              .fontColor('#6e6d68')
              .margin({ top: 8 })
            Button('Retry')
              .margin({ top: 20 })
              .onClick(() => {
                this.retryPage();
              })
          } else {
            LoadingProgress()
              .width(48)
              .height(48)
              .color($r('app.color.start_window_background'))
            Text('Loading...')
              .fontSize(14)
              .fontColor('#6e6d68')
              .margin({ top: 12 })
          }
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
