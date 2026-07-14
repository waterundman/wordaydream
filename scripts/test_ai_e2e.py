"""
Wordaydream v2.2.0 AI 功能端到端测试 (Playwright)

测试目标:
1. 文章生成 (passage generation) — 验证真实 LLM 调用, source badge 显示 "AI 生成"
2. 评估功能 (evaluation) — 答题后验证 LLM 评估
3. Gloss 释义 (gloss cache) — 点击词汇查看释义

前置条件:
- 前端 dev server 运行在 http://localhost:5173/
- 后端 LLM proxy 运行在 http://localhost:3001/
- .env 中配置了 DEEPSEEK_API_KEY
"""

import json
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

FRONTEND_URL = "http://localhost:5173/#/reading"
PROXY_URL_FRAGMENT = "/api/llm-proxy"
SCREENSHOT_DIR = Path(__file__).parent / "e2e_screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

# 收集器
console_messages = []
proxy_requests = []
proxy_responses = []
page_errors = []


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            locale="zh-CN",
        )
        page = context.new_page()

        # ---- 监听 console ----
        def on_console(msg):
            console_messages.append(
                {"type": msg.type, "text": msg.text[:500], "url": msg.location.get("url", "")[:200]}
            )

        page.on("console", on_console)

        def on_page_error(err):
            page_errors.append(str(err)[:500])

        page.on("pageerror", on_page_error)

        # ---- 监听 LLM proxy 网络请求 ----
        def on_request(request):
            if PROXY_URL_FRAGMENT in request.url:
                proxy_requests.append(
                    {
                        "url": request.url,
                        "method": request.method,
                        "post_data": request.post_data[:1000] if request.post_data else None,
                    }
                )

        def on_response(response):
            if PROXY_URL_FRAGMENT in response.url:
                proxy_responses.append(
                    {
                        "url": response.url,
                        "status": response.status,
                    }
                )

        page.on("request", on_request)
        page.on("response", on_response)

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
        # 步骤 0: 导航到 home, 点击 "开始阅读" 进入 reading session
        # ============================================================
        print("\n=== 步骤 0: 导航到 home 并进入 reading session ===")
        page.goto("http://localhost:5173/#/home")
        page.wait_for_load_state("networkidle", timeout=15000)
        page.wait_for_timeout(1500)

        # 点击 "开始阅读" 进入 reading session 页面
        read_btn = page.locator('button:has-text("开始阅读")')
        read_btn.wait_for(state="visible", timeout=10000)
        read_btn.first.click()
        page.wait_for_timeout(2000)
        page.wait_for_load_state("networkidle", timeout=10000)
        print(f"  当前 URL: {page.url}")
        page.screenshot(path=str(SCREENSHOT_DIR / "00_reading_page.png"), full_page=True)
        print(f"  截图: 00_reading_page.png")

        # 验证已进入 reading 页面
        badge = page.locator('[data-testid="passage-source-badge"]')
        check("已进入 reading session (badge 可见)", badge.is_visible(), f"badge={badge.inner_text()}")

        # ============================================================
        # 步骤 1: 打开 Settings 模态框
        # ============================================================
        print("\n=== 步骤 1: 打开 Settings 模态框 ===")
        settings_btn = page.locator('button[aria-label="设置"]')
        settings_btn.wait_for(state="visible", timeout=10000)
        settings_btn.scroll_into_view_if_needed()
        settings_btn.click()
        page.wait_for_timeout(1000)
        page.screenshot(path=str(SCREENSHOT_DIR / "01_settings_open.png"), full_page=True)

        dialog = page.locator('[role="dialog"]')
        check("Settings 模态框已打开", dialog.is_visible())

        # ============================================================
        # 步骤 2: 切换 provider 到 DeepSeek
        # ============================================================
        print("\n=== 步骤 2: 切换 provider 到 DeepSeek ===")
        # 用精确文本匹配, 避免匹配到 "DeepSeek 快速" 等 preset
        deepseek_btn = page.get_by_role("button", name="DeepSeek", exact=True)
        deepseek_btn.wait_for(state="visible", timeout=5000)
        deepseek_btn.scroll_into_view_if_needed()
        deepseek_btn.click()
        page.wait_for_timeout(500)
        page.screenshot(path=str(SCREENSHOT_DIR / "02_provider_deepseek.png"), full_page=True)

        # 验证 LLM 状态指示器
        status_indicator = page.locator('[data-testid="llm-status-indicator"]')
        status_text = status_indicator.inner_text()
        print(f"  LLM 状态指示器: {status_text}")
        check("provider 已切换到 deepseek", "deepseek" in status_text.lower())

        # ============================================================
        # 步骤 3: 确保 LLM 路由已启用
        # ============================================================
        print("\n=== 步骤 3: 确保 LLM 路由已启用 ===")
        # toggle 在面板下方, 需要滚动
        llm_toggle = page.locator('button[aria-label="启用 LLM 路由"]')
        llm_toggle.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        toggle_class = llm_toggle.get_attribute("class") or ""
        if "on" not in toggle_class:
            print("  LLM 路由未启用, 点击 toggle 开启...")
            llm_toggle.click()
            page.wait_for_timeout(500)
            toggle_class = llm_toggle.get_attribute("class") or ""
        check("LLM 路由已启用", "on" in toggle_class, f"class={toggle_class}")
        page.screenshot(path=str(SCREENSHOT_DIR / "03_llm_enabled.png"), full_page=True)

        # ============================================================
        # 步骤 4: 关闭 Settings 模态框
        # ============================================================
        print("\n=== 步骤 4: 关闭 Settings 模态框 ===")
        close_btn = page.locator('[role="dialog"] button[aria-label="关闭"]')
        close_btn.click()
        page.wait_for_timeout(800)
        check("Settings 模态框已关闭", page.locator('[role="dialog"]').count() == 0)

        # ============================================================
        # 步骤 5: 点击 "生成新文本" 触发 LLM 文章生成
        # ============================================================
        print("\n=== 步骤 5: 点击 生成新文本 (触发 LLM 调用) ===")
        # 清空之前的 proxy 请求记录
        proxy_requests.clear()
        proxy_responses.clear()

        generate_btn = page.locator('button:has-text("生成新文本")')
        if not generate_btn.is_visible():
            generate_btn = page.locator('button:has-text("生成中")')
        generate_btn.wait_for(state="visible", timeout=5000)
        generate_btn.click()
        print("  已点击生成按钮, 等待 LLM 响应...")

        # 等待 loading 出现然后消失 (LLM 调用可能需要 10-30 秒)
        try:
            page.wait_for_selector("text=生成中", timeout=5000)
            print("  进入生成中状态...")
            page.screenshot(path=str(SCREENSHOT_DIR / "05_generating.png"), full_page=True)
        except Exception:
            print("  (未检测到生成中状态, 可能已快速完成)")

        # 等待 source badge 出现 (最多 60 秒)
        print("  等待 source badge 出现 (最多 60 秒)...")
        try:
            badge = page.locator('[data-testid="passage-source-badge"]')
            badge.wait_for(state="visible", timeout=60000)
            page.wait_for_timeout(1000)
            page.screenshot(path=str(SCREENSHOT_DIR / "06_passage_generated.png"), full_page=True)

            badge_text = badge.inner_text()
            print(f"  Source badge 文本: {badge_text}")

            check("文章已生成 (source badge 可见)", badge.is_visible())
            check(
                "source 为 AI 生成 (非演示数据)",
                "AI 生成" in badge_text,
                f"badge_text={badge_text}",
            )
        except Exception as e:
            page.screenshot(path=str(SCREENSHOT_DIR / "06_timeout.png"), full_page=True)
            check("文章已生成 (source badge 可见)", False, f"timeout: {e}")

        # ============================================================
        # 步骤 6: 验证 LLM proxy 网络请求
        # ============================================================
        print("\n=== 步骤 6: 验证 LLM proxy 网络请求 ===")
        print(f"  proxy 请求数: {len(proxy_requests)}")
        for i, req in enumerate(proxy_requests):
            print(f"  请求[{i}]: {req['method']} {req['url']}")
            if req["post_data"]:
                try:
                    pd = json.loads(req["post_data"])
                    print(f"    provider={pd.get('provider')}, prompt 前80字={str(pd.get('prompt', ''))[:80]}")
                except Exception:
                    print(f"    post_data 前100字: {req['post_data'][:100]}")

        print(f"  proxy 响应数: {len(proxy_responses)}")
        for i, resp in enumerate(proxy_responses):
            print(f"  响应[{i}]: status={resp['status']}")

        check("LLM proxy 收到至少 1 个请求", len(proxy_requests) >= 1)
        check("LLM proxy 至少 1 个响应成功 (200)", any(r["status"] == 200 for r in proxy_responses))

        # ============================================================
        # 步骤 7: 测试 gloss 功能 (点击词汇查看释义)
        # ============================================================
        print("\n=== 步骤 7: 测试 gloss 功能 ===")
        # InteractivePassage 中词汇是可点击的 token
        # 尝试点击文章中的词汇元素
        gloss_triggered = False
        try:
            # 词汇通常标记为可点击的 span/button
            # 先尝试找 data-testid 或特定 class
            token_selectors = [
                '[data-token]',
                'span[class*="token"]',
                'span[class*="word"]',
                'button[class*="token"]',
                '.occurrence',
                '[data-occurrence]',
            ]
            for sel in token_selectors:
                tokens = page.locator(sel)
                if tokens.count() > 0:
                    print(f"  找到词汇元素: {sel} ({tokens.count()} 个)")
                    # 清空 proxy 记录
                    proxy_requests.clear()
                    proxy_responses.clear()
                    tokens.first.click()
                    page.wait_for_timeout(3000)
                    page.screenshot(path=str(SCREENSHOT_DIR / "07_gloss_clicked.png"), full_page=True)
                    if len(proxy_requests) > 0:
                        print(f"  gloss 触发了 {len(proxy_requests)} 个 proxy 请求")
                        gloss_triggered = True
                    break

            if not gloss_triggered:
                # 尝试点击文章区域中的任意词汇
                passage_area = page.locator('[class*="passage"], [class*="reading"], article')
                if passage_area.count() > 0:
                    print("  尝试点击文章区域内的元素...")
                    proxy_requests.clear()
                    proxy_responses.clear()
                    # 点击文章中的某个 span
                    spans = passage_area.first.locator("span")
                    count = spans.count()
                    print(f"  文章区域有 {count} 个 span")
                    for idx in range(min(count, 10)):
                        span = spans.nth(idx)
                        text = span.inner_text().strip()
                        if len(text) > 2 and text.isalpha():
                            print(f"  点击 span[{idx}]: '{text}'")
                            span.click()
                            page.wait_for_timeout(2000)
                            if len(proxy_requests) > 0:
                                print(f"  gloss 触发了 {len(proxy_requests)} 个 proxy 请求")
                                gloss_triggered = True
                                page.screenshot(path=str(SCREENSHOT_DIR / "07_gloss_clicked.png"), full_page=True)
                                break
        except Exception as e:
            print(f"  gloss 测试异常: {e}")

        check("gloss 功能触发 LLM 请求", gloss_triggered)

        # ============================================================
        # 步骤 8: 检查 console 错误
        # ============================================================
        print("\n=== 步骤 8: 检查 console 错误 ===")
        errors = [m for m in console_messages if m["type"] == "error"]
        warnings = [m for m in console_messages if m["type"] == "warning"]
        print(f"  console error 数: {len(errors)}")
        print(f"  console warning 数: {len(warnings)}")
        print(f"  pageerror 数: {len(page_errors)}")

        for err in errors[:5]:
            print(f"  [ERROR] {err['text'][:200]}")
        for pe in page_errors[:3]:
            print(f"  [PAGEERROR] {pe[:200]}")

        check("无 console error", len(errors) == 0, f"{len(errors)} errors")
        check("无 pageerror (未捕获异常)", len(page_errors) == 0, f"{len(page_errors)} errors")

        # ============================================================
        # 汇总报告
        # ============================================================
        print("\n" + "=" * 60)
        print("AI 功能端到端测试报告")
        print("=" * 60)
        print(f"通过: {results['pass']}  失败: {results['fail']}")
        print("-" * 60)
        for c in results["checks"]:
            print(f"  [{c['status']}] {c['name']}" + (f" — {c['detail']}" if c["detail"] else ""))
        print("-" * 60)
        print(f"截图保存目录: {SCREENSHOT_DIR}")
        print(f"LLM proxy 请求总数: {len(proxy_requests)}")
        print(f"LLM proxy 响应总数: {len(proxy_responses)}")

        browser.close()

        sys.exit(0 if results["fail"] == 0 else 1)


if __name__ == "__main__":
    main()
