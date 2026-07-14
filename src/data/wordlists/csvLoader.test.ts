/**
 * v2.2.0 Stage 2 (D2): CSV 解析 + 校验 + 模板生成 单元测试
 *
 * 覆盖 test_spec:
 * - T09: parseCsvWordlist 解析合法 CSV 返回 entries
 * - T10: parseCsvWordlist 处理引号转义 ("hello,world")
 * - T11: parseCsvWordlist 处理 semanticConflicts 用 `|` 分隔
 * - T12: validateEntry 拒绝空 lemma
 * - T13: validateEntry 拒绝非法 cefr (如 "C1")
 * - T14: generateCsvTemplate 返回合法 CSV 字符串
 */
import { describe, it, expect } from 'vitest';
import {
  parseCsvWordlist,
  validateEntry,
  generateCsvTemplate,
} from './csvLoader';

describe('csvLoader', () => {
  describe('T09: parseCsvWordlist 解析合法 CSV 返回 entries', () => {
    it('解析合法 CSV 返回 entries 数组', () => {
      const csv = [
        'lemma,pos,translation,cefr,priority,topic,semanticConflicts',
        'apple,noun,苹果,A1,1,food,',
        'run,verb,跑,A2,2,action,',
      ].join('\n');

      const result = parseCsvWordlist(csv, 'test.csv');

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.entries).toHaveLength(2);
      expect(result.fileName).toBe('test.csv');

      expect(result.entries[0]).toEqual({
        lemma: 'apple',
        pos: 'noun',
        translation: '苹果',
        cefr: 'A1',
        priority: 1,
        topic: 'food',
      });

      expect(result.entries[1]).toEqual({
        lemma: 'run',
        pos: 'verb',
        translation: '跑',
        cefr: 'A2',
        priority: 2,
        topic: 'action',
      });
    });

    it('priority 省略时默认为 2', () => {
      const csv = 'lemma,pos,translation,cefr\napple,noun,苹果,A1\n';
      const result = parseCsvWordlist(csv, 'test.csv');
      expect(result.entries[0].priority).toBe(2);
    });

    it('topic 省略时不赋值', () => {
      const csv = 'lemma,pos,translation,cefr,priority\napple,noun,苹果,A1,1\n';
      const result = parseCsvWordlist(csv, 'test.csv');
      expect(result.entries[0].topic).toBeUndefined();
    });
  });

  describe('T10: parseCsvWordlist 处理引号转义', () => {
    it('处理引号内的逗号 ("hello,world")', () => {
      const csv = [
        'lemma,pos,translation,cefr,priority,topic,semanticConflicts',
        '"hello,world",noun,"你好,世界",A1,1,greetings,',
      ].join('\n');

      const result = parseCsvWordlist(csv, 'test.csv');

      expect(result.success).toBe(true);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].lemma).toBe('hello,world');
      expect(result.entries[0].translation).toBe('你好,世界');
    });
  });

  describe('T11: parseCsvWordlist 处理 semanticConflicts 用 `|` 分隔', () => {
    it('解析 semanticConflicts 为数组', () => {
      const csv = [
        'lemma,pos,translation,cefr,priority,topic,semanticConflicts',
        'apple,noun,苹果,A1,1,food,pear|orange|peach',
      ].join('\n');

      const result = parseCsvWordlist(csv, 'test.csv');

      expect(result.success).toBe(true);
      expect(result.entries[0].semanticConflicts).toEqual(['pear', 'orange', 'peach']);
    });

    it('semanticConflicts 为空时不赋值', () => {
      const csv = [
        'lemma,pos,translation,cefr,priority,topic,semanticConflicts',
        'apple,noun,苹果,A1,1,food,',
      ].join('\n');

      const result = parseCsvWordlist(csv, 'test.csv');
      expect(result.entries[0].semanticConflicts).toBeUndefined();
    });
  });

  describe('T12: validateEntry 拒绝空 lemma', () => {
    it('空 lemma 返回错误数组', () => {
      const errors = validateEntry(
        { lemma: '', pos: 'noun', translation: '苹果', cefr: 'A1' },
        1,
      );
      expect(errors).not.toBeNull();
      expect(errors!.length).toBeGreaterThan(0);
      expect(errors!.some((e) => e.includes('lemma'))).toBe(true);
    });

    it('lemma 仅空格返回错误数组', () => {
      const errors = validateEntry(
        { lemma: '   ', pos: 'noun', translation: '苹果', cefr: 'A1' },
        1,
      );
      expect(errors).not.toBeNull();
      expect(errors!.some((e) => e.includes('lemma'))).toBe(true);
    });

    it('合法 entry 返回 null', () => {
      const errors = validateEntry(
        { lemma: 'apple', pos: 'noun', translation: '苹果', cefr: 'A1', priority: 1 },
        1,
      );
      expect(errors).toBeNull();
    });
  });

  describe('T13: validateEntry 拒绝非法 cefr', () => {
    it('cefr 为 "C1" 返回错误数组', () => {
      const errors = validateEntry(
        { lemma: 'apple', pos: 'noun', translation: '苹果', cefr: 'C1' as 'A1' },
        1,
      );
      expect(errors).not.toBeNull();
      expect(errors!.some((e) => e.includes('cefr'))).toBe(true);
    });

    it('cefr 为 "X5" 返回错误数组', () => {
      const errors = validateEntry(
        { lemma: 'apple', pos: 'noun', translation: '苹果', cefr: 'X5' as 'A1' },
        1,
      );
      expect(errors).not.toBeNull();
      expect(errors!.some((e) => e.includes('cefr'))).toBe(true);
    });

    it('cefr 为空返回错误数组', () => {
      const errors = validateEntry(
        { lemma: 'apple', pos: 'noun', translation: '苹果', cefr: '' as 'A1' },
        1,
      );
      expect(errors).not.toBeNull();
      expect(errors!.some((e) => e.includes('cefr'))).toBe(true);
    });

    it('合法 cefr (A1/A2/B1/B2) 返回 null', () => {
      for (const cefr of ['A1', 'A2', 'B1', 'B2'] as const) {
        const errors = validateEntry(
          { lemma: 'apple', pos: 'noun', translation: '苹果', cefr },
          1,
        );
        expect(errors).toBeNull();
      }
    });
  });

  describe('T14: generateCsvTemplate 返回合法 CSV 字符串', () => {
    it('返回含表头 + 2 示例行的 CSV 字符串', () => {
      const template = generateCsvTemplate();

      // 含表头
      expect(template).toContain('lemma,pos,translation,cefr,priority,topic,semanticConflicts');

      // 含 2 示例行
      const lines = template.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(3); // header + 2 examples

      // 能被 parseCsvWordlist 正确解析
      const result = parseCsvWordlist(template, 'template.csv');
      expect(result.entries).toHaveLength(2);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
