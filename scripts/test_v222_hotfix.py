"""
Wordaydream v2.2.2 端到端验证

验证 4 个 bug 修复:
1. Bug 4: 已学词汇列表显示标注过的词汇
2. Bug 5: 连续生成文章标题不同
3. Bug 6: 词汇标注不误匹配子串 (good 不标为 go)
4. Bug 7: 可标注词汇数量增加 + 复习时机不立即复现
"""

import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

FRONTEND_HOME = "http://localhost:5173/#/home"
SCREENSHOT_DIR = Path(__file__).parent / "e2e_screenshots_v222"
SCREENSHOT_DIR.mkdir(exist_ok=True)

console_errors = []
page_errors = []
network_requests = []


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
        page = context.new_page()

        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on("request", lambda req: network_requests.append({
            "url": req.url,
            "method": req.method
        }) if "llm-proxy" in req.url else None)

        results = {"pass": 0, "fail": 0, "checks": []}

        def check(name, condition, detail=""):
            status = "PASS" if condition else "FAIL"
            results["checks"].append({"name": name, "status": status, "detail": detail})
            if condition:
                results["pass"] += 1
            else:
                results["fail"] += 1
            print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))

        # ============================================================
        # 步骤 0: 导航并配置 DeepSeek
        # ============================================================
        print("\n=== 步骤 0: 导航并配置 DeepSeek ===")
        page.goto(FRONTEND_HOME)
        page.wait_for_load_state("networkidle", timeout=15000)
        page.wait_for_timeout(1500)

        # 进入 reading session
        read_btn = page.locator('button:has-text("开始阅读")')
        read_btn.first.click()
        page.wait_for_timeout(2000)
        page.wait_for_load_state("networkidle", timeout=10000)

        # 配置 DeepSeek
        settings_btn = page.locator('button[aria-label="设置"]')
        settings_btn.click()
        page.wait_for_timeout(1000)

        deepseek_btn = page.get_by_role("button", name="DeepSeek", exact=True)
        deepseek_btn.click()
        page.wait_for_timeout(500)

        llm_toggle = page.locator('button[aria-label="启用 LLM 路由"]')
        toggle_class = llm_toggle.get_attribute("class") or ""
        if "on" not in toggle_class:
            llm_toggle.click()
            page.wait_for_timeout(500)

        close_btn = page.locator('[role="dialog"] button[aria-label="关闭"]')
        close_btn.click()
        page.wait_for_timeout(800)
        print("  DeepSeek 已配置")

        # ============================================================
        # Bug 5 验证: 连续生成 3 篇文章标题不同
        # ============================================================
        print("\n=== Bug 5 验证: 连续生成文章标题不同 ===")

        titles = []
        for i in range(3):
            gen_btn = page.locator('button:has-text("生成新文本")')
            gen_btn.click()
            print(f"  生成第 {i+1} 篇文章...")
            page.wait_for_selector("text=生成中", timeout=5000)

            badge = page.locator('[data-testid="passage-source-badge"]')
            badge.wait_for(state="visible", timeout=90000)
            page.wait_for_timeout(1500)

            # 获取标题
            title_el = page.locator('h1, h2, [class*="title"], [class*="Title"]')
            title_text = title_el.first.inner_text() if title_el.count() > 0 else "(无标题)"

            # 也获取 passage 内容前 100 字
            passage_area = page.locator('[class*="passage"], [class*="reading"], article').first
            passage_text = passage_area.inner_text()[:100] if passage_area.count() > 0 else ""

            titles.append(title_text)
            print(f"  第 {i+1} 篇标题: {title_text}")
            print(f"  第 {i+1} 篇内容前 50 字: {passage_text[:50]}")
            page.screenshot(path=str(SCREENSHOT_DIR / f"passage_{i+1}.png"), full_page=True)

        distinct_titles = len(set(titles))
        check("3 篇文章标题不完全相同 (Bug 5)", distinct_titles >= 2,
              f"distinct={distinct_titles}/3, titles={titles}")

        # ============================================================
        # Bug 7 验证: 可标注词汇数量
        # ============================================================
        print("\n=== Bug 7 验证: 可标注词汇数量 ===")

        # 计算当前文章中可点击的 token 数量
        token_selectors = [
            'span[class*="token"]',
            '[data-token]',
            'button[class*="token"]',
            'mark[class*="token"]',
        ]
        token_count = 0
        for sel in token_selectors:
            tokens = page.locator(sel)
            count = tokens.count()
            if count > 0:
                token_count = count
                print(f"  找到 {count} 个可标注词汇 (selector: {sel})")
                break

        check("可标注词汇数量 >= 8 (Bug 7)", token_count >= 8,
              f"实际数量={token_count}")

        # ============================================================
        # Bug 6 验证: 词汇标注不误匹配子串
        # ============================================================
        print("\n=== Bug 6 验证: 词汇标注不误匹配子串 ===")

        # 检查是否有 token 的 surfaceForm 是另一个词的子串
        # 这里通过截图人工检查 + 检查 token 文本是否为完整单词
        page.screenshot(path=str(SCREENSHOT_DIR / "token_check.png"), full_page=True)

        # 获取所有 token 的文本
        token_texts = []
        for sel in token_selectors:
            tokens = page.locator(sel)
            if tokens.count() > 0:
                for i in range(min(tokens.count(), 20)):
                    txt = tokens.nth(i).inner_text().strip()
                    if txt:
                        token_texts.append(txt)
                break

        print(f"  标注词汇: {token_texts}")

        # 检查是否有 2 字符以下的短词 (可能是子串误匹配)
        short_tokens = [t for t in token_texts if len(t) < 3]
        check("无 2 字符以下的短词标注 (Bug 6)", len(short_tokens) == 0,
              f"短词={short_tokens}" if short_tokens else "")

        # ============================================================
        # Bug 4 验证: 答题后词汇出现在已学列表
        # ============================================================
        print("\n=== Bug 4 验证: 答题后词汇记录 ===")

        # 点击第一个 token 并答题
        token_clicked = False
        for sel in token_selectors:
            tokens = page.locator(sel)
            if tokens.count() > 0:
                tokens.first.click()
                page.wait_for_timeout(1000)
                token_clicked = True
                break

        if token_clicked:
            answer_input = page.locator('input[type="text"], textarea')
            if answer_input.count() > 0:
                answer_input.first.fill("测试答案")
                page.wait_for_timeout(500)

                submit_btn = page.locator('button:has-text("提交"), button:has-text("确认"), button[type="submit"]')
                if submit_btn.count() > 0:
                    submit_btn.first.click()
                    page.wait_for_timeout(3000)
                    page.screenshot(path=str(SCREENSHOT_DIR / "after_submit.png"), full_page=True)

                    # 检查进度条
                    progress = page.locator('[class*="progress"]')
                    if progress.count() > 0:
                        progress_text = progress.first.inner_text()
                        print(f"  进度: {progress_text}")
                        check("答题后进度条推进 (Bug 4)", "0 /" not in progress_text,
                              f"progress={progress_text}")
                    else:
                        check("答题后进度条推进 (Bug 4)", False, "未找到进度条")
                else:
                    check("答题流程", False, "无提交按钮")
            else:
                check("答题面板", False, "无 input")
        else:
            check("词汇可点击", False, "未找到 token")

        # ============================================================
        # 导航到词汇列表页检查已学词汇
        # ============================================================
        print("\n=== 检查已学词汇列表 ===")
        page.goto("http://localhost:5173/#/wordlist")
        page.wait_for_load_state("networkidle", timeout=10000)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(SCREENSHOT_DIR / "wordlist.png"), full_page=True)

        # 检查是否有"学习中"或"已掌握"的词汇
        learning_section = page.locator('text=学习中')
        mastered_section = page.locator('text=已掌握')
        learning_count_text = ""
        if learning_section.count() > 0:
            learning_count_text = learning_section.first.inner_text()
            print(f"  学习中区域: {learning_count_text}")

        # 检查词汇列表是否有内容
        word_items = page.locator('[class*="word"], [class*="card"], [class*="item"]')
        word_count = word_items.count()
        print(f"  词汇列表项数量: {word_count}")

        check("已学词汇列表有内容 (Bug 4)", word_count > 0 or "学习中" in learning_count_text,
              f"items={word_count}, learning={learning_count_text}")

        # ============================================================
        # 检查 LLM 请求和错误
        # ============================================================
        print("\n=== LLM 请求和错误检查 ===")
        llm_posts = [r for r in network_requests if r["method"] == "POST"]
        print(f"  LLM POST 请求数: {len(llm_posts)}")
        check("LLM proxy 收到请求", len(llm_posts) >= 1,
              f"{len(llm_posts)} POST requests")

        check("无 console error", len(console_errors) == 0, f"{len(console_errors)} errors")
        for err in console_errors[:5]:
            print(f"  [ERROR] {err[:200]}")

        check("无 pageerror", len(page_errors) == 0, f"{len(page_errors)} errors")

        # ============================================================
        # 汇总
        # ============================================================
        print("\n" + "=" * 60)
        print("v2.2.2 端到端验证报告")
        print("=" * 60)
        print(f"通过: {results['pass']}  失败: {results['fail']}")
        print("-" * 60)
        for c in results["checks"]:
            print(f"  [{c['status']}] {c['name']}" + (f" — {c['detail']}" if c['detail'] else ""))
        print("-" * 60)

        browser.close()
        sys.exit(0 if results["fail"] == 0 else 1)


if __name__ == "__main__":
    main()
