/**
 * buildPassagePrompt 单元测试 (v1.2.0 Stage 4 hotfix P1-B + v1.3.0 Stage 3 P1 CoT)
 *
 * 覆盖 SPEC 要求 10 个 case:
 * - T01 [critical]: buildPassagePrompt({language: 'de'}) -> system 包含 "MUST be in DE"
 * - T02 [critical]: buildPassagePrompt({language: 'en'}) -> system 包含 "MUST be in EN"
 * - T03 [critical]: buildPassagePrompt({language: 'de'}) -> user 包含 "Target language: de"
 * - T04 [critical]: buildPassagePrompt({language: 'de'}) -> user 包含 1 段德文 example passage
 * - T05 [critical]: buildPassagePrompt({language: 'en'}) -> user 包含 1 段英文 example passage
 * - T06 [critical]: 德文 example 含 'der'/'die'/'das'/'und'/'ist' 等典型词
 * - T07 [critical]: 英文 example 不含德文字符 [äöüß]
 * - T08 [non-critical] (v1.3.0 Stage 3 P1 CoT): user 模板顶部 CoT 段含 token list (Step 1) + JSON 格式 (Step 4)
 * - T09 [non-critical] (v1.3.0 Stage 3 P1 CoT): CoT 段强约束 (Step 3 self-check + Step 2 difficulty)
 * - T10 [non-critical] (v1.3.0 Stage 3 P1 CoT): CoT 段多语言支持 (de/en 各有不同 languageName)
 */
import { describe, expect, it } from 'vitest';
import { buildPassagePrompt, __testing__ } from './prompts';

describe('buildPassagePrompt (Stage 4 hotfix P1-B: language 强约束)', () => {
  it('T01: buildPassagePrompt(language="de") -> system 包含 "MUST be in DE"', () => {
    const { system, prompt, expectJson } = buildPassagePrompt('de', 2, []);
    expect(expectJson).toBe(true);
    // system 末尾追加的 "CRITICAL: Output MUST be in German (language code: DE)"
    expect(system).toContain('MUST be in German');
    expect(system).toContain('language code: DE');
    expect(system).toContain('Output MUST be in');
    expect(system).toContain('Do NOT output English');
    // 原始 V2 system 内容保留
    expect(system).toContain('You are a language-learning content generator');
    // user prompt 仍然包含 language
    expect(prompt).toContain('Target language: de');
  });

  it('T02: buildPassagePrompt(language="en") -> system 包含 "MUST be in EN"', () => {
    const { system, prompt, expectJson } = buildPassagePrompt('en', 3, []);
    expect(expectJson).toBe(true);
    expect(system).toContain('MUST be in English');
    expect(system).toContain('language code: EN');
    expect(system).toContain('Output MUST be in');
    expect(prompt).toContain('Target language: en');
  });

  it('T03: buildPassagePrompt(language="de") -> user 包含 "Target language: de"', () => {
    const { prompt } = buildPassagePrompt('de', 2, []);
    // 顶部强约束行
    expect(prompt).toContain('Target language: de');
    // 与原 V2 'Language:' 行并存 (双保险)
    expect(prompt).toContain('Language: German (de).');
  });

  it('T04 [hotfix P1-B 加固]: buildPassagePrompt(language="de") -> user 包含 1 段德文 example passage', () => {
    const { prompt } = buildPassagePrompt('de', 2, []);
    // few-shot 块标志
    expect(prompt).toContain('[Example German passage at difficulty 2]');
    expect(prompt).toContain('[End example]');
    // 真实德文 passage
    expect(prompt).toContain('Anna ging am Morgen');
    expect(prompt).toContain('Der Hund des Nachbarn');
    expect(prompt).toContain('fröhlich');
    // 上下文引导句
    expect(prompt).toContain('Below is a real example of a German passage');
  });

  it('T05 [hotfix P1-B 加固]: buildPassagePrompt(language="en") -> user 包含 1 段英文 example passage', () => {
    const { prompt } = buildPassagePrompt('en', 2, []);
    expect(prompt).toContain('[Example English passage at difficulty 2]');
    expect(prompt).toContain('[End example]');
    expect(prompt).toContain('Anna walked to the small park');
    expect(prompt).toContain('The birds sang loudly');
    expect(prompt).toContain('Below is a real example of a English passage');
  });

  it('T06 [hotfix P1-B 加固]: 德文 example 含 der/die/das/und/ist/ä/ö/ü/ß 等典型词', () => {
    const { prompt } = buildPassagePrompt('de', 2, []);
    // 提取 [Example German passage ...] 块
    const match = prompt.match(/\[Example German passage at difficulty 2\][\s\S]*?\[End example\]/);
    expect(match).toBeTruthy();
    const block = match![0];
    // 冠词 + 连词 + 系动词 (标准德文 50 词, case-insensitive 因为德文名词首大写)
    expect(block).toMatch(/\bder\b/i);
    expect(block).toMatch(/\bdie\b/i);
    expect(block).toMatch(/\bdas\b/i);
    expect(block).toMatch(/\bund\b/i);
    // 变元音 (ä/ö/ü) 或 ß 必须至少出现一个
    expect(block).toMatch(/[äöüß]/);
  });

  it('T07 [hotfix P1-B 加固]: 英文 example 不含德文字符 [äöüß]', () => {
    const { prompt } = buildPassagePrompt('en', 2, []);
    // 提取 [Example English passage ...] 块
    const match = prompt.match(/\[Example English passage at difficulty 2\][\s\S]*?\[End example\]/);
    expect(match).toBeTruthy();
    const block = match![0];
    // 英文 example 不应含德文变元音
    expect(block).not.toMatch(/[äöüß]/);
  });
});

describe('buildPassagePrompt (v1.3.0 Stage 3 P1 CoT — chain-of-thought prefix)', () => {
  it('T08 [v1.3.0 Stage 3 CoT]: user 模板顶部 CoT 段含 token list (Step 1) + JSON 格式 (Step 4)', () => {
    const { prompt } = buildPassagePrompt('de', 2, []);
    // Step 1: token list (key vocabulary words)
    expect(prompt).toMatch(/\[Step 1:\s*Output\s+5-10\s+key\s+vocabulary\s+words\s+in\s+German/);
    // Step 4: JSON 格式
    expect(prompt).toMatch(/\[Step 4:\s*Output\s+as\s+JSON/);
    expect(prompt).toMatch(/\{\s*"text"\s*:\s*"\.\.\."\s*,\s*"tokens"\s*:/);
    // 顶部 CoT 段在 user 模板的最前面 (出现在 "Generate a reading passage." 之前)
    const cotIndex = prompt.indexOf('[Chain-of-thought');
    const generateIndex = prompt.indexOf('Generate a reading passage.');
    expect(cotIndex).toBeGreaterThanOrEqual(0);
    expect(generateIndex).toBeGreaterThanOrEqual(0);
    expect(cotIndex).toBeLessThan(generateIndex);
  });

  it('T09 [v1.3.0 Stage 3 CoT]: CoT 段强约束 (Step 3 self-check + Step 2 difficulty)', () => {
    const { prompt } = buildPassagePrompt('en', 3, []);
    // Step 2: difficulty 数字 (3) 必须出现在 CoT 段中
    expect(prompt).toMatch(/\[Step 2:\s*Write\s+a\s+3-difficulty\s+passage/);
    // Step 3: self-check 5+ 目标语言词
    expect(prompt).toMatch(/\[Step 3:\s*Self-check:\s*verify\s+at\s+least\s+5\s+English\s+words\s+appear\s+in\s+the\s+passage\]/);
    // CoT 段必须在 user 模板最顶部
    expect(prompt.startsWith('\n[Chain-of-thought')).toBe(true);
  });

  it('T10 [v1.3.0 Stage 3 CoT]: CoT 段多语言支持 (de/en 各有不同 languageName)', () => {
    // 直接用 __testing__.buildCotPrefix 验证多语言
    const cotDe = __testing__.buildCotPrefix('de', 2);
    const cotEn = __testing__.buildCotPrefix('en', 2);
    expect(cotDe).toContain('German');
    expect(cotDe).not.toContain('English');
    expect(cotEn).toContain('English');
    expect(cotEn).not.toContain('German');
    // 通过 buildPassagePrompt 验证 user prompt 顶部 CoT 段也含正确 languageName
    const { prompt: promptDe } = buildPassagePrompt('de', 2, []);
    const { prompt: promptEn } = buildPassagePrompt('en', 2, []);
    // 提取 user prompt 顶部 CoT 段 (从开头到 "Generate a reading passage.")
    const cotBlockDe = promptDe.substring(0, promptDe.indexOf('Generate a reading passage.'));
    const cotBlockEn = promptEn.substring(0, promptEn.indexOf('Generate a reading passage.'));
    expect(cotBlockDe).toContain('German');
    expect(cotBlockEn).toContain('English');
  });
});

