/**
 * 面板定位 CSS 契约 (v1.6.3 UX-fix)
 *
 * 背景
 * ----
 * 用户实测反馈「输入释义的输入框会乱跑, 导致整个界面变卡」。根因是 CSS 级联规则:
 * **animation fill-forwards 终态 > inline style > class 规则**。
 * InlineAnswerPanel 曾把 pageEntrance 入场动画以内联 style 叠加在面板上, 其终态
 * `transform: translateY(0)` (无 translateX(-50%)) 永久压死 `.panel.open` 的居中位移,
 * 面板整体右漂半宽 → 溢出视口 → focus 自动滚屏 → usePanelPosition 的 capture scroll
 * 监听重算 → transform 过渡滑行 → 循环 = 乱跑 + 卡顿。
 *
 * 修复口径 (本测试锁定的不变量):
 * 1. 面板水平位移统一由 inline 变量 `--panel-shift-x` 承载 (center = calc(-50% + Npx),
 *    left/right = 纯 Npx), 所有 transform 声明 (base / open / closing / keyframes) 一律消费该变量;
 * 2. `.panel` 的 transition 不得包含 transform (位置纠错瞬时化, 杜绝"游动");
 * 3. 面板组件不得内联 animation / opacity / transform 与 CSS 定位竞争;
 * 4. 旧变量 `--panel-offset-x` 与死类 `vocabPulse` (全仓无 CSS 规则命中) 保持清除。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const INLINE_PANEL_CSS = readFileSync(
  join(ROOT, 'src/features/reading/components/InlineAnswerPanel.module.css'),
  'utf8',
);
const GRAMMAR_PANEL_CSS = readFileSync(
  join(ROOT, 'src/features/grammar/components/GrammarPanel.module.css'),
  'utf8',
);

/** 提取某个顶层选择器块 (从 `selector {` 到配对 `}`) 的文本。 */
function extractBlock(css: string, selector: string): string | null {
  const idx = css.indexOf(selector);
  if (idx < 0) return null;
  const open = css.indexOf('{', idx);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  return null;
}

/** 提取 @keyframes 块文本。 */
function extractKeyframes(css: string, name: string): string | null {
  return extractBlock(css, `@keyframes ${name}`);
}

describe('v1.6.3 UX-fix — 面板定位 CSS 契约', () => {
  it('T01 [critical]: InlineAnswerPanel .panel 的 transition 不含 transform (位置纠错瞬时化)', () => {
    const base = extractBlock(INLINE_PANEL_CSS, '.panel {');
    expect(base).not.toBeNull();
    const transition = base!.match(/transition:\s*([^;]+);/)?.[1] ?? '';
    expect(transition).not.toMatch(/transform/);
  });

  it('T02 [critical]: .panel 基态/open/closing 的 transform 一律消费 --panel-shift-x', () => {
    for (const selector of ['.panel {', '.panel.open', '.panel.closing']) {
      const block = extractBlock(INLINE_PANEL_CSS, selector);
      expect(block, `${selector} 存在`).not.toBeNull();
      const transform = block!.match(/transform:\s*([^;]+);/)?.[1] ?? '';
      expect(transform, `${selector} transform 消费 shift 变量`).toContain('var(--panel-shift-x');
      // 锁死旧硬编码形态不得回归 (fill-forwards 曾借它丢掉居中/偏移)
      expect(transform, `${selector} 不得硬编码 translateX(-50%)`).not.toMatch(
        /translateX\(-50%\)/,
      );
    }
  });

  it('T03 [critical]: GrammarPanel panelExpand/panelCollapse keyframes 消费 --panel-shift-x', () => {
    for (const name of ['panelExpand', 'panelCollapse']) {
      const kf = extractKeyframes(GRAMMAR_PANEL_CSS, name);
      expect(kf, `${name} 存在`).not.toBeNull();
      const transforms = [...kf!.matchAll(/transform:\s*([^;]+);/g)].map((m) => m[1]);
      expect(transforms.length).toBeGreaterThan(0);
      for (const t of transforms) {
        expect(t, `${name} 的 transform 消费 shift 变量`).toContain('var(--panel-shift-x');
        expect(t, `${name} 不得硬编码 translateX(-50%)`).not.toMatch(/translateX\(-50%\)/);
      }
    }
  });

  it('T04: GrammarPanel 基态 .panel transform 消费 --panel-shift-x', () => {
    const base = extractBlock(GRAMMAR_PANEL_CSS, '.panel {');
    expect(base).not.toBeNull();
    const transform = base!.match(/transform:\s*([^;]+);/)?.[1] ?? '';
    expect(transform).toContain('var(--panel-shift-x');
  });

  it('T05: 旧变量 --panel-offset-x 全仓清除 (两份面板 CSS 均不得残留)', () => {
    expect(INLINE_PANEL_CSS).not.toContain('--panel-offset-x');
    expect(GRAMMAR_PANEL_CSS).not.toContain('--panel-offset-x');
  });

  it('T06: 死类 vocabPulse 与其 keyframes 保持清除 (锁定删除决定)', () => {
    const indexCss = readFileSync(join(ROOT, 'src/index.css'), 'utf8');
    expect(indexCss).not.toContain('@keyframes vocabPulse');
    expect(INLINE_PANEL_CSS).not.toContain('vocabPulse');
  });

  it('T07: pageEntrance 死 keyframes 引用不回到面板 (panelEnter 已删除)', () => {
    expect(INLINE_PANEL_CSS).not.toContain('panelEnter');
  });
});
