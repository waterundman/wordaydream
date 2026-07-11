import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@radix-ui/react-tooltip'
import './index.css'
import App from './App.tsx'
// v1.4.1 Stage 2: 离线模式 store (init / beforeinstallprompt 监听)
import { useOfflineModeStore } from './features/llm/store/offlineMode'

// 启动 window 'online' / 'offline' 事件监听, 镜像 navigator.onLine 到 store.
// 在 main.tsx module 顶层调用, 整个应用生命周期都生效.
useOfflineModeStore.getState().init()

// 监听 PWA install prompt 事件, 存到 store 供 InstallPromptButton 使用.
// 浏览器只在页面 'eligible for install' 时触发 beforeinstallprompt,
// 错过即丢失, 因此必须在 main 启动时即挂载.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // 阻止浏览器默认 mini-infobar, 由我们自己的按钮触发 prompt.
    event.preventDefault()
    useOfflineModeStore.getState().setInstallPromptEvent(event)
  })

  // 监听 app installed 事件, 清理 installPromptEvent 引用.
  window.addEventListener('appinstalled', () => {
    useOfflineModeStore.getState().setInstallPromptEvent(null)
  })
}

// v1.4.1 Stage 2: 触发 SW 注册 (autoUpdate 模式由 vite-plugin-pwa 处理, 0 额外代码).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // vite-plugin-pwa 在 production 自动注入 registerSW.js,
  // 这里用 dynamic import 走其 virtual module, 避免在 dev 模式报 SW 警告.
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({ immediate: true })
    })
    .catch(() => {
      // virtual:pwa-register 在 dev / 沙箱不可用, 静默忽略
    })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300} skipDelayDuration={100}>
      <App />
    </TooltipProvider>
  </StrictMode>,
)
