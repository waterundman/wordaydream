/**
 * Wordaydream v1.2.0 Stage 3: Web E2E 首批 (Playwright)
 *
 * 范围: 纯 Web 主链路 (复习 / 错词本 / 设置), 与既有 harmony / offline spec 解耦.
 * 不改任何 src/ 代码, 也不触碰 playwright.harmony.config.ts. 本文件会被
 * playwright.config.ts 的 testMatch (.*\.spec\.ts) 自动纳入, harmony 两个 spec
 * 已被 testIgnore 排除, 因此本文件不会让鸿蒙 spec 回归.
 *
 * 种子策略 (contract: 宁真勿猜):
 * 应用本身无 demo/种子数据, 复习链必须至少 1 张 due 卡. 采用 playwright addInitScript
 * 在页面加载前把 zustand persist 格式的 localStorage 写入:
 *   - 'wordaydream:memory'        (useMemoryStore, name/version/partialize 见源码)
 *   - 'wordaydream:wrong-words'   (useWrongWordsStore, name=wordaydream:wrong-words, version=1)
 * 字段与 persist 定义逐一对齐: memory 卡片以 lexemeGroupId 为 Map key, partialize 仅存
 * cards/ratingHistory/schemaVersion; wrong-words 仅存 entries. 卡片 FSRS 字段取
 * createEmptyCard 同款初值 (state=new, stability/difficulty/elapsedDays/scheduledDays/
 * reps/lapses=0), 保证 rateCard 内 f.repeat() 不抛错.
 *
 * 评分入账口径 (源码事实): useReviewSessionStore.completeReview 仅当
 * evaluation.grade === 'wrong' 才 recordWrong. mock provider 对"非中文答案 + 不在
 * EVAL_KEYWORDS 的 lemma" 判定 grade='wrong' (见 mockProvider.lookupEvaluation 启发式).
 * 故 T01 用 lemma='wake' + 输入 'zzzzz' (非中文) 稳定得到 wrong, 再点"重来"触发入账.
 *
 * 选择器: 优先 data-testid / aria-label / 文本, 与源码一致; 评分按钮用可见文案 /重来/,
 * 设置面板用 [role="dialog"][aria-modal="true"] 与 data-testid 区块.
 */

import { test, expect, type Page } from '@playwright/test';

const SHOTS_DIR = 'debug_shots_web';

interface SeedCard {
  id: string;
  lexemeGroupId: string;
  lemma: string;
  objectiveDifficulty: number;
  language: 'en' | 'de';
  due: number;
}

interface SeedWrongWord {
  cardId: string;
  lexemeGroupId: string;
  lemma: string;
  language?: 'en' | 'de';
  wrongCount: number;
  lastWrongAt: number;
  firstWrongAt: number;
}

/** 在页面加载前写入 zustand persist 格式的 memory store (键名 wordaydream:memory, version 2). */
function seedMemory(page: Page, cards: SeedCard[]): Promise<void> {
  return page.addInitScript((cards: SeedCard[]) => {
    const now = Date.now();
    const map: Record<string, unknown> = {};
    for (const c of cards) {
      // 与 useMemoryStore / schedulerAdapter.fsrsCardToMemoryCard 字段对齐.
      // 取 createEmptyCard 同款初值, 保证 rateCard -> f.repeat() 不抛错.
      map[c.lexemeGroupId] = {
        id: c.id,
        lexemeGroupId: c.lexemeGroupId,
        lemma: c.lemma,
        objectiveDifficulty: c.objectiveDifficulty,
        language: c.language,
        firstLearnedAt: now - 86_400_000,
        lastReviewAt: now - 86_400_000,
        due: c.due,
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        status: 'new',
        learningSteps: 0,
      };
    }
    localStorage.setItem(
      'wordaydream:memory',
      JSON.stringify({
        state: { cards: map, ratingHistory: [], schemaVersion: 2 },
        version: 2,
      }),
    );
  }, cards);
}

/** 在页面加载前写入 zustand persist 格式的 wrong-words store (键名 wordaydream:wrong-words, version 1). */
function seedWrongWords(page: Page, entries: SeedWrongWord[]): Promise<void> {
  return page.addInitScript((entries: SeedWrongWord[]) => {
    localStorage.setItem(
      'wordaydream:wrong-words',
      JSON.stringify({ state: { entries }, version: 1 }),
    );
  }, entries);
}

test.describe('Wordaydream v1.2.0 Web 主链路 E2E', () => {
  test.beforeEach(async ({ page }) => {
    // 模拟 reduced-motion: 避免 hero/呼吸动画导致元素"不稳定" 30s 超时 (与 offline-install spec 对齐).
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  // T01 [critical]: 复习链 — 首页 -> 进入复习 -> 答错评分 -> 错词入账 (UI 可见 + localStorage 佐证)
  test('T01 [critical]: 复习链 — 答错评分后错词入账并可在错词本看到', async ({ page }, testInfo) => {
    await seedMemory(page, [
      {
        id: 'card-wake-1',
        lexemeGroupId: 'wake',
        lemma: 'wake',
        objectiveDifficulty: 2,
        language: 'en',
        due: Date.now() - 2 * 86_400_000, // 过去 -> 进入 due 队列
      },
    ]);

    await page.goto('/');
    // 首页出现"开始复习" (TodayReviewCard: dueCount>0 时渲染)
    const startBtn = page.getByRole('button', { name: '开始复习' });
    await startBtn.waitFor({ state: 'visible', timeout: 20_000 });
    await startBtn.click();

    // 复习页: 答案输入框
    const answerInput = page.locator('#review-answer');
    await answerInput.waitFor({ state: 'visible', timeout: 10_000 });
    // 输入非中文答案 -> mock evaluator 判定 grade='wrong' (lemma='wake' 不在 EVAL_KEYWORDS)
    await answerInput.fill('zzzzz');
    await page.getByRole('button', { name: '确认' }).click();

    // 评分栏出现, 点击"重来" (again)
    const againBtn = page.getByRole('button', { name: /重来/ });
    await againBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await againBtn.click();

    // 状态级佐证: 错词已写入持久化 store (completeReview -> recordWrong 同步执行)
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const raw = window.localStorage.getItem('wordaydream:wrong-words');
            if (!raw) return false;
            try {
              return JSON.parse(raw).state.entries.some(
                (e: { lemma: string }) => e.lemma === 'wake',
              );
            } catch {
              return false;
            }
          }),
        { timeout: 10_000 },
      )
      .toBe(true);

    // UI 级佐证: 退出到主页 -> 进入词表 -> 错词本区块渲染该词条 (持久化可见)
    await page.getByRole('button', { name: '返回主舞台' }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByRole('button', { name: '返回主舞台' }).click();

    const wordlistBtn = page.getByRole('button', { name: '查看词表' });
    await wordlistBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await wordlistBtn.click();

    const wrongSection = page.getByTestId('wrong-words-section');
    await wrongSection.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(page.getByTestId('wrong-word-item').first()).toContainText('wake');
    await expect(page.getByTestId('wrong-words-count')).toHaveText('1');

    await page.screenshot({ path: `${SHOTS_DIR}/T01-wrong-words-${testInfo.project.name}.png`, fullPage: true });
  });

  // T02 [critical]: 错词链 — wordlist 页错词本区块渲染 + 排序/数量/筛选控件存在
  test('T02 [critical]: 错词链 — 错词本区块渲染且排序/数量/语言/时间筛选控件齐全', async ({ page }, testInfo) => {
    const now = Date.now();
    await seedWrongWords(page, [
      {
        cardId: 'c-apple',
        lexemeGroupId: 'apple',
        lemma: 'apple',
        language: 'en',
        wrongCount: 3,
        lastWrongAt: now - 1_000,
        firstWrongAt: now - 10_000,
      },
      {
        cardId: 'c-baum',
        lexemeGroupId: 'baum',
        lemma: 'baum',
        language: 'de',
        wrongCount: 1,
        lastWrongAt: now - 5_000,
        firstWrongAt: now - 5_000,
      },
    ]);

    // URL hash 深链直达词表页 (useUrlHashSync)
    await page.goto('/#/wordlist');
    const section = page.getByTestId('wrong-words-section');
    await section.waitFor({ state: 'visible', timeout: 15_000 });

    // 计数与列表项
    await expect(page.getByTestId('wrong-words-count')).toHaveText('2');
    await expect(page.getByTestId('wrong-word-item')).toHaveCount(2);

    // 复习控件 (排序 + 数量) 与 列表筛选控件 (语言 + 时间) 均存在
    await expect(page.locator('select[aria-label="错词排序"]')).toBeVisible();
    await expect(page.locator('select[aria-label="复习数量"]')).toBeVisible();
    await expect(page.locator('select[aria-label="错词语言筛选"]')).toBeVisible();
    await expect(page.locator('select[aria-label="错词时间筛选"]')).toBeVisible();

    await page.screenshot({ path: `${SHOTS_DIR}/T02-wrong-words-${testInfo.project.name}.png`, fullPage: true });
  });

  // T03 [non-critical]: 设置链 — 设置面板快捷键区 (ShortcutsSection) 与错词导出区 (WrongWordsExportSection) 可见
  test('T03 [non-critical]: 设置链 — 快捷键区与错词导出区在设置面板可见', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });

    // 首页头部设置按钮 (aria-label="设置") 打开全局 SettingsPanel
    const settingsBtn = page.locator('[aria-label="设置"]').first();
    await settingsBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await settingsBtn.click();

    // 设置面板以 dialog 形式挂载
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });

    // 快捷键编辑区块 (ShortcutsSection) + 错词导出区块 (WrongWordsExportSection)
    await expect(page.getByTestId('shortcut-row-again')).toBeVisible();
    await expect(page.getByTestId('wrong-words-export-section')).toBeVisible();

    await page.screenshot({ path: `${SHOTS_DIR}/T03-settings-${testInfo.project.name}.png`, fullPage: true });
  });
});
