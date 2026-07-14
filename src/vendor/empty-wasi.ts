// v2.2.0 hotfix: @open-spaced-repetition/binding-wasm32-wasi 的空模块替代.
// 浏览器端 WASM 版本未安装, Vite import-analysis 解析失败导致 500.
// 用空模块让 Vite 解析成功, 运行时 binding.computeParameters 不存在,
// fsrsOptimizer.ts 的 loadBinding() 降级为 "优化不可用".
export {};
