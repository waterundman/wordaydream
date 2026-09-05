import { defineConfig, type Plugin, type ViteDevServer, loadEnv } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { compression } from 'vite-plugin-compression2'
import { visualizer } from 'rollup-plugin-visualizer'
import { fileURLToPath, URL } from 'node:url'
import {
  HARMONY_PROXY_DISABLED,
  HARMONY_PROXY_ENV_NAME,
  hardenHarmonyCsp,
  parseHarmonyProxyUrl,
} from './src/config/harmonyCsp.js'

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
//
// v2.3.1: dev server 集成 api/llm-proxy.ts (Node.js serverless function)
// - configureServer 钩子动态 import api/llm-proxy.ts, 挂载到 /api/llm-proxy
// - 前端 .env 的 VITE_LLM_PROXY_URL=/api/llm-proxy 直接走 dev server
// - 生产环境仍走 IGA Pages serverless function (同路径)
//
// v0.1.0-harmony Stage 1: 新增 harmony 构建目标
// - 通过 `vite build --mode harmony` 触发 (cross-platform, 无需 cross-env)
// - outDir: harmony/entry/src/main/resources/rawfile/dist (供 ArkWeb rawfile 加载)
// - base: './' (rawfile 需 relative path)
// - VitePWA 在 harmony 模式禁用: SW 在 ArkWeb rawfile 上下文无法正常注册,
//   且 manifest 的 start_url '/' 不适用于 rawfile 协议. Stage 2+ 会单独评估
//   ArkWeb 的 Service Worker 支持路径.
// - 0 改动: 默认 (web) 模式行为与原配置完全一致, 545 测试基线不变.
// harmony 模式下 vite-plugin-pwa 被禁用, 但 src/main.tsx 仍 import('virtual:pwa-register').
// 提供一个 stub 插件把该 virtual module 解析为 no-op, 让 catch 块永不触发,
// 避免污染 ArkWeb 控制台 (rawfile 协议下 SW 注册本就无意义).
function harmonyPwaStubPlugin(): Plugin {
  const virtualModuleId: string = 'virtual:pwa-register'
  const resolvedId: string = `\0${virtualModuleId}`
  return {
    name: 'harmony-pwa-stub',
    enforce: 'pre',
    resolveId(id: string): string | null {
      if (id === virtualModuleId) {
        return resolvedId
      }
      return null
    },
    load(id: string): string | null {
      if (id === resolvedId) {
        // no-op registerSW; import.meta.env.PROD 仍为 true, 但 SW 注册无害失败
        return 'export function registerSW() { return () => {} }'
      }
      return null
    },
  }
}

function harmonyCspPlugin(proxyOrigin: string | undefined): Plugin {
  return {
    name: 'harmony-csp-connect-src',
    enforce: 'pre',
    transformIndexHtml(html: string): string {
      return hardenHarmonyCsp(html, proxyOrigin)
    },
  }
}

export default defineConfig(({ mode }) => {
  const isHarmony: boolean = mode === 'harmony'

  // v0.1.0-harmony Stage 4: 鸿蒙构建模式下, 加载 .env.harmony, 把
  // VITE_LLM_PROXY_URL_HARMONY 注入为前端的 VITE_LLM_PROXY_URL.
  // 前端代码 (router.ts / llmConfig.ts) 仍读 import.meta.env.VITE_LLM_PROXY_URL,
  // 与 Web 端 0 改动. .env.harmony.example 给出模板.
  //
  // loadEnv 会自动加载: .env + .env.[mode] + .env.local + .env.[mode].local
  // 这里 prefix='' 让所有变量 (不仅 VITE_ 前缀) 都加载, 但只读 VITE_LLM_PROXY_URL_HARMONY.
  const harmonyEnv = isHarmony ? loadEnv(mode, process.cwd(), '') : {}
  const harmonyProxyValue: string | undefined = harmonyEnv.VITE_LLM_PROXY_URL_HARMONY
  const harmonyProxyConfig =
    isHarmony && harmonyProxyValue?.trim()
      ? parseHarmonyProxyUrl(harmonyProxyValue)
      : undefined
  if (isHarmony && !harmonyProxyConfig) {
    console.warn(
      `[harmony] ${HARMONY_PROXY_ENV_NAME} is not set; disabling the Harmony LLM proxy instead of inheriting the Web endpoint`,
    )
  }
  const harmonyDefine: Record<string, string> | undefined =
    isHarmony
      ? {
          'import.meta.env.VITE_LLM_PROXY_URL': JSON.stringify(
            harmonyProxyConfig?.proxyUrl ?? HARMONY_PROXY_DISABLED,
          ),
        }
      : undefined

  return {
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
    // harmony: rawfile 加载需 relative path; web: Vite 默认 '/' 行为不变.
    base: isHarmony ? './' : '/',
    server: {
      port: 3001,
      // v2.3.1: dev server 直接挂载 api/llm-proxy.ts, 前端 /api/llm-proxy 走本地
      configureServer(server: ViteDevServer) {
        // 动态加载 serverless function (Node.js (req, res) 格式)
        import('./api/llm-proxy.ts').then((mod) => {
          const handler = mod.default;
          server.middlewares.use('/api/llm-proxy', async (req: IncomingMessage, res: ServerResponse) => {
            // 兼容 connect 中间件 (req, res) 签名
            // Vite dev server 的 middlewares 是 connect 实例, req/res 与 Node.js http 一致
            // 用 as unknown as 链转换, 避免 no-explicit-any (oxlint error)
            await handler(
              req as unknown as Parameters<typeof handler>[0],
              res as unknown as Parameters<typeof handler>[1],
            );
          });
        }).catch((err) => {
          console.warn('[vite] api/llm-proxy.ts 加载失败, LLM 功能在 dev 环境不可用:', err);
        });
      },
    },
    build: {
      // harmony: 输出到鸿蒙 rawfile 目录供 ArkWeb 加载.
      // web (default): undefined → Vite 使用默认 'dist'.
      outDir: isHarmony ? 'harmony/entry/src/main/resources/rawfile/dist' : undefined,
      assetsDir: 'assets',
      // v0.4.0-harmony Stage 3 (D3): modulePreload 启用.
      // 首屏 index.html 注入 <link rel="modulepreload"> 预加载首屏所需 chunk,
      // 同时为 lazy chunk (路由级 React.lazy / 动态 import) 提供 polyfill,
      // 兼容不支持 import() polyfill 的旧浏览器.
      modulePreload: { polyfill: true },
      cssCodeSplit: true,
      // v0.3.0-harmony Stage 3: manualChunks 4 chunk (R-PERF-3 缓解)
      // 拆分 vendor 以提升缓存命中率 + 并行加载, 调整 chunk 边界减少重复打包.
      // 函数形式 (rolldown 要求: Vite 8 内置 rolldown 不支持对象形式, 仅接受 function).
      // 路径归一化为正斜杠以兼容 Windows (node_modules 路径跨平台匹配).
      //
      // v0.4.0-harmony Stage 3 (D3): data-parsers chunk 现在通过 TMA / 动态 import
      // 按需加载 (papaparse 在 csvLoader, jsonrepair/zod 在 jsonParser/llmConfig/router).
      // 由于 useSettingsStore 不再静态 import router, data-parsers 完全脱离首屏 bundle.
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return
            const path = id.replace(/\\/g, '/')
            if (path.includes('/node_modules/react/') || path.includes('/node_modules/react-dom/')) {
              return 'react-vendor'
            }
            if (
              path.includes('/node_modules/zustand/') ||
              path.includes('/node_modules/ts-fsrs/') ||
              path.includes('/node_modules/@open-spaced-repetition/binding')
            ) {
              return 'state-fsrs'
            }
            if (
              path.includes('/node_modules/papaparse/') ||
              path.includes('/node_modules/jsonrepair/') ||
              path.includes('/node_modules/zod/')
            ) {
              return 'data-parsers'
            }
            if (path.includes('/node_modules/@radix-ui/react-tooltip')) {
              return 'radix-ui'
            }
          },
        },
      },
    },
    // v0.1.0-harmony Stage 4: harmony 模式下, 把 VITE_LLM_PROXY_URL_HARMONY
    // 静态替换为 VITE_LLM_PROXY_URL. 前端代码 import.meta.env.VITE_LLM_PROXY_URL
    // 在 harmony build 中被替换为 .env.harmony 配置的独立 LLM Proxy URL.
    // web 模式下 harmonyDefine 为 undefined, 不影响现有 VITE_LLM_PROXY_URL 行为.
    define: harmonyDefine,
    plugins: [
      react(),
      // harmony 模式跳过 PWA: SW 在 ArkWeb rawfile 上下文不可注册,
      // manifest 的绝对路径 start_url 也不适用于 rawfile 协议.
      // 改用 harmonyPwaStubPlugin 提供 no-op 的 virtual:pwa-register,
      // 让 src/main.tsx 中的 import 解析成功, catch 块永不触发.
      ...(isHarmony ? [
        harmonyPwaStubPlugin(),
        harmonyCspPlugin(harmonyProxyConfig?.origin),
      ] : [
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
                // v2.3.1: LLM API 端点路径更新为 /api/llm-proxy (原 /.netlify/edge-functions/llm-proxy)
                // NetworkFirst 策略, 显式限制 method === 'GET', POST 请求透传不缓存
                urlPattern: ({ url, request }) =>
                  request.method === 'GET' &&
                  url.pathname.startsWith('/api/llm-proxy'),
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
      ]),
      // Brotli/Gzip sidecars require HTTP Content-Encoding negotiation. Keep
      // them for the regular web deployment, but do not package unusable
      // duplicates into Harmony rawfile resources.
      ...(isHarmony ? [] : [
        compression({
          algorithms: ['brotliCompress', 'gzip'],
          threshold: 10240,
          deleteOriginalAssets: false,
        }),
      ]),
      // v0.3.0-harmony Stage 3: chunk 体积分析 (R-PERF-3 缓解)
      // open=false (CI 环境, 不自动打开浏览器), sunburst 模板可视化 chunk 边界
      visualizer({
        open: false,
        filename: 'dist/stats.html',
        template: 'sunburst',
      }),
    ],
  }
})
