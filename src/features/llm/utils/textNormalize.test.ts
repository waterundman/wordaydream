/**
 * textNormalize 单元测试 (Stage 1 — T01..T07)
 *
 * 覆盖 test_spec (来自 bayesian/v1.1.0/plan.md Stage 1):
 * - T01 [critical]: \r\n 转为 \n
 * - T02 [critical]: trim 首尾空白, 保留内部空白
 * - T03 [critical]: 移除零宽空格 (U+200B, U+FEFF)
 * - T04 [non-critical]: 移除独立 markdown 字符行
 * - T05 [critical]: offsetMap 正确性 (字符删除 / 中间删除场景)
 * - T06 [non-critical]: 中文 Unicode (BMP) 边界正确处理
 * - T07 [critical]: normalizeTextPreservingOffsets 与 normalizeText 输出一致
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeText,
  normalizeTextPreservingOffsets,
  remapOffset,
} from './textNormalize';

describe('textNormalize (Stage 1)', () => {
  it('T01: \\r\\n 转为 \\n, 单独 \\r 也转 \\n', () => {
    // \r\n -> \n
    expect(normalizeText('Hello\r\nWorld')).toBe('Hello\nWorld');
    // 单 \r -> \n (老 Mac 风格)
    expect(normalizeText('Hello\rWorld')).toBe('Hello\nWorld');
    // 多个 \r\n
    expect(normalizeText('a\r\nb\r\nc')).toBe('a\nb\nc');
    // 混合 \r\n 和 \r
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('T02: trim 首尾空白, 保留内部空白', () => {
    // 首尾空格
    expect(normalizeText('   hello world   ')).toBe('hello world');
    // 首尾含 \n
    expect(normalizeText('\n\nhello\n\n')).toBe('hello');
    // 首尾含 \t
    expect(normalizeText('\thello\t')).toBe('hello');
    // 内部空白保留
    expect(normalizeText('  hello   world  ')).toBe('hello   world');
    // 内部换行保留
    expect(normalizeText('  hello\n\nworld  ')).toBe('hello\n\nworld');
  });

  it('T03: 移除零宽空格 (U+200B, U+FEFF)', () => {
    // U+200B (ZERO WIDTH SPACE)
    expect(normalizeText('hello\u200Bworld')).toBe('helloworld');
    // U+FEFF (BOM / ZERO WIDTH NO-BREAK SPACE)
    expect(normalizeText('hello\uFEFFworld')).toBe('helloworld');
    // 混合
    expect(normalizeText('\u200Bhello\uFEFFworld\u200B')).toBe('helloworld');
    // 多个连续零宽
    expect(normalizeText('a\u200B\u200B\u200Bb')).toBe('ab');
    // 内部段落之间的零宽
    expect(normalizeText('Para1\u200B\n\nPara2')).toBe('Para1\n\nPara2');
  });

  it('T04: 移除孤立 markdown 字符行 (只含 **, #, -)', () => {
    // 单独的 **
    expect(normalizeText('**\nReal text')).toBe('Real text');
    // 单独的 #
    expect(normalizeText('#\nReal text')).toBe('Real text');
    // 单独的 -
    expect(normalizeText('Real text\n-')).toBe('Real text');
    // 多字符: ***, ---
    expect(normalizeText('***\nHello\n---')).toBe('Hello');
    // 中间的孤立行也移除
    expect(normalizeText('Hello\n**\nWorld')).toBe('Hello\nWorld');
    // 行首/行尾空白不算"非孤立"
    expect(normalizeText('  **  \nReal')).toBe('Real');
    // 内嵌 `**` (不是单独行) 不动
    expect(normalizeText('Hello **bold** world')).toBe('Hello **bold** world');
    // 空行不算孤立 (保留作段落分隔)
    expect(normalizeText('Para1\n\nPara2')).toBe('Para1\n\nPara2');
  });

  it('T05: offsetMap 正确性 — 删除/中间删除场景', () => {
    // 5.1 零宽空格删除 (单点)
    {
      const r = normalizeTextPreservingOffsets('ab\u200Bcd');
      expect(r.normalized).toBe('abcd');
      // a=0, b=1, c=3 (跳过 \u200B=2), d=4
      expect(r.offsetMap).toEqual([0, 1, 3, 4]);
      // remapOffset 验证: 旧 token "bcd" 在原 text 中是 [1, 5) (含零宽),
      // 映射到新 text 中 [1, 4) = "bcd"
      const newStart = remapOffset(1, r.offsetMap);
      const newEnd = remapOffset(5, r.offsetMap);
      expect(r.normalized.substring(newStart, newEnd)).toBe('bcd');
      // 旧 token "b" 在新 text 中 [1, 2)
      expect(r.normalized.substring(remapOffset(1, r.offsetMap), remapOffset(2, r.offsetMap))).toBe('b');
      // 旧 token "d" 在新 text 中 [3, 4)
      expect(r.normalized.substring(remapOffset(4, r.offsetMap), remapOffset(5, r.offsetMap))).toBe('d');
    }

    // 5.2 trim 首尾空白
    {
      const r = normalizeTextPreservingOffsets('  hello  ');
      expect(r.normalized).toBe('hello');
      // "hello" 5 字符, 原始位置 2-6
      expect(r.offsetMap).toEqual([2, 3, 4, 5, 6]);
      // 旧 [2, 7] -> 新 [0, 5]
      expect(remapOffset(2, r.offsetMap)).toBe(0);
      expect(remapOffset(7, r.offsetMap)).toBe(5);
    }

    // 5.3 中间删除: markdown 整行
    {
      // "Hello\n**\nWorld" 长度 14
      // H=0,e=1,l=2,l=3,o=4, \n=5, *=6, *=7, \n=8, W=9,o=10,r=11,l=12,d=13
      const r = normalizeTextPreservingOffsets('Hello\n**\nWorld');
      expect(r.normalized).toBe('Hello\nWorld');
      // "Hello\n" 0-5, "World" 9-13 (整行 "**\n" 6-8 被删除)
      expect(r.offsetMap).toEqual([0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13]);
      // 旧 [6, 11] 在新 text 中是 [6, 9) = "Wor"
      expect(remapOffset(6, r.offsetMap)).toBe(6);
      expect(remapOffset(11, r.offsetMap)).toBe(8);
      expect(r.normalized.substring(6, 9)).toBe('Wor');
    }

    // 5.4 多个零宽 + 段落
    {
      const r = normalizeTextPreservingOffsets('a\u200Bb\u200Bc');
      expect(r.normalized).toBe('abc');
      expect(r.offsetMap).toEqual([0, 2, 4]);
    }

    // 5.5 尾部添加 (trim 移除尾部空白, 然后末尾是 word)
    {
      // "  word  \n  " 长度 11
      // ' ',' ','w','o','r','d',' ',' ','\n',' ',' '
      const r = normalizeTextPreservingOffsets('  word  \n  ');
      expect(r.normalized).toBe('word');
      // "word" 4 字符, 原始位置 2-5
      expect(r.offsetMap).toEqual([2, 3, 4, 5]);
    }

    // 5.6 混合: \r\n + 零宽 + markdown
    {
      const r = normalizeTextPreservingOffsets('\r\n  **  \r\nHello\u200BWorld\r\n');
      expect(r.normalized).toBe('HelloWorld');
      // 旧 "HelloWorld" 位置: H=10, e=11, l=12, l=13, o=14, W=16, o=17, r=18, l=19, d=20
      expect(r.offsetMap).toEqual([10, 11, 12, 13, 14, 16, 17, 18, 19, 20]);
    }
  });

  it('T06: 中文 Unicode 边界 (BMP 字符)', () => {
    // 纯中文
    {
      const r = normalizeTextPreservingOffsets('你好世界');
      expect(r.normalized).toBe('你好世界');
      expect(r.offsetMap).toEqual([0, 1, 2, 3]);
      // 中文 + 英文混排
      const r2 = normalizeTextPreservingOffsets('Hello 你好 World');
      expect(r2.normalized).toBe('Hello 你好 World');
      // H=0,e=1,l=2,l=3,o=4, ' '=5, 你=6, 好=7, ' '=8, W=9,o=10,r=11,l=12,d=13
      expect(r2.offsetMap).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    }

    // 中文之间有零宽空格
    {
      const r = normalizeTextPreservingOffsets('你\u200B好');
      expect(r.normalized).toBe('你好');
      // '你' 位置 0, '好' 位置 2 (跳过 \u200B)
      expect(r.offsetMap).toEqual([0, 2]);
    }

    // 段落换行 (中文)
    {
      // 原 text: '第' '一' '段' '\r' '\n' '第' '二' '段' (length 8)
      // \r\n -> \n, \n 的 oldIdx 取 4 (实际 \n 位置)
      // offsetMap: [0, 1, 2, 4, 5, 6, 7]
      const r = normalizeTextPreservingOffsets('第一段\r\n第二段');
      expect(r.normalized).toBe('第一段\n第二段');
      expect(r.offsetMap).toEqual([0, 1, 2, 4, 5, 6, 7]);
    }

    // German umlauts 不破坏
    {
      const r = normalizeText('Schöne Grüße aus München');
      expect(r).toBe('Schöne Grüße aus München');
    }
  });

  it('T07: normalizeTextPreservingOffsets 与 normalizeText 输出一致', () => {
    const cases: string[] = [
      '',
      'hello',
      '  hello  ',
      '\n\nhello\n\n',
      'Hello\r\nWorld',
      'Hello\u200BWorld',
      '**\nReal text',
      'Hello\n**\nWorld',
      '你好世界',
      'Mixed 中文 and English',
      '\r\n  **  \r\nHello\u200BWorld\r\n',
      // 多段落
      'Para1\n\nPara2\n\nPara3',
      // markdown 行夹中间
      'Para1\n***\nPara2\n---\nPara3',
      // 全部空白
      '   \n  \t  ',
      // 极端: 全部 markdown 行
      '**\n#\n-',
    ];
    for (const c of cases) {
      const plain = normalizeText(c);
      const rich = normalizeTextPreservingOffsets(c);
      expect(rich.normalized, `case=${JSON.stringify(c)}`).toBe(plain);
    }
  });
});
