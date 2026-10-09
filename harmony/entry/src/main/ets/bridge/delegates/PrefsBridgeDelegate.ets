/**
 * PrefsBridgeDelegate (v1.6.3 S1 — B1 上帝文件拆分)
 *
 * preferences 域委托: Web → 鸿蒙 @ohos.data.preferences 读写.
 * 由 HarmonyBridge facade 持有并转发; 桥接契约面 (方法名/签名) 不变,
 * BridgeMethodRegistry.ets 仍是唯一方法真源.
 *
 * context 由 facade.refreshContext 同源刷新 (换引用时丢弃绑定旧 context 的
 * prefs 缓存, 与拆分前 facade 行为逐字一致). read 走缓存实例, write 沿用
 * 拆分前"直接 getPreferences + put + flush"路径 (不改语义).
 * Contract: 所有方法 try/catch 兜底, 异常返回 null / void 不抛错 (异常不传播到 Web).
 */
import { preferences } from '@kit.ArkData';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { BridgeInputValidator } from '../BridgeInputValidator';

const DOMAIN: number = 0x0001;
const TAG: string = 'HarmonyBridge';
const PREFS_NAME: string = 'wordaydream_prefs';

export class PrefsBridgeDelegate {
  private context: common.Context;
  private prefsName: string = PREFS_NAME;
  private cachedPrefs: preferences.Preferences | null = null;

  constructor(context: common.Context) {
    this.context = context;
  }

  /**
   * 由 facade.refreshContext 同源刷新 (facade 已在同引用时提前返回).
   * 换引用时丢弃绑定旧 context 的 prefs 缓存, 避免用已销毁 context 读 preferences.
   */
  refreshContext(newContext: common.Context): void {
    this.context = newContext;
    this.cachedPrefs = null;
  }

  /** 缓存 preferences 实例 (避免每次 read 重新 getPreferences). */
  private async getPrefs(): Promise<preferences.Preferences> {
    if (this.cachedPrefs !== null) {
      return this.cachedPrefs;
    }
    try {
      this.cachedPrefs =
        await preferences.getPreferences(this.context, this.prefsName);
      return this.cachedPrefs;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getPreferences failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      throw new Error(err.message);
    }
  }

  /**
   * 读取 preferences 键值 (返回 null 表示键不存在).
   * 真实 @ohos.data.preferences 调用.
   */
  async readPreferences(key: string): Promise<string | null> {
    try {
      if (!BridgeInputValidator.validatePreferencesKey(key)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'readPreferences rejected: invalid key=%{public}s',
          key
        );
        return null;
      }
      const prefs: preferences.Preferences = await this.getPrefs();
      const exists: boolean = await prefs.has(key);
      if (!exists) {
        hilog.info(
          DOMAIN,
          TAG,
          'readPreferences: key=%{public}s -> null (not found)',
          key
        );
        return null;
      }
      // API 22: prefs.get 返回 ValueType 联合类型, 需 typeof 收窄到 string.
      const raw: preferences.ValueType = await prefs.get(key, '');
      const value: string = typeof raw === 'string' ? raw : '';
      hilog.info(
        DOMAIN,
        TAG,
        'readPreferences: key=%{public}s -> (value len=%{public}d)',
        key,
        value.length
      );
      return value;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'readPreferences failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return null;
    }
  }

  /**
   * 写入 preferences 键值.
   * 真实 @ohos.data.preferences 调用.
   */
  async writePreferences(key: string, value: string): Promise<void> {
    try {
      if (
        !BridgeInputValidator.validatePreferencesKey(key) ||
        !BridgeInputValidator.validatePreferencesValue(value)
      ) {
        hilog.warn(
          DOMAIN,
          TAG,
          'writePreferences rejected: invalid key or value (key=%{public}s)',
          key
        );
        return;
      }
      const prefs: preferences.Preferences =
        await preferences.getPreferences(this.context, this.prefsName);
      await prefs.put(key, value);
      await prefs.flush();
      hilog.info(
        DOMAIN,
        TAG,
        'writePreferences: key=%{public}s (value len=%{public}d) flushed',
        key,
        value.length
      );
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'writePreferences failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }
}