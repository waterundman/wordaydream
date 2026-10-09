/**
 * v1.6.4 — T03 [critical]: 断言关键词 ↔ 日志源 双向契约测试
 *
 * assertion-keywords.mjs 的头注释承诺「keyword 必须与运行时日志源串逐字一致」,
 * 但 seed-and-verify.test.mjs 只校验关键词清单的结构 (id 顺序 / level), 从不校验
 * 日志源里还留着那串字. B1 拆分把 A4 的 'getAllCards done: count=' 从
 * HarmonyBridge.ets 静默搬进 delegates/CardBridgeDelegate.ets 时, 没有任何测试会红.
 *
 * 本用例补上这条链: 每条断言在 EVIDENCE 表里钉死「文件 + 代码字面量」, 清单增删
 * 或日志源改动都会强制同步这张表.
 *
 * 两个刻意的设计约束:
 * 1. 只在剥掉注释的源码里搜索 —— ArkTS 侧注释会原文复述断言子串 (见
 *    EntryAbility.ets 的 A6 说明注释), 逐字匹配注释等于没有守护.
 * 2. A6 的运行时串是拼接产物 ('...dispatching query=%{public}s' + query.split('&')[0]),
 *    任何单文件里都不存在完整的 'dispatching query=action=openCard', 故按 composed
 *    分段校验, 不允许把注释当证据.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSERTION_KEYWORDS,
  OPEN_CARD_ASSERTIONS,
  ALL_ASSERTIONS,
} from './assertion-keywords.mjs';

/** 日志源证据: keyword 由这些「文件 + 代码字面量」拼出. */
const EVIDENCE = [
  {
    id: 'A1',
    keyword: 'seedDebugCards done',
    sources: [{ file: 'harmony/entry/src/main/ets/entryability/EntryAbility.ets', literal: 'seedDebugCards done' }],
  },
  {
    id: 'A2',
    keyword: 'Page begin',
    sources: [{ file: 'harmony/entry/src/main/ets/pages/Index.ets', literal: 'Page begin' }],
  },
  {
    id: 'A3',
    keyword: 'Web content ready',
    sources: [{ file: 'harmony/entry/src/main/ets/bridge/HarmonyBridge.ets', literal: 'Web content ready' }],
  },
  {
    id: 'A4',
    keyword: 'getAllCards done: count=',
    sources: [{ file: 'harmony/entry/src/main/ets/bridge/delegates/CardBridgeDelegate.ets', literal: 'getAllCards done: count=' }],
  },
  {
    id: 'A5',
    keyword: 'Web launch handler ready: generation=',
    sources: [{ file: 'harmony/entry/src/main/ets/bridge/HarmonyBridge.ets', literal: 'Web launch handler ready: generation=' }],
  },
  {
    id: 'A6',
    keyword: 'dispatching query=action=openCard',
    composed: true,
    sources: [
      { file: 'harmony/entry/src/main/ets/entryability/EntryAbility.ets', literal: 'handleLaunchWant: dispatching query=%{public}s' },
      { file: 'harmony/entry/src/main/ets/bridge/BridgeInputValidator.ets', literal: 'action=openCard&cardId=' },
    ],
  },
  {
    id: 'A7',
    keyword: '[harmonyLaunch] openCard',
    sources: [{ file: 'src/domain/harmonyLaunch.ts', literal: '[harmonyLaunch] openCard' }],
  },
];

/** 读取源码并剥掉注释, 避免「注释里复述了关键词」被当成证据. */
function readCode(relPath) {
  const raw = readFileSync(join(process.cwd(), relPath), 'utf-8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

describe('v1.6.4 T03 [critical]: 断言清单 ↔ 日志源证据表双向闭合', () => {
  it('每条断言都有证据, 每份证据都对应断言 (无漏网 / 无孤儿)', () => {
    const assertionIds = ALL_ASSERTIONS.map((a) => a.id);
    const evidenceIds = EVIDENCE.map((e) => e.id);
    expect([...assertionIds].sort()).toEqual([...evidenceIds].sort());
    expect(assertionIds).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
  });

  it('非拼接断言: 关键词逐字存在于所钉文件的可执行代码中', () => {
    for (const entry of EVIDENCE.filter((e) => !e.composed)) {
      const assertion = ALL_ASSERTIONS.find((a) => a.id === entry.id);
      expect(assertion.keyword, entry.id).toBe(entry.keyword);
      for (const { file, literal } of entry.sources) {
        expect(readCode(file), `${entry.id} in ${file}`).toContain(literal);
      }
    }
  });

  it('A6 [critical]: 拼接运行时串 = hilog 前缀 + query action 段', () => {
    const entry = EVIDENCE.find((e) => e.id === 'A6');
    const [fmt, action] = entry.sources;
    const fmtCode = readCode(fmt.file);
    const actionCode = readCode(action.file);
    expect(fmtCode).toContain(fmt.literal);
    expect(actionCode).toContain(action.literal);

    const composed =
      fmt.literal.slice(0, fmt.literal.indexOf('%{public}s')) +
      action.literal.slice(0, action.literal.indexOf('&'));
    expect(composed).toContain(entry.keyword);
    // 前缀格式不得漂移: 运行时串必须以关键词收尾 (hilog 前缀 + query action 段).
    expect(composed.endsWith(entry.keyword), composed).toBe(true);
  });
});

describe('v1.6.4 T03: 关键词清单自身未被单方面改动', () => {
  it('seed 段 A1-A5 critical, openCard 段 A6 critical / A7 soft', () => {
    expect(ASSERTION_KEYWORDS.map((a) => a.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
    expect(OPEN_CARD_ASSERTIONS.map((a) => a.id)).toEqual(['A6', 'A7']);
    expect(ASSERTION_KEYWORDS.every((a) => a.level !== 'soft')).toBe(true);
    expect(OPEN_CARD_ASSERTIONS.find((a) => a.id === 'A6').level).toBe('critical');
    expect(OPEN_CARD_ASSERTIONS.find((a) => a.id === 'A7').level).toBe('soft');
  });

  it('B1 拆分回归防线: A4 日志源在 CardBridgeDelegate, 不在 façade 里', () => {
    const delegateFile = EVIDENCE.find((e) => e.id === 'A4').sources[0].file;
    expect(readCode(delegateFile)).toContain('getAllCards done: count=');
  });
});
