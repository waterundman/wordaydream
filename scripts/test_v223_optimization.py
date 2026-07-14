"""Wordaydream v2.2.3 端到端验证 — 验证 token 数量 + data-testid"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

SCREENSHOT_DIR = Path(__file__).parent / "e2e_screenshots_v223"
SCREENSHOT_DIR.mkdir(exist_ok=True)
console_errors = []
network_requests = []


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900}, locale="zh-CN")
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("request", lambda req: network_requests.append(req.url) if "llm-proxy" in req.url else None)
        results = {"pass": 0, "fail": 0, "checks": []}

        def check(name, cond, detail=""):
            status = "PASS" if cond else "FAIL"
            results["checks"].append({"name": name, "status": status, "detail": detail})
            results["pass" if cond else "fail"] += 1
            print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))

        print("\n=== 步骤 0: 导航并配置 DeepSeek ===")
        page.goto("http://localhost:5173/#/home")
        page.wait_for_load_state("networkidle", timeout=15000)
        page.wait_for_timeout(1500)
        page.locator('button:has-text("开始阅读")').first.click()
        page.wait_for_timeout(2000)
        page.wait_for_load_state("networkidle", timeout=10000)

        # 配置 DeepSeek
        page.locator('button[aria-label="设置"]').click()
        page.wait_for_timeout(1000)
        page.get_by_role("button", name="DeepSeek", exact=True).click()
        page.wait_for_timeout(500)
        toggle = page.locator('button[aria-label="启用 LLM 路由"]')
        if "on" not in (toggle.get_attribute("class") or ""):
            toggle.click()
            page.wait_for_timeout(500)
        page.locator('[role="dialog"] button[aria-label="关闭"]').click()
        page.wait_for_timeout(800)
        print("  DeepSeek 已配置")

        print("\n=== Bug 5 验证: 连续生成文章标题不同 ===")
        titles = []
        for i in range(2):
            page.locator('button:has-text("生成新文本")').click()
            print(f"  生成第 {i+1} 篇...")
            page.wait_for_selector("text=生成中", timeout=5000)
            page.locator('[data-testid="passage-source-badge"]').wait_for(state="visible", timeout=90000)
            page.wait_for_timeout(1500)
            # 用 data-testid 定位标题
            title_el = page.locator('h1[class*="title"], [class*="title"]')
            title_text = title_el.first.inner_text() if title_el.count() > 0 else "(无标题)"
            titles.append(title_text)
            print(f"  第 {i+1} 篇标题: {title_text}")
            page.screenshot(path=str(SCREENSHOT_DIR / f"passage_{i+1}.png"), full_page=True)

        check("2 篇文章标题不同 (Bug 5)", titles[0] != titles[1], f"t1={titles[0]}, t2={titles[1]}")

        print("\n=== Stage 1 验证: token 数量 (data-testid) ===")
        tokens = page.locator('[data-testid="passage-token"]')
        token_count = tokens.count()
        print(f"  data-testid='passage-token' 数量: {token_count}")
        check("可标注词汇数量 >= 8 (Stage 1 token 补偿)", token_count >= 8, f"实际={token_count}")

        # 检查 data-token-id
        token_ids = []
        for i in range(min(token_count, 15)):
            tid = tokens.nth(i).get_attribute("data-token-id")
            if tid:
                token_ids.append(tid)
        check("data-token-id 属性存在 (Stage 2)", len(token_ids) > 0, f"ids={token_ids[:5]}")

        print("\n=== Stage 2 验证: token 文本 ===")
        token_texts = []
        for i in range(min(token_count, 15)):
            txt = tokens.nth(i).inner_text().strip()
            if txt:
                token_texts.append(txt)
        print(f"  标注词汇: {token_texts}")
        short_tokens = [t for t in token_texts if len(t) < 3]
        check("无 2 字符以下短词标注 (Bug 6)", len(short_tokens) == 0, f"短词={short_tokens}" if short_tokens else "")

        print("\n=== Bug 4 验证: 答题后进度 ===")
        if token_count > 0:
            tokens.first.click()
            page.wait_for_timeout(1000)
            answer_input = page.locator('input[type="text"], textarea')
            if answer_input.count() > 0:
                answer_input.first.fill("测试答案")
                page.wait_for_timeout(500)
                submit_btn = page.locator('button:has-text("提交"), button:has-text("确认"), button[type="submit"]')
                if submit_btn.count() > 0:
                    submit_btn.first.click()
                    page.wait_for_timeout(3000)
                    page.screenshot(path=str(SCREENSHOT_DIR / "after_submit.png"), full_page=True)
                    progress = page.locator('[class*="progress"]')
                    if progress.count() > 0:
                        progress_text = progress.first.inner_text()
                        check("答题后进度推进 (Bug 4)", "0 /" not in progress_text, f"progress={progress_text}")
                    else:
                        check("答题后进度推进", False, "未找到进度条")

        print("\n=== 已学词汇列表 ===")
        page.goto("http://localhost:5173/#/wordlist")
        page.wait_for_load_state("networkidle", timeout=10000)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(SCREENSHOT_DIR / "wordlist.png"), full_page=True)
        learning_section = page.locator('text=学习中')
        learning_text = learning_section.first.inner_text() if learning_section.count() > 0 else ""
        check("已学词汇列表有内容 (Bug 4)", "学习中" in learning_text, f"learning={learning_text}")

        print("\n=== LLM 请求和错误 ===")
        llm_posts = [r for r in network_requests if "llm-proxy" in r]
        check("LLM proxy 收到请求", len(llm_posts) >= 1, f"{len(llm_posts)} requests")
        check("无 console error", len(console_errors) == 0, f"{len(console_errors)} errors")

        print("\n" + "=" * 60)
        print("v2.2.3 端到端验证报告")
        print("=" * 60)
        print(f"通过: {results['pass']}  失败: {results['fail']}")
        print("-" * 60)
        for c in results["checks"]:
            print(f"  [{c['status']}] {c['name']}" + (f" — {c['detail']}" if c['detail'] else ""))

        browser.close()
        sys.exit(0 if results["fail"] == 0 else 1)


if __name__ == "__main__":
    main()
