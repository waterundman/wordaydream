import { validateCardId, validateLaunchQuery } from './bridgeInputValidator';

export type HarmonyLaunchAction =
  | { type: 'startReview' }
  | { type: 'openCard'; cardId: string };

export type HarmonyLaunchActionHandler = (
  action: HarmonyLaunchAction,
) => void | Promise<void>;

interface StoredHarmonyLaunch {
  id: string;
  query: string;
}

const OPEN_CARD_PREFIX = 'action=openCard&cardId=';
export const HARMONY_LAUNCH_QUEUE_STORAGE_KEY =
  'wordaydream:harmony-launch-queue';
let launchIdCounter = 0;

function readStoredLaunches(): StoredHarmonyLaunch[] {
  try {
    const raw = window.localStorage.getItem(HARMONY_LAUNCH_QUEUE_STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is StoredHarmonyLaunch =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as StoredHarmonyLaunch).id === 'string' &&
        typeof (entry as StoredHarmonyLaunch).query === 'string',
    );
  } catch {
    return [];
  }
}

function writeStoredLaunches(entries: StoredHarmonyLaunch[]): void {
  window.localStorage.setItem(
    HARMONY_LAUNCH_QUEUE_STORAGE_KEY,
    JSON.stringify(entries),
  );
}

function persistLaunch(query: string): void {
  const entries = readStoredLaunches();
  let id: string;
  do {
    id = `${Date.now()}-${++launchIdCounter}`;
  } while (entries.some((entry) => entry.id === id));
  writeStoredLaunches([...entries, { id, query }]);
}

function removeStoredLaunch(id: string): boolean {
  try {
    writeStoredLaunches(
      readStoredLaunches().filter((entry) => entry.id !== id),
    );
    return true;
  } catch {
    // Keep the entry for a future page load when storage becomes writable.
    return false;
  }
}

export function parseHarmonyLaunchQuery(input: unknown): HarmonyLaunchAction | null {
  if (typeof input !== 'string' || !validateLaunchQuery(input)) {
    return null;
  }
  if (input === 'action=startReview') {
    return { type: 'startReview' };
  }
  if (!input.startsWith(OPEN_CARD_PREFIX)) {
    return null;
  }
  const cardId = input.slice(OPEN_CARD_PREFIX.length);
  if (!validateCardId(cardId)) {
    return null;
  }
  return { type: 'openCard', cardId };
}

export function installHarmonyLaunchHandler(
  handleAction: HarmonyLaunchActionHandler,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const previousHandler = window.handleHarmonyLaunch;
  let disposed = false;
  let draining = false;

  const drainNext = (): void => {
    if (disposed || draining) {
      return;
    }
    const entry = readStoredLaunches()[0];
    if (entry === undefined) {
      return;
    }
    const action = parseHarmonyLaunchQuery(entry.query);
    if (action === null) {
      if (removeStoredLaunch(entry.id)) {
        drainNext();
      }
      return;
    }

    draining = true;
    try {
      Promise.resolve(handleAction(action))
        .then(() => {
          draining = false;
          if (removeStoredLaunch(entry.id)) {
            drainNext();
          }
        })
        .catch(() => {
          draining = false;
        });
    } catch {
      draining = false;
    }
  };

  const installedHandler = (query: string): void => {
    if (parseHarmonyLaunchQuery(query) === null) {
      return;
    }
    persistLaunch(query);
    drainNext();
  };

  window.handleHarmonyLaunch = installedHandler;
  drainNext();

  return () => {
    disposed = true;
    if (window.handleHarmonyLaunch !== installedHandler) {
      return;
    }
    if (previousHandler === undefined) {
      delete window.handleHarmonyLaunch;
    } else {
      window.handleHarmonyLaunch = previousHandler;
    }
  };
}
