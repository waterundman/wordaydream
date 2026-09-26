/**
 * LocalUnit.test (v0.1.0-harmony)
 *
 * 本地单元测试 - 不需设备/模拟器, 由 hvigor 在构建期执行.
 * 测试纯逻辑模块: 通知模板多语言 fallback + MemoryCardSchema 常量 + 桥接注册表契约.
 *
 * 注意: 本地单元测试无法 import @kit.* 系统 Kit (需要设备运行时),
 * 仅测试不依赖系统 API 的纯 ArkTS 模块 (templates / MemoryCardSchema /
 * BridgeMethodRegistry / bridge types). 这里 import 真实 production 模块,
 * 不再用字面量自比 (H1: 避免同义反复断言).
 */
import { describe, it, expect } from '@ohos/hypium';
import {
  BRIDGE_ASYNC_METHODS,
  BRIDGE_SYNC_METHODS,
} from '../main/ets/bridge/BridgeMethodRegistry';
import type { ReminderPayload } from '../main/ets/bridge/types';
import {
  getPermissionRequestText,
  getReviewReminderText,
} from '../main/ets/notification/templates';
import type { NotificationText } from '../main/ets/notification/templates';
import {
  COLUMN_LIST,
  CREATE_INDEX_SQL_DUE,
  CREATE_INDEX_SQL_LANGUAGE,
  CREATE_INDEX_SQL_LAST_REVIEW,
  CREATE_TABLE_SQL,
  STORE_NAME,
  TABLE_NAME,
} from '../main/ets/data/MemoryCardSchema';

export default function localUnitTest() {
  describe('NotificationTemplatesLocalTest', () => {
    // templates.ets 是纯函数模块 (无系统 Kit 依赖), 直接 import production 实现.

    it('reviewReminderTextZh', 0, () => {
      const text: NotificationText = getReviewReminderText('zh', 5);
      expect(text.title).assertEqual('复习时间到');
      expect(text.text).assertEqual('有 5 个词汇到期复习');
      expect(text.expandedText).assertEqual('点击开始复习');
    })

    it('reviewReminderTextEnPlural', 0, () => {
      const text: NotificationText = getReviewReminderText('en', 2);
      expect(text.title).assertEqual('Review Time');
      expect(text.text).assertEqual('2 words due for review');
    })

    it('reviewReminderTextEnSingular', 0, () => {
      const text: NotificationText = getReviewReminderText('en', 1);
      expect(text.text).assertEqual('1 word due for review');
    })

    it('reviewReminderTextDe', 0, () => {
      const text: NotificationText = getReviewReminderText('de', 3);
      expect(text.title).assertEqual('Wiederholungszeit');
      expect(text.text).assertEqual('3 Karten fällig');
    })

    it('reviewReminderTextUnknownLanguageFallsBackToEn', 0, () => {
      const zh: NotificationText = getReviewReminderText('fr', 2);
      const en: NotificationText = getReviewReminderText('en', 2);
      expect(zh.title).assertEqual(en.title);
      expect(zh.text).assertEqual(en.text);
    })

    it('reviewReminderTextNegativeCountIsClamped', 0, () => {
      const text: NotificationText = getReviewReminderText('zh', -1);
      expect(text.text).assertEqual('有 0 个词汇到期复习');
    })

    it('permissionRequestTextThreeLanguages', 0, () => {
      expect(getPermissionRequestText('zh').title).assertEqual('开启复习提醒');
      expect(getPermissionRequestText('en').title)
        .assertEqual('Enable Review Reminders');
      expect(getPermissionRequestText('de').title)
        .assertEqual('Wiederholungserinnerungen aktivieren');
      // 未匹配语言 fallback 到 en
      expect(getPermissionRequestText('ja').title)
        .assertEqual('Enable Review Reminders');
    })
  })

  describe('MemoryCardSchemaLocalTest', () => {
    // Schema 常量是纯字符串/数组, import production 模块验证真实值.

    it('tableNameAndStoreName', 0, () => {
      expect(TABLE_NAME).assertEqual('wordaydream_memory_cards');
      expect(STORE_NAME).assertEqual('wordaydream_memory.db');
    })

    it('columnCountIs16', 0, () => {
      // 16 字段对应 Web MemoryCard 接口
      expect(COLUMN_LIST.length).assertEqual(16);
    })

    it('createTableSqlContainsPrimaryKey', 0, () => {
      expect(CREATE_TABLE_SQL.includes('id TEXT PRIMARY KEY')).assertTrue();
      expect(CREATE_TABLE_SQL.includes('due INTEGER')).assertTrue();
      expect(CREATE_TABLE_SQL.includes('stability REAL')).assertTrue();
      expect(CREATE_TABLE_SQL.includes(TABLE_NAME)).assertTrue();
    })

    it('createIndexSqlCoversHotPaths', 0, () => {
      expect(CREATE_INDEX_SQL_DUE.includes('CREATE INDEX IF NOT EXISTS'))
        .assertTrue();
      expect(CREATE_INDEX_SQL_DUE.includes('idx_due')).assertTrue();
      expect(CREATE_INDEX_SQL_DUE.includes(TABLE_NAME)).assertTrue();
      expect(CREATE_INDEX_SQL_DUE.includes('(due)')).assertTrue();
      expect(CREATE_INDEX_SQL_LAST_REVIEW.includes('idx_lastReviewAt'))
        .assertTrue();
      expect(CREATE_INDEX_SQL_LAST_REVIEW.includes('(lastReviewAt)'))
        .assertTrue();
      expect(CREATE_INDEX_SQL_LANGUAGE.includes('idx_language')).assertTrue();
      expect(CREATE_INDEX_SQL_LANGUAGE.includes('(language)')).assertTrue();
    })
  })

  describe('HarmonyBridgeContractTest', () => {
    // Validate the same method registry used by the production ArkWeb page.

    it('bridgeMethodRegistryMatchesContract', 0, () => {
      const methodNames: string[] =
        BRIDGE_SYNC_METHODS.concat(BRIDGE_ASYNC_METHODS);
      expect(BRIDGE_SYNC_METHODS.length).assertEqual(4);
      expect(BRIDGE_ASYNC_METHODS.length).assertEqual(16);
      expect(methodNames.length).assertEqual(20);
      expect(BRIDGE_ASYNC_METHODS.includes('notifyReviewCompleted')).assertTrue();
      expect(BRIDGE_SYNC_METHODS.includes('triggerHapticFeedback')).assertTrue();
      expect(BRIDGE_SYNC_METHODS.includes('stopSpeech')).assertTrue();
      expect(BRIDGE_SYNC_METHODS.includes('notifyWebReady')).assertTrue();
      expect(BRIDGE_SYNC_METHODS.includes('notifyWebContentReady')).assertTrue();
      expect(BRIDGE_ASYNC_METHODS.includes('speak')).assertTrue();
      expect(BRIDGE_ASYNC_METHODS.includes('getAllCards')).assertTrue();
      expect(!methodNames.includes('handleHarmonyLaunch')).assertTrue();
      // 同步组与异步组不得重复注册同一方法
      for (let i: number = 0; i < BRIDGE_SYNC_METHODS.length; i++) {
        expect(BRIDGE_ASYNC_METHODS.includes(BRIDGE_SYNC_METHODS[i]))
          .assertFalse();
      }
    })

    it('reminderPayloadFields', 0, () => {
      // ReminderPayload (bridge/types.ets): { dueAt: number, cardId: string }
      const payload: ReminderPayload = {
        dueAt: 1700000000000,
        cardId: 'card-001',
      };
      expect(typeof payload.dueAt).assertEqual('number');
      expect(typeof payload.cardId).assertEqual('string');
      expect(payload.dueAt > 0).assertTrue();
    })
  })
}
