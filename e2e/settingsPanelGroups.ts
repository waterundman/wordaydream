/**
 * v1.6.4 Stage 1 (P1 回归修复): 设置面板折叠组展开助手.
 *
 * 背景 —— 折叠引入的 E2E 基线破坏:
 * v1.6.4 Stage 1 把设置面板改为三层 IA, 快捷键 / 错词导出 / 错词导入 / 配置迁移 /
 * FSRS 参数优化 / AI 释义缓存 / 词库管理 等区块被移进**默认折叠**的原生 `<details>`
 * (`data-testid="settings-group-data-advanced"`), LLM 高级参数进
 * `settings-group-llm-advanced`. 原生 `<details>` 折叠态下子元素仍在 DOM, 但**没有渲染盒**,
 * 因此 Playwright 的 `toBeVisible()` / `click()` 一律判 hidden ——
 * web.spec.ts 的 T03/T04/T05/T06/T07/T11 全部因此失败.
 *
 * 处置 (首选方向): 不改产品结构 —— 折叠是 SPEC §3 S1 的明确目标. 改为在打开设置面板后
 * 先把所有折叠组展开, 再执行原有断言.
 *
 * 稳健性:
 * - 不硬编码组数: 以 `details[data-collapsible]` 的实际数量为上限;
 * - 不硬编码组名: 用 `details:not([open]) > summary` 定位「当前仍折叠」的组头;
 * - 等待 `open` 属性 (状态) 而不是 sleep, 避免动画/时序 flaky;
 * - 收口断言「无残留折叠组」, 让后续 `toBeVisible()` 的失败定位到展开步骤而不是内容断言.
 *
 * 本文件不是 spec (不被 testMatch 收集), 仅作为四个 spec 的共享模块, 避免选择器漂移.
 */
import { expect, type Locator } from '@playwright/test';

/** 展开设置面板内所有处于关闭态的折叠组 (幂等: 已全开时立即返回). */
export async function expandAllSettingsGroups(dialog: Locator): Promise<void> {
  const total = await dialog.locator('details[data-collapsible]').count();
  if (total === 0) return;

  for (let i = 0; i < total; i += 1) {
    const closedSummaries = dialog.locator('details:not([open]) > summary');
    if ((await closedSummaries.count()) === 0) break;

    const summary = closedSummaries.first();
    await summary.waitFor({ state: 'visible', timeout: 10_000 });
    const openedBefore = await dialog.locator('details[open]').count();
    await summary.click();
    // 状态等待: open 属性就位即视为展开完成 (不 sleep)
    await expect(dialog.locator('details[open]')).toHaveCount(openedBefore + 1);
  }

  // 收口: 不留任何折叠组, 否则组内 toBeVisible() / click() 必然失败
  await expect(dialog.locator('details:not([open])')).toHaveCount(0);
}