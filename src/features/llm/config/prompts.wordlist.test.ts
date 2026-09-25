/**
 * buildPassagePrompt 词表约束段落测试 (v1.6.0 SPEC §11.1)
 *
 * 覆盖 SPEC §11.1 `prompts.wordlist.test.ts` (3 测试):
 * - T01 [critical]: 传入 targetWords/optionalWords → prompt 含约束段 + 目标词清单 + minCover
 * - T02 [critical]: 不传 wordlistConstraint → prompt 无约束段 (0 breaking change)
 * - T03 [critical]: 约束段插入位置在 "MANDATORY self-check" 之前 (空 optionalWords 不渲染 optional 段)
 *
 * 实现注记:
 * - buildWordlistConstraintSection / injectWordlistConstraint 为模块私有函数, 未进 __testing__,
 *   故一律经公共 buildPassagePrompt 验证真实装配路径 (更贴近生产调用).
 * - minCover 实际实现 = Math.max(6, Math.ceil(targetWords.length * 0.75))
 *   (v2.2.2 Stage 2 Bug 7 加固), 非 SPEC 初稿的 ceil(n / 2) — 本测试断言实际行为.
 */
import { describe, expect, it } from 'vitest';
import { buildPassagePrompt } from './prompts';

describe('buildPassagePrompt — wordlistConstraint (v1.6.0)', () => {
  it('T01: 传入 targetWords/optionalWords → prompt 含约束段 + 目标词清单 + minCover', () => {
    const targetWords = [
      'harvest', 'barn', 'wheat', 'tractor', 'orchard', 'fence', 'grain', 'soil',
    ];
    const optionalWords = ['field', 'farm'];

    const { prompt } = buildPassagePrompt('en', 2, [], { targetWords, optionalWords });

    // 段落标题
    expect(prompt).toContain('Wordlist constraint (v1.6.0');
    // 每个目标词都以引号形式列出
    for (const w of targetWords) {
      expect(prompt).toContain(`"${w}"`);
    }
    for (const w of optionalWords) {
      expect(prompt).toContain(`"${w}"`);
    }
    // minCover = max(6, ceil(8 * 0.75)) = max(6, 6) = 6
    expect(prompt).toContain('at least 6 of these target words');
    // optional 段落 (optionalWords 非空时渲染)
    expect(prompt).toContain('You MAY also naturally include');
    // tokens 契约要求 (lemma = 词典形, surfaceForm = 屈折形)
    expect(prompt).toContain('"tokens" array');
    expect(prompt).toContain('dictionary form (lemma)');
  });

  it('T02: 不传 wordlistConstraint → prompt 无约束段 (0 breaking change)', () => {
    const { prompt } = buildPassagePrompt('en', 2, []);

    expect(prompt).not.toContain('Wordlist constraint');
    // 基础 prompt 仍然完整 (v1.5.x 行为)
    expect(prompt).toContain('Target language: en');
    expect(prompt).toContain('MANDATORY self-check');
  });

  it('T03: 约束段插入到 "MANDATORY self-check" 之前 + targetWords 少时取 minCover 下限 6', () => {
    // 2 个目标词 → ceil(2 * 0.75) = 2 → 下限 6
    const { prompt } = buildPassagePrompt('en', 1, [], {
      targetWords: ['alpha', 'beta'],
      optionalWords: [],
    });

    const sectionIdx = prompt.indexOf('Wordlist constraint');
    const selfCheckIdx = prompt.indexOf('MANDATORY self-check');

    expect(sectionIdx).toBeGreaterThanOrEqual(0);
    expect(selfCheckIdx).toBeGreaterThan(sectionIdx);
    expect(prompt).toContain('at least 6 of these target words');
    // optionalWords 为空 → 不渲染 optional 段
    expect(prompt).not.toContain('You MAY also naturally include');
  });
});
