/**
 * MockLLMProvider 单元测试 (v1.2.0 Stage 1 — T01..T05)
 *
 * 覆盖 SPEC 要求 5 个 case:
 * - T01 [critical]: success fixture 返回合法 passage JSON (默认 + 显式)
 * - T02 [critical]: broken-json fixture 返回 ```json\n{...}\n``` markdown 包裹
 * - T03 [critical]: missing-fields fixture 返回 `{}` (空对象)
 * - T04 [critical]: fuzzy-offsets fixture 返回 valid JSON 但 offset +1 错位
 * - T05 [critical]: throw-network fixture 抛 Error (模拟网络异常)
 *
 * 设计:
 * - 直接构造 MockLLMProvider, 不走 vi.mock 替换 (这是 mockProvider 自身的单测)
 * - 每个 case 用 setFixture() 切换场景, afterEach 用 resetFixture() 复原
 * - 验证点: generate() 返回的 text 字段内容, 或抛出 Error
 * - 5 个 case 全部 critical (跨 stage 集成测试基础设施的核心)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MockLLMProvider,
  resetFixture,
  setFixture,
} from './mockProvider';
import type { PassageJsonPayload } from './jsonParser';

describe('MockLLMProvider fixture (v1.2.0 Stage 1)', () => {
  let provider: MockLLMProvider;

  beforeEach(() => {
    provider = new MockLLMProvider();
  });

  afterEach(() => {
    // 复原 fixture, 避免污染后续测试
    resetFixture();
  });

  it('T01 [critical]: success fixture 返回正确 passage JSON (默认 + 显式)', async () => {
    // 1a. 默认 fixture: 应该是 success + 默认 payload
    const r1 = await provider.generate({ prompt: 'any prompt' });
    expect(typeof r1.text).toBe('string');
    // 解析后是合法 PassageJsonPayload
    const parsed1 = JSON.parse(r1.text) as PassageJsonPayload;
    expect(parsed1.text).toBeTruthy();
    expect(parsed1.tokens).toBeInstanceOf(Array);
    expect(parsed1.tokens.length).toBeGreaterThan(0);
    // text 字段不含 markdown 包裹
    expect(r1.text).not.toContain('```');
    expect(r1.text).not.toContain('markdown');

    // 1b. 显式 setFixture 同样 success
    const customPayload: PassageJsonPayload = {
      title: 'Custom',
      text: 'Hello world',
      tokens: [
        { lemma: 'hello', surfaceForm: 'Hello', startIndex: 0, endIndex: 5, partOfSpeech: 'interjection' },
        { lemma: 'world', surfaceForm: 'world', startIndex: 6, endIndex: 11, partOfSpeech: 'noun' },
      ],
    };
    setFixture({ kind: 'success', payload: customPayload });
    const r2 = await provider.generate({ prompt: 'any prompt' });
    const parsed2 = JSON.parse(r2.text) as PassageJsonPayload;
    expect(parsed2.text).toBe('Hello world');
    expect(parsed2.tokens).toHaveLength(2);
    expect(parsed2.title).toBe('Custom');

    // 1c. provider id 仍为 'mock'
    expect(provider.id).toBe('mock');
  });

  it('T02 [critical]: broken-json fixture 返回 ```json 包裹', async () => {
    setFixture({ kind: 'broken-json' });

    const r = await provider.generate({ prompt: 'any prompt' });

    // 包裹存在
    expect(r.text).toMatch(/^```json/);
    expect(r.text.trim().endsWith('```')).toBe(true);

    // 提取 ```json 内部内容后能 parse
    const inner = r.text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    expect(inner).not.toBeNull();
    const innerJson = inner![1].trim();
    const parsed = JSON.parse(innerJson) as PassageJsonPayload;
    expect(parsed.text).toBeTruthy();
    expect(parsed.tokens).toBeInstanceOf(Array);
    expect(parsed.tokens.length).toBeGreaterThan(0);
    // 内部 JSON 与默认 success payload 相同
    expect(parsed.text).toBe(
      'Anna woke up early. The sun was rising behind the hills. She walked to the kitchen and poured coffee. Birds sang in the garden.'
    );
  });

  it('T03 [critical]: missing-fields fixture 返回 `{}`', async () => {
    setFixture({ kind: 'missing-fields' });

    const r = await provider.generate({ prompt: 'any prompt' });

    // 严格等于 '{}'
    expect(r.text).toBe('{}');
    // parse 后是空对象 (zod 校验会失败, 这是预期)
    const parsed = JSON.parse(r.text) as Record<string, unknown>;
    expect(parsed).toEqual({});
    expect(parsed.text).toBeUndefined();
    expect(parsed.tokens).toBeUndefined();
  });

  it('T04 [critical]: fuzzy-offsets fixture 返回 valid JSON 但 offset +1 错位', async () => {
    setFixture({ kind: 'fuzzy-offsets' });

    const r = await provider.generate({ prompt: 'any prompt' });
    // valid JSON (无 markdown 包裹)
    expect(r.text).not.toContain('```');
    const parsed = JSON.parse(r.text) as PassageJsonPayload;

    // text 字段未变 (offset 错位不影响 text)
    expect(parsed.text).toBe(
      'Anna woke up early. The sun was rising behind the hills. She walked to the kitchen and poured coffee. Birds sang in the garden.'
    );

    // 所有 token 的 startIndex / endIndex 都 +1
    expect(parsed.tokens).toHaveLength(9);
    // 默认 payload 的第一个 token 是 "woke" at [5, 9), fuzzy 后应是 [6, 10)
    expect(parsed.tokens[0].surfaceForm).toBe('woke');
    expect(parsed.tokens[0].startIndex).toBe(6);
    expect(parsed.tokens[0].endIndex).toBe(10);
    // "early" [13, 18) -> [14, 19)
    expect(parsed.tokens[1].surfaceForm).toBe('early');
    expect(parsed.tokens[1].startIndex).toBe(14);
    expect(parsed.tokens[1].endIndex).toBe(19);
    // "garden" [120, 126) -> [121, 127)
    expect(parsed.tokens[8].surfaceForm).toBe('garden');
    expect(parsed.tokens[8].startIndex).toBe(121);
    expect(parsed.tokens[8].endIndex).toBe(127);

    // sanity: 错位 offset 的切片不等于 surfaceForm (alignment 校正场景)
    // text[6..10] = "oke " (4 chars), 与 "woke" 不相等
    const sliced = parsed.text.substring(parsed.tokens[0].startIndex, parsed.tokens[0].endIndex);
    expect(sliced).not.toBe('woke');
    expect(sliced).toBe('oke ');
  });

  it('T05 [critical]: throw-network fixture 抛 Error (模拟网络异常)', async () => {
    setFixture({ kind: 'throw-network' });

    // generate() 必须 reject
    await expect(provider.generate({ prompt: 'any prompt' })).rejects.toThrow();

    // 错误信息含 "network" (确认是模拟网络异常, 而非其他错误)
    let caught: Error | null = null;
    try {
      await provider.generate({ prompt: 'any prompt' });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message.toLowerCase()).toContain('network');

    // 切换到 success 后又能正常返回
    setFixture({ kind: 'success', payload: { text: 'X', tokens: [] } });
    const r = await provider.generate({ prompt: 'any prompt' });
    expect(r.text).toContain('"text":"X"');
  });
});
