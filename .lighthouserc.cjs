/**
 * Wordaydream Lighthouse CI 配置 (LHCI config 格式)
 *
 * v2.4.0 修复:
 * - 删除 PWA category (Lighthouse 10+ 已移除, installable-manifest / service-worker /
 *   splash-screen / themed-omnibox 等 audit 全部废弃, 引用会直接报错).
 * - 改用 LHCI config 格式 (assertions 字段是 LHCI 概念, 不能写在 lighthouse config 里).
 * - 文件后缀 .cjs 强制 CommonJS 解析 (项目 package.json type=module, .js 会被当 ESM).
 * - 用 staticDistDir 测试构建产物, 不依赖外部 URL (PR / push / schedule 统一).
 *
 * 4 项评级 (PWA 已删, 仅保留 Lighthouse 11 支持的 4 项):
 * - performance:        TTI / FCP / bundle size
 * - accessibility:      viewport / content-width / 颜色对比
 * - best-practices:     HTTPS / no console errors
 * - seo:                viewport / meta description
 *
 * 5% buffer + retry 3 (与 v1.5.1 合同一致, 减少 CI 波动):
 * - assertions 阈值 = 真实阈值 * 0.95
 * - numberOfRuns: 3, 取中位数 (3 次全失败才报失败)
 *
 * 0 emoji (项目硬约束)
 */

module.exports = {
  ci: {
    collect: {
      // 测试构建产物 (不依赖外部 Netlify URL, PR / push 都能跑)
      staticDistDir: './dist',
      // 3 次取中位数, 减少 CI 波动
      numberOfRuns: 3,
      settings: {
        // Lighthouse 11 仅支持 4 项 category (PWA 已移除)
        onlyCategories: [
          'performance',
          'accessibility',
          'best-practices',
          'seo',
        ],
        // 移动端模拟 (与 v1.5.0 PWA 合同一致)
        formFactor: 'mobile',
        screenEmulation: {
          mobile: true,
          width: 412,
          height: 823,
          deviceScaleFactor: 1.75,
          disabled: false,
        },
        throttlingMethod: 'simulate',
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          requestLatencyMs: 0,
          downloadThroughputKbps: 0,
          uploadThroughputKbps: 0,
          cpuSlowdownMultiplier: 4,
        },
      },
    },
    assert: {
      // 5% buffer: 真实阈值 * 0.95, 减少 CI 波动误报
      // performance: 0.80 * 0.95 = 0.76
      // accessibility: 0.90 * 0.95 = 0.855 -> 0.85
      // best-practices: 0.90 * 0.95 = 0.855 -> 0.85
      // seo: 0.90 * 0.95 = 0.855 -> 0.85
      assertions: {
        'categories:performance': ['error', { minScore: 0.76 }],
        'categories:accessibility': ['error', { minScore: 0.85 }],
        'categories:best-practices': ['error', { minScore: 0.85 }],
        'categories:seo': ['error', { minScore: 0.85 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
