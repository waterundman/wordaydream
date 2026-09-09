/**
 * Single source of truth for the ArkWeb JavaScriptProxy contract.
 *
 * API 22 registers synchronous and Promise-returning methods in separate
 * arrays. Keep this registry shared by the production page and native tests
 * so that new bridge capabilities cannot be silently omitted.
 */
export const BRIDGE_NAME: string = 'harmonyBridge';

export const BRIDGE_SYNC_METHODS: string[] = [
  'triggerHapticFeedback',
  'stopSpeech',
  'notifyWebReady',
  'notifyWebContentReady',
];

export const BRIDGE_ASYNC_METHODS: string[] = [
  'getDueCardsCount',
  'registerReminder',
  'readPreferences',
  'writePreferences',
  'upsertCard',
  'deleteCard',
  'getAllCards',
  'getRecentlyReviewedCards',
  'getTodayReviewStats',
  'speak',
  'isSpeechSupported',
  'getSpeechEngines',
  'notifyReviewCompleted',
];

/** AppStorage key for the controller shared with native launch dispatch. */
export const WEB_CONTROLLER_STORAGE_KEY: string = 'webController';

/** AppStorage flag set only after the current Web page installs its handler. */
export const WEB_HANDLER_READY_STORAGE_KEY: string = 'webHandlerReady';

/** Monotonic generation advanced by each explicit Web readiness handshake. */
export const WEB_READY_GENERATION_STORAGE_KEY: string = 'webReadyGeneration';

/** AppStorage flag set only after React commits the current trusted page. */
export const WEB_CONTENT_READY_STORAGE_KEY: string = 'webContentReady';
