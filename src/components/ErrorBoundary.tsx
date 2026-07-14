import { Component, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
  /**
   * v2.2.4 Stage 2 (D2-5): 重试 / 返回首页前调用, 供调用方重置外部状态 (可选).
   * 不提供时仅重置 ErrorBoundary 内部状态.
   */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  // v2.2.4 Stage 2 (D2-5): 返回首页 — 通过 hash 路由跳转 home, 并重置错误边界状态.
  handleGoHome = () => {
    window.location.hash = '#/home';
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className={styles.container}>
          <div className={styles.card}>
            <h2 className={styles.title}>出错了</h2>
            <p className={styles.message}>
              {this.state.error?.message || '应用发生未知错误'}
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.retryButton}
                onClick={this.handleRetry}
              >
                重试
              </button>
              <button
                type="button"
                className={styles.homeButton}
                onClick={this.handleGoHome}
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
