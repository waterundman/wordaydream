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
import { readFileSync } from 'node:fs';

const SHOTS_DIR = 'debug_shots_web';

/** 本地日期戳 YYYYMMDD (与 WrongWordsExportSection.toLocalDateStamp 同口径). */
function localDateStamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** 打开首页设置面板 (dialog), 供导出/快捷键区块用例复用. */
async function openSettingsPanel(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });
  const settingsBtn = page.locator('[aria-label="设置"]').first();
  await settingsBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await settingsBtn.click();
  await page.locator('[role="dialog"][aria-modal="true"]').waitFor({ state: 'visible', timeout: 10_000 });
}

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

  // T04 [critical]: 导出链 — CSV 下载 (v1.3.0 Stage 2, 计划用例 T01)
  // 种子 2 条错词 → 设置面板导出 CSV → 文件名 YYYYMMDD + RFC 4180 表头 7 字段 + 行序 recent
  test('T04 [critical]: 导出链 — CSV 下载文件名与 RFC 4180 内容体', async ({ page }, testInfo) => {
    const now = Date.now();
    await seedWrongWords(page, [
      { cardId: 'c-apple', lexemeGroupId: 'apple', lemma: 'apple', language: 'en', wrongCount: 3, lastWrongAt: now - 1_000, firstWrongAt: now - 10_000 },
      { cardId: 'c-baum', lexemeGroupId: 'baum', lemma: 'baum', language: 'de', wrongCount: 1, lastWrongAt: now - 5_000, firstWrongAt: now - 6_000 },
    ]);

    await openSettingsPanel(page);
    const exportSection = page.getByTestId('wrong-words-export-section');
    await expect(exportSection).toBeVisible();

    // waitForEvent 先于 click 注册 (blob 下载竞态预防)
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 CSV' }).click();
    const download = await downloadPromise;

    // 文件名: wordaydream-wrong-words-YYYYMMDD.csv
    expect(download.suggestedFilename()).toBe(`wordaydream-wrong-words-${localDateStamp()}.csv`);

    // 内容体: 表头 7 字段 + 行序 recent (apple lastWrongAt 更近 → 在 baum 前) + ISO 8601 时间
    const content = readFileSync(await download.path(), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines[0]).toBe('cardId,lexemeGroupId,lemma,language,wrongCount,firstWrongAt,lastWrongAt');
    expect(lines).toHaveLength(3);
    expect(content.indexOf('apple')).toBeLessThan(content.indexOf('baum'));
    expect(lines[1]).toContain(',apple,en,3,');
    expect(lines[1]).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(lines[2]).toContain(',baum,de,1,');

    await page.screenshot({ path: `${SHOTS_DIR}/T04-export-csv-${testInfo.project.name}.png`, fullPage: true });
  });

  // T05 [critical]: 导出链 — JSON 下载 (v1.3.0 Stage 2, 计划用例 T02)
  test('T05 [critical]: 导出链 — JSON 下载 schema/version/entries', async ({ page }, testInfo) => {
    const now = Date.now();
    await seedWrongWords(page, [
      { cardId: 'c-apple', lexemeGroupId: 'apple', lemma: 'apple', language: 'en', wrongCount: 3, lastWrongAt: now - 1_000, firstWrongAt: now - 10_000 },
    ]);

    await openSettingsPanel(page);
    await expect(page.getByTestId('wrong-words-export-section')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 JSON' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(`wordaydream-wrong-words-${localDateStamp()}.json`);

    const payload = JSON.parse(readFileSync(await download.path(), 'utf-8')) as {
      schema: string;
      version: number;
      exportedAt: string;
      entries: Array<{ lemma: string; wrongCount: number }>;
    };
    expect(payload.schema).toBe('wordaydream-wrong-words');
    expect(payload.version).toBe(1);
    expect(payload.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]).toMatchObject({ lemma: 'apple', wrongCount: 3 });

    await page.screenshot({ path: `${SHOTS_DIR}/T05-export-json-${testInfo.project.name}.png`, fullPage: true });
  });

  // T06 [critical]: 快捷键链 — 捕获新键生效 + localStorage 持久化 (v1.3.0 Stage 2, 计划用例 T03)
  test('T06 [critical]: 快捷键链 — 捕获新键生效并持久化', async ({ page }, testInfo) => {
    await openSettingsPanel(page);

    // 进入 Again 键捕获态 → 按下 'q' (window capture 阶段 keydown)
    await page.getByRole('button', { name: '修改 Again 键' }).click();
    await expect(page.locator('[aria-label="正在修改 Again 键，请按下新按键"]')).toBeVisible();
    await page.keyboard.press('q');

    // kbd 更新为新键
    await expect(page.locator('[aria-label="Again 当前按键 q"]')).toBeVisible();
    // 无冲突告警
    await expect(page.locator('[role="alert"]')).toHaveCount(0);

    // persist: wordaydream:shortcut-overrides 写入 again:'q'
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => window.localStorage.getItem('wordaydream:shortcut-overrides'));
        if (!raw) return null;
        try {
          return (JSON.parse(raw) as { state: { ratingKeys: { again: string } } }).state.ratingKeys.again;
        } catch {
          return null;
        }
      }, { timeout: 10_000 })
      .toBe('q');

    await page.screenshot({ path: `${SHOTS_DIR}/T06-shortcut-capture-${testInfo.project.name}.png`, fullPage: true });
  });

  // T07 [critical]: 快捷键链 — 保留键/互斥冲突拒绝, 原键位不变 (v1.3.0 Stage 2, 计划用例 T04)
  test('T07 [critical]: 快捷键链 — 冲突拒绝且原键位不变', async ({ page }, testInfo) => {
    await openSettingsPanel(page);

    // 冲突 1: 保留键 'r' → role="alert" 行内提示, Hard 键位不变
    await page.getByRole('button', { name: '修改 Hard 键' }).click();
    await page.keyboard.press('r');
    const alert = page.locator('[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('保留键');
    await expect(page.locator('[aria-label="Hard 当前按键 2"]')).toBeVisible();

    // 冲突 2: 评分互斥 — Again 占用的 '1' → alert 提示占用, 键位仍不变
    await page.getByRole('button', { name: '修改 Hard 键' }).click();
    await page.keyboard.press('1');
    await expect(page.locator('[role="alert"]')).toContainText('占用');
    await expect(page.locator('[aria-label="Hard 当前按键 2"]')).toBeVisible();

    // 拒绝不写持久化 (setRatingKey 拒绝路径不触发 zustand set)
    const raw = await page.evaluate(() => window.localStorage.getItem('wordaydream:shortcut-overrides'));
    expect(raw).toBeNull();

    // Escape 取消捕获态 (无告警新增)
    await page.getByRole('button', { name: '修改 Hard 键' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[aria-label="Hard 当前按键 2"]')).toBeVisible();
    await expect(page.locator('[role="alert"]')).toHaveCount(0);

    await page.screenshot({ path: `${SHOTS_DIR}/T07-shortcut-conflict-${testInfo.project.name}.png`, fullPage: true });
  });

  // ---------------------------------------------------------------------------
  // 阅读链 (v1.3.0 Stage 3, 计划用例 T01-T03)
  // 断言锚定 MockLLMProvider 确定性 demo 语料 'The Quiet Revolution'
  // (src/mocks/passages.ts mockEnglishPassage: 7 token, revolution/artisans/...),
  // 评估走 mockProvider.lookupEvaluation 确定性启发式:
  //   'revolution' + '革命' → correct (制卡); 非中文答案 → wrong (错词入账).
  // ---------------------------------------------------------------------------

  /** 首页 → 阅读页 → 生成新文本 (mock 短路) → passage 渲染完成. */
  async function generatePassage(page: Page): Promise<void> {
    await page.goto('/');
    // v2.4.0 fix 沿例 (offline-install T04): mobile-chrome 393px 视口下 hero CTA /
    // 生成按钮位于滚动容器视口外且 scrollIntoView 滚不动 (v0.4.0 移动布局),
    // click 的视口命中检查失败 → dispatchEvent 直接派发 DOM click 绕过.
    await page.locator('[data-testid="hero-cta"]').dispatchEvent('click');
    const generateBtn = page.locator('button', { hasText: '生成新文本' });
    await generateBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await generateBtn.dispatchEvent('click');
    await page.locator('[data-testid="passage-token"]').first().waitFor({ state: 'visible', timeout: 30_000 });
  }

  // T08 [critical]: 阅读链答题 → 评估 → 制卡入账 (计划用例 T01)
  test('T08 [critical]: 阅读链 — 答题评估制卡入账', async ({ page }, testInfo) => {
    // mock 短路: 全程不应有 LLM proxy 请求 (沿 offline-install T04 手法)
    let llmProxyCallCount = 0;
    await page.route('**/api/llm-proxy**', (route) => {
      llmProxyCallCount += 1;
      return route.fulfill({ status: 500, body: 'unexpected call with mock provider' });
    });
    await page.route('**/.netlify/edge-functions/llm-proxy**', (route) => {
      llmProxyCallCount += 1;
      return route.fulfill({ status: 500, body: 'unexpected call with mock provider' });
    });

    await generatePassage(page);

    // 点击 token 'revolution' → InlineAnswerPanel 打开
    const token = page.locator('[data-testid="passage-token"]', { hasText: 'revolution' }).first();
    await token.click();
    const answerInput = page.locator('input[aria-label="释义输入"]');
    await answerInput.waitFor({ state: 'visible', timeout: 10_000 });

    // 提交正确释义 → mock 评估 correct → addCardFromToken 制卡
    await answerInput.fill('革命');
    await page.locator('[role="dialog"]').getByRole('button', { name: '确认' }).click();

    // UI 反馈: 评估 correct 文案
    await expect(page.getByText('完全正确')).toBeVisible({ timeout: 10_000 });

    // 状态级佐证: memory persist (wordaydream:memory) 出现 lex-revolution 卡
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => window.localStorage.getItem('wordaydream:memory'));
        return raw !== null && raw.includes('lex-revolution');
      }, { timeout: 10_000 })
      .toBe(true);

    // mock 短路: 无 proxy 请求
    expect(llmProxyCallCount).toBe(0);

    await page.screenshot({ path: `${SHOTS_DIR}/T08-reading-card-${testInfo.project.name}.png`, fullPage: true });
  });

  // T09 [critical]: 阅读链 — 面板发音按钮朗读 token 原文 (计划用例 T02)
  test('T09 [critical]: 阅读链 — 发音按钮朗读 token 原文', async ({ page }, testInfo) => {
    // 页面加载前 stub window.speechSynthesis → 录制 speak 的 utterance 文本
    await page.addInitScript(() => {
      const spoken: string[] = [];
      (window as unknown as { __spokenTexts: string[] }).__spokenTexts = spoken;
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          speak: (utterance: { text: string }) => {
            spoken.push(utterance.text);
          },
          cancel: () => undefined,
          getVoices: () => [],
        },
      });
    });

    await generatePassage(page);

    // 点击 token 'artisans' (难度 3, 在默认 difficulty 2 的 ±1 过滤范围内;
    // 'dilapidated' 难度 4 会被 getMockPassage 过滤掉) → 面板 → 发音按钮
    // → stub 收到 surfaceForm 'artisans' (lemma 为 'artisan', 恰好可断言原文非 lemma)
    const token = page.locator('[data-testid="passage-token"]', { hasText: 'artisans' }).first();
    await token.click();
    await page.locator('input[aria-label="释义输入"]').waitFor({ state: 'visible', timeout: 10_000 });

    await page.getByRole('button', { name: '朗读单词' }).click();

    await expect
      .poll(async () => {
        const spoken = await page.evaluate(
          () => (window as unknown as { __spokenTexts: string[] }).__spokenTexts,
        );
        return spoken.join('|');
      }, { timeout: 10_000 })
      .toContain('artisans');

    await page.screenshot({ path: `${SHOTS_DIR}/T09-reading-speak-${testInfo.project.name}.png`, fullPage: true });
  });

  // T10 [critical]: 阅读链 — 错词种子命中渲染标记 + tooltip 累计次数 (计划用例 T03)
  test('T10 [critical]: 阅读链 — 错词标记与 tooltip', async ({ page }, testInfo) => {
    const now = Date.now();
    // 种子错词: lex-revolution (passage token 'revolution' 的 lexemeGroupId)
    await seedWrongWords(page, [
      {
        cardId: 'c-rev',
        lexemeGroupId: 'lex-revolution',
        lemma: 'revolution',
        language: 'en',
        wrongCount: 2,
        lastWrongAt: now - 60_000,
        firstWrongAt: now - 120_000,
      },
    ]);

    await generatePassage(page);

    // 错词 token 渲染标记类 (amber 虚线下划线, CSS module 类名含 wrongWordMark)
    const token = page.locator('[data-testid="passage-token"]', { hasText: 'revolution' }).first();
    await expect(token).toHaveClass(/wrongWordMark/);

    // hover → Radix tooltip: "错词 · 累计 2 次"
    await token.hover();
    await expect(page.getByRole('tooltip')).toContainText('错词 · 累计 2 次', { timeout: 5_000 });

    await page.screenshot({ path: `${SHOTS_DIR}/T10-reading-wrongmark-${testInfo.project.name}.png`, fullPage: true });
  });

  // ---------------------------------------------------------------------------
  // v1.4.0 S4: 导入链 / 单条删除链 / 阅读摘要链 (计划用例 T11-T13)
  // ---------------------------------------------------------------------------

  // T11 [critical]: 导入链 — 设置面板导入 CSV (含重复条目 + RFC 4180 引号字段)
  // 种子 c-apple → 导入 CSV (c-apple 重复 + c-new 引号 lemma) → 结果行 "导入 1 条 · 跳过 1 条"
  // → localStorage 佐证: c-apple 保留现有 (wrongCount 不变), c-new lemma 逗号还原
  test('T11 [critical]: 导入链 — CSV 导入 skip 冲突 + RFC 4180 字段还原', async ({ page }, testInfo) => {
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
    ]);

    await openSettingsPanel(page);
    await expect(page.getByTestId('wrong-words-import-section')).toBeVisible();

    const csv = [
      'cardId,lexemeGroupId,lemma,language,wrongCount,firstWrongAt,lastWrongAt',
      `c-apple,apple,apple,en,99,${new Date(now - 5000).toISOString()},${new Date(now - 4000).toISOString()}`,
      `c-new,gruen,"grün, mit Umlaut",de,1,${new Date(now - 3000).toISOString()},${new Date(now - 2000).toISOString()}`,
    ].join('\n');
    await page.getByTestId('wrong-words-import-input').setInputFiles({
      name: 'wordaydream-wrong-words-backup.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });

    // 结果行: 导入 1 条 (c-new) · 跳过 1 条 (c-apple 冲突)
    const result = page.getByTestId('wrong-words-import-result');
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expect(result).toContainText('导入 1 条');
    await expect(result).toContainText('跳过 1 条');

    // 状态级佐证: c-apple 保留现有 (wrongCount=3 非 CSV 的 99), c-new 引号字段还原
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => window.localStorage.getItem('wordaydream:wrong-words'));
        if (!raw) return null;
        try {
          const entries = (JSON.parse(raw) as { state: { entries: Array<{ cardId: string; wrongCount: number; lemma: string }> } }).state.entries;
          return entries.map((e) => `${e.cardId}:${e.wrongCount}:${e.lemma}`).join('|');
        } catch {
          return null;
        }
      }, { timeout: 10_000 })
      .toBe('c-apple:3:apple|c-new:1:grün, mit Umlaut');

    await page.screenshot({ path: `${SHOTS_DIR}/T11-import-csv-${testInfo.project.name}.png`, fullPage: true });
  });

  // T12 [critical]: 单条删除链 — wordlist 页行内删除按钮 → 行消失 + 总数 -1
  test('T12 [critical]: 单条删除链 — 行内删除按钮移除条目', async ({ page }, testInfo) => {
    const now = Date.now();
    await seedWrongWords(page, [
      { cardId: 'c-apple', lexemeGroupId: 'apple', lemma: 'apple', language: 'en', wrongCount: 3, lastWrongAt: now - 1_000, firstWrongAt: now - 10_000 },
      { cardId: 'c-baum', lexemeGroupId: 'baum', lemma: 'baum', language: 'de', wrongCount: 1, lastWrongAt: now - 5_000, firstWrongAt: now - 6_000 },
    ]);

    await page.goto('/#/wordlist');
    const section = page.getByTestId('wrong-words-section');
    await section.waitFor({ state: 'visible', timeout: 15_000 });
    await expect(page.getByTestId('wrong-word-item')).toHaveCount(2);

    // 删除第一行 (apple, lastWrongAt 倒序在前) — mobile 视口命中风险兜底: 先常规 click
    const firstItem = page.getByTestId('wrong-word-item').first();
    await firstItem.getByTestId('wrong-word-remove').click();

    // 行消失 + 总数 -1 + 剩余为 baum
    await expect(page.getByTestId('wrong-word-item')).toHaveCount(1);
    await expect(page.getByTestId('wrong-words-count')).toHaveText('1');
    await expect(page.getByTestId('wrong-word-item').first()).toContainText('baum');

    // 状态级佐证: persist 已移除 c-apple
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => window.localStorage.getItem('wordaydream:wrong-words'));
        if (!raw) return null;
        try {
          return (JSON.parse(raw) as { state: { entries: Array<{ cardId: string }> } }).state.entries.map((e) => e.cardId).join('|');
        } catch {
          return null;
        }
      }, { timeout: 10_000 })
      .toBe('c-baum');

    await page.screenshot({ path: `${SHOTS_DIR}/T12-wrong-remove-${testInfo.project.name}.png`, fullPage: true });
  });

  // T13 [critical]: 阅读摘要链 — wordlist 页摘要卡 (完成/解析/近 7 天/语言分布)
  test('T13 [critical]: 阅读摘要链 — 摘要卡渲染主行与次行', async ({ page }, testInfo) => {
    const now = Date.now();
    // 种子 reading-history (persist 键 wordaydream:reading-history, version 2):
    // h1 = 今天完成 en (resolved 8); h2 = 未完成 de (resolved 5, 不进完成/语言分布)
    await page.addInitScript((nowMs: number) => {
      const mkEntry = (id: string, language: string, resolvedCount: number, completedAt: number | null) => ({
        id,
        passage: { tokens: [] },
        language,
        difficulty: 2,
        startedAt: nowMs - 2 * 86_400_000,
        resolvedCount,
        totalTokenCount: 20,
        ...(completedAt !== null ? { completedAt } : {}),
      });
      localStorage.setItem(
        'wordaydream:reading-history',
        JSON.stringify({
          state: {
            maxHistory: 50,
            history: [
              mkEntry('h1', 'en', 8, nowMs - 3_600_000),
              mkEntry('h2', 'de', 5, null),
            ],
          },
          version: 2,
        }),
      );
    }, now);

    await page.goto('/#/wordlist');
    const summary = page.getByTestId('reading-summary-section');
    await summary.waitFor({ state: 'visible', timeout: 15_000 });

    // 主行: 阅读 2 篇 · 完成 1 篇 · 解析 8 词 (完成条目 resolved 求和)
    await expect(page.getByTestId('reading-summary-main')).toHaveText(
      '阅读 2 篇 · 完成 1 篇 · 解析 8 词',
    );
    // 次行: 近 7 天完成 1 篇 · en 1 / de 0 (语言分布只计完成条目)
    await expect(page.getByTestId('reading-summary-sub')).toHaveText(
      '近 7 天完成 1 篇 · en 1 / de 0',
    );

    await page.screenshot({ path: `${SHOTS_DIR}/T13-reading-summary-${testInfo.project.name}.png`, fullPage: true });
  });

  // ---------------------------------------------------------------------------
  // v1.5.0 S3: 完成页链 (T14) — 全答对 → ReadingCompleteOverlay 会话统计
  // session store 无 persist → 必须真实答题。mock 语料 7 词中 difficulty 2 会话
  // (getMockPassage ±1 过滤) 保留 4 词: revolution(2)/artisans(3)/marveled(3)/
  // blossomed(3), lemma 全命中 mockProvider EVAL_KEYWORDS → 全答对链可行。
  // 每词 correct 反馈后 1500ms 面板关闭, 4 词 ≈ 15-25s > 单 test 30s → setTimeout 90s。
  // ---------------------------------------------------------------------------

  /** 答案映射 (surfaceForm → mockProvider EVAL_KEYWORDS 中文, 全部命中 correct)。 */
  const COMPLETE_ANSWERS: Record<string, string> = {
    revolution: '革命',
    artisans: '工匠',
    marveled: '惊叹',
    blossomed: '开花',
    dilapidated: '破旧的',
    authenticity: '真实性',
    endeavor: '努力',
  };

  test('T14 [critical]: 完成页链 — 全答对后 overlay 显示会话统计', async ({ page }, testInfo) => {
    test.setTimeout(90_000);

    await generatePassage(page);

    // 收集本会话实际渲染的唯一 token 词形 (难度过滤后动态断言, 不写死数量)
    const tokenTexts = await page.getByTestId('passage-token').allTextContents();
    const uniqueWords = [...new Set(tokenTexts.map((t) => t.trim()).filter(Boolean))];
    expect(uniqueWords.length).toBeGreaterThan(0);

    // 完成统计行 (最后一词答对时与庆祝层同步出现, z-index 更高)
    const statsRow = page.getByTestId('reading-complete-session-stats');

    // 逐词: 点击 → 输入 EVAL_KEYWORDS 中文 (全对) → 确认 → 等面板 1500ms 后关闭
    // → WordLearnedOverlay ('已掌握单词 X' 庆祝层) 点击关闭 → 下一词。
    // 最后一词: ReadingCompleteOverlay 与庆祝层同步渲染 (z-index 更高, 拦截点击),
    // 此时完成统计已出现, 庆祝层无需也无法关闭。
    for (const word of uniqueWords) {
      const answer = COMPLETE_ANSWERS[word.toLowerCase()] ?? 'zzzzz';
      await page.locator('[data-testid="passage-token"]', { hasText: word }).first().click();
      const input = page.locator('input[aria-label="释义输入"]');
      await input.waitFor({ state: 'visible', timeout: 10_000 });
      await input.fill(answer);
      await page.locator('[role="dialog"]').getByRole('button', { name: '确认' }).click();
      await input.waitFor({ state: 'hidden', timeout: 15_000 });

      if (await statsRow.isVisible().catch(() => false)) break;

      const learned = page.locator('[role="dialog"][aria-label^="已掌握单词"]');
      try {
        await learned.waitFor({ state: 'visible', timeout: 5_000 });
        await learned.click({ timeout: 3_000 });
        await learned.waitFor({ state: 'hidden', timeout: 5_000 });
      } catch {
        // 庆祝层被完成层覆盖 (最后一词 race) → 统计行已出现, 继续循环外断言
      }
    }

    // 完成触发: overlay 会话统计行已随最后一词渲染 (waitFor 兜底)
    await statsRow.waitFor({ state: 'visible', timeout: 20_000 });

    const expectedCorrect = uniqueWords.filter((w) => COMPLETE_ANSWERS[w.toLowerCase()]).length;
    const expectedWrong = uniqueWords.length - expectedCorrect;
    await expect(statsRow).toContainText(`本篇生词 ${uniqueWords.length} 个`);
    await expect(statsRow).toContainText(`答对 ${expectedCorrect}`);
    await expect(statsRow).toContainText(`答错 ${expectedWrong}`);

    await page.screenshot({ path: `${SHOTS_DIR}/T14-reading-complete-${testInfo.project.name}.png`, fullPage: true });
  });

  // === v1.6.0 Stage 1 (S3): 课程路径 + 词表规模冒烟 ===
  // 背景: v1.6.0 把英语词表从 80 词占位替换为真实 CEFR 词表
  //       (A1 942 / A2 898 / B1 802 / B2 1428, 见 src/data/wordlists/en/*.json),
  //       并据此重建了 courses/en.ts 的 Lesson targetLemmas.
  //       这两条用例守住"词表规模不再回退到占位"与"课程路径仍可渲染"。

  test('T15 [critical]: 课程路径 — #/course 选课 → Module/Lesson 渲染且每 Lesson 15 目标词', async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    // 深链接进入课程页 (useUrlHashSync: '#/${mode}')
    await page.goto('/#/course');

    // 未选课视图: 英语课程卡片
    const courseCard = page.getByTestId('course-card-en-from-zh');
    await courseCard.waitFor({ state: 'visible', timeout: 20_000 });
    await expect(courseCard).toContainText('4 个 Module');
    await courseCard.click();

    // 已选课视图: A1-B2 四个 Module 全部渲染
    await page.getByTestId('module-section-en-a1').waitFor({ state: 'visible', timeout: 15_000 });
    for (const lv of ['a1', 'a2', 'b1', 'b2']) {
      await expect(page.getByTestId(`module-section-en-${lv}`)).toBeVisible();
    }

    // A1 的 5 个 Lesson 全部渲染 (id 由 themeSlug 派生)
    const a1Section = page.getByTestId('module-section-en-a1');
    await expect(a1Section.locator('[data-testid^="lesson-card-en-a1-"]')).toHaveCount(5);

    // 每个 Lesson 15 个 targetLemmas → 进度标签形如 "0/15" (LessonCard.progressLabel)
    await expect(a1Section).toContainText('0/15');

    // 课程标题 (来自 courses/en.ts) 可见
    await expect(page.getByRole('heading', { name: 'English for Chinese Speakers' })).toBeVisible();

    await page.screenshot({ path: `${SHOTS_DIR}/T15-course-path-${testInfo.project.name}.png`, fullPage: true });
  });

  test('T16 [critical]: 词表链 — 首页进入词表页, A1 规模为真实 CEFR 词表 (>= 900)', async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 20_000 });

    await page.getByRole('button', { name: '查看词表' }).click();

    // 头部: "{CEFR} 词表 · N 词" (WordlistPage: {cefrLabel} 词表 · {words.length} 词)
    const header = page.getByText(/词表 · \d+ 词/);
    await header.waitFor({ state: 'visible', timeout: 20_000 });

    /** 读取当前等级的词数 (词表按难度异步加载, 用轮询避免读到切换中的中间态) */
    const readCount = async (): Promise<number> => {
      const text = (await header.textContent()) ?? '';
      return Number(/词表 · (\d+) 词/.exec(text)?.[1] ?? '0');
    };

    // 默认难度为 A2 (useSettingsStore.difficulty 初始值 2) → A2 真实词表 898 词
    await expect.poll(readCount, { timeout: 20_000 }).toBeGreaterThanOrEqual(800);

    // 切到 A1: 占位词表为 80 词, v1.6.0 真实 CEFR 词表为 942 词 → 下界取 900
    await page.getByRole('group', { name: '难度' }).getByRole('button', { name: 'A1' }).click();
    await expect.poll(readCount, { timeout: 20_000 }).toBeGreaterThanOrEqual(900);

    // 搜索框可用, 且能命中词表内的真实词
    const search = page.getByLabel('搜索词表');
    await expect(search).toBeVisible();
    await search.fill('dog');
    await expect(page.getByText('dog', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: `${SHOTS_DIR}/T16-wordlist-${testInfo.project.name}.png`, fullPage: true });
  });
});
