/**
 * v0.1.0-harmony Stage 7: 复习提醒通知 (Notifications) 测试
 *
 * 覆盖 test_spec (Stage 7, task_type=external_service):
 * - T01 [critical]: useSettingsStore v7→v8 migrate 注入 notifications 默认值, 其他字段透传
 * - T02 [critical]: useSettingsStore v8 默认值含 notifications: { enabled:true, startHour:8, endHour:22 }
 * - T03 [critical]: SettingsPanel Notifications section 在 supportsNotifications=false (Web) 时渲染 null
 * - T04 [critical]: SettingsPanel Notifications section 在 supportsNotifications=true (鸿蒙) 时渲染开关 + 时间窗
 * - T05 [critical]: useReviewSessionStore.completeReview 触发 window.harmonyBridge.registerReminder
 * - T06 [non-critical]: NotificationService 时间窗延迟逻辑 (00:00→08:00, 23:00→次日08:00, 10:00→立即)
 * - T07 [critical]: detectPlatform().supportsNotifications() — Web=false, 鸿蒙=true
 * - T08 [critical]: Web 端既有测试无 regression (由 npm run test:run 全量验证, 此处不单测)
 *
 * Mock 策略:
 * - T03: jsdom 默认 (Web 环境, supportsNotifications=false), 不需 mock
 * - T04: 模拟 ArkWeb userAgent + window.harmonyBridge (真实 detectPlatform 路径)
 * - T05: mock window.harmonyBridge.registerReminder, setState 注入 useMemoryStore + useReviewSessionStore
 * - T07: 同 T04, 真实 detectPlatform + _resetPlatformCache
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { MemoryCard } from '../../../types';
import type { HarmonyBridge } from '../../../platform/harmonyBridge';
import { detectPlatform, _resetPlatformCache } from '../../../platform/detect';

type BridgeWindow = Window & { harmonyBridge?: HarmonyBridge };

const STORAGE_KEY = 'wordaydream:settings';

function makeCard(
  partial: Partial<MemoryCard> &
    Pick<MemoryCard, 'lexemeGroupId' | 'lemma' | 'objectiveDifficulty'>,
): MemoryCard {
  return {
    id: partial.id ?? `card-${partial.lexemeGroupId}`,
    lexemeGroupId: partial.lexemeGroupId,
    lemma: partial.lemma,
    objectiveDifficulty: partial.objectiveDifficulty,
    firstLearnedAt: partial.firstLearnedAt ?? 1_700_000_000_000,
    lastReviewAt: partial.lastReviewAt ?? partial.firstLearnedAt ?? 1_700_000_000_000,
    learningSteps: partial.learningSteps ?? 0,
    due: partial.due ?? 0,
    stability: partial.stability ?? 0,
    difficulty: partial.difficulty ?? 0,
    elapsedDays: partial.elapsedDays ?? 0,
    scheduledDays: partial.scheduledDays ?? 0,
    reps: partial.reps ?? 0,
    lapses: partial.lapses ?? 0,
    status: partial.status ?? 'new',
  };
}

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  vi.resetModules();
  // 默认 Web 环境: 清理 window.harmonyBridge
  delete (window as BridgeWindow).harmonyBridge;
});

afterEach(() => {
  cleanup();
  _resetPlatformCache();
  // 恢复 navigator.userAgent (T04/T07 可能修改)
  Object.defineProperty(navigator, 'userAgent', {
    value: '',
    configurable: true,
  });
  const w = window as BridgeWindow;
  delete w.harmonyBridge;
});

// ============================================================================
// T01: v7→v8 migrate 注入 notifications 默认值, 其他字段透传
// ============================================================================
describe('T01: useSettingsStore v7→v8 migrate', () => {
  it('v7 persistedState (无 notifications) → migrate 后含 notifications 默认值', async () => {
    const v7Data = {
      state: {
        llm: {
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.3,
          enabled: true,
          timeout: 30,
          maxRetries: 2,
          streaming: false,
          jsonMaxAttempts: 3,
        },
        difficulty: 3,
        theme: 'dark',
        totalSecondsToday: 120,
        lastSessionDate: '2026-07-23',
        fsrsWeights: undefined,
        fsrsWeightsBackup: undefined,
        // 注意: 无 notifications 字段 (v7 旧数据)
      },
      version: 7,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v7Data));

    vi.resetModules();
    const mod = await import('../store/useSettingsStore');
    const store = mod.useSettingsStore.getState();

    // notifications 注入默认值
    expect(store.notifications).toBeDefined();
    expect(store.notifications).toEqual({
      enabled: true,
      startHour: 8,
      endHour: 22,
    });

    // 其他字段透传未丢失
    expect(store.llm.provider).toBe('deepseek');
    expect(store.llm.model).toBe('deepseek-chat');
    expect(store.difficulty).toBe(3);
    expect(store.theme).toBe('dark');
    expect(store.totalSecondsToday).toBe(120);
    expect(store.lastSessionDate).toBe('2026-07-23');
  });
});

// ============================================================================
// T02: v8 默认值包含 notifications: { enabled:true, startHour:8, endHour:22 }
// ============================================================================
describe('T02: useSettingsStore v8 默认 notifications', () => {
  it('fresh store 默认 notifications = { enabled:true, startHour:8, endHour:22 }', async () => {
    vi.resetModules();
    const mod = await import('../store/useSettingsStore');
    const store = mod.useSettingsStore.getState();

    expect(store.notifications).toEqual({
      enabled: true,
      startHour: 8,
      endHour: 22,
    });
  });

  it('setNotifications 更新 notifications 字段 (partial merge)', async () => {
    vi.resetModules();
    const mod = await import('../store/useSettingsStore');
    const store = mod.useSettingsStore;

    store.getState().setNotifications({ enabled: false });
    expect(store.getState().notifications.enabled).toBe(false);
    expect(store.getState().notifications.startHour).toBe(8); // 未改字段保持
    expect(store.getState().notifications.endHour).toBe(22);

    store.getState().setNotifications({ startHour: 9, endHour: 21 });
    expect(store.getState().notifications.startHour).toBe(9);
    expect(store.getState().notifications.endHour).toBe(21);
    expect(store.getState().notifications.enabled).toBe(false);
  });

  it('resetAll 重置 notifications 到默认值', async () => {
    vi.resetModules();
    const mod = await import('../store/useSettingsStore');
    const store = mod.useSettingsStore;

    store.getState().setNotifications({ enabled: false, startHour: 10, endHour: 20 });
    expect(store.getState().notifications.enabled).toBe(false);

    store.getState().resetAll();
    expect(store.getState().notifications).toEqual({
      enabled: true,
      startHour: 8,
      endHour: 22,
    });
  });
});

// ============================================================================
// T03: SettingsPanel Notifications section 在 supportsNotifications=false (Web) 时渲染 null
// ============================================================================
describe('T03: NotificationsSection Web 端渲染 null', () => {
  it('supportsNotifications=false 时 Notifications section 不在 DOM 中', async () => {
    // jsdom 默认 Web 环境: navigator.userAgent 不含 'ArkWeb', window.harmonyBridge undefined
    _resetPlatformCache();
    const cap = detectPlatform();
    expect(cap.supportsNotifications()).toBe(false);

    const { NotificationsSection } = await import('../components/SettingsPanel');
    const { container } = render(<NotificationsSection />);

    // Notifications section 完全不渲染 (返回 null)
    expect(container.querySelector('[data-testid="notifications-section"]')).toBeNull();
    expect(screen.queryByText('Enable review reminders')).toBeNull();
    expect(screen.queryByText('Start time')).toBeNull();
  });
});

// ============================================================================
// T04: SettingsPanel Notifications section 在 supportsNotifications=true (鸿蒙) 时渲染
// ============================================================================
describe('T04: NotificationsSection 鸿蒙端渲染开关 + 时间窗', () => {
  it('supportsNotifications=true 时渲染 Enable review reminders 开关 + Start/End time 选择器', async () => {
    // 模拟鸿蒙 ArkWeb 环境
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 12; HarmonyOS) ArkWeb/5.0.0',
      configurable: true,
    });
    const bridgeStub: HarmonyBridge = {
      getDueCardsCount: () => Promise.resolve(0),
      registerReminder: () => Promise.resolve(undefined),
      readPreferences: () => Promise.resolve(null),
      writePreferences: () => Promise.resolve(undefined),
      triggerHapticFeedback: () => {},
      handleHarmonyLaunch: () => {},
    };
    (window as BridgeWindow).harmonyBridge = bridgeStub;
    _resetPlatformCache();

    const cap = detectPlatform();
    expect(cap.supportsNotifications()).toBe(true);

    const { NotificationsSection } = await import('../components/SettingsPanel');
    render(<NotificationsSection />);

    // 开关可见
    expect(screen.getByText('Enable review reminders')).toBeInTheDocument();
    // Start time / End time 选择器可见 (通过 label 关联)
    expect(screen.getByLabelText('Start time')).toBeInTheDocument();
    expect(screen.getByLabelText('End time')).toBeInTheDocument();
  });

  it('点击开关切换 enabled 状态并调用 writePreferences', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 12; HarmonyOS) ArkWeb/5.0.0',
      configurable: true,
    });
    const writePreferences = vi.fn().mockResolvedValue(undefined);
    const bridgeStub: HarmonyBridge = {
      getDueCardsCount: () => Promise.resolve(0),
      registerReminder: () => Promise.resolve(undefined),
      readPreferences: () => Promise.resolve(null),
      writePreferences,
      triggerHapticFeedback: () => {},
      handleHarmonyLaunch: () => {},
    };
    (window as BridgeWindow).harmonyBridge = bridgeStub;
    _resetPlatformCache();

    const { fireEvent } = await import('@testing-library/react');
    const { NotificationsSection } = await import('../components/SettingsPanel');
    const { useSettingsStore } = await import('../store/useSettingsStore');

    // 确保默认 enabled=true
    useSettingsStore.setState({
      notifications: { enabled: true, startHour: 8, endHour: 22 },
    });

    render(<NotificationsSection />);

    const toggle = screen.getByRole('switch', { name: 'Enable review reminders' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);

    // enabled 切换为 false
    expect(useSettingsStore.getState().notifications.enabled).toBe(false);
    // writePreferences 被调用 (持久化到鸿蒙端)
    expect(writePreferences).toHaveBeenCalled();
  });
});

// ============================================================================
// T05: useReviewSessionStore.completeReview 触发 window.harmonyBridge.registerReminder
// ============================================================================
describe('T05: completeReview 触发 registerReminder', () => {
  it('completeReview("good") 后 registerReminder 被调用 (含 dueAt + cardId)', async () => {
    const registerReminder = vi.fn().mockResolvedValue(undefined);
    const bridgeStub: HarmonyBridge = {
      getDueCardsCount: () => Promise.resolve(0),
      registerReminder,
      readPreferences: () => Promise.resolve(null),
      writePreferences: () => Promise.resolve(undefined),
      triggerHapticFeedback: () => {},
      handleHarmonyLaunch: () => {},
    };
    (window as BridgeWindow).harmonyBridge = bridgeStub;

    const { useMemoryStore } = await import('../../review/store/useMemoryStore');
    const { useReviewSessionStore } = await import('../../review/store/useReviewSessionStore');

    const card = makeCard({
      id: 'card-g1',
      lexemeGroupId: 'g1',
      lemma: 'apple',
      objectiveDifficulty: 2,
      status: 'review',
      due: 0,
      reps: 2,
    });
    useMemoryStore.setState({ cards: new Map([['g1', card]]) });

    // 设置复习会话: queue=[card], currentIndex=0
    useReviewSessionStore.setState({
      mode: 'reviewing',
      queue: [card],
      currentIndex: 0,
      userAnswer: '',
      evaluation: null,
      isEvaluating: false,
      isPaused: false,
      showRatingBar: true,
      results: [],
      startedAt: Date.now(),
    });

    // 调用 completeReview
    useReviewSessionStore.getState().completeReview('good');

    // 等待 fire-and-forget promise 链 settle
    await new Promise((r) => setTimeout(r, 20));

    // registerReminder 被调用 (通过 completeReview → rateCard → registerReminder 链路)
    expect(registerReminder).toHaveBeenCalled();

    // 参数含 dueAt (number) + cardId (string)
    const payload = registerReminder.mock.calls[0][0];
    expect(typeof payload.dueAt).toBe('number');
    expect(payload.cardId).toBe('g1');
  });

  it('window.harmonyBridge === undefined 时 completeReview 不抛错', async () => {
    // Web 环境: 无 harmonyBridge
    expect((window as BridgeWindow).harmonyBridge).toBeUndefined();

    const { useMemoryStore } = await import('../../review/store/useMemoryStore');
    const { useReviewSessionStore } = await import('../../review/store/useReviewSessionStore');

    const card = makeCard({
      id: 'card-g2',
      lexemeGroupId: 'g2',
      lemma: 'book',
      objectiveDifficulty: 1,
      status: 'review',
      due: 0,
      reps: 1,
    });
    useMemoryStore.setState({ cards: new Map([['g2', card]]) });
    useReviewSessionStore.setState({
      mode: 'reviewing',
      queue: [card],
      currentIndex: 0,
      showRatingBar: true,
      results: [],
      startedAt: Date.now(),
    });

    // completeReview 不抛错
    expect(() => useReviewSessionStore.getState().completeReview('good')).not.toThrow();

    await new Promise((r) => setTimeout(r, 20));

    // 卡片状态已更新 (rateCard 主流程未阻塞)
    const updated = useMemoryStore.getState().cards.get('g2');
    expect(updated).toBeDefined();
    expect(updated!.reps).toBe(card.reps + 1);
  });
});

// ============================================================================
// T06: NotificationService 时间窗延迟逻辑 (non-critical, mock 验证)
// ============================================================================
describe('T06: NotificationService 时间窗延迟逻辑', () => {
  /**
   * 复制 NotificationService.computeTriggerAt + applyWindow 逻辑 (纯函数, 便于 vitest 验证).
   * 真机由用户在 DevEco Studio 内验证.
   */
  const MIN_DELAY_MS = 60_000;
  const MS_PER_DAY = 86_400_000;

  interface TestWindow {
    enabled: boolean;
    startHour: number;
    endHour: number;
  }

  function atHour(ts: number, hour: number): number {
    const d = new Date(ts);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  }

  function applyWindow(ts: number, win: TestWindow): number {
    if (win.startHour >= win.endHour) return ts;
    const date = new Date(ts);
    const hour = date.getHours();
    if (hour < win.startHour) return atHour(ts, win.startHour);
    if (hour >= win.endHour) return atHour(ts + MS_PER_DAY, win.startHour);
    return ts;
  }

  function computeTriggerAt(dueAt: number, now: number, win: TestWindow): number {
    if (dueAt <= now || dueAt - now < MIN_DELAY_MS) {
      return applyWindow(now, win);
    }
    return applyWindow(dueAt, win);
  }

  const win: TestWindow = { enabled: true, startHour: 8, endHour: 22 };

  it('00:00 (窗外) → 当日 08:00', () => {
    // 2026-07-24 00:00:00 UTC+8 → hour=0
    const midnight = new Date(2026, 6, 24, 0, 0, 0).getTime();
    const now = midnight - 1000; // dueAt 略早于 now (已过期)
    const trigger = computeTriggerAt(midnight, now, win);
    const expected = atHour(midnight, 8);
    expect(trigger).toBe(expected);
  });

  it('23:00 (窗外) → 次日 08:00', () => {
    const lateEvening = new Date(2026, 6, 24, 23, 0, 0).getTime();
    const now = lateEvening - 1000; // 已过期
    const trigger = computeTriggerAt(lateEvening, now, win);
    const expected = atHour(lateEvening + MS_PER_DAY, 8);
    expect(trigger).toBe(expected);
  });

  it('10:00 (窗内) → 立即触发 (10:00)', () => {
    const morning = new Date(2026, 6, 24, 10, 0, 0).getTime();
    // now === dueAt: dueAt <= now 命中立即路径, applyWindow(morning) 窗内返回 morning
    const now = morning;
    const trigger = computeTriggerAt(morning, now, win);
    expect(trigger).toBe(morning); // 窗内, 不延迟
  });

  it('dueAt 在未来 1 小时, 落在窗内 → 保持 dueAt', () => {
    const now = new Date(2026, 6, 24, 10, 0, 0).getTime();
    const dueAt = now + 3_600_000; // 1 小时后 (11:00, 窗内)
    const trigger = computeTriggerAt(dueAt, now, win);
    expect(trigger).toBe(dueAt);
  });

  it('startHour >= endHour (全天允许) → 不延迟', () => {
    const allDayWin: TestWindow = { enabled: true, startHour: 0, endHour: 0 };
    const midnight = new Date(2026, 6, 24, 0, 0, 0).getTime();
    // now === dueAt: dueAt <= now 命中立即路径, applyWindow 全天允许返回原值
    const now = midnight;
    const trigger = computeTriggerAt(midnight, now, allDayWin);
    expect(trigger).toBe(midnight); // 全天允许, 不延迟
  });

  it('enabled=false → 调用方应跳过 (computeTriggerAt 仍返回时间, 由 scheduleReviewReminder 守卫)', () => {
    // computeTriggerAt 不检查 enabled, scheduleReviewReminder 在调用前检查 enabled.
    // 此测试验证: 即使 enabled=false, computeTriggerAt 仍正常计算 (不崩溃).
    const disabledWin: TestWindow = { enabled: false, startHour: 8, endHour: 22 };
    const morning = new Date(2026, 6, 24, 10, 0, 0).getTime();
    const now = morning - 1000;
    const trigger = computeTriggerAt(morning, now, disabledWin);
    expect(typeof trigger).toBe('number');
  });
});

// ============================================================================
// T07: detectPlatform().supportsNotifications() — Web=false, 鸿蒙=true
// ============================================================================
describe('T07: PlatformCapability.supportsNotifications', () => {
  it('detectPlatform() 返回对象含 supportsNotifications 方法', () => {
    _resetPlatformCache();
    const cap = detectPlatform();
    expect(typeof cap.supportsNotifications).toBe('function');
  });

  it('Web 端 (无 ArkWeb UA) → supportsNotifications=false', () => {
    // jsdom 默认 navigator.userAgent 不含 'ArkWeb'
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      configurable: true,
    });
    delete (window as BridgeWindow).harmonyBridge;
    _resetPlatformCache();
    const cap = detectPlatform();
    expect(cap.supportsNotifications()).toBe(false);
  });

  it('鸿蒙端 (ArkWeb UA + harmonyBridge) → supportsNotifications=true', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 12; HarmonyOS) ArkWeb/5.0.0',
      configurable: true,
    });
    const bridgeStub: HarmonyBridge = {
      getDueCardsCount: () => Promise.resolve(0),
      registerReminder: () => Promise.resolve(undefined),
      readPreferences: () => Promise.resolve(null),
      writePreferences: () => Promise.resolve(undefined),
      triggerHapticFeedback: () => {},
      handleHarmonyLaunch: () => {},
    };
    (window as BridgeWindow).harmonyBridge = bridgeStub;
    _resetPlatformCache();
    const cap = detectPlatform();
    expect(cap.isHarmonyOS()).toBe(true);
    expect(cap.supportsNotifications()).toBe(true);
  });

  it('仅 window.harmonyBridge 存在 (无 ArkWeb UA) → supportsNotifications=true', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      configurable: true,
    });
    const bridgeStub: HarmonyBridge = {
      getDueCardsCount: () => Promise.resolve(0),
      registerReminder: () => Promise.resolve(undefined),
      readPreferences: () => Promise.resolve(null),
      writePreferences: () => Promise.resolve(undefined),
      triggerHapticFeedback: () => {},
      handleHarmonyLaunch: () => {},
    };
    (window as BridgeWindow).harmonyBridge = bridgeStub;
    _resetPlatformCache();
    const cap = detectPlatform();
    expect(cap.supportsNotifications()).toBe(true);
  });
});
