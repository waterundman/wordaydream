import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const harmonyMain = join(projectRoot, 'harmony', 'entry', 'src', 'main');
const harmonyEts = join(harmonyMain, 'ets');

describe('Harmony production manifest', () => {
  it('requests only the native capabilities used by the shell', () => {
    const moduleProfile = readFileSync(
      join(harmonyMain, 'module.json5'),
      'utf8',
    );

    expect(moduleProfile).toContain('ohos.permission.INTERNET');
    expect(moduleProfile).toContain('ohos.permission.VIBRATE');
    expect(moduleProfile).not.toContain(
      'ohos.permission.KEEP_BACKGROUND_RUNNING',
    );
  });

  it('keeps obsolete debug pages out of the production source set', () => {
    const pageProfile = JSON.parse(
      readFileSync(
        join(harmonyMain, 'resources', 'base', 'profile', 'main_pages.json'),
        'utf8',
      ),
    ) as { src: string[] };
    const pagesDir = join(harmonyMain, 'ets', 'pages');

    expect(pageProfile.src).toEqual(['pages/Index']);
    expect(existsSync(join(pagesDir, 'Index.ets'))).toBe(true);
    expect(existsSync(join(pagesDir, 'IndexDebug.ets'))).toBe(false);
    expect(existsSync(join(pagesDir, 'WebTest.ets'))).toBe(false);
  });

  it('dispatches native launches only after the explicit Web readiness handshake', () => {
    const registry = readFileSync(
      join(harmonyEts, 'bridge', 'BridgeMethodRegistry.ets'),
      'utf8',
    );
    const bridge = readFileSync(
      join(harmonyEts, 'bridge', 'HarmonyBridge.ets'),
      'utf8',
    );
    const page = readFileSync(join(harmonyEts, 'pages', 'Index.ets'), 'utf8');
    const main = readFileSync(join(projectRoot, 'src', 'main.tsx'), 'utf8');
    expect(registry).toContain("'notifyWebReady'");
    expect(registry).toContain('WEB_HANDLER_READY_STORAGE_KEY');
    expect(bridge).toMatch(
      /notifyWebReady\(\): void[\s\S]*?WEB_HANDLER_READY_STORAGE_KEY, true[\s\S]*?WEB_READY_GENERATION_STORAGE_KEY[\s\S]*?resumePendingLaunches\(\)/,
    );
    expect(bridge).toMatch(
      /resumePendingLaunches\(\): void[\s\S]*?WEB_HANDLER_READY_STORAGE_KEY[\s\S]*?if \(!webHandlerReady\)[\s\S]*?WEB_CONTROLLER_STORAGE_KEY/,
    );
    expect(main).toMatch(
      /installHarmonyLaunchHandling\(\)[\s\S]*?harmonyBridge\?\.notifyWebReady\(\)/,
    );

    const pageEnd = page.slice(page.indexOf('.onPageEnd('), page.indexOf('.onErrorReceive('));
    expect(pageEnd).toContain('WEB_CONTROLLER_STORAGE_KEY');
    expect(pageEnd).toContain('dispatchPendingLaunches');
    expect(pageEnd).not.toContain('WEB_HANDLER_READY_STORAGE_KEY');
    expect(pageEnd).not.toContain('WEB_READY_GENERATION_STORAGE_KEY');
  });

  it('removes the native loading layer only after React commits content', () => {
    const registry = readFileSync(
      join(harmonyEts, 'bridge', 'BridgeMethodRegistry.ets'),
      'utf8',
    );
    const bridge = readFileSync(
      join(harmonyEts, 'bridge', 'HarmonyBridge.ets'),
      'utf8',
    );
    const page = readFileSync(join(harmonyEts, 'pages', 'Index.ets'), 'utf8');
    const main = readFileSync(join(projectRoot, 'src', 'main.tsx'), 'utf8');
    const contentReady = readFileSync(
      join(projectRoot, 'src', 'platform', 'HarmonyContentReady.tsx'),
      'utf8',
    );

    expect(registry).toContain("'notifyWebContentReady'");
    expect(registry).toContain('WEB_CONTENT_READY_STORAGE_KEY');
    expect(bridge).toMatch(
      /notifyWebContentReady\(\): void[\s\S]*?WEB_CONTENT_READY_STORAGE_KEY, true/,
    );
    expect(contentReady).toMatch(
      /function HarmonyContentReady\(\)[\s\S]*?useEffect\(\(\) => \{[\s\S]*?harmonyBridge\?\.notifyWebContentReady\(\)/,
    );
    expect(main).toMatch(/<HarmonyContentReady \/>[\s\S]*?<App \/>/);

    const pageEnd = page.slice(
      page.indexOf('.onPageEnd('),
      page.indexOf('.onErrorReceive('),
    );
    expect(pageEnd).not.toContain('this.pageLoaded = true');
    expect(pageEnd).toContain('scheduleContentReadyTimeout');
    expect(page).toContain('@StorageLink(WEB_CONTENT_READY_STORAGE_KEY)');
    expect(page).toContain("Text('Unable to load the app')");
    expect(page).toContain('this.controller.refresh()');
  });

  it('serves packaged ArkWeb assets through one strict synthetic HTTPS origin', () => {
    const page = readFileSync(join(harmonyEts, 'pages', 'Index.ets'), 'utf8');
    const policy = readFileSync(
      join(harmonyEts, 'pages', 'ArkWebLocalResource.ets'),
      'utf8',
    );

    expect(policy).toContain("APP_ORIGIN: string = 'https://app.wordaydream.invalid'");
    expect(policy).toContain("APP_ENTRY_PATH: string = '/index.html'");
    expect(page).toContain('Web({ src: APP_ENTRY_URL');
    expect(page).toContain('.onInterceptRequest(');
    expect(page).toContain('resolveLocalResource(requestUrl)');
    expect(page).toContain("createTextResponse(404, 'Not Found'");
    expect(page).toContain("createTextResponse(405, 'Method Not Allowed'");
    expect(page).toContain('.fileAccess(false)');
    expect(page).toContain('.onNavigationEntryCommitted(');
    expect(page).not.toContain("$rawfile('dist/index.html')");
  });

  it('allows only same-origin module Workers in the document policy', () => {
    const html = readFileSync(join(projectRoot, 'index.html'), 'utf8');

    expect(html).toMatch(/worker-src\s+'self'/);
    expect(html).not.toMatch(/worker-src[^;]*\bblob:/);
  });

  it('handles ArkWeb CSV input through the read-only system document picker', () => {
    const page = readFileSync(join(harmonyEts, 'pages', 'Index.ets'), 'utf8');

    expect(page).toContain("import { picker } from '@kit.CoreFileKit'");
    expect(page).toContain('.onShowFileSelector(');
    expect(page).toContain('FileSelectorMode.FileOpenMode');
    expect(page).toContain('fileSelector.isCapture()');
    expect(page).toContain("CSV / Text|.csv,.txt");
    expect(page).toMatch(
      /new picker\.DocumentViewPicker\(context\)[\s\S]*?maxSelectNumber: 1[\s\S]*?selectMode: picker\.DocumentSelectMode\.FILE[\s\S]*?documentPicker\.select\(options\)/,
    );
    expect(page).toMatch(
      /selectedUris[\s\S]*?isCsvTextFileUri\(uri\)[\s\S]*?\.slice\(0, 1\)/,
    );
    expect(page).toContain('this.finishFileSelection(event.result, [])');
    expect(page).toContain('this.documentGeneration !== trustedDocumentGeneration');
    expect(page).not.toContain('documentPicker.save(');
    expect(page).not.toContain('picker.DocumentSelectMode.FOLDER');
    expect(page).not.toContain('picker.DocumentSelectMode.MIXED');
  });
});
