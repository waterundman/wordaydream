/**
 * attribute-hap-size 单测 (v1.6.3 S3)
 *
 * 设计要点 (避免平凡通过):
 * - readZipEntries 用**内存构造的真实 zip**验证 (local header + central directory +
 *   EOCD 三段齐全), 而非桩数据 —— 这样签名偏移、字段宽度一旦写错就会失败。
 * - normalizeEntryName 的正向与**反向**用例都测: 既要剥掉真 hash, 也要证明
 *   `course-cover-en` / `divider-sprig` 这类人工命名**不被误剥**。
 * - diffEntries 覆盖碰撞回退 (两个 chunk 归一后同名时必须回退原名), 这是
 *   最容易写出假读数的分支。
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateByTopDir,
  diffEntries,
  normalizeEntryName,
  readZipEntries,
} from './attribute-hap-size.mjs';

/** 构造一个 STORED (不压缩) 的最小 zip, 用于验证 central directory 解析。 */
function buildStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // method = STORED
    local.writeUInt32LE(0, 14); // crc32 (解析不读, 置 0)
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); // method = STORED
    central.writeUInt32LE(0, 16); // crc32
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

describe('attribute-hap-size (v1.6.3 S3)', () => {
  it('T01: readZipEntries 从 central directory 读出条目名与压缩体积', () => {
    const zip = buildStoredZip([
      ['resources/rawfile/dist/index.html', '<html>hello</html>'],
      ['ets/modules.abc', 'abcdefghij'],
    ]);

    const entries = readZipEntries(zip);

    expect(entries.map((e) => e.name)).toEqual([
      'resources/rawfile/dist/index.html',
      'ets/modules.abc',
    ]);
    expect(entries[0].compressedSize).toBe(Buffer.from('<html>hello</html>').length);
    expect(entries[1].compressedSize).toBe(10);
    expect(entries.every((e) => e.method === 0)).toBe(true);
  });

  it('T01b: 非 zip 输入必须抛错, 不能静默返回空', () => {
    expect(() => readZipEntries(Buffer.from('not a zip at all'))).toThrow(/EOCD/);
  });

  it('T02: normalizeEntryName 剥离真 hash, 但保留人工命名', () => {
    // 正向: Vite 内容 hash (含大写/数字) 被剥掉
    expect(normalizeEntryName('assets/HomePage-CmIJDChR.js')).toBe('assets/HomePage.js');
    expect(normalizeEntryName('assets/index-D3adbeef.css')).toBe('assets/index.css');
    expect(normalizeEntryName('assets/ReadingSessionPage-ruMqMb4E.js')).toBe(
      'assets/ReadingSessionPage.js',
    );

    // 反向: 恰好 8 位但纯小写的后缀不是 hash, 不得剥离
    expect(normalizeEntryName('assets/img/course-cover-en.webp')).toBe(
      'assets/img/course-cover-en.webp',
    );
    expect(normalizeEntryName('assets/img/course-cover-de.webp')).toBe(
      'assets/img/course-cover-de.webp',
    );
    // 反向: 长度不足 8 的后缀不剥离
    expect(normalizeEntryName('assets/svg/divider-sprig.svg')).toBe('assets/svg/divider-sprig.svg');
    // 反向: 无扩展名/无后缀的条目原样返回
    expect(normalizeEntryName('ets/modules.abc')).toBe('ets/modules.abc');
  });

  it('T03: diffEntries 在 normalize 下按逻辑模块配对 (改名不等于删旧增新)', () => {
    const before = [{ name: 'a/HomePage-CmIJDChR.js', compressedSize: 100, uncompressedSize: 100, method: 0 }];
    const after = [{ name: 'a/HomePage-DF6kqnqI.js', compressedSize: 140, uncompressedSize: 140, method: 0 }];

    const raw = diffEntries(before, after);
    // 不归一化时: 旧名消失 + 新名出现, 各成一条 (误判)
    expect(raw.onlyBefore).toHaveLength(1);
    expect(raw.onlyAfter).toHaveLength(1);
    expect(raw.rows).toHaveLength(0);

    const norm = diffEntries(before, after, { normalize: true });
    // 归一化后: 配对成 1 条, delta = +40
    expect(norm.rows).toHaveLength(1);
    expect(norm.rows[0].delta).toBe(40);
    expect(norm.onlyBefore).toHaveLength(0);
    expect(norm.onlyAfter).toHaveLength(0);
  });

  it('T04: 归一化碰撞时回退原名, 不产生假差异', () => {
    // 两个 evaluateAnswer chunk 归一后同名 -> 必须回退原名, 各自独立比对
    const before = [
      { name: 'a/evaluateAnswer-CwFlBTiL.js', compressedSize: 35885, uncompressedSize: 35885, method: 0 },
      { name: 'a/evaluateAnswer-CK76Z4JM.js', compressedSize: 77, uncompressedSize: 77, method: 0 },
    ];
    const after = [
      { name: 'a/evaluateAnswer-IGUKAlVq.js', compressedSize: 35885, uncompressedSize: 35885, method: 0 },
      { name: 'a/evaluateAnswer-ZBMyXZ7r.js', compressedSize: 77, uncompressedSize: 77, method: 0 },
    ];

    const { totals } = diffEntries(before, after, { normalize: true });

    // 碰撞回退后总差异为 0 (若错误合并成一条, 会报出 ±357xx 的假差异)
    expect(totals.delta).toBe(0);
    expect(totals.deltaCommon).toBe(0);
  });

  it('T05: totals 三分量自洽 (common + onlyBefore + onlyAfter = total delta)', () => {
    const before = [
      { name: 'x/keep-Aa1Bb2Cc.js', compressedSize: 100, uncompressedSize: 100, method: 0 },
      { name: 'x/gone-Aa1Bb2Cc.js', compressedSize: 50, uncompressedSize: 50, method: 0 },
    ];
    const after = [
      { name: 'x/keep-Zz9Yy8Xx.js', compressedSize: 130, uncompressedSize: 130, method: 0 },
      { name: 'x/new-Zz9Yy8Xx.js', compressedSize: 20, uncompressedSize: 20, method: 0 },
    ];

    const { totals } = diffEntries(before, after, { normalize: true });

    expect(totals.deltaCommon).toBe(30); // keep: 100 -> 130
    expect(totals.deltaOnlyBefore).toBe(-50); // gone
    expect(totals.deltaOnlyAfter).toBe(20); // new
    expect(totals.delta).toBe(30 - 50 + 20);
    expect(totals.delta).toBe(
      totals.deltaCommon + totals.deltaOnlyBefore + totals.deltaOnlyAfter,
    );
  });

  it('T06: aggregateByTopDir 按第一段路径聚合, 并按 |delta| 降序', () => {
    const rows = [
      { name: 'resources/rawfile/a.js', before: 10, after: 20, delta: 10 },
      { name: 'resources/rawfile/b.js', before: 10, after: 15, delta: 5 },
      { name: 'ets/modules.abc', before: 100, after: 40, delta: -60 },
      { name: 'resources.index', before: 1, after: 2, delta: 1 },
    ];

    const agg = aggregateByTopDir(rows);

    expect(agg.map((d) => d.dir)).toEqual(['ets', 'resources', '(root)']);
    expect(agg[0].delta).toBe(-60);
    expect(agg[1].delta).toBe(15);
    expect(agg[1].count).toBe(2);
    expect(agg[2].delta).toBe(1);
  });
});