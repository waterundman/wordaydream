/**
 * v1.6.4 Stage 2 (S2) T14: N1-N9 质量闸门单测 (正例 / 反例各一).
 *
 * 为什么必须有这条测试:
 *   `verify-wordlists.smoke.test.mjs` 只断言「脚本可跑且退出码 0」—— 它能抓到脚本崩溃,
 *   但**抓不到闸门失效**(例如把阈值写成 0、把 BLOCK 分支删掉、把豁免做成静默通过)。
 *   本文件直接调用纯函数 (checkN1..checkN9 + evaluateGate), 用**构造数据**钉住三态语义:
 *     PASS   = 达标
 *     EXEMPT = 未达标但在豁免清单内且未超基线 (必须打印理由, 不静默)
 *     BLOCK  = 未达标且无豁免 / 超基线  → 阻断 exit 1
 *
 * 口径: 不读真实词表 (真实数据的现状由 smoke 测试 + `npm run verify:wordlists` 负责),
 *       只验证**判定逻辑**本身, 因此数据清理不会让本文件变成需要同步维护的噪音。
 */
import { describe, expect, it } from 'vitest';
import {
  checkN1Coverage,
  checkN2Translations,
  checkN3CrossLevelDuplicates,
  checkN4SameLevelSamePosDuplicates,
  checkN5ExampleReuse,
  checkN6WeakHits,
  checkN7UnknownSources,
  checkN8CourseMembership,
  checkN9CrossModuleDuplicates,
  collectPriority1Gaps,
  evaluateGate,
  LESSON_LEMMA_COUNT,
  N1_COVERAGE_MIN,
  N6_WEAK_RATIO_MAX,
  N7_UNKNOWN_RATIO_MAX,
  parseCourseLessons,
} from './verify-wordlists.mjs';

const ex = (lemma, translation = '释义', extra = {}) => ({
  lemma,
  pos: 'noun',
  translation,
  cefr: 'A1',
  example: `The ${lemma} is here.`,
  exampleTranslation: `${translation}在这里。`,
  exampleSource: 'tatoeba:1',
  ...extra,
});

describe('T14 [N1-N9 闸门] v1.6.4 Stage 2', () => {
  it('T14-N1 正例/反例: 覆盖率达标 PASS; 未达标且无豁免 BLOCK; 有豁免不超基线 EXEMPT', () => {
    // 正例: 10 条里 9 条有例句 (90% >= 80%), priority=1 全部有例句
    const okWords = [...Array(10)].map((_, i) =>
      i === 0 ? { lemma: 'x', pos: 'noun', translation: '释义', priority: 1 } : ex(`w${i}`, '释义', { priority: 1 })
    );
    const ok = checkN1Coverage(okWords);
    expect(ok.coverage).toBeGreaterThanOrEqual(N1_COVERAGE_MIN);
    expect(evaluateGate({ check: 'N1', scope: 'x', ok: true, violations: 0 }).status).toBe('PASS');

    // 反例: 全无例句 + 无豁免 → BLOCK
    const bad = checkN1Coverage([{ lemma: 'x', pos: 'noun', translation: '释义', priority: 1 }]);
    expect(bad.uncovered).toBe(1);
    const blocked = evaluateGate({ check: 'N1', scope: 'x', ok: false, violations: bad.uncovered });
    expect(blocked.status).toBe('BLOCK');
    expect(blocked.blocking).toBe(true);

    // 反例 2: 有豁免但缺口扩大 (1 > 基线 0) → BLOCK
    expect(
      evaluateGate({
        check: 'N1',
        scope: 'de/a2.json',
        ok: false,
        violations: 1,
        exempt: { baseline: 0, reason: '待 S3 例句回填' },
      }).blocking
    ).toBe(true);
    // 正例 3: 有豁免且未超基线 → EXEMPT (不阻断, 但必须带理由)
    const exempt = evaluateGate({
      check: 'N1',
      scope: 'de/a2.json',
      ok: false,
      violations: 0,
      exempt: { baseline: 797, reason: '待 S3 例句回填' },
    });
    expect(exempt.status).toBe('EXEMPT');
    expect(exempt.blocking).toBe(false);
    expect(exempt.detail).toContain('待 S3 例句回填');
  });

  it('T14-N1b 附属: priority=1 缺例句清单由数据现算 (不硬编码快照)', () => {
    // 只列出真有缺口的等级; priority!=1 缺例句不算缺口 (N1 只对 p1 卡 95%)
    const gaps = collectPriority1Gaps([
      {
        key: 'en/b1',
        words: [
          { lemma: 'alpha', priority: 1 },
          ex('beta', '释义', { priority: 1 }),
          { lemma: 'gamma', priority: 2 },
        ],
      },
      { key: 'en/b2', words: [ex('delta', '释义', { priority: 1 })] },
    ]);
    expect(gaps).toEqual([{ key: 'en/b1', lemmas: ['alpha'] }]);

    // 缺口补齐后自动消失 (S3 回填后报告不会残留旧快照)
    expect(collectPriority1Gaps([{ key: 'en/b1', words: [ex('alpha', '释义', { priority: 1 })] }])).toEqual([]);
  });

  it('T14-N2 正例/反例: 非空 + 含 CJK + trim 一致', () => {
    // 正例
    expect(checkN2Translations([ex('a', '一个'), ex('b', '包/袋子')]).total).toBe(0);
    expect(evaluateGate({ check: 'N2', scope: 'x', ok: true, violations: 0 }).status).toBe('PASS');

    // 反例: 空白 / 纯英文 / 前导空格 各 1 条
    const r = checkN2Translations([ex('a', '   '), ex('b', 'bag'), ex('c', ' 包')]);
    expect(r).toMatchObject({ blank: 1, noCjk: 1, untrimmed: 1, total: 3 });
    expect(evaluateGate({ check: 'N2', scope: 'x', ok: false, violations: r.total }).status).toBe('BLOCK');
  });

  it('T14-N3 正例/反例: 跨等级重复 lemma', () => {
    // 正例: 各等级互不重叠
    const clean = checkN3CrossLevelDuplicates([
      { key: 'a1', words: [ex('alpha')] },
      { key: 'a2', words: [ex('beta')] },
    ]);
    expect(clean.entryCount).toBe(0);
    expect(evaluateGate({ check: 'N3', scope: 'en', ok: true, violations: 0 }).status).toBe('PASS');

    // 反例: 同一 lemma 出现在 A1 + A2 (2 条) → 无豁免即 BLOCK
    const dup = checkN3CrossLevelDuplicates([
      { key: 'a1', words: [ex('result')] },
      { key: 'a2', words: [ex('result')] },
    ]);
    expect(dup).toMatchObject({ lemmaCount: 1, entryCount: 2 });
    expect(evaluateGate({ check: 'N3', scope: 'en', ok: false, violations: dup.entryCount }).status).toBe('BLOCK');
    // 有豁免且未超基线 → EXEMPT
    expect(
      evaluateGate({
        check: 'N3',
        scope: 'en',
        ok: false,
        violations: dup.entryCount,
        exempt: { baseline: 719, reason: '分级词表既有设计' },
      }).status
    ).toBe('EXEMPT');
  });

  it('T14-N4 正例/反例: 同等级同 pos 重复 (声明与否)', () => {
    // 正例: 同 lemma + 同 pos 但已用自指 semanticConflicts 声明为同形异义 → 不计
    const declared = checkN4SameLevelSamePosDuplicates([
      { lemma: 'ihr', pos: 'pron', translation: '你们', semanticConflicts: ['ihr'] },
      { lemma: 'ihr', pos: 'pron', translation: '她的', semanticConflicts: ['ihr'] },
    ]);
    expect(declared.count).toBe(0);
    expect(evaluateGate({ check: 'N4', scope: 'de/a1.json', ok: true, violations: 0 }).status).toBe('PASS');

    // 反例: 同 lemma + 同 pos 未声明 → BLOCK
    const undeclared = checkN4SameLevelSamePosDuplicates([
      { lemma: 'Computer', pos: 'noun', translation: '电脑' },
      { lemma: 'Computer', pos: 'noun', translation: '电脑' },
    ]);
    expect(undeclared.count).toBe(1);
    expect(evaluateGate({ check: 'N4', scope: 'de/a1.json', ok: false, violations: undeclared.count }).status).toBe(
      'BLOCK'
    );
  });

  it('T14-N5 正例/反例: 例句跨词复用', () => {
    // 正例: 各词例句互不相同
    const clean = checkN5ExampleReuse([
      { key: 'en:a1', words: [ex('alpha'), { ...ex('beta'), example: 'Other beta sentence.', exampleTranslation: '另一句。' }] },
    ]);
    expect(clean.groups).toBe(0);
    expect(evaluateGate({ check: 'N5', scope: 'global', ok: true, violations: 0 }).status).toBe('PASS');

    // 反例: 同句被 2 个词引用 → BLOCK (无豁免)
    const reuse = checkN5ExampleReuse([
      { key: 'en:a1', words: [ex('good'), ex('morning')] },
      { key: 'en:a2', words: [ex('good')] },
    ]);
    expect(reuse.groups).toBe(1);
    expect(evaluateGate({ check: 'N5', scope: 'global', ok: false, violations: reuse.groups }).status).toBe('BLOCK');
    expect(
      evaluateGate({
        check: 'N5',
        scope: 'global',
        ok: false,
        violations: reuse.groups,
        exempt: { baseline: 582, reason: '语料 join 固有现象' },
      }).status
    ).toBe('EXEMPT');
  });

  it('T14-N6 正例/反例: 弱命中率 (matchTier>=2)', () => {
    // 正例: 例句含原形 → tier 0 → 占比 0
    const strong = checkN6WeakHits([{ ...ex('computer'), example: 'The computer is here.', exampleTranslation: '电脑在这里。' }]);
    expect(strong.weak).toBe(0);
    expect(evaluateGate({ check: 'N6', scope: 'en/a1.json', ok: true, violations: 0 }).status).toBe('PASS');

    // 反例: 例句只含同根派生词 (similarly <- similar) → tier 2 → 占比 100% > 10%
    const weak = checkN6WeakHits([
      { ...ex('similarly'), example: 'The two are similar.', exampleTranslation: '两者相似。' },
    ]);
    expect(weak.weak).toBe(1);
    expect(weak.ratio).toBeGreaterThan(N6_WEAK_RATIO_MAX);
    expect(
      evaluateGate({ check: 'N6', scope: 'en/a1.json', ok: weak.ratio <= N6_WEAK_RATIO_MAX, violations: weak.weak }).status
    ).toBe('BLOCK');
    expect(
      evaluateGate({
        check: 'N6',
        scope: 'de/a1.json',
        ok: false,
        violations: weak.weak,
        exempt: { baseline: 100, reason: '既有词干兜底命中' },
      }).status
    ).toBe('EXEMPT');
  });

  it('T14-N7 正例/反例: unknown 出处占比 + 缺出处', () => {
    // 正例: 出处为 tatoeba:<id>
    const clean = checkN7UnknownSources([ex('a')]);
    expect(clean).toMatchObject({ unknown: 0, missingSource: 0, ratio: 0 });
    expect(evaluateGate({ check: 'N7', scope: 'en/a1.json', ok: true, violations: 0 }).status).toBe('PASS');

    // 反例 1: unknown 出处占比 100% > 20% → BLOCK
    const unknown = checkN7UnknownSources([{ ...ex('a'), exampleSource: 'unknown:de-a1' }]);
    expect(unknown.ratio).toBeGreaterThan(N7_UNKNOWN_RATIO_MAX);
    expect(
      evaluateGate({ check: 'N7', scope: 'de/b2.json', ok: unknown.ratio <= N7_UNKNOWN_RATIO_MAX, violations: unknown.unknown })
        .status
    ).toBe('BLOCK');

    // 反例 2: 例句存在但缺出处 → 必须 BLOCK (与占比无关)
    const noSource = checkN7UnknownSources([{ lemma: 'a', pos: 'noun', translation: '一个', example: 'A cat.', exampleTranslation: '一只猫。' }]);
    expect(noSource.missingSource).toBe(1);
    expect(
      evaluateGate({ check: 'N7', scope: 'en/a1.json', ok: noSource.missingSource === 0, violations: noSource.unknown })
        .status
    ).toBe('BLOCK');
  });

  it('T14-N8 正例/反例: courses targetLemmas 命中对应等级词表', () => {
    // fixture 必须满足课程编排契约 (每 Lesson 恰 LESSON_LEMMA_COUNT 词),
    // 否则 badLen 会把「词数不符」混进 violationCount, 让正例断言失去意义。
    const a1 = [...Array(LESSON_LEMMA_COUNT)].map((_, i) => `alpha${i}`);
    const a2 = [...Array(LESSON_LEMMA_COUNT)].map((_, i) => `gamma${i}`);
    const quote = (ws) => ws.map((w) => `'${w}'`).join(',');
    const src = `
      buildLesson('en-a1', 1, 'T1', 'in a park', [${quote(a1)}]),
      buildLesson('en-a2', 2, 'T2', 'at home', [${quote(a2)}])
    `;
    const lessons = parseCourseLessons(src);
    expect(lessons).toHaveLength(2);

    // 正例: 词数合规 + 全部命中
    const okMap = new Map([
      ['a1', new Set(a1)],
      ['a2', new Set(a2)],
    ]);
    const ok = checkN8CourseMembership(lessons, okMap);
    expect(ok).toMatchObject({ badModule: 0, badLen: 0 });
    expect(ok.violationCount).toBe(0);
    expect(evaluateGate({ check: 'N8', scope: 'courses/en.ts', ok: true, violations: 0 }).status).toBe('PASS');

    // 反例: 词表外词 + moduleId 无法对应 → BLOCK
    const badMap = new Map([['a1', new Set([a1[0]])]]);
    const bad = checkN8CourseMembership(lessons, badMap);
    expect(bad.missing).toContain(`T1:${a1[1]}`);
    expect(bad.missing).toHaveLength(LESSON_LEMMA_COUNT - 1);
    expect(bad.badModule).toBe(1);
    expect(
      evaluateGate({ check: 'N8', scope: 'courses/en.ts', ok: bad.violationCount === 0, violations: bad.violationCount })
        .status
    ).toBe('BLOCK');
  });

  it('T14-N9 正例/反例: courses 跨模块 targetLemma 重复', () => {
    // 正例: 同一 lemma 只出现在一个模块
    const clean = checkN9CrossModuleDuplicates([
      { moduleId: 'en-a1', lemmas: ['alpha'] },
      { moduleId: 'en-a2', lemmas: ['beta'] },
    ]);
    expect(clean.count).toBe(0);
    expect(evaluateGate({ check: 'N9', scope: 'en', ok: true, violations: 0 }).status).toBe('PASS');

    // 反例: 同一 lemma 跨 a1/a2 → BLOCK (无豁免)
    const dup = checkN9CrossModuleDuplicates([
      { moduleId: 'en-a1', lemmas: ['film'] },
      { moduleId: 'en-a2', lemmas: ['film'] },
    ]);
    expect(dup).toMatchObject({ count: 1, dups: ['film'] });
    expect(evaluateGate({ check: 'N9', scope: 'en', ok: false, violations: dup.count }).status).toBe('BLOCK');
    expect(
      evaluateGate({
        check: 'N9',
        scope: 'en',
        ok: false,
        violations: dup.count,
        exempt: { baseline: 11, reason: '课程编排既有设计' },
      }).status
    ).toBe('EXEMPT');
  });
});