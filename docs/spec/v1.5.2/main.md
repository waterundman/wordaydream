# Wordaydream v1.5.2 — 主规范文档

**版本**: v1.5.2
**日期**: 2026-07-10
**状态**: Stage 5 收尾, 4 NEW 合同全部 PASS, 30/30 contracts PASS
**起点 posterior**: 0.99+ (v1.5.1 终点承接)
**终点 posterior**: 0.99+ (Stage 1-4 累积, 持平)
**工期**: 1 天 (Stage 1 主题切换 + Stage 2 阅读时长 + Stage 3 滚动进度条 + Stage 4 函数化推广 + Stage 5 收尾)

---

## 1. 概述

Wordaydream v1.5.2 是 v1.5.1 (Stage 5 收尾 + 主页 Hero-First 重设计) 的增量版本, 沿用 26 合同 (1-26), 新增 4 合同 (27-30):

- **Contract 27 (Stage 1 D-3)**: 主题切换 (3 主题 light/dark/sepia)
- **Contract 28 (Stage 2 D-2)**: 阅读时长统计 (useReadingTimeTracker + Hero 德文)
- **Contract 29 (Stage 3 D-1)**: 滚动进度条 (顶部 3px + rAF + a11y)
- **Contract 30 (Stage 4 P2_1)**: 函数化推广 3 service llm 路径 (grammarDetector + difficultyEvaluator + glossAdapter)

**核心变更**:
- 主页深化 3 NEW (主题切换 + 阅读时长 + 滚动进度条), 用户最直观能感知的改进
- 函数化推广 selector 真正启用 'llm' 路径 (v1.5.0 锁住, v1.5.2 解锁)
- persist 升级 v3 -> v4, migrate 透传 theme / llm / difficulty 字段
- 0 breaking change, 0 new dependencies

---

## 2. 设计原则

### 2.1 0 breaking change
- 默认 `theme='light'` 与 v1.5.1 视觉完全一致
- 旧 persist v1/v2/v3 数据 migrate 后, theme 默认 'light' (无视觉跳变)
- 沿用 v0.9.0 baseline UI 骨架, 仅在主页 Hero / App.tsx / 3 functional.ts 加 NEW

### 2.2 0 new dependencies
- 沿用 zustand 4.x (useSettingsStore)
- 沿用 react 18.x (hooks / context)
- 沿用 vite 5.x (build)
- 沿用 vitest 1.x (unit test)
- 不引入新 lib (无 styled-components / react-i18next / @supabase/supabase-js)

### 2.3 persist migrate 兜底
- v3 -> v4 migrate 函数: `if (fromVersion < 4) return { ...state, totalSecondsToday: state.totalSecondsToday ?? 0, lastSessionDate: state.lastSessionDate ?? null }`
- theme / llm / difficulty 字段全保留, 不重置
- onRehydrateStorage: 校验 + normalize, 无效值回退 DEFAULT

### 2.4 双签名
- 沿用 v1.5.0 functional.ts 双签名: `detectGrammarPoints(s, opts)` + `detectGrammarPoints.functional.ts`(新签名)
- 旧 detectGrammarPoints 函数签名 0 改, 新 selector 函数 (`llmDetectGrammarPoints` / `mockDetectGrammarPoints` / `heuristicDetectGrammarPoints`) 走 functional.ts 内部

---

## 3. 数据契约 (Zod schema)

### 3.1 useSettingsStore ThemeSchema (NEW v1.5.2)
```typescript
// useSettingsStore.ts
type Theme = 'light' | 'dark' | 'sepia';
const VALID_THEMES: readonly Theme[] = ['light', 'dark', 'sepia'] as const;
const DEFAULT_THEME: Theme = 'light';

function normalizeTheme(input: unknown): Theme {
  if (typeof input === 'string' && VALID_THEMES.includes(input as Theme)) {
    return input as Theme;
  }
  return DEFAULT_THEME;
}
```

### 3.2 useSettingsStore ReadingSchema (NEW v1.5.2)
```typescript
type ReadingTime = {
  totalSecondsToday: number;  // 今日累计阅读秒数, 0 <= N < 86400
  lastSessionDate: string | null;  // ISO yyyy-mm-dd, 跨日重置锚点
};
```

### 3.3 useSettingsStore MigrationSchema (v3 -> v4)
```typescript
// persist v3 -> v4
{
  version: 4,
  migrate: (persistedState: any, version: number) => {
    if (version < 4) {
      return {
        ...persistedState,
        totalSecondsToday: persistedState.totalSecondsToday ?? 0,
        lastSessionDate: persistedState.lastSessionDate ?? null,
      };
    }
    return persistedState;
  },
}
```

### 3.4 全字段清单 (v4 状态)
```typescript
type SettingsState = {
  theme: Theme;  // 'light' | 'dark' | 'sepia', 沿用 v3 + v4 字段
  llm: { provider: LLMProviderKey; enabled: boolean; model: string };
  difficulty: { mode: DifficultyMode; level: CEFRLevel };
  totalSecondsToday: number;  // v4 NEW
  lastSessionDate: string | null;  // v4 NEW
  // ... 其它 v1.5.1 沿用字段 (fontSize / lineHeight / streak / collection 等)
};
```

---

## 4. API 契约

### 4.1 useReadingTimeTracker hook (NEW v1.5.2)
```typescript
// useReadingTimeTracker.ts
export function useReadingTimeTracker(isReading: boolean): void;

// 实现
// - useEffect 依赖 isReading
// - setInterval(1000ms) 累计, 调用 store action incrementReadingSeconds()
// - 跨日重置: new Date().toISOString().slice(0, 10) !== lastSessionDate -> resetTodayIfNewDay()
// - cleanup: clearInterval (路由切换/卸载无泄漏)
// - SSR 兼容: useEffect 内访问 store, 0 window 错误
```

### 4.2 ScrollProgressBar component (NEW v1.5.2)
```typescript
// ScrollProgressBar.tsx
export const ScrollProgressBar: React.FC = () => JSX.Element;

// 实现
// - useEffect 内 window.addEventListener('scroll', handleScroll)
// - handleScroll: requestAnimationFrame 节流, 16ms throttle (lastUpdate 时间戳)
// - 计算 progress = scrollTop / (scrollHeight - clientHeight)
// - <div role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Lesefortschritt" />
// - cleanup: removeEventListener + cancelAnimationFrame
// - SSR 兼容: useEffect 内访问 window
```

### 4.3 3 functional.ts selector 升级 (NEW v1.5.2)
```typescript
// grammarDetector.functional.ts
type Provider = 'mock' | 'heuristic' | 'llm';

export function selectProvider(llm: LLMSettings): Provider {
  if (!llm.enabled || llm.provider === 'mock' || llm.provider === 'disabled') {
    return 'mock';
  }
  if (['openai', 'anthropic', 'deepseek', 'kimi', 'qwen', 'minimax'].includes(llm.provider)) {
    return 'llm';
  }
  return 'heuristic';  // 0 break fallback
}

export async function llmDetectGrammarPoints(passage: string, llm: LLMSettings): Promise<GrammarPoint[]> {
  // 真实 LLM 调用 (OpenAI / Anthropic / DeepSeek / Kimi / Qwen / MiniMax)
  // try/catch: 失败回退到 mockDetectGrammarPoints
}
```

```typescript
// difficultyEvaluator.functional.ts
export function selectDifficultyProvider(llm: LLMSettings): Provider {
  // 同上, 0 break fallback 返回 'heuristic'
}

export async function llmEvaluate(passage: string, llm: LLMSettings): Promise<DifficultyResult | null> {
  // 真实 LLM 调用, try/catch 失败返回 null
}
```

```typescript
// glossAdapter.functional.ts
export function selectGlossProvider(llm: LLMSettings): Provider {
  // 同上, 0 break fallback 返回 'mock'
}

export async function llmGloss(word: string, llm: LLMSettings, ctx: string): Promise<GlossEntry | null> {
  // 真实 LLM 调用, try/catch 失败返回 source='mock' fallback
}
```

---

## 5. UI 契约

### 5.1 ThemeSwitcher 视觉 (NEW v1.5.2)
- 3 按钮 (明亮/暗色/羊皮) 横排, 每按钮 ~80px 宽, 56px 高
- active 主题: 实心背景 + 选中图标 (inline SVG check, no emoji)
- 非 active 主题: 透明背景 + hover 浅色高亮
- a11y: role="radio" + aria-checked + aria-pressed + 文字 label
- 主题切换: <html data-theme="dark|sepia"> 切换, CSS variable 重写

### 5.2 Hero 注入"今日已读" (NEW v1.5.2)
- HeroSection 在主标题下方, 副标题下方注入一行
- 视觉: `Heute bereits X Min. gelesen` (X = totalSecondsToday / 60, Math.floor)
- a11y: aria-label="Heute bereits X Minuten gelesen" (全称)
- 0 emoji (纯数字 + 德文文案)

### 5.3 进度条 fixed top 0 (NEW v1.5.2)
- 位置: position: fixed; top: 0; left: 0; right: 0; height: 3px
- 填充: width = progress * 100%, background: linear-gradient(--color-accent -> --color-flame)
- 轨道: background: var(--color-paper-alpha) (dark 主题 rgba(255,255,255,0.06), sepia 主题 rgba(91,70,54,0.06))
- 主题适配: data-theme="dark"/"sepia" 切换时, 0 跳变
- pointer-events: none (不拦截点击)
- z-index: 100 (高于 hero, 低于 modal)
- prefers-reduced-motion: fill transition: none

### 5.4 主页 Refined Paper 沿用 v1.5.1
- ProgressRing .label: 0.875rem (--home-progress-label-size token)
- StreakBadge 呼吸动效: 0.97-1.03 scale 3s ease-in-out
- useScrollReveal delayMs: TodayCard 100 / ProgressRing 200 / AchievementWall 300

---

## 6. 测试契约

### 6.1 vitest 177/177 PASS
- 22 沿用 v1.5.0 (162 测试)
- 4 NEW v1.5.1 (1 测试 = useScrollReveal.test.ts)
- 3 NEW v1.5.2 useReadingTimeTracker (T01/T02/T03)
- 9 NEW v1.5.2 T-LLM (3 service x 3 cases = 9 测试)
- 累计: 162 + 1 + 3 + 9 + 其它 = 177

### 6.2 9 NEW T-LLM 测试 (v1.5.2)
- `grammarDetector.functional.test.ts`:
  - T-LLM-1: `selectProvider({ provider: 'openai', enabled: true })` returns 'llm'
  - T-LLM-2: injected llm provider (mock llm) 命中 llmDetectGrammarPoints
  - T-LLM-3: llm 抛错回退到 mock
- `difficultyEvaluator.functional.test.ts`:
  - T-LLM-1/2/3: 同上结构
- `glossAdapter.functional.test.ts`:
  - T-LLM-1/2/3: 同上结构

### 6.3 29 contracts (HARD)
- 22 沿用 v1.5.0 (1 SOFT = Contract 9 language_compliance_rate)
- 4 NEW v1.5.1 (Contract 23-26)
- 4 NEW v1.5.2 (Contract 27-30)
- debug_verify_v152.py 退出码 0

### 6.4 tsc 0 errors
- `npx tsc --noEmit -p tsconfig.app.json` 0 errors

### 6.5 vite build 0 errors
- `npm run build` 生成 dist/, 0 errors

---

## 7. 部署契约

### 7.1 沿用 v1.5.1 Netlify 配置
- `netlify.toml` 沿用 v1.5.0 + v1.5.1
- `netlify/edge-functions/llm-proxy.ts` 沿用 v1.3.0 Stage 3
- 4 阻塞点 runbook (`docs/OPERATIONS.md`): Netlify 8 + 3 API key 15 + Lighthouse 5 + Playwright 6 = 34 步骤

### 7.2 0 新增配置
- 沿用 v1.5.1 `vite.config.ts` (PWA 插件 + workbox)
- 沿用 v1.5.1 `package.json` (无新依赖)
- 沿用 v1.5.1 `tsconfig.app.json` / `tsconfig.json`

### 7.3 沿用 v1.5.1 GitHub Actions
- `.github/workflows/lighthouse.yml`: 5% buffer + treosh/lighthouse-ci-action@v11
- `.github/workflows/playwright.yml`: microsoft/playwright-github-action@v1 + 4 截图归档

### 7.4 沿用 v1.5.1 pre-commit
- `scripts/pre-commit-secret-scan.sh`: 3 模式 (sk-/sk-ant-/sk-proj-) + 20 字符约束

---

## 8. 迁移契约

### 8.1 persist v3 -> v4 (1 用户)
```typescript
// useSettingsStore.ts
{
  name: 'wordaydream-settings',
  version: 4,
  migrate: (persistedState: any, version: number) => {
    if (version < 4) {
      return {
        ...persistedState,
        totalSecondsToday: typeof persistedState.totalSecondsToday === 'number'
          ? persistedState.totalSecondsToday
          : 0,
        lastSessionDate: typeof persistedState.lastSessionDate === 'string'
          ? persistedState.lastSessionDate
          : null,
      };
    }
    return persistedState;
  },
}
```

### 8.2 onRehydrateStorage 校验
```typescript
onRehydrateStorage: () => (state) => {
  if (state) {
    state.theme = normalizeTheme(state.theme);
    state.totalSecondsToday = typeof state.totalSecondsToday === 'number'
      ? Math.max(0, state.totalSecondsToday)
      : 0;
    state.lastSessionDate = typeof state.lastSessionDate === 'string'
      ? state.lastSessionDate
      : null;
  }
}
```

### 8.3 旧 v1/v2/v3 数据兼容
- 旧 v1 (无 theme 字段): 加载后 theme='light' (默认)
- 旧 v2 (无 normalize): 加载后 theme='light' (无效值回退)
- 旧 v3 (无 totalSecondsToday/lastSessionDate): 加载后 totalSecondsToday=0, lastSessionDate=null
- v1.5.2 加载 v1/v2/v3 数据: 0 报错, 0 数据丢失, 0 视觉跳变

---

## 9. 已知限制

### 9.1 沙箱 4 阻塞点 (沿用 v1.5.1)
1. 无 Netlify CLI: 用户执行 OPERATIONS.md Section 1 (8 步骤)
2. 无 3 API key: 用户执行 OPERATIONS.md Section 2 (15 步骤)
3. 无 Lighthouse: 用户执行 OPERATIONS.md Section 3 (5 步骤) + lighthouse.yml
4. 无 Playwright Chromium: 用户执行 OPERATIONS.md Section 4 (6 步骤) + playwright.yml

### 9.2 1 预存 emoji
- `src/features/reading/components/CompoundWordDisplay.tsx:94` 含 U+2726 (BLACK FOUR POINTED STAR)
- 来自 v1.2.0 沿用代码, 不在 v1.5.2 Stage 1-4 改文件范围内
- v1.5.3 收尾修复 (替换为 inline SVG)

### 9.3 真实 LLM 5 德文 run 验证
- 沙箱无 API key, 用户配置 3 key 后执行 5 句德文 passage 端到端
- 验证 3 service `llm` 路径真实工作 (grammarDetector + difficultyEvaluator + glossAdapter)

### 9.4 灰度路由真实跑分
- 沙箱无 VITE_LLM_GRAYSCALE 实际值
- 用户配置后运行 5 句德文, 验证 `parseGrayscale + selectByWeight` 按权重分配

### 9.5 主题切换浏览器原生支持
- IE 11 不支持 `prefers-reduced-motion` + `data-theme` attribute
- 沿用 v0.9.0 baseline (现代浏览器, 0 IE 11 支持)

---

## 10. 未来工作 (v1.5.3 计划)

### 10.1 用户认证 (P1, Supabase)
- Supabase Auth 集成
- Email + OAuth (Google / GitHub)
- 多设备同步 (reading progress + settings + collection)

### 10.2 i18n (P1, react-i18next)
- react-i18next 集成
- 德文 / 英文 / 中文 三语
- 词卡释义自动翻译

### 10.3 词卡复习 (P1, TS-FSRS)
- spaced repetition 调度
- 复习卡片 UI
- 复习统计 + 推送提醒

### 10.4 收藏夹 (P2)
- 单词收藏 + 短语收藏 + 段落收藏
- 收藏夹管理 UI
- 收藏夹导出 (JSON / CSV)

### 10.5 数据导出 (P2)
- 用户数据 (设置 / 进度 / 收藏) 导出 JSON
- 导入 JSON 恢复
- 隐私保护 (本地优先, 0 服务端)

### 10.6 真实 LLM 验证 (P0 阻塞点, 沿用 v1.5.1)
- 用户配置 3 API key 后, 5 德文 run 验证 3 service `llm` 路径
- 灰度路由真实跑分 (VITE_LLM_GRAYSCALE)

### 10.7 1 预存 emoji 修复
- `CompoundWordDisplay.tsx:94` U+2726 (BLACK FOUR POINTED STAR) -> inline SVG 6 角星

### 10.8 4 阻塞点收尾 (沿用 v1.5.1)
- Netlify 真实部署
- 3 API key 真实配置
- Lighthouse 5 项真实跑分
- Playwright 4 场景真实 E2E

---

## 11. 收尾交付物 (Stage 5)

1. `debug_verify_v152.py` (30 合同, 29 HARD + 1 SOFT, 全部 PASS)
2. `docs/E2E_REPORT_v152.md` (本报告 + 4 NEW 合同对账 + 沙箱限制声明)
3. `docs/spec/v1.5.2/main.md` (本规范文档)
4. `CHANGELOG.md` v1.5.2 entry
5. `package.json` version 1.5.2
6. vault 3 文件:
   - `bayesian/v1.5.2/history.md` (R11 反思, ~150 LOC)
   - `cache/v1.5.2/NEXT-VERSION-DIRECTION.md` (v1.5.3 方向, ~300 LOC)
   - `INDEX.md` (主索引更新 v1.5.2 状态行)
