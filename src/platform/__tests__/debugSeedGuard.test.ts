/**
 * v0.5.0-harmony Stage 4 — T01 [critical] + T02 [critical]
 *
 * T01 [critical]: debugSeed 生产安全守卫 (源码不变量):
 *   - EntryAbility.seedDebugCards 中 debuggable 检查先于 seed 调用
 *     (release 构建无该入口, 外部 intent 无法滥用)
 *   - 'action=debugSeed' 不在 LAUNCH_QUERY_REGEX 白名单内 — 外部 intent
 *     无法经 HarmonyBridge.handleHarmonyLaunch 派发到 Web
 *   - 拦截点位于 bridge.handleHarmonyLaunch 之前 (原生层)
 *
 * T02 [critical]: seed 数据构造不变量:
 *   - buildDebugSeedCards 产出 5 张卡 (DEBUG_SEED_CARD_COUNT)
 *   - due = now - 1h (严格过去, DEBUG_SEED_DUE_OFFSET_MS)
 *   - 语言 3 en + 2 de (覆盖 startReview 的语言选择分支)
 *   - id 固定前缀 debug-seed- (幂等 upsert), status='review', reps=1
 *
 * ArkTS 无法在 vitest 中运行, 以源码结构断言 (与 reminderAgentSafety.test.ts 同模式).
 *
 * 0 emoji. 0 改动既有源文件.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const entryAbilitySource = readFileSync(
  resolve(process.cwd(), 'harmony/entry/src/main/ets/entryability/EntryAbility.ets'),
  'utf8',
);
const validatorSource = readFileSync(
  resolve(process.cwd(), 'harmony/entry/src/main/ets/bridge/BridgeInputValidator.ets'),
  'utf8',
);
const seedSource = readFileSync(
  resolve(process.cwd(), 'harmony/entry/src/main/ets/data/DebugSeedCards.ets'),
  'utf8',
);

describe('Stage 4 — T01 [critical]: debugSeed production guard', () => {
  it('seedDebugCards 中 debug 检查先于 seedDebugCardsForRun 调用', () => {
    const method = entryAbilitySource.slice(
      entryAbilitySource.indexOf('private seedDebugCards()'),
      entryAbilitySource.indexOf('Stage 5: 处理元服务分享卡片'),
    );
    const guard = method.indexOf('appInfo.debug === true');
    const seedCall = method.indexOf('seedDebugCardsForRun(');
    expect(guard).toBeGreaterThan(0);
    expect(seedCall).toBeGreaterThan(guard);
  });

  it('非 debuggable 构建显式跳过 (warn + return)', () => {
    const method = entryAbilitySource.slice(
      entryAbilitySource.indexOf('private seedDebugCards()'),
      entryAbilitySource.indexOf('Stage 5: 处理元服务分享卡片'),
    );
    const guardReturn = method.indexOf("seedDebugCards skipped: not a debuggable build");
    expect(guardReturn).toBeGreaterThan(0);
  });

  it('LAUNCH_QUERY_REGEX 白名单不包含 debugSeed (外部 intent 不可达)', () => {
    const regexDecl = validatorSource.slice(
      validatorSource.indexOf('LAUNCH_QUERY_REGEX: RegExp'),
      validatorSource.indexOf('const CARD_ID_MAX_LENGTH'),
    );
    expect(regexDecl).not.toContain('debugSeed');
    expect(regexDecl).toContain('action=startReview');
  });

  it('EntryAbility 拦截点在 bridge.handleHarmonyLaunch 派发之前 (原生层)', () => {
    const intercept = entryAbilitySource.indexOf('query === DEBUG_SEED_QUERY');
    const dispatch = entryAbilitySource.indexOf('bridge.handleHarmonyLaunch(query)');
    expect(intercept).toBeGreaterThan(0);
    expect(dispatch).toBeGreaterThan(intercept);
  });
});

describe('Stage 4 — T02 [critical]: seed data construction invariants', () => {
  it('due 为严格过去时间 (now - 1h offset)', () => {
    const offsetDecl = seedSource.indexOf('DEBUG_SEED_DUE_OFFSET_MS: number = 60 * 60 * 1000');
    const dueUsage = seedSource.indexOf('const due: number = now - DEBUG_SEED_DUE_OFFSET_MS');
    expect(offsetDecl).toBeGreaterThan(0);
    expect(dueUsage).toBeGreaterThan(0);
  });

  it('产出 5 张卡 (DEBUG_SEED_CARD_COUNT = 5, 循环上限一致)', () => {
    expect(seedSource).toContain('DEBUG_SEED_CARD_COUNT: number = 5');
    expect(seedSource).toContain('i < DEBUG_SEED_CARD_COUNT');
  });

  it('语言混合 3 en + 2 de (覆盖 startReview 语言选择)', () => {
    expect(seedSource).toContain("'en', 'en', 'en', 'de', 'de'");
  });

  it('id 固定前缀 + status=review + reps=1 (幂等 upsert 语义)', () => {
    expect(seedSource).toContain('`debug-seed-${i + 1}`');
    expect(seedSource).toContain("status: 'review'");
    expect(seedSource).toContain('reps: 1');
  });

  it('seed 失败不抛错 (skipped 降级返回)', () => {
    expect(seedSource).toContain("return { skipped: true, inserted: 0, reason: err.message };");
  });
});
