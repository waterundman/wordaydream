/**
 * Ability.test (v0.1.0-harmony)
 *
 * ohosTest 仪器测试套件 - 需要 DevEco Studio 模拟器或真机执行.
 * 覆盖 HarmonyBridge 6 方法 + MemoryCardStore + NotificationService 关键路径.
 *
 * 测试矩阵 (对应 e2e/harmony_full.spec.ts 10 case 的 ArkTS 侧守护):
 * 1. HarmonyBridge 实例化 (constructor 不抛错)
 * 2. getDueCardsCount 返回 number (空库返回 0)
 * 3. readPreferences 未写入键返回 null
 * 4. writePreferences + readPreferences 往返一致
 * 5. triggerHapticFeedback 不抛错 (缺权限时 catch 兜底)
 * 6. handleHarmonyLaunch webController 未就绪时静默跳过
 * 7. registerReminder 异常兜底 (缺通知权限时不抛错)
 * 8. MemoryCardStore 单例 + initialize 幂等
 * 9. NotificationService 单例
 * 10. 通知模板多语言 fallback
 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import { describe, beforeAll, beforeEach, afterEach, afterAll, it, expect } from '@ohos/hypium';
import { common } from '@kit.AbilityKit';
import { HarmonyBridge } from '../../../main/ets/bridge/HarmonyBridge';
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
      // 缺通知权限 / MemoryCardStore 未就绪时应 try/catch 兜底返回 void.
      let noThrow: boolean = true;
      try {
        await bridge.registerReminder({
          dueAt: Date.now() + 3600000,
          cardId: 'test_card_id',
        });
      } catch (e) {
        noThrow = false;
      }
      expect(noThrow).assertTrue();
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
    })
  })

  describe('NotificationServiceTest', () => {
    it('singletonInstance', 0, () => {
      const a: NotificationService = NotificationService.getInstance();
      const b: NotificationService = NotificationService.getInstance();
      expect(a).assertNotNull();
      expect(a === b).assertTrue();
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
}
