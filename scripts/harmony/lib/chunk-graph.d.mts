/**
 * chunk-graph.mjs 的类型声明 (供 vite.config.ts 在 `tsc -b` 下消费; 实现见同名 .mjs).
 */

export declare const CHUNK_GRAPH_FILE_NAME: string;
export declare const CHUNK_GRAPH_SCHEMA: number;

export interface ChunkGraph {
  schema: number;
  generatedBy: string;
  vite?: string;
  versionName?: string;
  chunks: Record<string, string[]>;
}

/** bundle 取 Rollup/Rolldown generateBundle 的第二参数; 实现侧按 type==='chunk' 防御式读取. */
export declare function buildChunkGraph(
  bundle: unknown,
  meta?: { vite?: string; versionName?: string },
): ChunkGraph;

export declare function normalizeChunkEdge(chunkKey: string, edge: string): string | null;

export declare function parseChunkGraph(text: string): ChunkGraph;

export declare function chunkGraphAdjacency(
  graph: ChunkGraph,
  fileSet: Set<string>,
): { adjacency: Map<string, Set<string>>; failures: string[] };
