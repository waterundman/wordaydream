# Wordaydream v1.1.0 Stage 4 Playwright E2E 报告

**生成时间**: 2026-07-09 17:58:49
**Base URL**: http://127.0.0.1:5174
**Provider**: DeepSeek (真实 API, 来自 .env VITE_DEEPSEEK_API_KEY)

---

## E2E 概览

- 5+ 真实 LLM (DeepSeek) passage 生成 + 验证
- 合同: 段落数>=2 / 划线精准度>=90% / markdown 泄漏=0%
- 视口: 1440 / 1024 / 390 各 2+ 张
---



## 8 指标汇总

- **1. 段落达标率**: `100.0% (5/5 passage 含 >=2 段)`
- **2. 划线达标率**: `100.0% (23/23 token slice==surfaceForm)`
- **3. Markdown 泄漏率**: `0.0% (0/5 passage 含独立 markdown 字符行)`
- **4. 视口截图数**: `6 张 (target >= 6, 三视口各 2+)`
- **5. pageerror 计数**: `0`
- **6. console.error 计数**: `0`
- **7. alignment stats**: `5 次 log, {"perfect": 16, "total": 16}`
- **8. 修复率**: `100.0% (1 - dropped/total)`


## 合同验收

- ✓ 段落数 >= 2 (100% 命中): 100.0%
- ✓ 划线精准度 >= 90%: 100.0%
- ✓ Markdown 泄漏 = 0%: 0.0%
- ✓ 视口截图 >= 6 张: 6
- ✓ 0 pageerror: 0
- ✓ 0 console.error (排除 vite/fsrs/404 噪声): 0
- ✓ [Alignment] 触发 >= 3 次: 5 次


## Passage 明细

- **Run 1** (en/d2/the daily life of a freelance ): paragraphs=3 (>=2? True), align=4/4 (100%), md_leak=False, passed=True
- **Run 2** (en/d3/the invention of the printing ): paragraphs=3 (>=2? True), align=7/7 (100%), md_leak=False, passed=True
- **Run 3** (de/d2/das Leben in einer deutschen K): paragraphs=2 (>=2? True), align=2/2 (100%), md_leak=False, passed=True
- **Run 4** (en/d2/how a coffee roaster decides t): paragraphs=2 (>=2? True), align=6/6 (100%), md_leak=False, passed=True
- **Run 5** (de/d3/die Geschichte der Berliner Ma): paragraphs=3 (>=2? True), align=4/4 (100%), md_leak=False, passed=True


## 截图清单

- - `00_setup_deepseek_injected.png` (38 KB)
- - `run01_en_d2.png` (91 KB)
- - `run02_en_d3.png` (91 KB)
- - `run03_de_d2.png` (76 KB)
- - `run04_en_d2.png` (66 KB)
- - `run05_de_d3.png` (91 KB)
- - `viewport_1024_fold.png` (50 KB)
- - `viewport_1024_fullpage.png` (50 KB)
- - `viewport_1440_fold.png` (54 KB)
- - `viewport_1440_fullpage.png` (54 KB)
- - `viewport_390_fold.png` (23 KB)
- - `viewport_390_fullpage.png` (23 KB)


## Stage 4 发现 / Notes

- ✓ alignment validator 被触发 5 次: {'perfect': 16, 'total': 16} (sum=32)
- ✓ Stage 4 段落单层 split 重构 DOM 正确: 段落数 == text.split(/\n\n+/).filter(.trim) 段数
- ✓ prefers-reduced-motion 仍被遵守 (usePageEntranceAnimation 内置 matchMedia 监听)


## 结论

- **通过 passage 数**: `5/5 (100.0%)`
- ✓ Stage 4 段落重构 + E2E 全部合同达成


