/**
 * FormIdStore (v0.5.0-harmony Stage 2)
 *
 * 持久化服务卡片 formId 集合, 供复习完成后主动刷新所有已添加的服务卡片.
 *
 * 背景: HarmonyOS FormExtensionAbility 默认不主动回调 Web 侧; 原实现仅在
 * 系统定时 (updateEnabled) 时刷新服务卡片. Stage 2 引入"复习完成 → 主动刷新"
 * 闭环, 需要一份持久化的 formId 列表, 在 notifyReviewCompleted 时对所有
 * formId 调 formProvider.updateForm.
 *
 * 存储: @ohos.data.preferences (轻量 KV, 适合小集合).
 * 键: 'formIds', 值为 JSON 序列化的 string[] (Set<string> 不能直接序列化).
 *
 * 并发安全: 初始化共用同一个 initializePromise, 重复调用 initialize
 *   返回同一 Promise (参考 MemoryCardStore 模式). 单例: 全局唯一实例.
 *
 * 所有方法 try/catch 兜底, 异常时静默降级 (save/remove 失败仅日志,
 * getAllFormIds 失败返回 []), 不抛错到调用方.
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';

const DOMAIN: number = 0x0001;
const TAG: string = 'FormIdStore';
const PREFS_NAME: string = 'wordaydream_form_prefs';
const FORM_IDS_KEY: string = 'formIds';

export class FormIdStore {
  private static instance: FormIdStore | null = null;
  private context: common.Context | null = null;
  private prefs: preferences.Preferences | null = null;
  private initPromise: Promise<preferences.Preferences> | null = null;

  private constructor() {}

  static getInstance(): FormIdStore {
    if (FormIdStore.instance === null) {
      FormIdStore.instance = new FormIdStore();
    }
    return FormIdStore.instance;
  }

  /**
   * 初始化 preferences 实例 (幂等, 并发调用共享同一 Promise).
   *
   * @param context 任意 ability context (FormExtensionContext 或 EntryAbility context),
   *   用于打开应用级 preferences 文件. 仅首次调用时使用.
   */
  initialize(context: common.Context): Promise<preferences.Preferences> {
    if (this.prefs !== null) {
      return Promise.resolve(this.prefs);
    }
    if (this.initPromise !== null) {
      return this.initPromise;
    }
    this.context = context;
    this.initPromise = preferences
      .getPreferences(context, PREFS_NAME)
      .then((prefs: preferences.Preferences): preferences.Preferences => {
        this.prefs = prefs;
        return prefs;
      });
    return this.initPromise;
  }

  /**
   * 持久化一个 formId (幂等: 已存在则跳过写入).
   *
   * @param formId 服务卡片 formId (空串直接忽略).
   * @param context 可选 context, 首次初始化时注入; 已初始化后可省略.
   */
  async saveFormId(formId: string, context?: common.Context): Promise<void> {
    if (formId.length === 0) {
      return;
    }
    try {
      const prefs: preferences.Preferences | null =
        await this.resolvePrefs(context);
      if (prefs === null) {
        return;
      }
      const ids: Set<string> = await this.readIds(prefs);
      if (ids.has(formId)) {
        return;
      }
      ids.add(formId);
      await prefs.put(FORM_IDS_KEY, JSON.stringify(Array.from(ids)));
      await prefs.flush();
      hilog.info(DOMAIN, TAG, 'saveFormId: %{public}s (total=%{public}d)', formId, ids.size);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'saveFormId failed: formId=%{public}s code=%{public}d msg=%{public}s',
        formId,
        err.code,
        err.message
      );
    }
  }

  /**
   * 移除一个 formId (卡片删除时调用). 不存在则跳过.
   */
  async removeFormId(formId: string): Promise<void> {
    if (formId.length === 0) {
      return;
    }
    try {
      const prefs: preferences.Preferences | null = await this.ensurePrefs();
      if (prefs === null) {
        return;
      }
      const ids: Set<string> = await this.readIds(prefs);
      if (!ids.has(formId)) {
        return;
      }
      ids.delete(formId);
      await prefs.put(FORM_IDS_KEY, JSON.stringify(Array.from(ids)));
      await prefs.flush();
      hilog.info(DOMAIN, TAG, 'removeFormId: %{public}s (total=%{public}d)', formId, ids.size);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'removeFormId failed: formId=%{public}s code=%{public}d msg=%{public}s',
        formId,
        err.code,
        err.message
      );
    }
  }

  /**
   * 返回所有已持久化的 formId. 异常返回 [] (不抛错).
   */
  async getAllFormIds(): Promise<string[]> {
    try {
      const prefs: preferences.Preferences | null = await this.ensurePrefs();
      if (prefs === null) {
        return [];
      }
      const ids: Set<string> = await this.readIds(prefs);
      return Array.from(ids);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getAllFormIds failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return [];
    }
  }

  /** 已初始化则返回实例, 否则用已有 context 初始化 (无 context 返回 null). */
  private async ensurePrefs(): Promise<preferences.Preferences | null> {
    if (this.prefs !== null) {
      return this.prefs;
    }
    if (this.context === null) {
      return null;
    }
    return this.initialize(this.context);
  }

  /** saveFormId 用的解析: 优先用传入 context, 否则用已存 context. */
  private resolvePrefs(
    context?: common.Context
  ): Promise<preferences.Preferences | null> {
    if (this.prefs !== null) {
      return Promise.resolve(this.prefs);
    }
    const ctx: common.Context | null = context ?? this.context;
    if (ctx === null) {
      return Promise.resolve(null);
    }
    return this.initialize(ctx);
  }

  /** 读取并解析 formIds 集合 (容错: 键不存在 / 解析失败返回空集). */
  private async readIds(prefs: preferences.Preferences): Promise<Set<string>> {
    const exists: boolean = await prefs.has(FORM_IDS_KEY);
    if (!exists) {
      return new Set<string>();
    }
    const raw: preferences.ValueType = await prefs.get(FORM_IDS_KEY, '');
    const str: string = typeof raw === 'string' ? raw : '';
    if (str.length === 0) {
      return new Set<string>();
    }
    try {
      const parsed: string[] = JSON.parse(str) as string[];
      const result: Set<string> = new Set<string>();
      // ArkTS strict: 不使用 unknown / Array.isArray / `is` 类型守卫.
      // 非数组 (如 {} ) 运行时 length 为 undefined, 循环条件 0 < undefined 为假, 安全跳过.
      for (let i = 0; i < parsed.length; i++) {
        const item: string = parsed[i] as string;
        if (typeof item === 'string' && item.length > 0) {
          result.add(item);
        }
      }
      return result;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'readIds parse failed (reset to empty): code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return new Set<string>();
    }
  }
}
