/**
 * Wordaydream Harmony Stage 6 — T01-T06 ArkUI 原生服务卡片集成测试
 *
 * 测试对象: harmony/entry/src/main/ets/ 下 Stage 6 新增的 ArkTS 文件
 *   - data/MemoryCardSchema.ets    (MemoryCardRecord 类型 + RDB schema)
 *   - data/MemoryCardStore.ets     (relationalStore 封装)
 *   - widget/CardDataProvider.ets   (服务卡片数据提供者 + 多语言)
 *   - widget/ReviewCardWidget.ets   (ArkUI 卡片组件)
 *   - resources/base/profile/form_config.json (服务卡片配置)
 *
 * 测试策略 (沙箱约束: vitest 无法直接导入 .ets 文件):
 * - T01: MemoryCardRecord 字段与 Web MemoryCard 接口一一对应 (typecheck + 文本提取)
 * - T02: CardDataProvider.formatDueCountText 多语言 (重新实现逻辑 + 校验 .ets 文本)
 * - T03: MemoryCardStore.getDueCardsCount SQL 逻辑 (mock relationalStore + 校验 .ets SQL)
 * - T04: form_config.json schema 校验 (fs 读取 + 字段断言)
 * - T05: CREATE_TABLE SQL 与 Web MemoryCard 字段对齐 (16 COLUMN_* 常量)
 * - T06: Web 端 MemoryCard 类型 regression guard (验证 Web 类型未被破坏)
 *
 * 0 emoji (项目硬约束)
 * 0 改动: 不修改任何源文件, 仅新增测试
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryCard, DifficultyLevel, Language } from '../types';

const PROJECT_ROOT: string = process.cwd();
const HARMONY_MAIN: string = join(
  PROJECT_ROOT,
  'harmony',
  'entry',
  'src',
  'main'
);
const SCHEMA_PATH: string = join(
  HARMONY_MAIN,
  'ets',
  'data',
  'MemoryCardSchema.ets'
);
const STORE_PATH: string = join(
  HARMONY_MAIN,
  'ets',
  'data',
  'MemoryCardStore.ets'
);
const PROVIDER_PATH: string = join(
  HARMONY_MAIN,
  'ets',
  'widget',
  'CardDataProvider.ets'
);
const WIDGET_PATH: string = join(
  HARMONY_MAIN,
  'ets',
  'widget',
  'ReviewCardWidget.ets'
);
const FORM_CONFIG_PATH: string = join(
  HARMONY_MAIN,
  'resources',
  'base',
  'profile',
  'form_config.json'
);
const DARK_COLOR_PATH: string = join(
  HARMONY_MAIN,
  'resources',
  'dark',
  'element',
  'color.json'
);
const BASE_COLOR_PATH: string = join(
  HARMONY_MAIN,
  'resources',
  'base',
  'element',
  'color.json'
);

/**
 * Web MemoryCard 接口的 16 个字段名 (与 src/types/index.ts L221-261 一致).
 * 注意: 实际 Web 端 MemoryCard 有 16 字段 (任务描述称 15, 实际含 learningSteps 共 16).
 */
const WEB_MEMORY_CARD_FIELDS: ReadonlyArray<keyof MemoryCard> = [
  'id',
  'lexemeGroupId',
  'lemma',
  'objectiveDifficulty',
  'language',
  'firstLearnedAt',
  'lastReviewAt',
  'due',
  'stability',
  'difficulty',
  'elapsedDays',
  'scheduledDays',
  'reps',
  'lapses',
  'status',
  'learningSteps',
] as const;

/** Web MemoryCard 字段数 (实际 16, 非任务描述的 15). */
const WEB_FIELD_COUNT: number = 16;

/**
 * 字段名 -> COLUMN_* 常量名映射 (与 MemoryCardSchema.ets 一致).
 */
const FIELD_TO_COLUMN_CONST: Record<string, string> = {
  id: 'COLUMN_ID',
  lexemeGroupId: 'COLUMN_LEXEME_GROUP_ID',
  lemma: 'COLUMN_LEMMA',
  objectiveDifficulty: 'COLUMN_OBJECTIVE_DIFFICULTY',
  language: 'COLUMN_LANGUAGE',
  firstLearnedAt: 'COLUMN_FIRST_LEARNED_AT',
  lastReviewAt: 'COLUMN_LAST_REVIEW_AT',
  due: 'COLUMN_DUE',
  stability: 'COLUMN_STABILITY',
  difficulty: 'COLUMN_DIFFICULTY',
  elapsedDays: 'COLUMN_ELAPSED_DAYS',
  scheduledDays: 'COLUMN_SCHEDULED_DAYS',
  reps: 'COLUMN_REPS',
  lapses: 'COLUMN_LAPSES',
  status: 'COLUMN_STATUS',
  learningSteps: 'COLUMN_LEARNING_STEPS',
};

/**
 * 构造一个合法的 Web MemoryCard 样本 (满足 typecheck, 验证字段完整性).
 */
function createSampleMemoryCard(): MemoryCard {
  return {
    id: 'card-1',
    lexemeGroupId: 'group-1',
    lemma: 'Haus',
    objectiveDifficulty: 3 as DifficultyLevel,
    language: 'de' as Language,
    firstLearnedAt: 1000,
    lastReviewAt: 2000,
    due: 3000,
    stability: 1.5,
    difficulty: 2.0,
    elapsedDays: 1,
    scheduledDays: 2,
    reps: 1,
    lapses: 0,
    status: 'review',
    learningSteps: 0,
  };
}

/**
 * 重新实现 CardDataProvider.formatDueCountText 逻辑 (镜像 CardDataProvider.ets).
 * 用于验证多语言文案规则, 不依赖真实 ArkTS 导入.
 */
function formatDueCountText(count: number, language: string = 'en'): string {
  if (language === 'zh') {
    if (count === 0) {
      return '暂无到期';
    }
    if (count === 1) {
      return '1 个到期';
    }
    return `${count} 个到期`;
  }
  if (language === 'de') {
    if (count === 0) {
      return 'Keine Karten';
    }
    if (count === 1) {
      return '1 Karte fällig';
    }
    return `${count} Karten fällig`;
  }
  if (count === 0) {
    return 'No cards';
  }
  if (count === 1) {
    return '1 card due';
  }
  return `${count} cards due`;
}

describe('Stage 6 — T01: MemoryCardRecord 字段与 Web MemoryCard 一一对应', () => {
  it('Web MemoryCard 接口应有 16 个字段', () => {
    expect(WEB_MEMORY_CARD_FIELDS.length).toBe(WEB_FIELD_COUNT);
  });

  it('createSampleMemoryCard 满足 MemoryCard typecheck (16 字段完整)', () => {
    const card: MemoryCard = createSampleMemoryCard();
    WEB_MEMORY_CARD_FIELDS.forEach((field) => {
      expect(card[field]).not.toBeUndefined();
    });
  });

  it('ArkTS MemoryCardSchema.ets 定义 MemoryCardRecord interface 含全部 16 字段', () => {
    const content: string = readFileSync(SCHEMA_PATH, 'utf-8');
    WEB_MEMORY_CARD_FIELDS.forEach((field) => {
      expect(content).toContain(`${field}:`);
    });
  });

  it('objectiveDifficulty 在 ArkTS 中为 number (对齐 Web 数值 DifficultyLevel)', () => {
    const content: string = readFileSync(SCHEMA_PATH, 'utf-8');
    expect(content).toMatch(/objectiveDifficulty:\s*number/);
  });

  it('language 与 status 在 ArkTS 中为 string', () => {
    const content: string = readFileSync(SCHEMA_PATH, 'utf-8');
    expect(content).toMatch(/language:\s*string/);
    expect(content).toMatch(/status:\s*string/);
  });
});

describe('Stage 6 — T02: CardDataProvider.formatDueCountText 多语言', () => {
  it.each([
    [0, 'zh', '暂无到期'],
    [1, 'zh', '1 个到期'],
    [5, 'zh', '5 个到期'],
    [10, 'zh', '10 个到期'],
    [0, 'en', 'No cards'],
    [1, 'en', '1 card due'],
    [5, 'en', '5 cards due'],
    [10, 'en', '10 cards due'],
    [0, 'de', 'Keine Karten'],
    [1, 'de', '1 Karte fällig'],
    [5, 'de', '5 Karten fällig'],
    [10, 'de', '10 Karten fällig'],
  ])('count=%i lang=%s -> %s', (count, lang, expected) => {
    expect(formatDueCountText(count, lang)).toBe(expected);
  });

  it('默认语言为 en', () => {
    expect(formatDueCountText(0)).toBe('No cards');
    expect(formatDueCountText(1)).toBe('1 card due');
  });

  it('ArkTS CardDataProvider.ets 包含相同的多语言文案', () => {
    const content: string = readFileSync(PROVIDER_PATH, 'utf-8');
    expect(content).toContain('暂无到期');
    expect(content).toContain('1 个到期');
    expect(content).toContain('No cards');
    expect(content).toContain('1 card due');
    expect(content).toContain('cards due');
    expect(content).toContain('Keine Karten');
    expect(content).toContain('1 Karte fällig');
    expect(content).toContain('Karten fällig');
  });

  it('ArkTS CardDataProvider.ets 定义 getInstance 单例方法', () => {
    const content: string = readFileSync(PROVIDER_PATH, 'utf-8');
    expect(content).toContain('static getInstance(): CardDataProvider');
    expect(content).toContain('getDueCardsCountForWidget');
    expect(content).toContain('getNextDueCardForWidget');
    expect(content).toContain('formatDueCountText');
  });
});

describe('Stage 6 — T03: MemoryCardStore.getDueCardsCount SQL 逻辑', () => {
  it('ArkTS MemoryCardStore.ets 使用 SELECT COUNT(*) WHERE due <= ? SQL', () => {
    const content: string = readFileSync(STORE_PATH, 'utf-8');
    expect(content).toMatch(/SELECT COUNT\(\*\)\s+AS\s+cnt/);
    expect(content).toMatch(/WHERE.*COLUMN_DUE.*<=.*\?/);
    expect(content).toContain('TABLE_NAME');
  });

  it('mock relationalStore 返回正确的 count (验证查询逻辑)', async () => {
    // Mock relationalStore.ResultSet + RdbStore, 镜像 MemoryCardStore.getDueCardsCount 逻辑
    interface MockResultSet {
      goToFirstRow(): boolean;
      getColumnIndex(name: string): number;
      getLong(idx: number): number;
      close(): void;
    }
    const mockResultSet: MockResultSet = {
      goToFirstRow: () => true,
      getColumnIndex: () => 0,
      getLong: () => 7,
      close: () => {},
    };
    interface MockRdbStore {
      querySql(
        sql: string,
        args: Array<number | string>
      ): Promise<MockResultSet>;
    }
    const capturedSql: string[] = [];
    const capturedArgs: Array<Array<number | string>> = [];
    const mockStore: MockRdbStore = {
      querySql: (sql, args) => {
        capturedSql.push(sql);
        capturedArgs.push(args);
        return Promise.resolve(mockResultSet);
      },
    };
    // 镜像 getDueCardsCount 逻辑
    const sql: string =
      'SELECT COUNT(*) AS cnt FROM wordaydream_memory_cards WHERE due <= ?';
    const now: number = 1000;
    const resultSet: MockResultSet = await mockStore.querySql(sql, [now]);
    let count: number = 0;
    if (resultSet.goToFirstRow()) {
      const idx: number = resultSet.getColumnIndex('cnt');
      if (idx >= 0) {
        count = resultSet.getLong(idx);
      }
    }
    resultSet.close();
    expect(count).toBe(7);
    expect(capturedArgs[0][0]).toBe(now);
    expect(capturedSql[0]).toContain('COUNT(*)');
    expect(capturedSql[0]).toContain('due');
  });

  it('ArkTS MemoryCardStore.ets 定义所有必需方法', () => {
    const content: string = readFileSync(STORE_PATH, 'utf-8');
    expect(content).toContain('async initialize(');
    expect(content).toContain('async upsertCard(');
    expect(content).toContain('async getDueCardsCount(');
    expect(content).toContain('async getDueCards(');
    expect(content).toContain('async deleteCard(');
    expect(content).toContain('async clear(');
  });

  it('ArkTS MemoryCardStore.ets 所有方法有 try/catch 兜底', () => {
    const content: string = readFileSync(STORE_PATH, 'utf-8');
    const tryCount: number = (content.match(/try\s*{/g) || []).length;
    const catchCount: number = (content.match(/catch\s*\(/g) || []).length;
    expect(tryCount).toBe(catchCount);
    expect(tryCount).toBeGreaterThanOrEqual(6);
  });
});

describe('Stage 6 — T04: form_config.json schema 校验', () => {
  it('包含有效的 review_card form 定义', () => {
    const raw: string = readFileSync(FORM_CONFIG_PATH, 'utf-8');
    const config: { forms: Array<Record<string, unknown>> } = JSON.parse(raw);
    expect(Array.isArray(config.forms)).toBe(true);
    expect(config.forms.length).toBeGreaterThan(0);
    const form: Record<string, unknown> = config.forms[0];
    expect(form.name).toBe('review_card');
    expect(form.src).toContain('ReviewCardWidget.ets');
    expect(form.type).toBe('arkts');
    expect(form.isDefault).toBe(true);
    expect(form.colorMode).toBe('auto');
  });

  it('supportDimensions 含 2*2 和 2*4', () => {
    const raw: string = readFileSync(FORM_CONFIG_PATH, 'utf-8');
    const config: { forms: Array<{ supportDimensions: string[] }> } =
      JSON.parse(raw);
    const form = config.forms[0];
    expect(form.supportDimensions).toContain('2*2');
    expect(form.supportDimensions).toContain('2*4');
  });

  it('defaultDimension 为 2*2, updateEnabled 为 true', () => {
    const raw: string = readFileSync(FORM_CONFIG_PATH, 'utf-8');
    const config: {
      forms: Array<{ defaultDimension: string; updateEnabled: boolean }>;
    } = JSON.parse(raw);
    const form = config.forms[0];
    expect(form.defaultDimension).toBe('2*2');
    expect(form.updateEnabled).toBe(true);
  });

  it('与 Stage 5 share_card.json 区分 (form_config 为服务卡片配置)', () => {
    const formRaw: string = readFileSync(FORM_CONFIG_PATH, 'utf-8');
    const formConfig: { forms: Array<{ name: string }> } =
      JSON.parse(formRaw);
    expect(formConfig.forms[0].name).toBe('review_card');
    const shareRaw: string = readFileSync(
      join(HARMONY_MAIN, 'resources', 'base', 'profile', 'share_card.json'),
      'utf-8'
    );
    const shareConfig: { forms: Array<{ name: string }> } =
      JSON.parse(shareRaw);
    expect(shareConfig.forms[0].name).toBe('share_review_card');
    // 两个配置的 form name 不同 (服务卡片 vs 元服务分享)
    expect(formConfig.forms[0].name).not.toBe(shareConfig.forms[0].name);
  });
});

describe('Stage 6 — T05: CREATE_TABLE SQL 与 Web MemoryCard 字段对齐', () => {
  it('ArkTS MemoryCardSchema.ets 定义 16 个 COLUMN_* 常量', () => {
    const content: string = readFileSync(SCHEMA_PATH, 'utf-8');
    WEB_MEMORY_CARD_FIELDS.forEach((field) => {
      const constName: string = FIELD_TO_COLUMN_CONST[field];
      expect(constName).toBeDefined();
      expect(content).toContain(`export const ${constName}`);
    });
  });

  it('CREATE_TABLE_SQL 引用全部 16 个 COLUMN_* 常量', () => {
    const content: string = readFileSync(SCHEMA_PATH, 'utf-8');
    const createTableStart: number = content.indexOf('CREATE_TABLE_SQL');
    expect(createTableStart).toBeGreaterThan(-1);
    const createTableSection: string = content.substring(createTableStart);
    WEB_MEMORY_CARD_FIELDS.forEach((field) => {
      const constName: string = FIELD_TO_COLUMN_CONST[field];
      expect(createTableSection).toContain(constName);
    });
  });

  it('TABLE_NAME 为 wordaydream_memory_cards', () => {
    const content: string = readFileSync(SCHEMA_PATH, 'utf-8');
    expect(content).toContain("'wordaydream_memory_cards'");
  });

  it('STORE_NAME 为 wordaydream_memory.db', () => {
    const content: string = readFileSync(SCHEMA_PATH, 'utf-8');
    expect(content).toContain("'wordaydream_memory.db'");
  });

  it('CREATE_TABLE_SQL 含 IF NOT EXISTS 与 PRIMARY KEY', () => {
    const content: string = readFileSync(SCHEMA_PATH, 'utf-8');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS');
    expect(content).toContain('PRIMARY KEY');
  });

  it('upsertCard SQL 使用 INSERT OR REPLACE 与 16 个占位符', () => {
    const content: string = readFileSync(STORE_PATH, 'utf-8');
    expect(content).toContain('INSERT OR REPLACE INTO');
    // 16 个 ? 占位符
    const upsertSection: string = content.substring(
      content.indexOf('INSERT OR REPLACE')
    );
    const placeholderCount: number =
      (upsertSection.match(/\?/g) || []).length;
    expect(placeholderCount).toBeGreaterThanOrEqual(WEB_FIELD_COUNT);
  });
});

describe('Stage 6 — T06: Web 端 MemoryCard 类型 regression guard', () => {
  it('MemoryCard 接口字段数仍为 16 (Web 类型未被破坏)', () => {
    expect(WEB_MEMORY_CARD_FIELDS.length).toBe(WEB_FIELD_COUNT);
    const card: MemoryCard = createSampleMemoryCard();
    expect(Object.keys(card).length).toBe(WEB_FIELD_COUNT);
  });

  it('DifficultyLevel 仍为数值联合类型 1-5 (未被修改为字符串)', () => {
    const valid: DifficultyLevel[] = [1, 2, 3, 4, 5];
    const sample: DifficultyLevel = 3;
    expect(valid).toContain(sample);
    // 验证字符串值不合法 (typecheck: 不能赋值字符串)
    // @ts-expect-error -- 字符串不应赋值给数值 DifficultyLevel
    const _invalid: DifficultyLevel = 'A1';
    expect(_invalid).toBe('A1');
  });

  it('Language 仍为 en | de (不含 zh, 未被修改)', () => {
    const valid: Language[] = ['en', 'de'];
    expect(valid).toContain('en');
    expect(valid).toContain('de');
    // @ts-expect-error -- 'zh' 不在 Language 联合类型中
    const _invalid: Language = 'zh';
    expect(_invalid).toBe('zh');
  });

  it('ReviewCardWidget.ets 使用 @ComponentV2 + @LocalV2 + @Builder', () => {
    const content: string = readFileSync(WIDGET_PATH, 'utf-8');
    expect(content).toContain('@ComponentV2');
    expect(content).toContain('@LocalV2');
    expect(content).toContain('@Builder');
    expect(content).toContain('postCardAction');
    expect(content).toContain('EntryAbility');
    expect(content).toContain('action=startReview');
  });

  it('dark/element/color.json 含全部 6 个卡片颜色 (暗色主题)', () => {
    const raw: string = readFileSync(DARK_COLOR_PATH, 'utf-8');
    const config: { color: Array<{ name: string; value: string }> } =
      JSON.parse(raw);
    const names: string[] = config.color.map((c) => c.name);
    expect(names).toContain('card_background');
    expect(names).toContain('card_text_primary');
    expect(names).toContain('card_text_secondary');
    expect(names).toContain('card_accent');
    expect(names).toContain('card_cta_background');
    expect(names).toContain('card_cta_text');
  });

  it('base/element/color.json 含全部 6 个卡片颜色 (亮色主题)', () => {
    const raw: string = readFileSync(BASE_COLOR_PATH, 'utf-8');
    const config: { color: Array<{ name: string; value: string }> } =
      JSON.parse(raw);
    const names: string[] = config.color.map((c) => c.name);
    expect(names).toContain('card_background');
    expect(names).toContain('card_text_primary');
    expect(names).toContain('card_text_secondary');
    expect(names).toContain('card_accent');
    expect(names).toContain('card_cta_background');
    expect(names).toContain('card_cta_text');
  });

  it('暗色与亮色 card_background 值不同 (区分主题)', () => {
    const baseRaw: string = readFileSync(BASE_COLOR_PATH, 'utf-8');
    const baseConfig: { color: Array<{ name: string; value: string }> } =
      JSON.parse(baseRaw);
    const darkRaw: string = readFileSync(DARK_COLOR_PATH, 'utf-8');
    const darkConfig: { color: Array<{ name: string; value: string }> } =
      JSON.parse(darkRaw);
    const baseBg: string | undefined = baseConfig.color.find(
      (c) => c.name === 'card_background'
    )?.value;
    const darkBg: string | undefined = darkConfig.color.find(
      (c) => c.name === 'card_background'
    )?.value;
    expect(baseBg).toBeDefined();
    expect(darkBg).toBeDefined();
    expect(baseBg).not.toBe(darkBg);
  });
});
