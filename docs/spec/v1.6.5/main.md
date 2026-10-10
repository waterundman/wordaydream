# v1.6.5 SPEC — 自定义词库真正参与学习 · 词表与复习管理闭环

> 版本口径: web `3.6.5` = harmony `1.6.5` + 2 (patch 一致), 由 `scripts/check-version-alignment.mjs` 强制。
> 模式: **EXTEND**（全部落在现有 feature 目录内, 不新建 feature 目录; 遵循仓库既有的「版本级 spec + 数字真源在 `harmony/CURRENT_STATUS.md`」约定, 不建 per-feature spec.md）。
> 选题来源: `docs/vault/v1.6.4-FUNCTIONAL-SWEEP-REPORT.md` 留档清单 L1–L6 与 `docs/spec/v1.6.4/main.md` §6 未做项。

## 1. 问题陈述

v1.6.4 全功能探测证实：**用户导入的 CSV 词库是写入即失效的死功能**。`src/data/wordlists/index.ts` 注册了 `custom:csv` loader, 但 `loadWordlist()` 的键是 `${language}:${difficulty}` 且 `Language` 只有 `en|de`, 该 loader 按构造不可达; 结果是「导入成功、列表可见、学习里永远看不到这些词」。

同时三项相邻缺口让词表/复习管理闭环不完整：
- 每日新词目标 `newWordsTarget` 在 store 两处硬编码 10, 无 setter 无控件（L4）。
- `#/review` 深链在无复习会话时被静默弹回 `#/home`（L2）。
- 错词本只有逐行删除, `clearAll` 无 UI, 无批量操作（L3）。

## 2. 设计原则（KISS / 反过度工程）

1. **不新增数据面**：自定义词库沿用 IndexedDB `wordlists` store 与既有 `CsvWordlistEntry` 字段, 只补 `language` 与 `enabled` 两个元字段。
2. **合并发生在唯一入口**：`loadWordlist()` 是词表进入系统的唯一门（`useWordlistStore` 派生查询与 `preloadWordlist` 都经它）, 因此只改这一处, 阅读生成 (`passageGenerator` 的 `getUnlearnedWords` / `getLearningWords`) 与词表页自然受益, 不做第二条通路。
3. **纯函数优先**：合并/去重/映射逻辑抽成无副作用纯函数, 单测覆盖边界, 组件层零业务逻辑。
4. **可回退**：每个词库带独立 `enabled` 开关, 关掉即回到 v1.6.4 行为; 关闭后必须清词表缓存, 不留脏读。

## 3. 范围

### S1 — 自定义词库参与学习（核心）

**数据契约**（`src/data/wordlists/csvStorage.ts`）
- `StoredCsvWordlist` 增 `language: Language` 与 `enabled: boolean`。
- 读路径统一迁移：缺 `language` → `'en'`（与该记录在 v1.6.4 里被合成时的语言一致）; 缺 `enabled` → `true`。
- 新增 `setCsvWordlistEnabled(id, enabled)`; 导入写入时带语言。

**合并契约**（新纯函数模块 `src/data/wordlists/customMerge.ts`）
- `CEFR_TO_DIFFICULTY`: A1→1, A2→2, B1→3, B2→4, C1→5。
- `mergeCustomEntries(base: Wordlist | null, language, difficulty, custom: CsvWordlistEntry[]) → Wordlist | null`
  - 只取 `language` 匹配、`cefr` 映射到目标 difficulty 的条目;
  - **官方词条优先**：lemma（小写）与官方词表重复时丢弃自定义条目, 避免同一 lemma 双进度语义;
  - 批内自身按 lemma 去重（保留首条）;
  - 合并后的条目打 `source: 'custom'`（`WordlistEntry` 新增可选字段, 0 breaking）, 供 UI 标注来源;
  - 官方词表为 null（如 C1）时也可单独成立, 返回合成词表;
  - 上限 `MAX_CUSTOM_PER_LEVEL = 1000`, 超出截断并在返回值里报告被截条数, 防止一次导入挤爆生成池。

**缓存一致性**：`loadWordlist` 结果按 key 缓存, 因此导入 / 删除 / 切换 enabled 三处必须 `clearWordlistCache()`。

**UI**（`WordlistPage`）
- 导入跟随词表页当前语言（不新增对话框与 CSV 列，保持与既有导出文件兼容），词库行显示语言标签，可一眼看出这批词进了哪门语言。
- 「我的词库」每行增：语言标签、`参与学习 / 仅备份` 开关、词条数; 表内来自自定义的词条显示「自定义」徽标。
- 区块说明文案改为事实：启用的词库按语言与 CEFR 等级并入对应词表，参与阅读生成与复习队列。

### S2 — 每日新词目标可调
- `useWordlistStore` 增 `setNewWordsTarget(n)`（clamp 1–100, 取整）; `resetDailyGoalIfNewDay` 跨日重置时**保留用户设定值**, 只清零 `newWordsDone`。
- 设置面板「学习节奏」增数字输入, 与首页「今日新词 0/N」联动。

### S3 — `#/review` 深链语义
- 有活跃复习会话 → 进复习页（不变）。
- 无会话但有到期卡 → 直接按当前语言开始复习。
- 无会话且无到期卡 → 跳词表页并给一条明确 toast（不再静默弹回首页）。

### S4 — 错词本批量管理
- `useWrongWordsStore` 增 `removeEntries(cardIds)`。
- 错词本区块增多选（全选当前筛选结果）+ 批量删除 + 清空全部, 破坏性操作走两步确认（首点进确认态, 再点执行, 第三态取消）。

### S5 — 版本收口与真源同步
- `package.json` 3.6.5 / AppScope·entry 1.6.5 / versionCode 按 1.x 线 +5 规则递增。
- CHANGELOG、`docs/README.md` 索引、`harmony/CURRENT_STATUS.md` 数字条目同步; 留档项 L1–L4 标注结清或仍开放。

### S5 离线横幅冷启动（追加，结清 L6 之一）

`offlineMode.init` 原先只把 `navigator.onLine` 写进持久化的 `isOffline` 而刻意不派发通知，但 `OfflineBanner` 要求「通知存在且 isOffline」，且 `setOffline(true)` 会因 `prev === true` 早退 —— 离线状态下打开应用的用户永远看不到离线提示。改为按 `navigator.onLine` 权威值同步派发/清除通知，加 T06/T07 回归锁。

### S6 课程完成链纳入 CI E2E（追加，结清 L5）

不伪造 mock 语料，改用种子 `wordaydream:course` 状态覆盖该链（`e2e/web.spec.ts` T21）：完成态弹模态、统计无 `NaN`/`undefined`、点「下一课」落 `#/reading` 且 store 出现下一课 id —— 同时锁住 v1.6.4 探测 D6 的修复。E2E 基线因此从 24 升为 **25**（web 21 + offline-install 4）。

## 4. 明确不做

- 词库跨设备云同步 / 冲突合并（无后端）。
- CSV 新增列（`language` 走导入时选择, 不改文件格式, 保持与既有导出文件兼容）。
- 官方词表数据变更（de 例句覆盖率受语料上限, 仍是外部数据项）。
- 真机与签名相关一切（外部条件）。

## 5. 验收

| # | 条件 | 判据 |
|---|---|---|
| 1 | 合并逻辑正确 | `customMerge.test.ts` 覆盖：语言过滤 / CEFR→difficulty / 官方优先去重 / 批内去重 / C1 无官方词表 / 1000 上限截断 / 空输入幂等 |
| 2 | 自定义词真的进学习 | 启用一个含 A2 词的词库后, `getUnlearnedWords('en', 2, 8)` 结果包含该 lemma; 关掉后不包含 |
| 3 | 缓存不脏读 | 导入 / 删除 / 切换 enabled 后 `loadWordlist` 返回集合随之变化（单测断言 `clearWordlistCache` 被调用） |
| 4 | 每日目标 | 设 20 → 首页显示 `/20`; 跨日重置后仍 `/20` 且 `newWordsDone` 归零 |
| 5 | 深链 | 无会话 + 有到期卡 → `#/review` 进入复习; 无到期卡 → 落词表页且有 toast |
| 6 | 批量删除 | 多选后删除, 剩余 entries 与 store 一致; 清空需二次确认 |
| 7 | 门禁 | `tsc --noEmit` 0 · `oxlint` 0w0e · 全量 vitest **181 files / 1685 tests** 全绿零回归 · `npm run test:e2e` chromium **25/25** · `check:versions` PASS（3.6.5 / 1.6.5 / 1000090）· `verify:wordlists` 不新增 BLOCK |
