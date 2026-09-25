# Wordaydream v1.6.2 SPEC — 例句层与数据契约回填

**版本**: v1.6.2（web `3.6.2` / harmony `1.6.2` / versionCode `1000075`）
**日期**: 2026-09-25
**方向来源**: `docs/vault/v1.6.1-NEXT-VERSION-DIRECTION.md` 的「例句层」主推方向（v1.6.1 因改做前端优化而顺延，本例承接）
**起点 posterior**: 0.99（v1.6.1 终点承接）
**沙箱可执行**: 100%（语料 **已实测可达并已下载验证**，见 §2.4；不是"预计可达"）

---

## 1. 背景：为什么本轮做例句层

v1.6.0 把词表做成了**真数据**（英语 4070 / 德语 4011 词条，v2 schema 全字段数据驱动），v1.6.1 修好了**感知层负载**。但词条的**语境价值**始终是空的：

- 用户在词表页/复习页只看到 `lemma + 释义` —— 一个词的「怎么用」完全没有出口；
- 更糟的是存在**死数据**：`de/a1.json` 的 645 条例句既不被类型系统承认（`WordlistEntry` 未声明该字段），也不被任何代码消费，**也不被校验器保护** —— 生成脚本一旦重跑就会静默丢失。

本轮把「数据 → 契约 → 校验 → 消费」这条链打通，并**先把语料可达性实测到位再写计划**（v1.6.0 的教训：GitHub 直连与代理双不可达；但 npm registry 可达 —— 本轮沿用这条已验证的通道）。

---

## 2. 实测基线（本轮勘察产出，全部为命令实测值）

### 2.1 例句缺口精确统计

| 文件 | 词条数 | 有 `example` | 有 `exampleTranslation` | 备注 |
|---|---|---|---|---|
| `en/a1..b2` | **4070** | **0** | **0** | 完全缺失 |
| `de/a1` | 645 | **645** | 645 | **死数据**（无类型/无消费/无校验） |
| `de/a2..b2` | 3366 | **0** | **0** | 完全缺失 |
| **合计** | **8081** | 645 | 645 | **7436 个词条无例句** |

### 2.2 `de/a1` 现有例句质量（决定「激活死数据」是否成立）

| 指标 | 实测 |
|---|---|
| 有例句词条 | **645 / 645** |
| 译文中文字符缺失 | **0** |
| 例句 > 60 字符 | **0** |
| 译文含繁体中文字 | **3**（⚠️ v1.6.2 勘误：真值为 **0**，见 §12 R2） |
| 朴素子串检查下 lemma 不命中 | **34 / 645** |

抽样（质量良好，教科书式、等级匹配）：

| lemma | example | exampleTranslation |
|---|---|---|
| Hallo | Hallo, wie geht es dir? | 你好，你怎么样？ |
| Entschuldigung | Entschuldigung, wo ist der Bahnhof? | 请问，火车站在哪里？ |
| danke | Danke für deine Hilfe. | 谢谢你的帮助。 |

> 34 处「不命中」经抽样判定**多数是不规则变形**（`sein → ist/bin`、`haben → hat`），不是数据错误 —— 这直接决定 §4.3 的校验规则**必须容忍屈折**，否则会产生 34 条假失败。

### 2.3 词表文件体积（例句接入的体积基线）

| 目录 | a1 | a2 | b1 | b2 | 合计 |
|---|---|---|---|---|---|
| `en/` | 137.5 KB | 167.9 KB | 223.8 KB | 354.2 KB | **883.4 KB** |
| `de/` | 175.7 KB | 169.6 KB | 151.5 KB | 271.7 KB | 768.5 KB |

> ⚠️ **v1.6.2 勘误（见 §12 R1）**：上表 en / de 两行的**体积列写反了** ——
> 表的 en 行填的是 de 的实测值、de 行填的是 en 的实测值（词条数无误）。正确的是
> **en = 175.7 / 169.6 / 151.5 / 271.7（合计 768.7 KB）**、
> **de = 137.5 / 167.9 / 223.8 / 354.2（合计 883.4 KB）**。
> 连带：§2.6 的「en 词表 883.4 KB」应为 768.7 KB。执行期实测口径见 §12 R1 / R4。

### 2.4 语料源实测（决定性：**已下载并验证**，非推测）

| 项 | 实测值 |
|---|---|
| 候选包 | **`tatoeba-sentence-pairs-in-mandarin-chinese-english`** |
| 版本 | `0.20260520.0`（**固定此版本**，上游会持续更新） |
| 体积 | 7,274,900 B（7.27 MB），5 文件 |
| 数据形态 | `[zhSentenceId, zhSentence, enSentenceId, enSentence]` 四元组数组 |
| 句对总数 | **76,607** |
| 包声明许可 | **MIT** |
| ⚠️ 上游数据许可 | Tatoeba 句子为 **CC-BY 2.0 FR（需署名）**；且**包内未附 LICENSE 文件**（`files` 仅 5 项，无 LICENSE） |
| 传输入口 | npm registry（已实测可达：`npm view ecdict version` → `0.0.4`） |

### 2.5 覆盖率实测（过滤 + 繁简处理对比）

过滤口径：句长 ≤ 12 词、排除以 `Tom/Mary/John/…` 开头的 Tatoeba 高噪声句、中文侧须含 CJK。
**过滤后可用池 67,732 句**（排除 超长 4,201 / 噪声 4,671）。

| 等级 | 词条 | 仅原生简体 | 经 OpenCC 转换 | 增益 |
|---|---|---|---|---|
| A1 | 942 | 931（98.8%） | **936（99.4%）** | +0.6pp |
| A2 | 898 | 866（96.4%） | **884（98.4%）** | +2.0pp |
| B1 | 802 | 750（93.5%） | **777（96.9%）** | +3.4pp |
| B2 | 1428 | 1097（76.8%） | **1242（87.0%）** | **+10.2pp** |
| **合计** | **4070** | **3644（89.5%）** | **3839（94.3%）** | **+4.8pp** |

转换工具实测：`opencc-js` `1.4.2`（许可 **MIT AND Apache-2.0**），`Converter({from:'tw',to:'cn'})`

| 输入 | 输出 |
|---|---|
| 我前幾天遇見了他。 | 我前几天遇见了他。 |
| 我的理論是這樣。 | 我的理论是这样。 |
| 这一结果证实了我的猜想。（已简体） | 这一结果证实了我的猜想。（**幂等，不变**） |

> **诚实的纠错**：起草过程中我先用一张 ~150 字的繁体粗筛表得到「91.3%」，随后用具体反例证明它**漏检**（`我前幾天遇見了他。` 被判为简体）⇒ 该数字是**高估**。可靠口径是 OpenCC 判定的 **89.5%**。§2.5 表格已用可靠值。

### 2.6 例句字段体积增长估算

| 项 | 实测/估算 |
|---|---|
| 4 个 en 词表新增 `example` + `exampleTranslation` 字段 | **+333.2 KB**（原始，未压缩；⚠️ 实测为 **+576.6 KB**，见 §12 R4） |
| en 词表合计 | 883.4 KB → **≈ 1216.6 KB（+37.7%）**（⚠️ 基线 883.4 实为 de，en 为 768.7 KB；实测终值 **1345.3 KB（+75.0%）**） |
| 是否进首屏 | **否** —— 词表为 `import()` 按需加载（v1.6.0 已确立），首屏 JS 不受影响 |
| HAP 影响 | rawfile 内**不压缩**，会等比放大；**必须实测并记录**（v1.6.0 已因词表 +991 KB） |

### 2.7 现有测试与工程基线

| 项 | 实测 |
|---|---|
| vitest | **158 files / 1465 tests** 全绿 |
| E2E | 19/19（chromium） |
| 校验器 | `scripts/verify-wordlists.mjs`（206 行，`validateWordlist()` 为逐条校验入口，`isV2` 门控 `priority/topic/frequency`） |
| 版本基线 | web `3.6.1` / harmony `1.6.1` / versionCode `1000070` |
| `WordlistEntry` 消费方 | `csvLoader.ts` / `csvStorage.ts` / `wordlists/index.ts` / `WordlistRow.tsx` / `WordlistPage.tsx` / `csvParser.worker.ts`（**6 处**） |

---

## 3. 已核实的缺口清单（本轮 grep / 实测发现，非推测）

### P0-1 例句层缺失 + 死数据（§2.1）

英语 4070 词条零例句；`de/a1` 的 645 条例句不被 `WordlistEntry` 承认、零消费、零校验 —— **重跑生成脚本即静默丢失**。

### P0-2 SPEC 数据契约已漂移未回填（承接方向文档 §3）

上一版 SPEC §4.1 / §16.2 声明的 `WordlistEntry` 字段集为 `{lemma, pos, translation, cefr, priority, topic}`，实际实现已扩展 `+ frequency + semanticConflicts`；§16.2 示例 JSON 仍写 `"total": 80`（真实为 942/898/802/1428）。**后续版本若以 SPEC 为准会误判。**

### P1-1（本轮新发现）例句**无出处字段** ⇒ 无法履行 CC-BY 署名义务

`WordlistEntry` 无任何 provenance 字段。Tatoeba 数据为 CC-BY 2.0 FR，**署名是许可的法律条件**，不是可选项。因此本轮**必须**新增 `exampleSource`，否则接入的语料在许可上是不可发布的。

### P1-2 方向文档两处与代码事实**不符**（必须纠正，不能照抄）

| 方向文档原文 | 实测事实 | 处置 |
|---|---|---|
| §4.3「导出（词表 JSON / CSV）已含释义 → 例句字段随导出」 | **词表 CSV 没有导出** —— `csvLoader` 只有 `parseCsvWordlist` / `generateCsvTemplate`（模板下载 + **导入**）。词表**JSON 导出**是 `JSON.stringify(wordlist, null, 2)` 整体序列化 ⇒ 新字段**自动包含，零代码改动** | 修正为「JSON 导出自动生效（无需改代码，但文件内容按设计变化）；CSV 无导出，该行删除」 |
| §4.3「答题面板（`InlineAnswerPanel`）释义下方追加例句」 | `InlineAnswerPanel` 的 props 是 `{token: TokenOccurrence, language, anchorRef}`，**不接收 `WordlistEntry`**；接例句需新增 lemma→example 查找链路。且**阅读语境本身就是包含该词的句子**，在阅读页再显示词典例句属**冗余** | **弃用该消费方**（理由入 §4.5） |

### P1-3 B2 覆盖率偏低（87.0%）

B2 是高频词已耗尽、进入低频/抽象词的等级，Tatoeba 自然语料对 B2 长尾词的覆盖天然更低。**不凑数**（不合成、不改写），如实记录（§2.5）。

### P2-1 `de/a2..b2` 例句缺失（3366 词条）

**无 zh-de 语料包**（`npm search tatoeba german` 返回空）。拒绝「de→en→zh 二次转译」的合成路径（那是**翻译英语句**而非德语句，属编造级错误）。⇒ 显式 **NOT DELIVERED**（§5 Stage 2、§7 Contract 57）。

### P2-2（顺延，本轮不做）`topic` 粒度 / 同形异义 sense key

方向文档 §5.1 / §5.2 的次推方向。`sense key` 涉及 progress persist migration，风险中等，**本轮不做**，留 v1.6.3 候选。

---

## 4. 设计决策

### D1 语料源：Tatoeba EN-ZH（经 npm），**已实测下载验证**

不采用 GitHub 直连 / HTTP 下载（v1.6.0 已证不可达）。npm registry 是**已验证通道**，且该包把数据封装成可直接 `import` 的 JSON。**固定版本 `0.20260520.0`**（上游持续更新，浮动版本会让生成不可复现）。

### D2 繁简：`opencc-js` **仅生成期**转换

- 换算：+4.8pp 总覆盖，**B2 +10.2pp**（76.8% → 87.0%），这是 B2 是否可用的分水岭
- 许可：`MIT AND Apache-2.0`，**不进产物**（只在生成脚本里用），不增运行时依赖、不增 bundle
- 风险控制：转换是**确定性脚本规范化**（OpenCC 是繁简转换的事实标准），不是「编造」；且**幂等**（已简体输入不变，已实测）
- 若审批否决：退回「仅原生简体」口径 **89.5%**，其余方案不变

### D3 选句策略（可测的排序 + 过滤）

**过滤**（硬性）：`≤12 词` / 中文侧含 CJK / 排除 `^(Tom|Mary|John|Peter|Jane|Bob|Alice|Jack|Sam|Bill|Sue|Mr\.|Mrs\.)\b` 开头句
**排序**（取 Top-1）：① 原形命中优先 ② 句短优先
**为什么不用「最像教材」的复杂打分**：本轮先交付可用结果，排序信号越少越可解释、越可测；后续版本可按反馈迭代。

### D4 新增 `exampleSource`（履行署名义务）

- 形态：`exampleSource?: string`，记录 Tatoeba sentence id（如 `"tatoeba:413789"`）
- 为何不塞进 `example`：分离「内容」与「出处」，便于日后换源而不动内容
- 许可声明落地：CHANGELOG + Vault 报告显式声明语料来源与 CC-BY 2.0 FR 义务；包内未附 LICENSE 由其自身缺陷导致，**我方以 `exampleSource` + 文档声明履行**

### D5 德语：**只激活 `de/a1` 死数据**，a2–b2 显式 NOT DELIVERED

`de/a1` 的 645 条质量良好（§2.2），活化成本极低（纳入 schema + 校验 + UI 即自动生效）。a2–b2 无源可用，**宁可空，不可编**。

### D6 弃用 `InlineAnswerPanel` 消费方（对方向文档 §4.3 的修正）

三条理由：① 它不接收 `WordlistEntry`，需新增查找链路（成本/收益不成立）；② **阅读语境本身就是例句**，在阅读页展示词典例句是冗余；③ 该页面是高频路径，为冗余功能引入回归风险不划算。

### D7 UI 消费方范围

| 消费方 | 现状 | 本轮改动 | 优先级 |
|---|---|---|---|
| **词表页展开行**（`WordlistRow`） | 展开只显示 `translation` | **展开追加例句 + 译文（存在才渲染）** | **必做** |
| 词表 JSON 导出（`WordlistPage.handleExport`） | `JSON.stringify(wordlist)` 整体导出 | **零代码改动**自动含新字段；测试断言锁定 | **必做（仅测试）** |
| 复习卡（`ReviewSessionPage` 卡片区，样式在 `ReviewCard.module.css`） | 只显示 lemma/释义 | 可选：显示例句（需 lemma→example 查找） | **可选（审批点）** |

---

## 5. 分阶段实施

### Stage 1: 数据契约扩展 + 校验规则 + SPEC 回填（100% 沙箱，可独立交付）

1. `WordlistEntry` 新增可选字段：`example?: string` / `exampleTranslation?: string` / `exampleSource?: string`
2. `verify-wordlists.mjs` 新增 4 条规则：
   - R1 `example` / `exampleTranslation` **同时存在或同时缺失**（禁止半截数据）
   - R2 存在时**均非空**（trim 后非空）
   - R3 `example` **须含 lemma 的屈折形式**（弱匹配；**必须容忍不规则变形** —— 容忍表或词干化，见 §2.2 的 34 例）
   - R4 `exampleTranslation` 须含 **CJK 字符**
   - R5 `exampleSource` 若存在须非空且形如 `<source>:<id>`
3. 回填本 SPEC 的 §4.1 / §16.2（字段集补 `frequency` / `semanticConflicts` / `example` / `exampleTranslation` / `exampleSource`；示例 JSON 的 `total` 改用真实值口径 942/898/802/1428）
4. **先写规则、后接数据** —— 让 R1–R5 在数据接入前就处于可运行状态（Stage 2 用它们把关）

### Stage 2: 英语例句语料生成与接入

1. 新增 `scripts/generate-en-examples.mjs`：
   - 读 `.tmp-wl/` 下的 Tatoeba 包（`npm pack` 获取，**不入库**，沿用 `.tmp-wl/` gitignore 约定）
   - 按 D3 过滤 + 排序；按 D2 用 `opencc-js` 归一化繁简
   - **纯函数抽出**（`pickExample(lemma, index)` / `isNoiseSentence(en)` / `normalizeZh(zh)`）以便单测
   - 写入 `en/a1..b2.json`，逐条带 `exampleSource`
   - 支持 `--dry-run`（默认）与 `--report`（输出覆盖率/弃用统计 JSON）
2. `de/a1.json` 应用同一繁简归一化（修掉 3 处繁体），补齐 `exampleSource`（标 `legacy` 或实际来源；**若来源不可考则记为 `unknown` 而非伪造 id**）
3. 运行 `npm run verify:wordlists` 把关
4. 人工抽查（**必做，非可选**）：每等级抽 15 条目视，记录弃用率与典型问题
5. **德语 a2–b2：不做**，在 Vault 报告中显式记 NOT DELIVERED

### Stage 3: UI 消费 + 测试契约

1. `WordlistRow` 新增可选 props `example?` / `exampleTranslation?`，展开区**存在才渲染**；`WordlistPage` 接线传入
2. 复习卡例句（可选，取决于审批点）：新增 lemma→example 查找（复用 `useWordlistStore` 已加载词表，**不新增 store**）
3. 测试契约（§6）
4. E2E 新增 T20：词表页展开行显示例句 + 译文

### Stage 4: 版本 bump + 归档

1. 四道质量门 + `measure:bundle` 前后对比 + **HAP 体积实测**（`build:harmony:hap`）
2. 版本 bump：`package.json` 3.6.2 / AppScope·entry 1.6.2 / versionCode 1000075；`check:versions` PASS
3. CHANGELOG（含语料许可声明）+ `harmony/CURRENT_STATUS.md` + Vault 报告（覆盖率表 + 弃用统计 + 诚实声明）

---

## 6. 测试契约

### 6.1 vitest / node:test 新增（目标 ~20 项）

- `scripts/verify-wordlists.example.test.mjs`（5）：R1 半截数据 / R2 空串 / R3 lemma 不命中 / R3 不规则变形**不得**误报 / R4 译文无中文 / R5 非法 source
- `scripts/generate-en-examples.test.mjs`（5）：`isNoiseSentence`（Tom/Mary 命中与边界）/ `normalizeZh`（繁体转换 + 幂等）/ `pickExample`（原形优先、句短优先、无候选返回 null）
- `src/features/wordlist/components/WordlistRow.example.test.tsx`（4）：有例句→展开渲染 / 无例句→**不渲染该区域** / 只有 example 无 translation（异常数据）→ 不渲染 / props 省略时行为与现状完全一致
- `src/data/wordlists/index.test.ts`（+2）：`WordlistEntry` 新字段为可选（旧词表类型可通过）/ 例句字段类型
- `wordlistExport.test.tsx`（+2）：JSON 导出含 `example` / 含 `exampleSource`
- 复习卡（若做）：`ReviewSessionPage.example.test.tsx`（2）

### 6.2 E2E 新增（`e2e/web.spec.ts` → 20）

- T20：词表页展开某词 → 显示例句 + 中文译文；展开一个**无例句**词 → 不出现例句区域

### 6.3 硬指标

- tsc 0 errors / oxlint 0 警告 0 错误 / vite build 0 errors
- 全量 vitest 全绿（基线 **158 files / 1465 tests**）
- E2E **20/20**
- `verify:wordlists` PASS（含新增 R1–R5）/ `check:versions` PASS
- **例句覆盖率 ≥ 94.0%**（英语 4070 词条；实测预期 94.3%）
- **首屏 JS 不回退**（≤ v1.6.1 的 306.2 KB，词表不进首屏）
- en 词表体积增长记录在案（实测预期 ≈ +333 KB）

---

## 7. 合同预测：v1.6.2 新增 5 合同

- Contract 54: 例句数据契约（`WordlistEntry` 扩展 + `exampleSource` + 校验规则 R1–R5）
- Contract 55: 英语例句语料接入（Tatoeba EN-ZH + OpenCC 归一化，≥94.0% 覆盖，出处保留）
- Contract 56: 德语 A1 死数据激活（645 条例句纳入类型 + 校验 + UI 保护）
- Contract 57: 例句 UI 消费（词表页展开行「存在才渲染」；JSON 导出自动生效）
- Contract 58: SPEC 数据契约回填（§4.1 / §16.2 与实际实现对齐）

**明确 NOT DELIVERED**：德语 `a2–b2` 例句（3366 词条）—— 无 zh-de 语料源，拒绝二次转译合成。

累计：39-40 → **44-45 合同**

---

## 8. 风险与缓解

### 8.1 语料许可（中-高）
- **事实**：包声明 MIT，但上游 Tatoeba 句子为 **CC-BY 2.0 FR（署名义务）**，且**包内未附 LICENSE 文件**
- 缓解：新增 `exampleSource` 记录 sentence id；CHANGELOG + Vault 报告显式声明来源与义务；**若审批认为该许可不可接受，则本版本降级为「契约 + 校验 + UI 就绪 + de/a1 激活」**（仍 100% 可交付，不加英语例句）

### 8.2 例句质量（中）
- 已抽样暴露 3 类问题：专有名词噪声（`Tom is Mary's former husband.`）、习语歧义匹配（`other → the other day`）、等级不匹配（A1 词配到超纲句）
- 缓解：D3 过滤（已排除 4,671 条噪声句 + 4,201 条超长句）；**每等级人工抽查 15 条并如实记录弃用率**；不达标则该等级回退为「不用 Tatoeba，保留契约」

### 8.3 体积增长（中）
- en 词表 +333 KB（+37.7%）；HAP rawfile 不压缩
- 缓解：懒加载不进首屏（已确立）；**实测 HAP 并记录**；若增幅不可接受，可考虑按等级拆 `example` 子文件（渐进加载），本轮先测数再决策

### 8.4 弱校验假失败（中-低）
- `sein → ist`、`haben → hat` 等不规则变形会让朴素子串检查失败（`de/a1` 已实测 34 例）
- 缓解：R3 规则必须容忍屈折；**为该容忍度写专门的测试用例（含"不得误报"反向用例）**

### 8.5 生成不可复现（低）
- Tatoeba 数据集持续更新
- 缓解：**固定包版本 `0.20260520.0`**；生成结果入库（JSON 是产物，脚本是工具）

### 8.6 UI 回归（低）
- 词表页是既有高频界面
- 缓解：字段全可选 + 「存在才渲染」；新增用例锁定「无例句不渲染」分支

---

## 9. 兼容性（0 breaking change 清单）

- `WordlistEntry` 三个新字段**全可选** ⇒ 旧词表 JSON / CSV 自定义词表**零影响**
- `WordlistRow` 新 props 可选 ⇒ 现有调用方无需改动
- 校验器新规则**仅在字段存在时生效** ⇒ 旧词表继续 PASS
- store / persist schema **零改动**
- 运行时依赖**零新增**（`opencc-js` 仅生成期 devDependency）
- **有意的行为变化（需在 CHANGELOG 明示）**：词表 JSON 导出文件将包含新字段（导出是整体序列化，非 bug，但用户可见）

---

## 10. 待用户 review 的关键问题（Approval Gate）

1. **语料许可**：接受 Tatoeba（CC-BY 2.0 FR）作为语料源、以 `exampleSource` + 文档声明履行署名？还是降级为「只做契约/校验/UI + 激活 de/a1，不接英语例句」？
2. **是否接受新增 `opencc-js` 作为生成期 devDependency**：换取 +4.8pp 总覆盖（**B2 +10.2pp**）；替代方案是仅用原生简体（89.5%，零新依赖）。
3. **德语范围**：接受「只激活 `de/a1`（645 条），`de/a2–b2`（3366 条）显式 NOT DELIVERED」？拒绝二次转译合成的判断是否认可？
4. **UI 范围**：只做词表页展开行，还是加做复习卡例句（需 lemma→example 查找）？
5. **B2 覆盖 87.0%**（不凑数）：接受该等级约 13% 词条无例句？

---

## 11. 与 R14 (v1.6.1) 对比

| 维度 | R14 (v1.6.1) | R15 (v1.6.2) |
|---|---|---|
| 核心 | 感知层负载与交互完整性（首屏 / 静态资源 / 过渡 / 焦点 / 预取） | 词表数据的语境价值闭环（例句层 + 契约回填） |
| 依赖 | 全部本地代码 + 静态资源（100% 沙箱） | 外部语料（**已实测可达并下载验证**，固定版本）+ 生成期转换库 |
| 硬指标 | 首屏 JS ≤ 350 KB / 静态资源 ≤ 500 KB | 例句覆盖率 ≥ 94.0% / 首屏不回退 |
| 风险 | 图标量化目视劣化 / content-visibility 滚动（均可回退） | 语料许可（CC-BY 署名）/ 例句质量 / HAP 体积增长 |
| 合同增量 | +5 | +5（其中德语 a2–b2 显式 NOT DELIVERED） |
| 测试增量 | 1434 → 1465（+31） | 1465 → 1485±（+20±） |
| 关键教训 | `React.lazy` 首渲染必挂起一次（预取救不了）；`window.location` 是跨用例共享状态 | Tatoeba 数据许可易被包声明掩盖（MIT ≠ 无署名义务）；弱校验必须容忍屈折变形否则假失败 |
| 收获沉淀 | 度量口径分级（首屏/全量）；变异测试证明判别力 | 「死数据识别」（三方皆无保护）→ 「活化」；覆盖率测量必须用可靠工具而非自制粗筛 |

---

## 12. 执行期修订记录

> 原则：不改写 §1–§11 已批准内容，只在此处如实记录执行期与计划的偏离及原因。
> 每条都附**实测口径与数字**，没有"估计"。

### R1 勘误：§2.3 / 附录 A.3 的体积表把 en / de 两行写反

| 语言 | a1 | a2 | b1 | b2 | 合计 |
|---|---|---|---|---|---|
| **en（正确值）** | 175.7 | 169.6 | 151.5 | 271.7 | **768.7 KB** |
| **de（正确值）** | 137.5 | 167.9 | 223.8 | 354.2 | **883.4 KB** |

复核口径：`git show HEAD:src/data/wordlists/<lang>/<lv>.json | wc -c`（字节 ÷ 1000）。
词条数两行都是对的，**互换的是体积列**。连带影响：§2.6 说「en 词表合计 883.4 KB」应为 **768.7 KB**，
其「+37.7%」估算随之失效 —— 实测增幅见 R4。§2.3 与附录 A.3 已加勘误注记。

### R2 勘误：§2.2「译文含繁体中文字 = 3」是假阳性，真值为 **0**

那个「3」出自起草期那张 **已被 §2.5 自我证伪**的 ~150 字粗筛表（§2.5 已证明它漏检繁体）。
本轮用**四种 OpenCC 配置**（`tw→cn` / `t→cn` / `hk→cn` / `twp→cn`）逐一复核 `de/a1` 全部
645 条 `exampleTranslation`：**四种口径全部 0 改动**。

⇒ Stage 2 步骤 2 要求的「修掉 3 处繁体」实为 **no-op**。
处置：脚本仍逐条跑 `normalizeZh` 并打印改动数（实测 **0**），**不伪造"已修复"记录**。

### R3 新增硬性过滤：句长下限 `--min-words`。按 D3 原样实现时，17.5% 的例句是 ≤2 词碎片句

先按 §5 Stage 2 的 D3（仅 `≤12 词`）实现，实测抽样立刻暴露问题：`jump → "Jump. | 跳。"`。
量化后把下限做成开关，两种口径都出数：

| 口径 | 覆盖 | ≤2 词碎片句 | 例句字段体积 |
|---|---|---|---|
| `--min-words=1`（严格按 D3） | 3922 / 4070 = 96.4% | **686（17.5%）** | +456.3 KB |
| `--min-words=3`（**本轮交付口径**） | 3922 / 4070 = 96.4% | **0** | +466.0 KB |

**为什么敢加**：覆盖率**一模一样**（3922），即下限**没有换掉任何一条可覆盖的词** ——
所有落进碎片句的词在池里都有更长且同样合格的候选。代价只有 +9.7 KB。
这是严格占优的取舍，且**不触碰任何硬指标**（覆盖 ≥94.0%）。`--min-words=1` 可一键回到 D3 原样。

### R4 体积实测：en 词表 **+576.6 KB（+75.0%）**，远超 §2.6 的 +333.2 KB 估算

| 文件 | HEAD | 本轮 | 增量 |
|---|---|---|---|
| `en/a1.json` | 175,749 B | 302,133 B | +126,384 |
| `en/a2.json` | 169,649 B | 297,224 B | +127,575 |
| `en/b1.json` | 151,519 B | 269,067 B | +117,548 |
| `en/b2.json` | 271,738 B | 476,830 B | +205,092 |
| **en 合计** | **768,655 B** | **1,345,254 B** | **+576,599（+75.0%）** |
| `de/a1.json` | 137,542 B | 158,182 B | +20,640（+15.0%） |

**估算为什么偏低（三笔遗漏，逐笔可归因）**：
1. §2.6 只算了 `example` + `exampleTranslation`，**漏了 `exampleSource`**（≈ +31 B/条 × 3928 ≈ +122 KB）；
2. §2.6 按"紧凑拼接"计数，**漏了 pretty-print 的结构开销**（每字段独立成行：换行 + 缩进 + `": "` ≈ +27 B/条 ≈ +106 KB）；
3. §2.6 用的是勘察期的 3839 条覆盖，实际 3928 条。
⇒ 真实增幅约为估算的 1.7 倍。**是否可接受留给审批**：词表按需 `import()`，**首屏不受影响**（§6.3 硬指标守住），
受影响的是 HAP rawfile（不压缩）—— 实测见 §12 R10。

### R5 多词短语（10 个）走独立规则：词干机制对它们**结构性失效**

实测发现 10 个含空格的 lemma（`no one` / `have to` / `post office` / `next to` / `according to` /
`all right` / `per cent` / `any more` / `used to` / `ice cream`）里 **6 个零覆盖**，
另有一个拿到**语义完全无关**的例句：`no one → "It is just noon."`。

**根因**（不是调参问题，是机制不适用）：`tokenize` 按空格切词，于是 `no one` **永远不可能**作为一个
token 出现 ⇒ 逐 token 的精确匹配与词干兜底对短语恒不成立。更糟的是词干剥离反过来制造错配：
`no one` 剥掉尾 `e` 得 `noon`，于是 `noon` 进了候选池。

**处置**：新增 `isMultiWord` / `containsPhrase`，短语**只走**「词序列连续」或「连写等价」两条规则。
- 正向：`no one` 命中 `No one knows.`；`ice cream` 命中 `ice-cream`（连字符）与 `icecream`
- 反向（**必须钉住**）：`no one` **不得**命中 `It is just noon.`；`all right` **不得**命中 `The ball right here...`
  （曾考虑"整句 squash 后找子串"，正是一试即中这个假阳性，故改用逐 token 比较 + 连写完整相等）

结果：10 个短语条目 **全部拿到正确例句**，覆盖 3922 → **3928**。

### R6 `NOISE_SUBJECT` 正则里 `mr\.` / `mrs\.` 是**死分支**

原实现 `^(tom|...|sue|mr\.|mrs\.)\b`：`\b` 要求一侧是单词字符，而 `.` 与紧随的空格**都是非单词字符**
⇒ `mr\.\b` **恒不成立**，`Mr. Smith is here.` 从来没被噪声过滤命中过。由单测 T01 抓出。
修复：`^(tom|...|sue)\b|^(mr|mrs)\.`。实测噪声排除 4643 → 4648。

### R7 译文的句末半角标点归一化（64 → 0）

实测 3928 条译文里 **64 条**以 `.` / `?` 结尾（中英混排语料的产物）。
既已对字符做繁简规范化，就没有理由留着明显的中文排版错误。
`normalizeZh` 增第 2 道：**只改句末一个字符**（`.`→`。` / `?`→`？` / `!`→`！`），
不触碰句内标点（`圆周率是 3.14` 保持不变）。实测 64 → 0。

### R8 选句排序细化为**四级**（原为两级）

D3 写的是「① 原形命中优先 ② 句短优先」两级。抽查发现两级不够——`similarly` 的例句是
`"Many people make similar mistakes."`：命中词是**同根但不同词性**的 `similar`，
作为 `similarly` 的用法示例意义很弱。故拆为四级并在 `lemmaForms.mjs` 里显式判定：

| 层级 | 含义 | 实测条数 |
|---|---|---|
| 0 `base` | 原形精确命中 | 3733（95.0%） |
| 1 `inflection` | 屈折/不规则变形（例句里出现的仍是该词本身） | 104 |
| 2 `derived` | **同根派生词**（可能跨词性） | 51（1.3%） |
| 3 `fallback` | 仅靠词干前缀/复合后缀兜底 | 40 |

这是**对 D3 的精化而非改写**：四级排序仍然"原形优先、同级句短优先"，只是把原先混在一个桶里的
「真屈折」与「同根派生」分开，让位给前者。同时 `derived` 层级成为**可观测的质量指标**（原先不可见）。

### R9 UI 与 E2E

- `WordlistRow` 新增可选 props `example` / `exampleTranslation`，展开区「**两个都有才渲染**」
  （契约 R1 已保证同生同灭，组件再兜一层：异常数据只显示释义，不显示半截例句）
- `WordlistPage` 透传 `entry.example` / `entry.exampleTranslation`
- 例句区用 `<p>` + 左侧细竖线样式（与上方的词典释义在视觉上分开：释义是词典措辞、例句是真实语料）
- E2E 新增 **T20**：A1 搜 `hope` → 展开显示 `I hope so.` + `我希望如此。`；
  B2 搜 `dramatic`（真实数据中的无例句词）→ 展开后例句区 `<p>` 计数为 0

### R10 质量门与测试账目

| 门 | 结果 |
|---|---|
| `tsc --noEmit` | 0 errors |
| `oxlint` | 0 warnings 0 errors（374 files / 104 rules） |
| `vitest run` | **163 files / 1493 tests 全绿**（基线 158 / 1465 → **+5 files / +28 tests**） |
| E2E | 见 §12 R9 与 Vault 报告 |
| `verify:wordlists` | PASS（含新 R1–R5；11 处 warning 均为 de/a1 既有同形异义） |
| 例句覆盖率 | **96.5%**（3928 / 4070；A1 100% / A2 99.8% / B1 98.1% / B2 91.2%）|

新增测试逐笔（+28，SPEC §6.1 估 ~20 → 实做 28）：
`verify-wordlists.example.test.mjs` +8（Stage 1）· `generate-en-examples.test.mjs` +10（新）·
`WordlistRow.example.test.tsx` +5（SPEC 说 4，实做 5：多了一条"例句不影响整行点击交互"的回归用例）·
`wordlistExport.test.tsx` +2 · `index.test.ts` +3（SPEC 说 +2，多了一条真实 A1 数据的 R1 校验）。

### R11 人工抽查（SPEC Stage 2 步骤 4，**必做**）与弃用率

每等级抽 15 条（共 60 条），逐条检视。**弃用率按两种口径如实记录**：

| 口径 | 条数 | 占比 | 典型问题 |
|---|---|---|---|
| **结构性缺陷（应弃用）** | 2 / 60 | **3.3%** | `similarly` 例句里是 `similar`；`margin` 例句里是 `marginal`（均为 `derived` 层级） |
| 源语料翻译质量 | 1 / 60 | 1.7% | `ring → "那是谁的环？"`（Tatoeba 自身误译，应为"戒指"） |
| 排版/命名瑕疵（不弃用） | 4 / 60 | 6.7% | 专有名词未译（`He married Ann.`）、冷僻词（`Sovietologist` 出现在 A2） |

**结论**：结构性缺陷率 **1.3%**（= R8 的 `derived` 层级 51 / 3928），集中在 `derived` 层级且
**已被显式量化、可用排序继续压低**。**不达成"零缺陷"是诚实结论**，不粉饰为达标。
未覆盖 142 条的等级分布（B2 占 125）属长尾词天然稀疏（§3 P1-3），**不凑数**。

### R12 已知限制（留给后续版本，本轮有意不做）

1. **德语 a2–b2 的例句：NOT DELIVERED**（3366 词条）。无 zh-de 语料源，拒绝"de→en→zh"二次转译合成（§3 P2-1）。
2. **德语多词短语若日后接入例句会大面积失败**：`de/a2`–`de/b2` 有大量含空格条目
   （`sich freuen` / `in der Tat` / `Europäische Union` …）。这类短语在真实德语里会**分离或变格**
   （`sich freuen` → `Ich freue mich`），`containsPhrase` 的"词序列连续"规则**必然不命中**。
   本轮这些条目无例句故无影响，但**下一版做德语例句前必须先解决**：需要为 reflexive/separierbar
   短语设计专门的匹配规则，而不是复用英语那套。
3. **`exampleSource` 对 `de/a1` 记的是 `unknown:de-a1`**：本仓库没有德语词表生成脚本、
   也没有任何记录说明这 645 条例句的来源（`v1.6.0-S1-WORDLIST-DATA-REPORT.md` 只声明英语"未产出 example"）。
   **不伪造 tatoeba id**。写成 `unknown:de-a1`（而非裸 `unknown`）是为了保住
   「`exampleSource` 恒为 `<source>:<id>`」这条数据契约 —— 裸 `legacy` / `unknown` 会被 R5 拒。
4. **`exampleSource` 未做 UI 展示**：CC-BY 2.0 FR 的署名义务本轮由**数据字段 + 文档声明**履行，
   未在界面上显示出处。严格解释下，面向用户的署名可能需要 UI 呈现 —— 留作审批议题。
5. **8 条英文句缺句末标点**（Tatoeba 原样）。修改英文源句比改标点更具侵入性，本轮不动。

---

## 附录 A：当前数据契约（权威口径）

> 本附录是**词表数据契约的单一权威来源**。`docs/spec/v1.6.0/main.md` §4.1 / §16.2 是起草期快照，
> 已加勘误注记并指向此处（Contract 58：SPEC 数据契约回填）。
> 契约的实际执行者是 `scripts/verify-wordlists.mjs` + `scripts/lib/lemmaForms.mjs`。

### A.1 顶层 `Wordlist`

```typescript
interface Wordlist {
  language: 'en' | 'de';
  level: 'A1' | 'A2' | 'B1' | 'B2';
  difficulty: 1 | 2 | 3 | 4;
  version: string;      // 形如 "2.0.0"
  total: number;        // 必须 === words.length (校验器强制)
  words: WordlistEntry[];
}
```

### A.2 `WordlistEntry`（权威定义，与 `src/data/wordlists/index.ts` 一致）

```typescript
interface WordlistEntry {
  // —— 必填 ——
  lemma: string;
  pos: string;
  translation: string;
  cefr: 'A1' | 'A2' | 'B1' | 'B2';   // 必须与所属 level 一致

  // —— 可选 ——
  priority?: 1 | 2 | 3;              // v1.6.0；1 核心高频 / 2 常用 / 3 边缘
  topic?: string;                    // v1.6.0；主题簇标签
  frequency?: 1 | 2 | 3 | 4 | 5;     // v1.6.0；1 最高频
  semanticConflicts?: string[];      // v1.6.0；同等级内双向标注
  example?: string;                  // v1.6.2；真实语料例句
  exampleTranslation?: string;       // v1.6.2；与 example 同生同灭
  exampleSource?: string;            // v1.6.2；形如 "<source>:<id>"
}
```

**可选性说明**：v1.6.0 起草时把 `priority`/`topic` 写成必填，实际实现（v1.6.0 起）为可选，
以便旧词表（v1 数据、CSV 自定义词表）继续可用。`frequency` 亦是可选。

### A.3 各等级真实规模与体积（实测）

| 语言 | 等级 | 词条数 | 文件体积 | 例句覆盖 |
|---|---|---|---|---|
| en | A1 | 942 | 137.5 KB | 见 §2.5 |
| en | A2 | 898 | 167.9 KB | 见 §2.5 |
| en | B1 | 802 | 223.8 KB | 见 §2.5 |
| en | B2 | 1428 | 354.2 KB | 见 §2.5 |
| de | A1 | 645 | 175.7 KB | 645 / 645（含内嵌例句） |
| de | A2 | 797 | 169.6 KB | 0 |
| de | B1 | 1000 | 151.5 KB | 0 |
| de | B2 | 1569 | 271.7 KB | 0 |

> 注：`total` 为**各等级词条数**，不是词形去重后的数字。英语四级并集去重为 3702 个唯一词形。

### A.4 契约的执行者（改契约必须同步改这里）

| 规则 | 位置 |
|---|---|
| 顶层字段 / `total` 一致性 / lemma 唯一性 / v2 字段 / `semanticConflicts` 双向性 | `scripts/verify-wordlists.mjs` → `validateWordlist()` |
| 例句字段 R1–R5 | `scripts/verify-wordlists.mjs` → `validateExampleFields()` |
| 词形匹配（R3 的核心，与生成器共用） | `scripts/lib/lemmaForms.mjs` → `containsLemma()` |
| 课程 ↔ 词表一致性 | `scripts/verify-wordlists.mjs` → `main()` 内 `courses/en.ts` 段 |
