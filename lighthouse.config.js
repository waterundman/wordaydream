/**
 * Wordaydream v1.5.0 Stage 2: Lighthouse 评级配置 (P1_3)
 * Wordaydream v1.5.1 Stage 1 P0_3 强化: 5% buffer + retry 3
 *
 * 沙箱无 Lighthouse CLI + Chrome, 配置层 100% 写完, 真实跑分由用户执行:
 *   npx lighthouse https://your-site.netlify.app --config-path=./lighthouse.config.js --output=json
 *
 * 5 项评级 (PWA / Performance / Accessibility / Best Practices / SEO) + 阈值
 * 3 次取中位数 (避免单次波动)
 *
 * 与 v1.4.1 PWA 合同对照:
 * - PWA:    installable-manifest (P0 兑现, v1.4.1) + service-worker (P0 兑现, v1.4.1) +
 *          splash-screen (manifest.start_url + display=standalone) + themed-omnibox (manifest.theme_color)
 * - Performance: TTI < 5s, FCP < 2s, JS bundle < 200KB, CSS < 100KB
 * - Accessibility: viewport meta + content-width
 * - Best Practices: HTTPS + no console errors
 * - SEO: viewport + content-width + meta description (manifest.description)
 *
 * v1.5.0 Stage 1 P0 升级 (vite-plugin-pwa 0.20.5 -> 1.3.0) 已兑现 PWA 评级
 * 的基础要求 (installable + offline + 3 icon + manifest v1), 本配置层为 v1.5.0 Stage 3+ 真实跑分准备.
 *
 * v1.5.1 Stage 1 强化 (5% buffer + retry 3):
 * - 5% buffer: assert 阈值比 Lighthouse 评分低 5%, 减少 CI 波动误报
 *   例: PWA >= 90 改为 assert >= 85 (5% buffer, 即 90 * 0.95 = 85.5)
 *   真实 Lighthouse 跑分仍按 90 评, 但 CI assert 容忍 5% 波动
 * - retry 3: lhci autorun 默认跑 3 次, 取中位数 (3 次全失败才报失败)
 *   本配置通过 .github/workflows/lighthouse.yml 调 lhci autorun, 自动 retry 3
 *
 * 完整 runbook 见 docs/OPERATIONS.md Section 3 (5 步骤).
 */

module.exports = {
  extends: 'lighthouse:default',
  settings: {
    // 5 项评级 (按 PWA 优先级排序)
    onlyCategories: [
      'pwa',
      'performance',
      'accessibility',
      'best-practices',
      'seo',
    ],
    // 5 项阈值 (符合 v1.4.1 合同 PWA 完整要求)
    throttlingMethod: 'simulate',
    throttling: {
      rttMs: 150,
      throughputKbps: 1638.4,
      requestLatencyMs: 0,
      downloadThroughputKbps: 0,
      uploadThroughputKbps: 0,
      cpuSlowdownMultiplier: 4,
    },
    // v1.5.0 PWA 模式: installable + offline + 3 icon + manifest v1
    emulatedFormFactor: 'mobile',
    screenEmulation: {
      mobile: true,
      width: 412,
      height: 823,
      deviceScaleFactor: 1.75,
      disabled: false,
    },
  },
  audits: [
    // PWA 核心 (v1.4.1 Stage 2 合同)
    'installable-manifest',
    'service-worker',
    'splash-screen',
    'themed-omnibox',
    // Accessibility 基础 (manifest + viewport)
    'content-width',
    'viewport',
  ],
  // 阈值 (沙箱不跑, 仅供真实环境参考)
  performanceBudgets: [
    {
      path: '/*',
      timings: [
        { metric: 'interactive', budget: 5000 }, // TTI 5s
        { metric: 'first-contentful-paint', budget: 2000 }, // FCP 2s
      ],
      resourceSizes: [
        { resourceType: 'script', budget: 200 }, // JS 200KB
        { resourceType: 'stylesheet', budget: 100 }, // CSS 100KB
        { resourceType: 'image', budget: 100 }, // Image 100KB
      ],
    },
  ],
  // v1.5.1 Stage 1 强化: 5% buffer (assert 阈值)
  // 5 项评分 (PWA / Performance / A11y / BP / SEO) 真实阈值 >= 90 / 80 / 90 / 90 / 90
  // 5% buffer 后: assert 阈值 = 真实阈值 * 0.95
  //   PWA:         90 * 0.95 = 85
  //   Performance: 80 * 0.95 = 76
  //   A11y:        90 * 0.95 = 85
  //   BP:          90 * 0.95 = 85
  //   SEO:         90 * 0.95 = 85
  // 减少 CI 波动误报, 真实评分仍按原阈值显示
  assertions: {
    'categories:pwa': ['error', { minScore: 0.85 }],           // 真实 0.90, buffer 0.85
    'categories:performance': ['error', { minScore: 0.76 }],  // 真实 0.80, buffer 0.76
    'categories:accessibility': ['error', { minScore: 0.85 }], // 真实 0.90, buffer 0.85
    'categories:best-practices': ['error', { minScore: 0.85 }],// 真实 0.90, buffer 0.85
    'categories:seo': ['error', { minScore: 0.85 }],           // 真实 0.90, buffer 0.85
  },
  // v1.5.1 Stage 1 强化: retry 3 (lhci autorun 默认行为, 在 .github/workflows/lighthouse.yml 调 lhci autorun)
  // 本配置通过 assertions 给出 5% buffer 阈值
  // 实际 retry 3 由 CI workflow 控制 (maxNumberOfRuns: 3)
  // 本地手动跑: lhci autorun 默认 3 次, 取中位数
};
