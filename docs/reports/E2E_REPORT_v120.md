# Wordaydream v1.2.0 Stage 4 Playwright E2E 报告

**生成时间**: 2026-07-10 02:03:15
**Base URL**: http://127.0.0.1:5175
**Provider**: DeepSeek (真实 API, 来自 .env VITE_DEEPSEEK_API_KEY)

---

## E2E 概览

- 5+ 真实 LLM (DeepSeek) passage 生成 + 验证
- 11 合同验收: v1.1.0 7 合同 + v1.2.0 Stage 4 hotfix-2 4 合同 (alignmentStatus / 德文 / en无德文 / banner)
- 视口: 1440 / 1024 / 390 各 2+ 张 + alignment tooltip 截图 + banner 截图
---



## 8 指标汇总

- **1. 段落达标率**: `100.0% (5/5 passage 含 >=2 段)`
- **2. 划线达标率**: `100.0% (9/9 token slice==surfaceForm)`
- **3. Markdown 泄漏率**: `0.0% (0/5 passage 含独立 markdown 字符行)`
- **4. 视口截图数**: `6 张 (target >= 6, 三视口各 2+)`
- **5. pageerror 计数**: `0`
- **6. console.error 计数**: `0`
- **7. alignment stats**: `11 次 log, {"perfect": 23, "total": 23}`
- **8. 修复率**: `100.0% (1 - dropped/total)`


## 11 合同验收

- ✓ **1. 段落数 >= 2 (100% 命中)**: 100.0%
- ✓ **2. 划线精准度 >= 90%**: 100.0%
- ✓ **3. Markdown 泄漏 = 0%**: 0.0%
- ✓ **4. 视口截图 >= 6 张**: 6 张
- ✓ **5. 0 pageerror**: 0
- ✓ **6. 0 console.error (排除 vite/fsrs/404 噪声)**: 0
- ✓ **7. [Alignment] 触发 >= 3 次**: 11 次
- ✓ **8. 5 run 全部 token alignmentStatus != 'unknown' (P1-A)**: unknown_ratio=0.0% (0/9), target<=10%
- ✗ **9. 德文 run 真实 LLM 含德文词 >= 5 (P1-B)**: min_hits=0, de_runs=2, target>=5
- ✓ **10. en run 真实 LLM 不含德文 (P1-B)**: max_german_chars=0, en_runs=3, target<=0
- ✓ **11. Fallback banner + useToastStore 派发**: banner=1, dispatch=1, dismiss_works=True
- **总通过**: `10/11`


## v1.2.0 Stage 4 hotfix-2 4 合同详细表现

- **8. alignmentStatus != 'unknown' (P1-A)**: `{'total_tokens': 9, 'unknown_tokens': 0, 'unknown_ratio': 0.0, 'per_run': [{'run': 1, 'language': 'en', 'total': 2, 'unknown': 0, 'statuses': {'perfect': 2}}, {'run': 2, 'language': 'en', 'total': 2, 'unknown': 0, 'statuses': {'perfect': 2}}, {'run': 3, 'language': 'de', 'total': 2, 'unknown': 0, 'statuses': {'perfect': 2}}, {'run': 4, 'language': 'de', 'total': 1, 'unknown': 0, 'statuses': {'perfect': 1}}, {'run': 5, 'language': 'en', 'total': 2, 'unknown': 0, 'statuses': {'perfect': 2}}], 'passed': True}`
- **9. 德文 run 含德文词 (P1-B)**: `{'de_runs': 2, 'min_hits': 0, 'per_run': [{'run': 3, 'difficulty': 2, 'german_keyword_hits': 0}, {'run': 4, 'difficulty': 3, 'german_keyword_hits': 0}], 'passed': False}`
- **10. en run 不含德文 (P1-B)**: `{'en_runs': 3, 'max_hits': 0, 'per_run': [{'run': 1, 'difficulty': 2, 'german_char_hits': 0}, {'run': 2, 'difficulty': 3, 'german_char_hits': 0}, {'run': 5, 'difficulty': 2, 'german_char_hits': 0}], 'passed': True}`
- **11. Banner 派发**: `{'banner_count': 1, 'banner_message': '已切换到预存文本 (LLM 服务暂不可用)', 'close_count': 1, 'dismiss_works': True, 'dispatch_count': 1, 'after_dismiss_count': 0, 'second_dispatch_count': 1}`


## Passage 明细

- **Run 1** (en/d2/the daily life of a freelance ): paragraphs=2 (>=2? True), align=2/2 (100%), md_leak=False, passed=True, alignment={"perfect": 2}
- **Run 2** (en/d3/the invention of the printing ): paragraphs=2 (>=2? True), align=2/2 (100%), md_leak=False, passed=True, alignment={"perfect": 2}
- **Run 3** (de/d2/das Leben in einer deutschen K): paragraphs=2 (>=2? True), align=2/2 (100%), md_leak=False, passed=True, alignment={"perfect": 2}
- **Run 4** (de/d3/die Geschichte der Berliner Ma): paragraphs=2 (>=2? True), align=1/1 (100%), md_leak=False, passed=True, alignment={"perfect": 1}
- **Run 5** (en/d2/how a coffee roaster decides t): paragraphs=2 (>=2? True), align=2/2 (100%), md_leak=False, passed=True, alignment={"perfect": 2}


## 截图清单

- - `00_setup_deepseek_injected.png` (38 KB)
- - `notification_banner_active.png` (66 KB)
- - `run01_en_d2.png` (74 KB)
- - `run02_en_d3.png` (68 KB)
- - `run03_de_d2.png` (71 KB)
- - `run04_de_d3.png` (68 KB)
- - `run05_en_d2.png` (69 KB)
- - `viewport_1024_fold.png` (49 KB)
- - `viewport_1024_fullpage.png` (50 KB)
- - `viewport_1440_fold.png` (54 KB)
- - `viewport_1440_fullpage.png` (54 KB)
- - `viewport_390_fold.png` (23 KB)
- - `viewport_390_fullpage.png` (23 KB)


## Stage 4 发现 / Notes

- ✓ alignment validator 被触发 11 次: {'perfect': 23, 'total': 23} (sum=46)
- ✓ prefers-reduced-motion 仍被遵守 (usePageEntranceAnimation 内置 matchMedia 监听)
- ✓ P1-A: 5 run alignmentStatus != 'unknown' 比例 0.0% (<= 10%)
- ✗ P1-B (de): 德文 run 真实 LLM 文本含德文词 min_hits=0 (< 5)
- ✓ P1-B (en): en run 不含德文 max_hits=0 (<= 0)


## 结论

- **通过 passage 数**: `5/5 (100.0%)`
- ⚠ Stage 4 v1.2.0 E2E 10/11 合同通过, 1 项需关注: 9. 德文 run 真实 LLM 含德文词 >= 5 (P1-B)


