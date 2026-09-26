/**
 * chunk-graph.mjs — harmony 构建 chunk 依赖邻接表的「生产 + 消费」共享助手 (M5)
 *
 * 背景: verify-harmony-build.mjs 过去用正则逆向 Vite 运行时的 `__vite__mapDeps`
 * 数组来还原 chunk -> (JS/CSS) 的预加载依赖边, 再做可达性 BFS. 那是对打包器
 * 内部代码形态的依赖: Vite/rolldown 改一下 helper 拼写, 可达性校验就会误报或
 * 静默漏判.
 *
 * 现在改为正向通道: vite.config.ts 的 harmony 构建在 generateBundle 阶段用本文件的
 * buildChunkGraph(bundle) 把 chunk 邻接表写成 dist/harmony-chunk-graph.json,
 * 校验器优先消费该 JSON (正则路径仅保留为「文件缺失时的 fallback」).
 *
 * 只使用公开的 Rollup/Rolldown 输出字段:
 *   - chunk.imports / chunk.dynamicImports        (兄弟 chunk 边)
 *   - chunk.viteMetadata.importedCss              (chunk -> CSS 边, 即 mapDeps 想表达的那层)
 * 两者在 Vite 8 / rolldown 实测返回「相对 outDir」的文件名 (如 assets/index-xxx.css);
 * 但历史上 Rollup 也给出「相对引用方 chunk」的 './x.js' 形态, 因此 normalizeChunkEdge
 * 同时接受这两种形态, 不猜、不做字符串形状假设.
 */

/** 产物里 chunk 依赖图的固定文件名 (与 vite.config.ts 的写入方一致). */
export const CHUNK_GRAPH_FILE_NAME = 'harmony-chunk-graph.json';

/** 当前实现的 schema 版本; 消费方按它决定能否安全使用. */
export const CHUNK_GRAPH_SCHEMA = 1;

function toList(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  return [];
}

/**
 * 纯函数: 从 rollup/rolldown 的 bundle 提取 chunk 邻接表.
 *
 * @param {Record<string, {type: string, imports?: string[], dynamicImports?: string[],
 *            viteMetadata?: {importedCss?: Set<string>|string[]}}>} bundle generateBundle 的 bundle
 * @param {{vite?: string, versionName?: string}} [meta] 溯源信息 (只写入 JSON, 不参与校验)
 * @returns {{schema: number, generatedBy: string, vite?: string, versionName?: string,
 *            chunks: Record<string, string[]>}}
 */
export function buildChunkGraph(bundle, meta = {}) {
  /** @type {Record<string, string[]>} */
  const chunks = {};
  for (const [fileName, item] of Object.entries(bundle ?? {})) {
    if (!item || item.type !== 'chunk') continue;
    const edges = new Set();
    const metadata = item.viteMetadata ?? {};
    for (const dep of [
      ...toList(item.imports),
      ...toList(item.dynamicImports),
      ...toList(metadata.importedCss),
    ]) {
      if (typeof dep === 'string' && dep.length > 0) edges.add(dep);
    }
    chunks[fileName.replace(/\\/g, '/')] = [...edges].sort();
  }
  const graph = {
    schema: CHUNK_GRAPH_SCHEMA,
    generatedBy: 'vite.config.ts:harmony-chunk-graph',
    chunks,
  };
  if (meta.vite) graph.vite = meta.vite;
  if (meta.versionName) graph.versionName = meta.versionName;
  return graph;
}

/**
 * 纯函数: 把邻接表里的一条边归一化为「相对 outDir」的产物路径.
 *
 * 接受形态:
 *   - 'assets/x.css'          已是 outDir 相对路径 -> 原样 (posix normalize)
 *   - './x.js' / '../x.js'    相对引用方 chunk -> 以 chunk 所在目录为基准拼接
 *   - '/x' / 'W:\x' / 'file:…' 绝对路径或模块 id -> 判定为非法边 (返回 null)
 *
 * @param {string} chunkKey 邻接表键 (outDir 相对路径, 正斜杠)
 * @param {string} edge 原始边
 * @returns {string|null} outDir 相对路径; 无法安全归一化时 null
 */
export function normalizeChunkEdge(chunkKey, edge) {
  if (typeof edge !== 'string' || edge.length === 0) return null;
  const raw = edge.replace(/\\/g, '/');
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.includes(':')) return null;
  const joined = raw.startsWith('.')
    ? `${chunkKey.split('/').slice(0, -1).join('/')}/${raw}`
    : raw;
  const normalized = joined.replace(/^\/+/, '');
  // 手工 posix normalize: 解析 '.' 与 '..', 越界则判非法.
  const segments = [];
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join('/') : null;
}

/**
 * 纯函数: 解析并校验 chunk 图 JSON 文本.
 * 结构不合法 (缺 chunks / schema 不匹配 / 边非字符串) 一律抛错, 由调用方决定
 * 是「回退正则」还是「报错」.
 *
 * @param {string} text harmony-chunk-graph.json 内容
 * @returns {{schema: number, chunks: Record<string, string[]>}}
 */
export function parseChunkGraph(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !parsed.chunks || typeof parsed.chunks !== 'object') {
    throw new Error('missing "chunks" object');
  }
  if (parsed.schema !== CHUNK_GRAPH_SCHEMA) {
    throw new Error(`unsupported schema ${String(parsed.schema)} (expected ${CHUNK_GRAPH_SCHEMA})`);
  }
  for (const [chunkKey, edges] of Object.entries(parsed.chunks)) {
    if (!Array.isArray(edges)) throw new Error(`chunk "${chunkKey}" adjacency is not an array`);
    for (const edge of edges) {
      if (typeof edge !== 'string') throw new Error(`chunk "${chunkKey}" has a non-string edge`);
    }
  }
  return { schema: parsed.schema, chunks: parsed.chunks, generatedBy: parsed.generatedBy, vite: parsed.vite };
}

/**
 * 纯函数: 把 chunk 图转成校验器可用的邻接表 (outDir 相对路径 -> Set<target>).
 *
 * 同时产出可读失败项: 图里列出的 chunk 或目标不在产物集合内 => 图与 dist 不同步
 * (通常是 rawfile/dist 半新半旧), 必须显式暴露而不是静默忽略.
 *
 * @param {{chunks: Record<string, string[]>}} graph parseChunkGraph 的结果
 * @param {Set<string>} fileSet 产物相对路径集合
 * @returns {{adjacency: Map<string, Set<string>>, failures: string[]}}
 */
export function chunkGraphAdjacency(graph, fileSet) {
  const adjacency = new Map();
  const failures = [];
  for (const [chunkKey, edges] of Object.entries(graph?.chunks ?? {})) {
    const key = String(chunkKey).replace(/\\/g, '/');
    if (!fileSet.has(key)) {
      failures.push(`chunk graph lists missing output file: ${key}`);
      continue;
    }
    const targets = adjacency.get(key) ?? new Set();
    for (const edge of edges) {
      const target = normalizeChunkEdge(key, edge);
      if (target === null) {
        failures.push(`chunk graph has an unsafe edge from ${key}: ${edge}`);
        continue;
      }
      if (!fileSet.has(target)) {
        failures.push(`chunk graph references missing output file: ${target} (from ${key})`);
        continue;
      }
      targets.add(target);
    }
    adjacency.set(key, targets);
  }
  return { adjacency, failures };
}
