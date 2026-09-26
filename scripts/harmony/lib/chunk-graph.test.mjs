/**
 * chunk-graph.test.mjs — M5 chunk 依赖图单测 (scripts/harmony/lib/chunk-graph.mjs)
 *
 * 覆盖正向通道两端:
 *   - buildChunkGraph      : generateBundle 侧从 bundle 提取邻接表 (Vite/rolldown 字段形态)
 *   - normalizeChunkEdge   : 两种边形态 (outDir 相对 / './x' 相对引用方) + 越界与绝对路径拒绝
 *   - parseChunkGraph      : schema 与结构校验
 *   - chunkGraphAdjacency  : 与产物集合对齐后的邻接表 + 陈旧图显式失败
 *
 * 0 emoji. 纯内存, 不跑构建.
 */
import { describe, expect, it } from 'vitest';

import {
  CHUNK_GRAPH_FILE_NAME,
  CHUNK_GRAPH_SCHEMA,
  buildChunkGraph,
  chunkGraphAdjacency,
  normalizeChunkEdge,
  parseChunkGraph,
} from './chunk-graph.mjs';

describe('M5 buildChunkGraph', () => {
  const bundle = {
    'assets/index-abc.js': {
      type: 'chunk',
      imports: ['./vendor-def.js', 'assets/preload-helper-ghi.js'],
      dynamicImports: ['./route-1.js'],
      viteMetadata: { importedCss: new Set(['assets/index.css']) },
    },
    'assets/route-1.js': {
      type: 'chunk',
      // rolldown 实测: imports 可能为空数组, CSS 边只在 viteMetadata 里
      imports: [],
      dynamicImports: [],
      viteMetadata: { importedCss: new Set(['assets/route-1.css']) },
    },
    'assets/route-1.css': { type: 'asset', fileName: 'assets/route-1.css' },
    'index.html': { type: 'asset', fileName: 'index.html' },
  };

  it('只为 chunk 建键, asset 不进图', () => {
    const graph = buildChunkGraph(bundle, { vite: '8.1.3' });
    expect(Object.keys(graph.chunks).sort()).toEqual(['assets/index-abc.js', 'assets/route-1.js']);
  });

  it('合并 imports / dynamicImports / importedCss 并排序去重', () => {
    const graph = buildChunkGraph(bundle, { vite: '8.1.3' });
    expect(graph.chunks['assets/index-abc.js']).toEqual([
      './route-1.js',
      './vendor-def.js',
      'assets/index.css',
      'assets/preload-helper-ghi.js',
    ]);
    expect(graph.chunks['assets/route-1.js']).toEqual(['assets/route-1.css']);
  });

  it('schema / generatedBy / vite 溯源字段齐备', () => {
    const graph = buildChunkGraph(bundle, { vite: '8.1.3', versionName: '1.6.2' });
    expect(graph.schema).toBe(CHUNK_GRAPH_SCHEMA);
    expect(graph.generatedBy).toBe('vite.config.ts:harmony-chunk-graph');
    expect(graph.vite).toBe('8.1.3');
    expect(graph.versionName).toBe('1.6.2');
  });

  it('对缺失字段与 Set/数组两种形态都容错', () => {
    const graph = buildChunkGraph({
      'assets/a.js': { type: 'chunk' },
      'assets/b.js': { type: 'chunk', imports: undefined, viteMetadata: { importedCss: ['assets/b.css'] } },
      'assets/c.js': { type: 'chunk', imports: ['assets/c.js'] },
    });
    expect(graph.chunks['assets/a.js']).toEqual([]);
    expect(graph.chunks['assets/b.js']).toEqual(['assets/b.css']);
    // 自环保留原样 (由消费方按可达性判断, 不在此处加工)
    expect(graph.chunks['assets/c.js']).toEqual(['assets/c.js']);
  });

  it('bundle 为空 / 非法输入不抛异常', () => {
    expect(buildChunkGraph({}).chunks).toEqual({});
    expect(buildChunkGraph(null).chunks).toEqual({});
  });
});

describe('M5 normalizeChunkEdge', () => {
  it('outDir 相对路径原样接受', () => {
    expect(normalizeChunkEdge('assets/index.js', 'assets/index.css')).toBe('assets/index.css');
  });
  it("'./x' 形态按引用方 chunk 目录拼接", () => {
    expect(normalizeChunkEdge('assets/index.js', './index.css')).toBe('assets/index.css');
    expect(normalizeChunkEdge('index.html', './assets/index.js')).toBe('assets/index.js');
  });
  it('越出 outDir 的 ../ 判为非法', () => {
    expect(normalizeChunkEdge('assets/index.js', '../../escape.js')).toBeNull();
    expect(normalizeChunkEdge('index.html', '../escape.js')).toBeNull();
  });
  it('根绝对路径 / 盘符 / 模块 id 一律判为非法 (产物文件名不会是这些形态)', () => {
    expect(normalizeChunkEdge('assets/index.js', '/assets/x.js')).toBeNull();
    expect(normalizeChunkEdge('assets/index.js', 'W:/wordaydream/x.js')).toBeNull();
    expect(normalizeChunkEdge('assets/index.js', 'W:\\wordaydream\\x.js')).toBeNull();
    expect(normalizeChunkEdge('assets/index.js', 'src/main.tsx')).toBe('src/main.tsx');
  });
  it('空串 / 非字符串判为非法', () => {
    expect(normalizeChunkEdge('assets/index.js', '')).toBeNull();
    expect(normalizeChunkEdge('assets/index.js', undefined)).toBeNull();
  });
});

describe('M5 parseChunkGraph', () => {
  it('合法 JSON 往返: build -> stringify -> parse 保持一致', () => {
    const graph = buildChunkGraph({
      'assets/a.js': { type: 'chunk', dynamicImports: ['./b.js'], viteMetadata: { importedCss: new Set(['assets/b.css']) } },
    });
    const text = JSON.stringify(graph, null, 2);
    expect(parseChunkGraph(text)).toEqual(graph);
  });

  it('结构不合法一律抛错 (交调用方决定回退还是失败)', () => {
    expect(() => parseChunkGraph('{}')).toThrow(/chunks/);
    // schema 必须显式带且等于当前版本 —— 手写/旧版文件不能蒙混过关
    expect(() => parseChunkGraph('{"chunks":{}}')).toThrow(/unsupported schema/);
    expect(() => parseChunkGraph('{"schema":1,"chunks":{}}')).not.toThrow();
    expect(() => parseChunkGraph(`{"schema":99,"chunks":{}}`)).toThrow(/unsupported schema/);
    expect(() => parseChunkGraph('{"schema":1,"chunks":{"a.js":"nope"}}')).toThrow(/not an array/);
    expect(() => parseChunkGraph('{"schema":1,"chunks":{"a.js":[1]}}')).toThrow(/non-string/);
    expect(() => parseChunkGraph('not json')).toThrow();
  });

  it('文件名常量与 schema 号被导出 (供 vite.config.ts 与校验器共用)', () => {
    expect(CHUNK_GRAPH_FILE_NAME).toBe('harmony-chunk-graph.json');
    expect(CHUNK_GRAPH_SCHEMA).toBe(1);
  });
});

describe('M5 chunkGraphAdjacency', () => {
  const fileSet = new Set([
    'index.html',
    'assets/index.js',
    'assets/vendor.js',
    'assets/index.css',
  ]);

  it('归一化后的邻接表 + 无失败', () => {
    const graph = parseChunkGraph(JSON.stringify(buildChunkGraph({
      'assets/index.js': {
        type: 'chunk',
        imports: ['./vendor.js'],
        viteMetadata: { importedCss: new Set(['assets/index.css']) },
      },
    })));
    const { adjacency, failures } = chunkGraphAdjacency(graph, fileSet);
    expect(failures).toEqual([]);
    // 顺序 = buildChunkGraph 排序后的顺序 ('./x' 的 '.' 排在 'assets/' 的 'a' 前)
    expect([...adjacency.get('assets/index.js')]).toEqual(['assets/vendor.js', 'assets/index.css']);
    expect(new Set(adjacency.get('assets/index.js'))).toEqual(new Set(['assets/vendor.js', 'assets/index.css']));
  });

  it('图指向不存在的产物 => 显式失败 (陈旧 rawfile/dist 不能静默放行)', () => {
    const { adjacency, failures } = chunkGraphAdjacency(
      { schema: 1, chunks: { 'assets/ghost.js': ['./x.css'], 'assets/index.js': ['./gone.css'] } },
      fileSet,
    );
    expect(failures).toEqual([
      'chunk graph lists missing output file: assets/ghost.js',
      'chunk graph references missing output file: assets/gone.css (from assets/index.js)',
    ]);
    expect([...(adjacency.get('assets/index.js') ?? [])]).toEqual([]);
  });

  it('非法边形态 => unsafe 失败', () => {
    const { failures } = chunkGraphAdjacency(
      { schema: 1, chunks: { 'assets/index.js': ['/assets/abs.css'] } },
      fileSet,
    );
    expect(failures).toEqual(['chunk graph has an unsafe edge from assets/index.js: /assets/abs.css']);
  });

  it('空图 / 缺字段不炸', () => {
    expect(chunkGraphAdjacency(null, fileSet)).toEqual({ adjacency: new Map(), failures: [] });
    expect(chunkGraphAdjacency({ schema: 1, chunks: {} }, fileSet).failures).toEqual([]);
  });
});
