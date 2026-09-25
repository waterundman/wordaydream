/**
 * App 过渡层收敛与导航排队 (v1.6.1 Stage 3)
 *
 * 覆盖 SPEC §6.1 `App.transition.test.tsx` (3 测试):
 * - T01 [critical]: 过渡容器为单层 —— `<InkWipeTransition>` 在 App.tsx 中只有 1 处使用点
 * - T02 [critical]: 过渡进行中的导航被排队, 不被同步改写 appMode; cover 阶段消费队首,
 *                   当前过渡结束后接续播放剩余队列
 * - T03 [critical]: 内层页面元素按 appMode 绑定 key, 且 key 不挂在过渡容器上
 *
 * 背景 (SPEC §3 P1-2):
 *   原实现 5 条 appMode 分支各自包裹一次 `<InkWipeTransition>`, 且 `navigateTo` 在
 *   `isTransitioning === true` 时直接同步 `setAppMode` (v2.4.0 为解死锁引入), 导致
 *   首屏开场 1.9s 窗口内的导航完全没有过渡 —— 内容在正在退场的 overlay 后面突变。
 *
 * T02 的判别力 (为什么这个测试值得存在):
 *   旧实现在"过渡中进行导航"时会**同步**改写 `currentMode`。因此
 *   「两次点击后 appMode 仍为 home」这条断言在旧实现下必然失败。
 *   本测试用"连点两个不同导航目标"来构造该场景, 从而不依赖首屏那 1.9s 窗口的时序 ——
 *   无论首屏开场是否仍在播放, 第二次点击都必然落在"过渡进行中"。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import App from '../App';
import { useAppModeStore } from '../hooks/useAppModeStore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');

/**
 * App.tsx 源码, 但剥掉整行注释 —— 否则注释里提到的
 * `<InkWipeTransition>` / `key={appMode}` 会被正则当成真实使用点计入。
 * 只丢弃"整行注释"(trim 后以 // 、* 、/* 开头), 不触碰行内字符串, 避免误伤。
 */
const APP_SOURCE = readFileSync(resolve(projectRoot, 'src/App.tsx'), 'utf-8');
const APP_CODE = APP_SOURCE.split('\n')
  .filter((line) => {
    const trimmed = line.trim();
    return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
  })
  .join('\n');

beforeAll(() => {
  // jsdom 无 matchMedia。统一应答 reduce-motion=false —— 需要真实的 400ms cover 时序
  // 才能观察到"过渡进行中"的窗口 (reduce-motion 分支会把 cover 变成同步调用)。
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

beforeEach(() => {
  useAppModeStore.setState({ currentMode: 'home', previousMode: null });
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
    // window.location 与 localStorage 一样跨用例共享: T02 会经 useUrlHashSync 把
    // hash 写成 '#/wordlist'; 若后续用例在此之前新增, 会被残留深链接拉离 home。
    // 用 replaceState 而非 `location.hash = ''` —— 后者会触发 hashchange 绕回 store。
    window.history.replaceState(null, '', '/');
  }
});

afterEach(() => {
  cleanup();
});

describe('App 过渡层 (v1.6.1 Stage 3)', () => {
  it('T01 [critical]: 过渡容器为单层 —— App.tsx 中 <InkWipeTransition> 仅 1 处使用点', () => {
    const openTags = APP_CODE.match(/<InkWipeTransition\b/g) ?? [];
    const closeTags = APP_CODE.match(/<\/InkWipeTransition>/g) ?? [];

    expect(openTags, '开标签应只有 1 个 (单层包裹)').toHaveLength(1);
    expect(closeTags, '闭标签应与开标签配对').toHaveLength(1);

    // 原先 5 条分支各包裹一次 → 重构后不应再出现"容器直接包住某个页面组件"的写法
    expect(APP_CODE).not.toMatch(/<InkWipeTransition[^>]*>\s*<\w+Page/);
  });

  it(
    'T02 [critical]: 过渡进行中的导航被排队 —— 不同步改写 appMode, 后续接续换页',
    async () => {
      render(<App />);

      // 首屏为 lazy 路由, 等 HomePage 挂载
      const cta = await screen.findByTestId('hero-cta', {}, { timeout: 15_000 });
      expect(useAppModeStore.getState().currentMode).toBe('home');

      // 第 1 次点击: 起播一段过渡 (或加入开场过渡的队列)
      fireEvent.click(cta);
      // 第 2 次点击: 必然落在"过渡进行中"的窗口里 → 必须排队
      fireEvent.click(screen.getByRole('button', { name: '查看词表' }));

      // 判别性断言: 过渡中的导航不得被同步应用到 appMode。
      // 旧实现 (v2.4.0 的 `if (isTransitioning) { setAppMode(mode); return }`)
      // 会在此处把 currentMode 立刻改成 reading / wordlist, 本断言随即失败。
      expect(
        useAppModeStore.getState().currentMode,
        '过渡进行中的导航不应被同步应用到 appMode',
      ).toBe('home');

      // 当前过渡进入 cover 阶段 → 消费队首 (reading)
      await waitFor(
        () => {
          expect(useAppModeStore.getState().currentMode).toBe('reading');
        },
        { timeout: 10_000 },
      );

      // 当前过渡结束 → 队列剩余项接续播放 → 再消费一次 (wordlist)。
      // 这一段覆盖了 rAF 重启路径 (必须分帧翻转 active, 否则 React 批处理会吞掉)。
      await waitFor(
        () => {
          expect(useAppModeStore.getState().currentMode).toBe('wordlist');
        },
        { timeout: 10_000 },
      );
    },
    30_000,
  );

  it('T03 [critical]: 内层页面元素按 appMode 绑定 key, 且 key 不落在过渡容器上', () => {
    const keyBindings = APP_CODE.match(/key=\{appMode\}/g) ?? [];
    expect(keyBindings, '每个分支的页面元素都应绑定 key={appMode}').toHaveLength(5);

    // key 若挂在过渡容器上, 换页会重建 InkWipeTransition 实例, 把正在播放的
    // 过渡状态 (phase) 直接丢掉 —— 这正是"单层包裹 + 内层 key"分工的意义。
    const transitionBlock = APP_CODE.slice(
      APP_CODE.indexOf('<InkWipeTransition'),
      APP_CODE.indexOf('</InkWipeTransition>'),
    );
    expect(transitionBlock.length, '应能定位到过渡容器代码块').toBeGreaterThan(0);
    expect(transitionBlock, '过渡容器自身不应带 key').not.toMatch(/<InkWipeTransition\s+key=/);
  });
});
