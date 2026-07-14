import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
//
// v1.4.1 Stage 2: 引入 vite-plugin-pwa 落地 PWA / 离线模式
// - 0 改动: react() plugin + 其它 Vite 配置
// - 新增 VitePWA plugin (manifest + workbox runtime caching + autoUpdate SW)
// - dev mode 默认 disabled, 避免 HMR 冲突 (devOptions.enabled: false)
//
// v1.5.0 Stage 1: 升级 vite-plugin-pwa 0.20.5 -> 1.3.0 (R-1 兑现)
// - 0 breaking change: registerType / manifest / workbox / devOptions 全部兼容
// - workbox 6.x -> 7.x (workbox-build ^7.4.1 + workbox-window ^7.4.1)
// - manifest v1 schema 仍支持 (1.x 兼容), v1.5.0 暂不迁移到 v2 (Stage 2+ 再做)
// - 1.x 内部修复 'This plugin assigns to bundle variable' warning, R-1 兑现
// - 0 改动: react() plugin + 其它 Vite 配置 + plugin 字段顺序
export default defineConfig({
  // v2.2.0 hotfix: 排除 @open-spaced-repetition/binding 的预构建.
  // 该包是 Node.js 原生绑定 (napi-rs), 浏览器端需要 WASM 版本 (binding-wasm32-wasi, 未安装).
  // fsrsOptimizer.ts 已改为动态 import + catch 降级, 但 Vite 依赖扫描器仍会捕获
  // import('@open-spaced-repetition/binding') 并尝试预构建, 导致 WASM 依赖解析失败 → 500.
  // exclude 后, 动态 import 在运行时按需加载, 失败时 catch 降级为"优化不可用".
  optimizeDeps: {
    exclude: ['@open-spaced-repetition/binding'],
  },
  resolve: {
    alias: {
      '@open-spaced-repetition/binding-wasm32-wasi': fileURLToPath(new URL('./src/vendor/empty-wasi.ts', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Wordaydream',
        short_name: 'Wordaydream',
        description: 'Vocabulary learning through reading',
        theme_color: '#1c1917',
        background_color: '#faf8f5',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp}'],
        runtimeCaching: [
          {
            // LLM API 端点 (Edge Function) - NetworkFirst 策略
            // v1.5.2 fix M9: 显式限制 method === 'GET', POST 请求透传不缓存
            // (workbox 默认仅缓存 GET, 但显式声明避免歧义 + 防止未来 workbox 行为变化)
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              url.pathname.startsWith('/.netlify/edge-functions/llm-proxy'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'llm-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            // 文档类请求 - StaleWhileRevalidate 策略
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'documents',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
})
