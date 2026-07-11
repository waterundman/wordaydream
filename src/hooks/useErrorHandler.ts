import { useCallback } from 'react';
import { useToastStore } from '../store/useToastStore';

/**
 * 错误处理选项
 */
export interface ErrorHandlerOptions {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 错误上下文描述 */
  context?: string;
  /** 是否显示 Toast 提示 */
  showToast?: boolean;
}

/**
 * 带错误处理的异步函数包装器
 * 支持自动重试和错误提示
 *
 * @template T 返回类型
 * @param fn 异步函数
 * @param options 错误处理选项
 * @returns 异步函数的返回值
 */
export async function withErrorHandler<T>(
  fn: () => Promise<T>,
  options: ErrorHandlerOptions = {}
): Promise<T> {
  const { maxRetries = 0, context = '', showToast = true } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : '未知错误';
  if (showToast) {
    useToastStore.getState().addToast(
      'error',
      `${context ? `${context}: ` : ''}${message}`
    );
  }
  throw lastError;
}

/**
 * 错误处理 Hook
 * 提供统一的错误处理和用户反馈机制
 *
 * @returns 错误处理方法集合
 */
export function useErrorHandler() {
  const addToast = useToastStore((s) => s.addToast);

  /**
   * 处理异步函数的错误
   *
   * @template T 返回类型
   * @param fn 异步函数
   * @param options 错误处理选项
   * @returns 异步函数的返回值
   */
  const handleAsync = useCallback(
    <T,>(fn: () => Promise<T>, options: ErrorHandlerOptions = {}): Promise<T> => {
      return withErrorHandler(fn, options);
    },
    []
  );

  /**
   * 处理错误并显示 Toast 提示
   *
   * @param error 错误对象
   * @param context 错误上下文描述
   */
  const handleError = useCallback(
    (error: unknown, context?: string) => {
      const message = error instanceof Error ? error.message : '未知错误';
      addToast('error', `${context ? `${context}: ` : ''}${message}`);
    },
    [addToast]
  );

  /**
   * 显示成功 Toast 提示
   *
   * @param message 消息内容
   */
  const handleSuccess = useCallback(
    (message: string) => {
      addToast('success', message);
    },
    [addToast]
  );

  /**
   * 显示警告 Toast 提示
   *
   * @param message 消息内容
   */
  const handleWarning = useCallback(
    (message: string) => {
      addToast('warning', message);
    },
    [addToast]
  );

  return { handleAsync, handleError, handleSuccess, handleWarning };
}