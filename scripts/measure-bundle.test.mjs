/**
 * measure-bundle 单测 (v1.6.1 Stage 5)
 *
 * SPEC §6.1 声明本文件 2 项：
 *   T01 基线 JSON 结构
 *   T02 首屏 JS 汇总正确
 *
 * 设计要点（避免平凡通过）:
 * - 只测**纯函数**（extractFirstScreenUrls / aggregateFirstScreen），因此不依赖 dist/ 是否存在,
 *   在 CI 未构建时也能跑 —— 同时这也顺带证明了「import 本模块不会触发测量」这条契约。
 * - 断言针对**行为差异**而非恒真式: 去重、缺失文件过滤、降序排序、字节求和都构造了会失败的输入。
 */
import { describe, expect, it } from 'vitest';
import { aggregateFirstScreen, extractFirstScreenUrls } from './measure-bundle.mjs';

/** 真实 Vite/rolldown 产出的 index.html 形态（截取了首屏相关片段）。 */
const SAMPLE_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-QTnfLwEv.js">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="modulepreload" crossorigin href="/assets/react-vendor-CCIEwYL0.js">
    <link rel="stylesheet" crossorigin href="/assets/index-D3adbeef.css">
    <link rel="modulepreload" crossorigin href="/assets/index-BqYNlAgW.js">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" crossorigin src="/assets/index-BqYNlAgW.js"></script>
  </body>
</html>`;

describe('measure-bundle (v1.6.1 Stage 5)', () => {
  it('T01: 首屏集合抽取 + 汇总对象结构契约', () => {
    const urls = extractFirstScreenUrls(SAMPLE_HTML);

    // entry <script src> 与 modulepreload <link href> 都要抓到, 顺序 = entry 先、preload 后
    expect(urls).toEqual([
      '/assets/index-BqYNlAgW.js',
      '/assets/rolldown-runtime-QTnfLwEv.js',
      '/assets/react-vendor-CCIEwYL0.js',
      '/assets/index-BqYNlAgW.js',
    ]);
    // stylesheet / icon 不是 JS, 不能被误抓
    expect(urls.some((u) => u.endsWith('.css'))).toBe(false);
    expect(urls.some((u) => u.endsWith('.svg'))).toBe(false);

    const summary = aggregateFirstScreen([
      { url: '/assets/index-BqYNlAgW.js', file: 'dist/assets/index-BqYNlAgW.js', bytes: 3000 },
    ]);

    // SPEC/CLI 依赖的四个字段必须存在且类型正确
    expect(Object.keys(summary).sort()).toEqual(['bytes', 'chunkCount', 'chunks', 'kb']);
    expect(typeof summary.bytes).toBe('number');
    expect(typeof summary.kb).toBe('number');
    expect(typeof summary.chunkCount).toBe('number');
    expect(Array.isArray(summary.chunks)).toBe(true);
  });

  it('T02: 首屏 JS 汇总 —— 去重 / 过滤缺失 / 字节求和 / 降序', () => {
    const summary = aggregateFirstScreen([
      // entry (与下面第二条 preload 指向同一文件 → 必须只算一次)
      { url: '/assets/index-x.js', file: 'dist/assets/index-x.js', bytes: 2048 },
      { url: '/assets/runtime.js', file: 'dist/assets/runtime.js', bytes: 1024 },
      // 重复: 同一 file 再次出现
      { url: '/assets/index-x.js', file: 'dist/assets/index-x.js', bytes: 2048 },
      // 磁盘上不存在 → describe() 会给 bytes=0, 必须被过滤掉
      { url: '/assets/missing.js', file: 'dist/assets/missing.js', bytes: 0 },
      { url: '/assets/vendor.js', file: 'dist/assets/vendor.js', bytes: 4096 },
    ]);

    expect(summary.chunkCount, '重复项与 bytes=0 的缺失项都不应计入').toBe(3);
    expect(summary.bytes).toBe(2048 + 1024 + 4096);
    expect(summary.kb).toBe(Math.round(((2048 + 1024 + 4096) / 1024) * 10) / 10);
    // 降序: 首屏最大 chunk 在第一位（报告表格依赖）
    expect(summary.chunks.map((c) => c.bytes)).toEqual([4096, 2048, 1024]);
    expect(summary.chunks[0].file).toBe('dist/assets/vendor.js');
  });
});
