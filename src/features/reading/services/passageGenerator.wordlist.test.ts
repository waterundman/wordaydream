/**
 * passageGenerator 词表约束链路测试 (v1.6.0 SPEC §11.1)
 *
 * 覆盖 SPEC §11.1 `passageGenerator.wordlist.test.ts` (5 测试):
 * - T01 [critical]: 正常模式 → wordlistConstraint.targetWords = 该级未学词 (8), optionalWords = learning 词
 * - T02 [critical]: wordlistConstraint 注入 prompt, 段落在 "MANDATORY self-check" 之前
 * - T03 [critical]: 无词表 (难度 5 / C1) → wordlistConstraint undefined, prompt 无约束段 (0 breaking change)
 * - T04 [critical]: 覆盖校验 — passage 命中词表内词 → markWordLearning (状态 learning)
 * - T05 [non-critical]: 覆盖校验 — passage 中词表外词不标记 (状态保持 unseen)
 *
 * 与既有 passageGenerator.test.ts 的边界:
 *   后者覆盖「巩固模式 (learning >= 阈值)」「dueCards 超载强制巩固」「wordlist 补偿」「targetLemmas 注入」;
 *   本文件聚焦「正常模式取词 → 约束注入 → 覆盖回写」三条 v1.6.0 新增链路, 与上述用例不重叠.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePassage, clearPassageCache, clearRecentTitles } from './passageGenerator';
import * as routerModule from '../../llm/services/router';
import * as promptsModule from '../../llm/config/prompts';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { getCachedWordlist, clearWordlistCache } from '../../../data/wordlists';

/**
 * 由 lemma 数组构造合法 passage JSON: text 为空格连接, offsets 精确对齐 surfaceForm.
 * (extractPassageJson 的严格 slice 校验要求 text.substring(start, end) === surfaceForm)
 */
function buildJsonFromLemmas(lemmas: string[], difficulty = 1): string {
  let text = '';
  const tokens = lemmas.map((lemma) => {
    if (text) text += ' ';
    const startIndex = text.length;
    text += lemma;
    return {
      lemma,
      surfaceForm: lemma,
      startIndex,
      endIndex: startIndex + lemma.length,
      partOfSpeech: 'noun',
    };
  });
  return JSON.stringify({
    language: 'en',
    difficulty,
    text: `${text}.`,
    tokens,
  });
}

describe('generatePassage — wordlistConstraint (v1.6.0 SPEC §11.1)', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    clearPassageCache();
    clearRecentTitles();
    clearWordlistCache();
    useSettingsStore.setState((s) => ({
      llm: {
        ...s.llm,
        enabled: true,
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: '',
        model: 'gpt-4o-mini',
        temperature: 0.5,
        timeout: 30,
        maxRetries: 2,
        streaming: false,
      },
    }));
  });

  afterEach(() => {
    clearPassageCache();
    clearRecentTitles();
    clearWordlistCache();
    vi.restoreAllMocks();
    useWordlistStore.getState().resetAll();
    useMemoryStore.getState().resetAll();
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  it('T01 [critical]: 正常模式 → targetWords = 该级未学词 (8), optionalWords 含 learning 词', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    const allLemmas = wordlist.words.map((w) => w.lemma);

    // 标记 2 个词为 learning (远低于难度 1 的阈值 20 → 非巩固模式)
    const learning = allLemmas.slice(0, 2);
    for (const l of learning) {
      useWordlistStore.getState().markWordLearning('en', l);
    }

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({
      text: buildJsonFromLemmas(allLemmas.slice(0, 10)),
    });
    const buildPromptSpy = vi.spyOn(promptsModule, 'buildPassagePrompt');

    await generatePassage('en', 1, [], undefined, true);

    expect(buildPromptSpy).toHaveBeenCalled();
    const constraint = buildPromptSpy.mock.calls[0][3] as
      | { targetWords: string[]; optionalWords: string[] }
      | undefined;
    expect(constraint).toBeDefined();
    if (!constraint) return;

    // 未学词取 8 个
    expect(constraint.targetWords).toHaveLength(8);

    // 全部属于该级词表, 且不含已 learning 的词
    const lemmaSet = new Set(allLemmas.map((l) => l.toLowerCase()));
    const learningSet = new Set(learning.map((l) => l.toLowerCase()));
    for (const w of constraint.targetWords) {
      expect(lemmaSet.has(w.toLowerCase())).toBe(true);
      expect(learningSet.has(w.toLowerCase())).toBe(false);
    }

    // optionalWords 含刚标记的 learning 词 (复现用)
    const optionalSet = new Set(constraint.optionalWords.map((l) => l.toLowerCase()));
    for (const l of learning) {
      expect(optionalSet.has(l.toLowerCase())).toBe(true);
    }
  });

  it('T02 [critical]: wordlistConstraint 注入 prompt, 段落在 "MANDATORY self-check" 之前', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    const lemmas = wordlist.words
      .map((w) => w.lemma)
      .filter((l) => /^[a-z]+$/.test(l));

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({
      text: buildJsonFromLemmas(lemmas.slice(0, 10)),
    });
    const buildPromptSpy = vi.spyOn(promptsModule, 'buildPassagePrompt');

    await generatePassage('en', 1, [], undefined, true);

    const constraint = buildPromptSpy.mock.calls[0][3] as
      | { targetWords: string[]; optionalWords: string[] }
      | undefined;
    expect(constraint).toBeDefined();
    expect(constraint!.targetWords.length).toBeGreaterThan(0);

    // buildPassagePrompt 的返回值 (spy 默认透传原实现) → 取真实 prompt
    const { prompt } = buildPromptSpy.mock.results[0].value as { prompt: string };

    expect(prompt).toContain('Wordlist constraint (v1.6.0');
    for (const w of constraint!.targetWords) {
      expect(prompt).toContain(`"${w}"`);
    }

    // 注入点: 约束段位于 self-check 之前
    const sectionIdx = prompt.indexOf('Wordlist constraint');
    const selfCheckIdx = prompt.indexOf('MANDATORY self-check');
    expect(sectionIdx).toBeGreaterThanOrEqual(0);
    expect(selfCheckIdx).toBeGreaterThan(sectionIdx);
  });

  it('T03 [critical]: 无词表 (难度 5 / C1) → wordlistConstraint undefined, prompt 无约束段', async () => {
    // C1 无词表 → getLevelTotal 返回 0, 缓存为 null
    await useWordlistStore.getState().getLevelTotal('en', 5);
    expect(getCachedWordlist('en', 5)).toBeNull();

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({
      text: buildJsonFromLemmas(
        ['cat', 'sit', 'mat', 'run', 'big', 'red', 'sun', 'hat', 'dog', 'pen'],
        5
      ),
    });
    const buildPromptSpy = vi.spyOn(promptsModule, 'buildPassagePrompt');

    await generatePassage('en', 5, [], undefined, true);

    // 0 breaking change: 无词表时不传约束
    expect(buildPromptSpy.mock.calls[0][3]).toBeUndefined();

    const { prompt } = buildPromptSpy.mock.results[0].value as { prompt: string };
    expect(prompt).not.toContain('Wordlist constraint');
  });

  it('T04 [critical]: passage 命中词表内词 → markWordLearning (状态 learning)', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    const lemmas = wordlist.words
      .map((w) => w.lemma)
      .filter((l) => /^[a-z]+$/.test(l));
    // 取中段词作探针, 避开头部 (targetWords 选词区) 以免前置语义混淆过滤干扰
    const probe = lemmas[5];
    expect(useWordlistStore.getState().getWordStatus('en', probe)).toBe('unseen');

    // 9 个词表内词 (>= 8, 不触发 wordlist 补偿)
    const covered = lemmas.slice(3, 12);
    expect(covered).toContain(probe);

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({
      text: buildJsonFromLemmas(covered),
    });

    await generatePassage('en', 1, [], undefined, true);

    // 覆盖校验: passage 中词表内词被标记 learning
    expect(useWordlistStore.getState().getWordStatus('en', probe)).toBe('learning');
  });

  it('T05: passage 中词表外词不标记 (状态保持 unseen)', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    const inList = wordlist.words
      .map((w) => w.lemma)
      .filter((l) => /^[a-z]+$/.test(l))[0];

    // 9 个 token: 1 个词表内 + 8 个确定不在 A1 词表的词 (>= 8, 不触发补偿)
    const outsideWords = [
      'photosynthesis',
      'quarantine',
      'bureaucracy',
      'entrepreneur',
      'infrastructure',
      'jurisdiction',
      'kaleidoscope',
      'metamorphosis',
    ];
    for (const w of outsideWords) {
      expect(
        wordlist.words.some((e) => e.lemma.toLowerCase() === w.toLowerCase())
      ).toBe(false);
    }

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({
      text: buildJsonFromLemmas([inList, ...outsideWords]),
    });

    await generatePassage('en', 1, [], undefined, true);

    // 词表内词被标记
    expect(useWordlistStore.getState().getWordStatus('en', inList)).toBe('learning');
    // 词表外词不标记
    for (const w of outsideWords) {
      expect(useWordlistStore.getState().getWordStatus('en', w)).toBe('unseen');
    }
  });
});
