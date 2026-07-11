/**
 * v1.5.0 Stage 2: 10 fixture 集中注册表 (P1_1 集成扩展兑现)
 *
 * 5 沿用 v1.2.0 (success / broken-json / missing-fields / fuzzy-offsets / throw-network)
 * 5 NEW v1.5.0 (german-fail / chinese-mixed / japanese-kanji / spanish-accents / french-elisions)
 *
 * 用途 (集成测试 passage-full-pipeline.test.tsx):
 *   import { FIXTURE_CATALOG, ALL_FIXTURES, NEW_FIXTURES_V150 } from '../__fixtures__';
 *   describe.each(ALL_FIXTURES)('$kind', ({ kind, expectedStatus, expectedTokenCount }) => { ... });
 *
 * 字段:
 * - kind:               MockFixture['kind'], 用作 setFixture({ kind }) 切换
 * - description:        人类可读的 fixture 描述 (供 test 报告 / 调试输出)
 * - expectedStatus:     alignment 期望状态 (perfect / corrected / fallback / dropped)
 * - expectedTokenCount: 期望 token 数量 (NEW 5 fixture 都是 9, 与 v1.2.0 默认一致)
 * - isNewInV150:        v1.5.0 Stage 2 新增标记, NEW_FIXTURES_V150 过滤器依赖此字段
 */

import type { MockFixture } from '../features/llm/services/mockProvider';

export type FixtureKind = MockFixture['kind'];

/**
 * alignment 期望状态 (与 alignmentValidator.AlignmentStatus 对齐)
 *
 * - perfect:   LLM 原 offset 严格匹配, 零修改
 * - corrected: 原 offset 不完美, 但 fuzzy / case 校正后 OK
 * - fallback:  原 offset 完全无效, 改用 text.indexOf 找第一个匹配
 * - dropped:   完全找不到 surfaceForm, 不进入渲染
 */
export type ExpectedAlignmentStatus = 'perfect' | 'corrected' | 'fallback' | 'dropped';

export interface FixtureEntry {
  kind: FixtureKind;
  description: string;
  expectedStatus: ExpectedAlignmentStatus;
  expectedTokenCount: number;
  isNewInV150?: boolean;
}

/**
 * 10 fixture 完整目录 — 单一事实源
 *
 * 5 基础 (v1.2.0): success / broken-json / missing-fields / fuzzy-offsets / throw-network
 * 5 NEW (v1.5.0): german-fail / chinese-mixed / japanese-kanji / spanish-accents / french-elisions
 *
 * 期望状态说明:
 * - success:        perfect (offset 严格对齐)
 * - broken-json:    perfect (jsonrepair 修复后 offset 仍 valid)
 * - missing-fields: fallback (zod 校验失败, generatePassageViaLLM 返回 null, mock fallback 触发)
 * - fuzzy-offsets:  corrected (offset 漂移 1 字符, fuzzy match 校正)
 * - throw-network:  fallback (网络异常, mock fallback 触发)
 * - 5 NEW v1.5.0:   perfect (offset 严格对齐, 多语种字符处理验证)
 */
export const FIXTURE_CATALOG: Record<FixtureKind, FixtureEntry> = {
  'success':         { kind: 'success',         description: '合法 JSON + 完美 offset (英文)',            expectedStatus: 'perfect',   expectedTokenCount: 9 },
  'broken-json':     { kind: 'broken-json',     description: 'markdown 包裹 + jsonrepair 修复',            expectedStatus: 'perfect',   expectedTokenCount: 9 },
  'missing-fields':  { kind: 'missing-fields',  description: '空 JSON + mock fallback 触发',               expectedStatus: 'fallback',  expectedTokenCount: 9 },
  'fuzzy-offsets':   { kind: 'fuzzy-offsets',   description: 'offset 偏移 1 字符 + fuzzy 校正',            expectedStatus: 'corrected', expectedTokenCount: 9 },
  'throw-network':   { kind: 'throw-network',   description: '网络异常 + router retry + mock fallback',     expectedStatus: 'fallback',  expectedTokenCount: 9 },
  'german-fail':     { kind: 'german-fail',     description: '德文段落 (v1.2.0 Stage 5 失败样本)',         expectedStatus: 'perfect',   expectedTokenCount: 9, isNewInV150: true },
  'chinese-mixed':   { kind: 'chinese-mixed',   description: '中英混合段落 (utf-8 多字节 + 跨语言)',       expectedStatus: 'perfect',   expectedTokenCount: 9, isNewInV150: true },
  'japanese-kanji':  { kind: 'japanese-kanji',  description: '日文汉字段落 (Kanji + Hiragana 混合)',     expectedStatus: 'perfect',   expectedTokenCount: 9, isNewInV150: true },
  'spanish-accents': { kind: 'spanish-accents', description: '西语重音段落 (á/é/í/ó/ú/ñ alignment)',     expectedStatus: 'perfect',   expectedTokenCount: 9, isNewInV150: true },
  'french-elisions': { kind: 'french-elisions', description: '法语省音段落 (l\'/d\'/qu\' + 撇号处理)',  expectedStatus: 'perfect',   expectedTokenCount: 9, isNewInV150: true },
};

/**
 * 10 fixture 列表 (供 describe.each 遍历)
 *
 * 顺序遵循 FIXTURE_CATALOG 的 declaration order (5 基础在前, 5 NEW 在后),
 * 让 describe 输出稳定 + 报告易读.
 */
export const ALL_FIXTURES: FixtureEntry[] = Object.values(FIXTURE_CATALOG);

/**
 * 5 NEW v1.5.0 fixture 列表 (供 passage-full-pipeline.test.tsx T06-T10 使用)
 *
 * 过滤规则: isNewInV150 === true
 *
 * 用法:
 *   import { NEW_FIXTURES_V150 } from '../__fixtures__';
 *   describe.each(NEW_FIXTURES_V150)('$kind (v1.5.0 NEW)', ({ kind, expectedStatus, expectedTokenCount }) => {
 *     it(`T${idx} [v1.5.0 critical]: ${kind} 跨方向 pipeline`, async () => { ... });
 *   });
 */
export const NEW_FIXTURES_V150: FixtureEntry[] = ALL_FIXTURES.filter((f) => f.isNewInV150 === true);

/**
 * 5 基础 v1.2.0 fixture 列表 (向后兼容旧测试, 0 breaking change)
 */
export const LEGACY_FIXTURES_V120: FixtureEntry[] = ALL_FIXTURES.filter((f) => f.isNewInV150 !== true);
