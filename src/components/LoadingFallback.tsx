/**
 * v0.4.0-harmony Stage 3 (D3): 路由级 Suspense fallback.
 *
 * 极简组件: 一个 div + 居中文字 + CSS 内联, 不引依赖.
 * 用于 React.lazy 包裹的路由组件加载时的占位.
 */
export function LoadingFallback() {
  return (
    <div
      role="status"
      aria-label="加载中"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontSize: '14px',
        color: 'inherit',
      }}
    >
      加载中…
    </div>
  );
}
