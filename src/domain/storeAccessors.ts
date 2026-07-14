/**
 * v2.0.0 Stage 3: Store 访问封装层.
 *
 * passageGenerator 等服务层通过本模块访问 store 状态,
 * 不再直接 import useWordlistStore / useMemoryStore (Contract 57).
 * useSettingsStore 可保留直接访问 (settings 是配置, 非业务状态).
 */
import { useWordlistStore } from '../features/wordlist/store/useWordlistStore';
import { useMemoryStore } from '../features/review/store/useMemoryStore';

/** 获取 wordlist store 的当前状态和方法 */
export function getWordlistState() {
  return useWordlistStore.getState();
}

/** 获取 memory store 的当前状态和方法 */
export function getMemoryState() {
  return useMemoryStore.getState();
}
