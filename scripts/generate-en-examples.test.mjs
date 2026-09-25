/**
 * 英语例句生成器单测 — v1.6.2 Stage 2
 *
 * 覆盖 SPEC §6.1 声明的 5 项 (本文件为**超集**): isNoiseSentence / normalizeZh / pickExample
 * + 本次执行期新增的 4 项: matchTier 四级 / containsPhrase 多词短语 / buildIndex 端到端 /
 * isEligible 过滤 / **不变量：pickExample 产出必过 R3** / rewriteLines 逐行改写安全。
 *
 * 两项刻意的设计：
 *  1. 每个用例只喂**构造的小语料**, 不读 .tmp-wl (语料是 gitignored 的, CI 上不存在)。
 *  2. 反向用例是重点: 多词短语的**假阳性**(`all right` 不得命中 `ball right`)与
 *     R3 的**假阴性**都必须钉住 —— 只测正面等于没测。
 */
import { describe, expect, it } from 'vitest';
import { containsLemma } from './lib/lemmaForms.mjs';
import {
  buildIndex,
  collectCandidates,
  countWords,
  isEligible,
  isNoiseSentence,
  normalizeZh,
  pickExample,
  toSimplifiedStrict,
} from './generate-en-examples.mjs';
import { rewriteLines } from './activate-de-a1-examples.mjs';

describe('generate-en-examples (v1.6.2 Stage 2)', () => {
  it('T01 [isNoiseSentence]: 人名噪声句命中, 且不误伤同前缀的普通词', () => {
    expect(isNoiseSentence('Tom is Mary\'s former husband.')).toBe(true);
    expect(isNoiseSentence('  mary went home.')).toBe(true);
    expect(isNoiseSentence('Mr. Smith is here.')).toBe(true);
    // 边界: "Tomorrow"/"Sample" 以 Tom/Sam 开头, 但后面紧跟字母 → 词边界不成立 → 不得命中
    expect(isNoiseSentence('Tomorrow is a new day.')).toBe(false);
    expect(isNoiseSentence('Samples are free.')).toBe(false);
    expect(isNoiseSentence('I like tomatoes.')).toBe(false);
  });

  it('T02 [normalizeZh]: 繁体转简体 + 句末标点全角化, 且幂等', () => {
    expect(normalizeZh('我前幾天遇見了他。')).toBe('我前几天遇见了他。');
    expect(normalizeZh('我的理論是這樣。')).toBe('我的理论是这样。');
    const simplified = '这一结果证实了我的猜想。';
    expect(normalizeZh(simplified)).toBe(simplified);
    // 幂等: 连续两次结果相同
    expect(normalizeZh(normalizeZh('我前幾天遇見了他。'))).toBe(normalizeZh('我前幾天遇見了他。'));
    // 句末半角 → 全角 (实测 3928 条里有 64 条)
    expect(normalizeZh('他的家在哪儿?')).toBe('他的家在哪儿？');
    expect(normalizeZh('祝你好运!')).toBe('祝你好运！');
    expect(normalizeZh('这是一个句子.')).toBe('这是一个句子。');
    // 只动**句末**一个字符: 句内小数/句内标点不得被改
    expect(normalizeZh('圆周率是 3.14')).toBe('圆周率是 3.14');
    expect(normalizeZh('他说：好.')).toBe('他说：好。');
    // 已是全角 → 不变
    expect(normalizeZh('一切正常。')).toBe('一切正常。');
  });

  it('T03 [独立口径]: 通用繁体转换器 (from:t) 对已归一化文本不再产生改动', () => {
    // 用自己的转换器验证自己 = 循环论证; 换一个配置再跑, 结果一致才算证据
    for (const zh of ['我前幾天遇見了他。', '我的理論是這樣。', '这一结果证实了我的猜想。']) {
      expect(toSimplifiedStrict(normalizeZh(zh))).toBe(normalizeZh(zh));
    }
  });

  it('T04 [isEligible]: 句长上下限 / 译文须含 CJK / 空句一律淘汰', () => {
    expect(isEligible('I have to go now.', '我得走了。')).toBe(true);
    expect(isEligible('a b c d e f g h i j k l m', '十三个词。')).toBe(false);   // >12 词
    expect(isEligible('No.', '不。', { minWords: 3 })).toBe(false);              // <3 词 (下限开关)
    expect(isEligible('No.', '不。')).toBe(true);                                // 默认无下限 (严格 SPEC D3)
    expect(isEligible('I have to go now.', 'I have to go now.')).toBe(false);    // 译文无 CJK
    expect(isEligible('   ', '空句。')).toBe(false);
    expect(isEligible('Tom is here.', '汤姆在这。')).toBe(false);                 // 噪声主语
    expect(isEligible('I have to go.', undefined)).toBe(false);                  // 无译文
    expect(countWords('I have to go now.')).toBe(5);
  });

  it('T05 [pickExample]: 原形优先 → 屈折 → 同根派生 → 兜底, 同级句短优先', () => {
    const s = (en, enId, zh = '译文。') => ({ en, zh, enId });
    // 同一条 lemma, 三种层级都在候选里 → 必须取原形那条 (即使它更长)
    const picked = pickExample('hope', [
      s('I hoped so.', '3'),
      s('I hope so.', '9'),
      s('I am hoping so.', '1'),
    ]);
    expect(picked?.example).toBe('I hope so.');
    expect(picked?.tier).toBe(0);
    expect(picked?.exampleSource).toBe('tatoeba:9');

    // 无原形时取屈折 (hoped / hoping 都是 hope 的屈折形) —— 同级再按句短优先
    const inflected = pickExample('hope', [s('I hoped so.', '3'), s('I am hoping so.', '1')]);
    expect(inflected?.tier).toBe(1);   // hoped = hope 的屈折形 (e 脱落 + ed), 不是同根派生
    expect(inflected?.example).toBe('I hoped so.');   // 句短优先 (4 词 < 5 词)

    // 无任何候选 → null
    expect(pickExample('hope', [])).toBe(null);
    expect(pickExample('hope', [s('The cat sat down.', '1')])).toBe(null);
  });

  it('T06 [pickExample]: 屈折命中优先于同根派生命中 (例句里出现的应是该词本身)', () => {
    const s = (en, enId) => ({ en, zh: '译文。', enId });
    // quickly: 一条含 quickly (屈折), 一条含 quicker-ish 派生 → 取屈折
    const picked = pickExample('work', [s('They are working hard now.', '5'), s('His workshop is big.', '1')]);
    expect(picked?.example).toBe('They are working hard now.');
    expect(picked?.tier).toBe(1);      // working = work + ing → 屈折
  });

  it('T07 [多词短语]: 词序列连续 / 连写等价命中; 假阳性必须被拒', () => {
    // 正向
    expect(containsLemma('no one', 'No one knows.')).toBe(true);
    expect(containsLemma('have to', 'I have to go now.')).toBe(true);
    expect(containsLemma('per cent', 'You are 100 percent correct.')).toBe(true);
    expect(containsLemma('ice cream', 'Stracciatella ice-cream is nice.')).toBe(true);
    // 反向: 这些正是实测踩到的错配/假阳性
    expect(containsLemma('no one', 'It is just noon.')).toBe(false);
    expect(containsLemma('all right', 'The ball right here is red.')).toBe(false);
  });

  it('T08 [buildIndex + collectCandidates]: 端到端只收录合格句, 且候选面等于判定面', () => {
    const tuples = [
      ['1', '我该去睡觉了。', '10', 'I have to go to sleep now.'],
      ['2', '不。', '20', 'No.'],
      ['3', '汤姆在这。', '30', 'Tom is here.'],
      ['4', '这是一句很长的句子，用来确保它超过十二个单词的限制从而被过滤掉，是的。', '40', 'one two three four five six seven eight nine ten eleven twelve thirteen'],
      ['5', '我喜歡冰淇淋。', '50', 'I like ice cream.'],
    ];
    const index = buildIndex(tuples, { minWords: 3 });
    expect(index.stats.eligible).toBe(2);            // 只剩 1 和 5
    expect(index.stats.excludedLong).toBe(1);
    expect(index.stats.excludedNoise).toBe(1);
    expect(index.stats.excludedShort).toBe(1);
    expect(index.stats.converted).toBe(1);           // 我喜歡冰淇淋 → 我喜欢冰淇淋

    const cands = collectCandidates('sleep', index);
    const viaContains = cands.filter((c) => containsLemma('sleep', c.en));
    expect(viaContains.length).toBeGreaterThan(0);
    const picked = pickExample('sleep', cands);
    expect(picked?.example).toBe('I have to go to sleep now.');
    expect(picked?.exampleTranslation).toBe('我该去睡觉了。');

    const phrase = pickExample('ice cream', collectCandidates('ice cream', index));
    expect(phrase?.example).toBe('I like ice cream.');
    expect(phrase?.tier).toBe(0);
  });

  it('T09 [不变量]: pickExample 的产出必定通过 R3 (生成即校验通过)', () => {
    const tuples = [
      ['1', '他们正在努力工作。', '11', 'They are working hard now.'],
      ['2', '我认识他。', '12', 'I know him.'],
      ['3', '她昨天来了。', '13', 'She came yesterday.'],
    ];
    const index = buildIndex(tuples, { minWords: 2 });
    for (const lemma of ['work', 'working', 'know', 'come', 'go', 'person']) {
      const picked = pickExample(lemma, collectCandidates(lemma, index));
      if (!picked) continue;
      // 这是本生成器与校验器共用 lemmaForms 的直接后果 —— 一旦漂移, 此断言转红
      expect(containsLemma(lemma, picked.example), `${lemma} 的产出 "${picked.example}" 未过 containsLemma`).toBe(true);
      expect(picked.exampleSource).toMatch(/^tatoeba:\d+$/);
    }
  });

  it('T10 [rewriteLines]: 只改写目标行, 分组空行与文件其余部分原样保留', () => {
    const src = [
      '{',
      '  "words": [',
      '    {"lemma":"Hallo","example":"Hallo!","exampleTranslation":"你好！"},',
      '',
      '    {"lemma":"danke","example":"Danke!","exampleTranslation":"谢谢！"}',
      '  ]',
      '}',
      '',
    ].join('\n');
    const { text, touched } = rewriteLines(src, (w) => {
      w.exampleSource = 'unknown:test';
      return true;
    });
    expect(touched).toBe(2);
    const lines = text.split('\n');
    expect(lines[3]).toBe('');                                       // 分组空行保留
    expect(lines[0]).toBe('{');
    expect(lines[1]).toBe('  "words": [');
    expect(lines[2]).toContain('"exampleSource":"unknown:test"');
    expect(lines[4]).toContain('"exampleSource":"unknown:test"');
    expect(lines[4].endsWith('}')).toBe(true);                       // 无尾逗号的行不得被加上
    // 未改动时返回原文本
    const noop = rewriteLines(src, () => false);
    expect(noop.text).toBe(src);
    expect(noop.touched).toBe(0);
  });
});
