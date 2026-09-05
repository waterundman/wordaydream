import type { Language } from '../../../types';
import type { ParseResult, PassagePayload } from './jsonParser';
import { useAnalyticsStore } from '../../analytics/store/useAnalyticsStore';

/** Schema identifiers understood by the LLM JSON module Worker. */
export type WorkerSchemaName =
  | 'passage'
  | 'evaluation'
  | 'difficulty'
  | 'gloss'
  | 'generic';

interface LlmJsonWorkerRequest {
  id: number;
  raw: string;
  schemaName: WorkerSchemaName;
  expectedLanguage?: Language;
}

interface LlmJsonWorkerResponse {
  id: number;
  ok: boolean;
  result?: ParseResult<unknown>;
  error?: string;
}

let llmJsonWorker: Worker | null = null;
let llmJsonWorkerUnsupported = false;
let llmJsonRequestCounter = 0;
const pendingRequests = new Map<number, {
  resolve: (result: ParseResult<unknown>) => void;
  reject: (error: Error) => void;
}>();

function disableLlmJsonWorker(error: Error): void {
  const worker = llmJsonWorker;
  llmJsonWorker = null;
  llmJsonWorkerUnsupported = true;
  worker?.terminate();
  for (const [id, pending] of pendingRequests) {
    pendingRequests.delete(id);
    pending.reject(error);
  }
}

function getLlmJsonWorker(): Worker | null {
  if (llmJsonWorkerUnsupported) return null;
  if (llmJsonWorker) return llmJsonWorker;
  if (typeof Worker === 'undefined') {
    llmJsonWorkerUnsupported = true;
    return null;
  }

  try {
    llmJsonWorker = new Worker(
      new URL('../../../workers/llmJsonWorker.ts', import.meta.url),
      { type: 'module' },
    );
    llmJsonWorker.onmessage = (event: MessageEvent) => {
      const response = event.data as LlmJsonWorkerResponse;
      if (!response || typeof response.id !== 'number') return;
      const pending = pendingRequests.get(response.id);
      if (!pending) return;
      pendingRequests.delete(response.id);

      if (!response.ok || !response.result) {
        pending.reject(
          new Error(response.error ?? 'LLM JSON worker failed without error message'),
        );
        return;
      }

      if (response.result.repaired && response.result.ok) {
        try {
          useAnalyticsStore.getState().incrementLLMRepair();
          const nextCount = useAnalyticsStore.getState().llmRepairCount;
          console.info(`[JSON Repair] count=${nextCount} (via worker)`);
        } catch {
          // Analytics must not block parsing.
        }
      }

      pending.resolve(response.result);
    };
    llmJsonWorker.onerror = (error) => {
      console.warn('[jsonParser] Worker error, falling back to main thread:', error);
      disableLlmJsonWorker(new Error('LLM JSON worker crashed'));
    };
    return llmJsonWorker;
  } catch (error) {
    console.warn('[jsonParser] Worker creation failed, falling back to main thread:', error);
    llmJsonWorkerUnsupported = true;
    return null;
  }
}

async function parseOnMainThread<T>(
  raw: string,
  schemaName: WorkerSchemaName,
  expectedLanguage?: Language,
): Promise<ParseResult<T>> {
  const { parseLLMResponseBySchemaName } = await import('./jsonParser');
  return parseLLMResponseBySchemaName<T>(raw, schemaName, expectedLanguage);
}

/**
 * Parse with a module Worker, loading the zod/jsonrepair main-thread fallback
 * only when Workers are unavailable or a previous Worker has been disabled.
 */
export async function parseLLMResponseAsync<T = PassagePayload>(
  raw: string,
  schemaName: WorkerSchemaName = 'passage',
  expectedLanguage?: Language,
): Promise<ParseResult<T>> {
  const worker = getLlmJsonWorker();
  if (!worker) {
    return parseOnMainThread<T>(raw, schemaName, expectedLanguage);
  }

  const id = ++llmJsonRequestCounter;
  const request: LlmJsonWorkerRequest = {
    id,
    raw,
    schemaName,
    expectedLanguage,
  };

  return new Promise<ParseResult<T>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      disableLlmJsonWorker(new Error('LLM JSON worker timeout (60s)'));
    }, 60000);

    pendingRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result as ParseResult<T>);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });

    try {
      worker.postMessage(request);
    } catch (error) {
      clearTimeout(timeout);
      pendingRequests.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** @internal Reset the singleton Worker state for tests. */
export function _resetLlmJsonWorkerForTesting(): void {
  if (llmJsonWorker) {
    llmJsonWorker.terminate();
    llmJsonWorker = null;
  }
  llmJsonWorkerUnsupported = false;
  pendingRequests.clear();
  llmJsonRequestCounter = 0;
}
