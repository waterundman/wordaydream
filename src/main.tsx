import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@radix-ui/react-tooltip'
import './index.css'
import './styles/animations.css'
import App from './App.tsx'
// v1.4.1 Stage 2: 离线模式 store (init / beforeinstallprompt 监听)
import { useOfflineModeStore } from './features/llm/store/offlineMode'
// v0.1.0-harmony Stage 2: SW 注册抽出到 platform 模块, 内部处理鸿蒙 ArkWeb 降级
import { registerServiceWorker } from './platform/swRegistration'
import { installHarmonyLaunchHandling } from './domain/harmonyLaunch'
import { HarmonyContentReady } from './platform/HarmonyContentReady'

// Install before React mounts so cold-start Want dispatches cannot race effects.
installHarmonyLaunchHandling()
// onPageEnd only confirms that the ArkWeb shell loaded. Explicitly acknowledge
// handler installation so an empty/failed bundle cannot consume native launches.
window.harmonyBridge?.notifyWebReady()

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

// v1.4.1 Stage 2: 触发 SW 注册 (autoUpdate 模式由 vite-plugin-pwa 处理).
// v0.1.0-harmony Stage 2: 鸿蒙 ArkWeb 不支持 SW, 由 registerServiceWorker 内部
// 通过 detectPlatform().supportsServiceWorker() 降级为纯网络模式.
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300} skipDelayDuration={100}>
      <HarmonyContentReady />
      <App />
    </TooltipProvider>
  </StrictMode>,
)
