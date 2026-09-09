/**
 * DebugSeedCards (v0.5.0-harmony Stage 4)
 *
 * 运行验证辅助: 通过 hdc shell aa start 携带 query=action=debugSeed 触发,
 * 在原生 RDB 中预置 5 张到期卡片, 用于正向验证:
 *   RDB 恢复 -> Web ready ACK -> 冷/热启动 FIFO 消费 -> 进入复习页.
 *
 * 安全守卫 (与 CURRENT_STATUS 虚拟同源安全模型一致):
 * - 该入口仅在 debuggable 构建 (DevEco 调试安装) 生效; release 构建直接跳过
 *   (EntryAbility.seedDebugCards 内检查 applicationInfo.debuggable).
 * - 白名单 query (LAUNCH_QUERY_REGEX) 不包含 action=debugSeed — 外部 intent
 *   无法经 HarmonyBridge.handleHarmonyLaunch 派发到 Web; 本模块只由
 *   EntryAbility 在原生层拦截调用.
 * - seed 卡片 id 固定前缀 debug-seed-, 幂等 (重复触发为 upsert 覆盖).
 *
 * ArkTS 适配: 无 any / 无对象字面量类型 / 无 var.
 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import type { MemoryCardRecord } from './MemoryCardSchema';
import type { MemoryCardStore } from './MemoryCardStore';

const DOMAIN: number = 0x0001;
const TAG: string = 'DebugSeedCards';

/** debugSeed 触发的 query 字面量 (EntryAbility 层拦截, 不入 Web 派发白名单). */
export const DEBUG_SEED_QUERY: string = 'action=debugSeed';

/** seed 卡片数量 (3 en + 2 de). */
export const DEBUG_SEED_CARD_COUNT: number = 5;

/** seed 卡片到期提前量 (1 小时前, 确保严格到期). */
export const DEBUG_SEED_DUE_OFFSET_MS: number = 60 * 60 * 1000;

/** seed 结果 (ArkTS 禁止内联对象字面量类型, 显式声明). */
export interface DebugSeedResult {
  /** 是否跳过 (非 debug 构建或 store 初始化失败). */
  skipped: boolean;
  /** 实际写入的卡片数. */
  inserted: number;
  /** 跳过原因. */
  reason?: string;
}

/**
 * 构造 5 张到期 seed 卡片 (纯函数, 无 I/O).
 *
 * - 3 张 en-US + 2 张 de-DE, 保证 startReview 的"选择可用语言"分支可覆盖.
 * - due = now - 1h (严格过去), status='review', reps=1 (模拟已建立卡片).
 * - id: debug-seed-1..5 (固定, 幂等覆盖).
 */
export function buildDebugSeedCards(now: number): MemoryCardRecord[] {
  const due: number = now - DEBUG_SEED_DUE_OFFSET_MS;
  const learned: number = now - 24 * 60 * 60 * 1000;
  const lemmas: string[] = ['alpha', 'beta', 'gamma', 'Beispiel', 'Haus'];
  const languages: string[] = ['en', 'en', 'en', 'de', 'de'];
  const cards: MemoryCardRecord[] = [];
  for (let i = 0; i < DEBUG_SEED_CARD_COUNT; i++) {
    const card: MemoryCardRecord = {
      id: `debug-seed-${i + 1}`,
      lexemeGroupId: `debug-seed-group-${i + 1}`,
      lemma: lemmas[i],
      objectiveDifficulty: 3,
      language: languages[i],
      firstLearnedAt: learned,
      lastReviewAt: learned,
      due: due,
      stability: 1.0,
      difficulty: 5.0,
      elapsedDays: 1,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      status: 'review',
      learningSteps: 0,
    };
    cards.push(card);
  }
  return cards;
}

/**
 * 将 seed 卡片写入 RDB (幂等 upsert). 失败不抛错, 返回 skipped 结果.
 *
 * @param store 已初始化的 MemoryCardStore.
 * @param now 当前时间戳 (由调用方传入, 便于测试注入).
 */
export async function seedDebugCardsForRun(
  store: MemoryCardStore,
  now: number
): Promise<DebugSeedResult> {
  try {
    const cards: MemoryCardRecord[] = buildDebugSeedCards(now);
    for (let i = 0; i < cards.length; i++) {
      await store.upsertCard(cards[i]);
    }
    hilog.info(
      DOMAIN,
      TAG,
      'seedDebugCardsForRun inserted=%{public}d due=%{public}d',
      cards.length,
      now - DEBUG_SEED_DUE_OFFSET_MS
    );
    return { skipped: false, inserted: cards.length };
  } catch (e) {
    const err: BusinessError = e as BusinessError;
    hilog.error(
      DOMAIN,
      TAG,
      'seedDebugCardsForRun failed: code=%{public}d msg=%{public}s',
      err.code,
      err.message
    );
    return { skipped: true, inserted: 0, reason: err.message };
  }
}
