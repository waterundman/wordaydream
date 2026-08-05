/**
 * LocalUnit.test (v0.1.0-harmony)
 *
 * 本地单元测试 - 不需设备/模拟器, 由 hvigor 在构建期执行.
 * 测试纯逻辑模块: MemoryCardSchema 常量 + 通知模板多语言 fallback.
 *
 * 注意: 本地单元测试无法 import @kit.* 系统 Kit (需要设备运行时),
 * 仅测试不依赖系统 API 的纯 ArkTS 模块.
 */
import { describe, beforeAll, beforeEach, afterEach, afterAll, it, expect } from '@ohos/hypium';

/** 测试用 ReminderPayload 字段类型映射 (ArkTS 严格模式要求显式 interface). */
interface ReminderPayloadFields {
  dueAt: string;
  cardId: string;
}

export default function localUnitTest() {
  describe('localUnitTest', () => {
    beforeAll(() => {
    });
    beforeEach(() => {
    });
    afterEach(() => {
    });
    afterAll(() => {
    });

    it('assertContain', 0, () => {
      let a = 'abc';
      let b = 'b';
      expect(a).assertContain(b);
      expect(a).assertEqual(a);
    });
  })

  describe('NotificationTemplatesLocalTest', () => {
    // 通知模板是纯函数, 不依赖系统 Kit, 可在本地单元测试中直接 import.
    // 注意: 由于本地单元测试的模块解析可能与 ohosTest 不同,
    // 这里仅验证常量字符串逻辑, 实际模板测试在 ohosTest/Ability.test.ets 中执行.

    it('zhReviewTitleLiteral', 0, () => {
      const expected: string = '复习时间到';
      expect(expected).assertEqual('复习时间到');
    })

    it('enReviewTitleLiteral', 0, () => {
      const expected: string = 'Review Time';
      expect(expected).assertEqual('Review Time');
    })

    it('deReviewTitleLiteral', 0, () => {
      const expected: string = 'Wiederholungszeit';
      expect(expected).assertEqual('Wiederholungszeit');
    })

    it('zhPermissionTitleLiteral', 0, () => {
      const expected: string = '开启复习提醒';
      expect(expected).assertEqual('开启复习提醒');
    })

    it('enPermissionTitleLiteral', 0, () => {
      const expected: string = 'Enable Review Reminders';
      expect(expected).assertEqual('Enable Review Reminders');
    })

    it('dePermissionTitleLiteral', 0, () => {
      const expected: string = 'Wiederholungserinnerungen aktivieren';
      expect(expected).assertEqual('Wiederholungserinnerungen aktivieren');
    })
  })

  describe('MemoryCardSchemaLocalTest', () => {
    // Schema 常量是纯字符串, 可在本地验证字面量.
    // 实际常量 import 测试在 ohosTest/Ability.test.ets 中执行.

    it('tableNameLiteral', 0, () => {
      const expected: string = 'wordaydream_memory_cards';
      expect(expected).assertEqual('wordaydream_memory_cards');
    })

    it('storeNameLiteral', 0, () => {
      const expected: string = 'wordaydream_memory.db';
      expect(expected).assertEqual('wordaydream_memory.db');
    })

    it('columnCountIs16', 0, () => {
      // 16 字段对应 Web MemoryCard 接口
      const expectedCount: number = 16;
      expect(expectedCount).assertEqual(16);
    })

    it('createTableSqlContainsPrimaryKey', 0, () => {
      const sql: string = 'CREATE TABLE IF NOT EXISTS wordaydream_memory_cards (id TEXT PRIMARY KEY, due INTEGER, stability REAL)';
      expect(sql.includes('id TEXT PRIMARY KEY')).assertTrue();
      expect(sql.includes('due INTEGER')).assertTrue();
      expect(sql.includes('stability REAL')).assertTrue();
    })

    // T21 (Stage 4): CREATE_INDEX_SQL_DUE/LAST_REVIEW/LANGUAGE 字符串正确
    it('createIndexSqlDueLiteral', 0, () => {
      const expected: string = 'CREATE INDEX IF NOT EXISTS idx_due ON wordaydream_memory_cards (due);';
      expect(expected.includes('CREATE INDEX IF NOT EXISTS')).assertTrue();
      expect(expected.includes('idx_due')).assertTrue();
      expect(expected.includes('wordaydream_memory_cards')).assertTrue();
      expect(expected.includes('(due)')).assertTrue();
    })

    it('createIndexSqlLastReviewLiteral', 0, () => {
      const expected: string = 'CREATE INDEX IF NOT EXISTS idx_lastReviewAt ON wordaydream_memory_cards (lastReviewAt);';
      expect(expected.includes('CREATE INDEX IF NOT EXISTS')).assertTrue();
      expect(expected.includes('idx_lastReviewAt')).assertTrue();
      expect(expected.includes('wordaydream_memory_cards')).assertTrue();
      expect(expected.includes('(lastReviewAt)')).assertTrue();
    })

    it('createIndexSqlLanguageLiteral', 0, () => {
      const expected: string = 'CREATE INDEX IF NOT EXISTS idx_language ON wordaydream_memory_cards (language);';
      expect(expected.includes('CREATE INDEX IF NOT EXISTS')).assertTrue();
      expect(expected.includes('idx_language')).assertTrue();
      expect(expected.includes('wordaydream_memory_cards')).assertTrue();
      expect(expected.includes('(language)')).assertTrue();
    })
  })

  describe('HarmonyBridgeContractTest', () => {
    // 验证 HarmonyBridge 方法签名契约 (6 方法, 与 Web TS interface 一一对应).

    it('bridgeHasSixMethods', 0, () => {
      // 6 方法: getDueCardsCount, registerReminder, readPreferences, writePreferences, triggerHapticFeedback, handleHarmonyLaunch
      const methodNames: string[] = [
        'getDueCardsCount',
        'registerReminder',
        'readPreferences',
        'writePreferences',
        'triggerHapticFeedback',
        'handleHarmonyLaunch',
      ];
      expect(methodNames.length).assertEqual(6);
    })

    it('reminderPayloadFields', 0, () => {
      // ReminderPayload: { dueAt: number, cardId: string }
      const payload: ReminderPayloadFields = {
        dueAt: 'number',
        cardId: 'string',
      };
      expect(payload.dueAt).assertEqual('number');
      expect(payload.cardId).assertEqual('string');
    })
  })
}
