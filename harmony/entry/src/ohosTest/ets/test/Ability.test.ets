/**
 * Ability.test (v0.1.0-harmony)
 *
 * ohosTest 仪器测试套件 - 需要 DevEco Studio 模拟器或真机执行.
 * 覆盖 HarmonyBridge 桥方法 + MemoryCardStore + NotificationService 关键路径,
 * 并守护 BridgeMethodRegistry 的 JSProxy 契约 (sync/async 数量与内容).
 *
 * 测试矩阵 (对应 e2e/harmony_full.spec.ts 10 case 的 ArkTS 侧守护):
 * 1. HarmonyBridge 实例化 (constructor 不抛错)
 * 2. getDueCardsCount 与今日统计的不变量 (dueCount <= totalCount)
 * 3. readPreferences 未写入键返回 null
 * 4. writePreferences + readPreferences 往返一致
 * 5. triggerHapticFeedback 不抛错 (缺权限时 catch 兜底)
 * 6. handleHarmonyLaunch webController 未就绪时静默跳过
 * 7. registerReminder 不抛错 + reminderAgent 调度结果契约 (非法入参必须 skipped)
 * 8. MemoryCardStore 单例 + initialize 幂等 + 初始化后表可读写往返
 * 9. NotificationService 单例 + isEnabled 返回布尔
 * 10. 通知模板多语言 fallback
 * 11. BridgeMethodRegistry 契约 (sync=4 / async=16, 无重复无遗漏)
 *
 * 断言取向: 优先断言结果/状态而非"不抛错"; 无权益 / 无 Web 控制器等环境相关
 * 分支只断言安全降级后的可观测状态, 不写死系统错误码.
 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import { describe, beforeAll, beforeEach, afterEach, afterAll, it, expect } from '@ohos/hypium';
import { common } from '@kit.AbilityKit';
import { HarmonyBridge } from '../../../main/ets/bridge/HarmonyBridge';
import {
  BRIDGE_NAME,
  BRIDGE_SYNC_METHODS,
  BRIDGE_ASYNC_METHODS,
} from '../../../main/ets/bridge/BridgeMethodRegistry';
import { MemoryCardStore } from '../../../main/ets/data/MemoryCardStore';
import { NotificationService } from '../../../main/ets/notification/NotificationService';
import { getReviewReminderText, getPermissionRequestText } from '../../../main/ets/notification/templates';
import {
  TABLE_NAME,
  STORE_NAME,
  COLUMN_LIST,
  CREATE_TABLE_SQL,
  CREATE_INDEX_SQL_DUE,
  CREATE_INDEX_SQL_LAST_REVIEW,
  CREATE_INDEX_SQL_LANGUAGE,
  MemoryCardRecord,
} from '../../../main/ets/data/MemoryCardSchema';

export default function abilityTest() {
  describe('HarmonyBridgeTest', () => {
    let bridge: HarmonyBridge;
    let context: common.Context;

    beforeAll(() => {
      const abilityDelegatorRegistry = require('@kit.TestKit');
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      context = delegator.getAppContext();
      bridge = HarmonyBridge.getInstance(context);
      hilog.info(0x0000, 'testTag', '%{public}s', 'HarmonyBridgeTest beforeAll ready');
    })

    beforeEach(() => {
    })
    afterEach(() => {
    })
    afterAll(() => {
    })

    it('bridgeInstanceNotNull', 0, () => {
      expect(bridge).assertNotNull();
      expect(typeof bridge).assertEqual('object');
    })

    it('getDueCardsCountReturnsNumber', 0, async () => {
      const count: number = await bridge.getDueCardsCount();
      expect(typeof count).assertEqual('number');
      expect(count >= 0).assertTrue();
      // 结果不变量: 到期数不会超过总卡数 (同一 store 的两条查询链路).
      const stats = await bridge.getTodayReviewStats();
      expect(stats.totalCount >= 0).assertTrue();
      expect(count <= stats.totalCount).assertTrue();
    })

    it('readPreferencesRejectsUnknownKey', 0, async () => {
      const value: string | null = await bridge.readPreferences('__nonexistent_key_test__');
      expect(value).assertNull();
    })

    it('writeAndReadPreferencesRoundTrip', 0, async () => {
      const key: string = 'streak_data';
      const value: string = 'test_value_' + Date.now().toString();
      await bridge.writePreferences(key, value);
      const readBack: string | null = await bridge.readPreferences(key);
      expect(readBack).assertNotNull();
      expect(readBack).assertEqual(value);
      // 覆盖写必须生效 (断言最后一次写入的值, 而非仅"能读回非空").
      const next: string = value + '_updated';
      await bridge.writePreferences(key, next);
      const readAgain: string | null = await bridge.readPreferences(key);
      expect(readAgain).assertEqual(next);
    })

    it('triggerHapticFeedbackNoThrow', 0, () => {
      // 缺 VIBRATE 权限时 vibrator 抛 SecurityException, 由 catch 兜底为 void.
      // 测试仅验证不抛错到调用方.
      let noThrow: boolean = true;
      try {
        bridge.triggerHapticFeedback('light');
        bridge.triggerHapticFeedback('medium');
        bridge.triggerHapticFeedback('heavy');
      } catch (e) {
        noThrow = false;
      }
      expect(noThrow).assertTrue();
    })

    it('handleHarmonyLaunchNoThrowWithoutController', 0, () => {
      // webController 未注入 (AppStorage 无 'webController' 键) 时应静默跳过.
      let noThrow: boolean = true;
      try {
        bridge.handleHarmonyLaunch('action=startReview');
      } catch (e) {
        noThrow = false;
      }
      expect(noThrow).assertTrue();
    })

    it('registerReminderNoThrow', 0, async () => {
      // registerReminder 返回 void: 缺通知权限 / store 未就绪时必须内部兜底,
      // 这里直接 await (抛错即失败), 不再用 try/catch 把异常吞成"通过".
      await bridge.registerReminder({
        dueAt: Date.now() + 3600000,
        cardId: 'test_card_id',
      });
    })

    it('scheduleReminderRejectsInvalidArguments', 0, async () => {
      // 可断言的结果契约: 非法 reminderId / 非未来时间必须被拒绝并安全跳过,
      // 绝不降级为立即通知 (无权益环境下同样成立).
      const invalidId = await bridge.scheduleReviewReminder(
        'invalid id with spaces',
        Date.now() + 3600000
      );
      expect(typeof invalidId.skipped).assertEqual('boolean');
      expect(invalidId.skipped).assertTrue();

      const pastTrigger = await bridge.scheduleReviewReminder(
        'ohos-test-reminder',
        Date.now() - 1000
      );
      expect(pastTrigger.skipped).assertTrue();

      // 取消未登记的提醒: 幂等语义要求 ok=true.
      const cancelUnknown = await bridge.cancelReviewReminder(
        `ohos-test-reminder-${Date.now()}`
      );
      expect(cancelUnknown.ok).assertTrue();

      // 非法 id 的取消必须显式失败 (不静默成功).
      const cancelInvalid = await bridge.cancelReviewReminder('invalid id!');
      expect(cancelInvalid.ok).assertFalse();
    })
  })

  describe('MemoryCardStoreTest', () => {
    it('singletonInstance', 0, () => {
      const a: MemoryCardStore = MemoryCardStore.getInstance();
      const b: MemoryCardStore = MemoryCardStore.getInstance();
      expect(a).assertNotNull();
      expect(a === b).assertTrue();
    })

    it('initializeIdempotent', 0, async () => {
      const abilityDelegatorRegistry = require('@kit.TestKit');
      const ctx: common.Context = abilityDelegatorRegistry.getAbilityDelegator().getAppContext();
      const store: MemoryCardStore = MemoryCardStore.getInstance();
      let noThrow: boolean = true;
      try {
        await store.initialize(ctx);
        await store.initialize(ctx); // 幂等, 第二次不抛错
      } catch (e) {
        noThrow = false;
      }
      expect(noThrow).assertTrue();
      // 幂等初始化后 store 必须处于可查询状态, 且 dueCount <= totalCount
      // (仅断言"不抛错"无法发现 store 停留在未初始化分支).
      const now: number = Date.now();
      const dueCount: number = await store.getDueCardsCount(now);
      const total: number = (await store.getTodayReviewStats(now)).totalCount;
      expect(dueCount >= 0).assertTrue();
      expect(dueCount <= total).assertTrue();
    })

    it('storeRoundTripAfterInitialize', 0, async () => {
      const abilityDelegatorRegistry = require('@kit.TestKit');
      const ctx: common.Context = abilityDelegatorRegistry.getAbilityDelegator().getAppContext();
      const store: MemoryCardStore = MemoryCardStore.getInstance();
      await store.initialize(ctx);

      const suffix: string = Date.now().toString();
      const now: number = Date.now();
      const card: MemoryCardRecord = {
        id: `ohos-test-card-${suffix}`,
        lexemeGroupId: `ohos-test-group-${suffix}`,
        lemma: 'ohos-test-lemma',
        objectiveDifficulty: 3,
        language: 'en',
        firstLearnedAt: now - 86400000,
        lastReviewAt: now - 3600000,
        due: now - 60000,
        stability: 1.0,
        difficulty: 5.0,
        elapsedDays: 1,
        scheduledDays: 1,
        reps: 1,
        lapses: 0,
        status: 'review',
        learningSteps: 0,
      };
      await store.upsertCard(card);

      // 写入后必须可按主键读回, 且字段值一致 (表真的可用, 而非静默降级返回 null).
      const readBack: MemoryCardRecord | null = await store.getCardById(card.id);
      expect(readBack !== null).assertTrue();
      if (readBack !== null) {
        expect(readBack.lemma).assertEqual(card.lemma);
        expect(readBack.lexemeGroupId).assertEqual(card.lexemeGroupId);
        expect(readBack.due).assertEqual(card.due);
        expect(readBack.status).assertEqual(card.status);
      }
      // 到期卡片 (due = now - 60s) 必须出现在到期查询里.
      const dueCards: MemoryCardRecord[] = await store.getDueCards(now, 100);
      expect(dueCards.length >= 1).assertTrue();
      const stats: number = (await store.getTodayReviewStats(now)).totalCount;
      expect(stats >= 1).assertTrue();

      // 清理: 按词位组删除后主键查询应为 null (deleteCardByLexemeGroupId 生效).
      await store.deleteCardByLexemeGroupId(card.lexemeGroupId);
      const deleted: MemoryCardRecord | null = await store.getCardById(card.id);
      expect(deleted).assertNull();
    })
  })

  describe('NotificationServiceTest', () => {
    it('singletonInstance', 0, () => {
      const a: NotificationService = NotificationService.getInstance();
      const b: NotificationService = NotificationService.getInstance();
      expect(a).assertNotNull();
      expect(a === b).assertTrue();
    })

    it('isEnabledReturnsBoolean', 0, async () => {
      // isEnabled 异常兜底为 false, 正常返回系统授权状态: 必须是确定布尔值.
      const enabled: boolean = await NotificationService.getInstance().isEnabled();
      expect(typeof enabled).assertEqual('boolean');
    })
  })

  describe('NotificationTemplatesTest', () => {
    it('reviewReminderZh', 0, () => {
      const text = getReviewReminderText('zh', 5);
      expect(text.title).assertEqual('复习时间到');
      expect(text.text).assertContain('5');
      expect(text.expandedText.length > 0).assertTrue();
    })

    it('reviewReminderEn', 0, () => {
      const text = getReviewReminderText('en', 3);
      expect(text.title).assertEqual('Review Time');
      expect(text.text).assertContain('3');
    })

    it('reviewReminderDe', 0, () => {
      const text = getReviewReminderText('de', 2);
      expect(text.title).assertEqual('Wiederholungszeit');
      expect(text.text).assertContain('2');
    })

    it('reviewReminderFallbackForUnknownLang', 0, () => {
      const text = getReviewReminderText('fr', 1);
      // 未知语言 fallback 到 en
      expect(text.title).assertEqual('Review Time');
    })

    it('reviewReminderZeroCount', 0, () => {
      const text = getReviewReminderText('en', 0);
      expect(text.text).assertContain('0');
    })

    it('reviewReminderNegativeCountSafe', 0, () => {
      const text = getReviewReminderText('en', -5);
      // 负数兜底为 0
      expect(text.text).assertContain('0');
    })

    it('permissionRequestZh', 0, () => {
      const text = getPermissionRequestText('zh');
      expect(text.title).assertEqual('开启复习提醒');
    })

    it('permissionRequestEn', 0, () => {
      const text = getPermissionRequestText('en');
      expect(text.title).assertEqual('Enable Review Reminders');
    })

    it('permissionRequestDe', 0, () => {
      const text = getPermissionRequestText('de');
      expect(text.title).assertEqual('Wiederholungserinnerungen aktivieren');
    })
  })

  describe('MemoryCardSchemaTest', () => {
    it('tableNameConstant', 0, () => {
      expect(TABLE_NAME).assertEqual('wordaydream_memory_cards');
    })

    it('storeNameConstant', 0, () => {
      expect(STORE_NAME).assertEqual('wordaydream_memory.db');
    })

    it('columnListHas16Fields', 0, () => {
      // 16 字段对应 Web MemoryCard 接口
      expect(COLUMN_LIST.length).assertEqual(16);
    })

    it('createTableSqlContainsAllColumns', 0, () => {
      expect(CREATE_TABLE_SQL.includes('CREATE TABLE')).assertTrue();
      expect(CREATE_TABLE_SQL.includes('id TEXT PRIMARY KEY')).assertTrue();
      expect(CREATE_TABLE_SQL.includes('due INTEGER')).assertTrue();
      expect(CREATE_TABLE_SQL.includes('stability REAL')).assertTrue();
      expect(CREATE_TABLE_SQL.includes('IF NOT EXISTS')).assertTrue();
    })

    // T21 (Stage 4): CREATE_INDEX_SQL_DUE/LAST_REVIEW/LANGUAGE 字符串正确
    it('createIndexSqlDueCorrect', 0, () => {
      expect(CREATE_INDEX_SQL_DUE.includes('CREATE INDEX IF NOT EXISTS')).assertTrue();
      expect(CREATE_INDEX_SQL_DUE.includes('idx_due')).assertTrue();
      expect(CREATE_INDEX_SQL_DUE.includes(TABLE_NAME)).assertTrue();
      expect(CREATE_INDEX_SQL_DUE.includes('(due)')).assertTrue();
    })

    it('createIndexSqlLastReviewCorrect', 0, () => {
      expect(CREATE_INDEX_SQL_LAST_REVIEW.includes('CREATE INDEX IF NOT EXISTS')).assertTrue();
      expect(CREATE_INDEX_SQL_LAST_REVIEW.includes('idx_lastReviewAt')).assertTrue();
      expect(CREATE_INDEX_SQL_LAST_REVIEW.includes(TABLE_NAME)).assertTrue();
      expect(CREATE_INDEX_SQL_LAST_REVIEW.includes('(lastReviewAt)')).assertTrue();
    })

    it('createIndexSqlLanguageCorrect', 0, () => {
      expect(CREATE_INDEX_SQL_LANGUAGE.includes('CREATE INDEX IF NOT EXISTS')).assertTrue();
      expect(CREATE_INDEX_SQL_LANGUAGE.includes('idx_language')).assertTrue();
      expect(CREATE_INDEX_SQL_LANGUAGE.includes(TABLE_NAME)).assertTrue();
      expect(CREATE_INDEX_SQL_LANGUAGE.includes('(language)')).assertTrue();
    })
  })

  describe('BridgeMethodRegistryTest', () => {
    it('registryMatchesBridgeContract', 0, () => {
      // 注册表是 ArkWeb JSProxy 的单一事实来源: 数量必须与实际实现一致
      // (sync=4 / async=16), 且无重复 / 无跨数组重名 — 漏注册是静默能力缺失.
      expect(BRIDGE_NAME).assertEqual('harmonyBridge');
      expect(BRIDGE_SYNC_METHODS.length).assertEqual(4);
      expect(BRIDGE_ASYNC_METHODS.length).assertEqual(16);

      const seen: Set<string> = new Set<string>();
      let duplicated: boolean = false;
      for (let i = 0; i < BRIDGE_SYNC_METHODS.length; i++) {
        if (seen.has(BRIDGE_SYNC_METHODS[i])) {
          duplicated = true;
        }
        seen.add(BRIDGE_SYNC_METHODS[i]);
      }
      for (let i = 0; i < BRIDGE_ASYNC_METHODS.length; i++) {
        if (seen.has(BRIDGE_ASYNC_METHODS[i])) {
          duplicated = true;
        }
        seen.add(BRIDGE_ASYNC_METHODS[i]);
      }
      expect(duplicated).assertFalse();
      expect(seen.size).assertEqual(
        BRIDGE_SYNC_METHODS.length + BRIDGE_ASYNC_METHODS.length
      );

      // 关键方法在册 (Web 端 harmonyBridge.ts / 运行验证链依赖).
      expect(BRIDGE_SYNC_METHODS.includes('notifyWebReady')).assertTrue();
      expect(BRIDGE_SYNC_METHODS.includes('triggerHapticFeedback')).assertTrue();
      expect(BRIDGE_ASYNC_METHODS.includes('getAllCards')).assertTrue();
      expect(BRIDGE_ASYNC_METHODS.includes('notifyReviewCompleted')).assertTrue();
      expect(BRIDGE_ASYNC_METHODS.includes('scheduleReviewReminder')).assertTrue();
    })
  })
}
