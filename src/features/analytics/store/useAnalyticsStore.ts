import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
// v1.5.3 fix V2-P3-001: 引入 useStreakStore 作为 streak 唯一来源
import { useStreakStore } from '../../streak/store/useStreakStore';

/**
 * 每日学习记录
 */
export interface DailyLearningRecord {
  /** 日期字符串 (YYYY-MM-DD) */
  date: string;
  /** 当日学习数量 */
  count: number;
  /** 当日学习时长（分钟） */
  durationMinutes: number;
  /** 当日答题正确数 */
  correctCount: number;
  /** 当日答题总数 */
  totalAnswered: number;
}

/**
 * 分析数据存储接口
 *
 * Stage 1 数据层: 5 个占位 getter (getTotalLearned / getReviewStats /
 * getMasteryRate / getDifficultyDistribution / getMasteryDistribution) 已删除,
 * 相关派生数据由 `features/analytics/hooks/useHomeAnalytics.ts` 替代。
 * 保留每日记录、连续天数等纯统计维度字段。
 */
export interface AnalyticsStore {
  /** 每日学习记录列表 */
  dailyRecords: DailyLearningRecord[];
  /** 最后学习时间戳 */
  lastLearnedAt: number;
  /** 学习开始时间戳（用于计算学习时长） */
  sessionStartTime: number | null;
  /**
   * v1.2.0: LLM JSON 修复累计次数 (jsonrepair 触发累计).
   * 用于监控 LLM 输出质量与配置阈值 (maxAttempts) 是否需要调整.
   */
  llmRepairCount: number;

  /** 添加学习记录 */
  addLearningRecord: (count: number) => void;
  /** 添加答题记录 */
  addAnswerRecord: (isCorrect: boolean) => void;
  /** 开始学习会话 */
  startSession: () => void;
  /** 结束学习会话 */
  endSession: () => void;
  /** v1.2.0: 累加一次 LLM JSON 修复 (jsonrepair 触发) */
  incrementLLMRepair: () => void;
  /** 获取学习曲线数据 */
  getLearningCurve: (days: number) => DailyLearningRecord[];
  /** 获取连续学习天数 */
  getStreak: () => number;
  /** 获取正确率趋势数据 */
  getAccuracyTrend: (days: number) => { date: string; accuracy: number }[];
  /** 获取每日学习时长数据 */
  getDailyDuration: (days: number) => { date: string; duration: number }[];
}

/** 存储架构版本号 */
const SCHEMA_VERSION = 1;

/**
 * 获取今日日期字符串
 *
 * @returns 日期字符串 (YYYY-MM-DD)
 */
function getTodayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * 分析数据存储 Hook
 * 使用 Zustand 管理学习分析数据，支持持久化存储
 */
export const useAnalyticsStore = create<AnalyticsStore>()(
  persist(
    (set, get) => ({
      /** 每日学习记录列表 */
      dailyRecords: [],
      /** 最后学习时间戳 */
      lastLearnedAt: 0,
      /** 学习开始时间戳（用于计算学习时长） */
      sessionStartTime: null,
      /** v1.2.0: LLM JSON 修复累计次数 */
      llmRepairCount: 0,

      /**
       * 添加学习记录
       * 如果今日已有记录则累加，否则创建新记录
       *
       * @param count 学习数量
       */
      addLearningRecord: (count: number) => {
        const today = getTodayString();
        const records = [...get().dailyRecords];
        const existingIndex = records.findIndex((r) => r.date === today);

        if (existingIndex >= 0) {
          records[existingIndex].count += count;
        } else {
          records.push({ date: today, count, durationMinutes: 0, correctCount: 0, totalAnswered: 0 });
        }

        set({
          dailyRecords: records,
          lastLearnedAt: Date.now(),
        });
      },

      /**
       * 添加答题记录
       *
       * @param isCorrect 是否正确
       */
      addAnswerRecord: (isCorrect: boolean) => {
        const today = getTodayString();
        const records = [...get().dailyRecords];
        const existingIndex = records.findIndex((r) => r.date === today);

        if (existingIndex >= 0) {
          records[existingIndex].totalAnswered++;
          if (isCorrect) {
            records[existingIndex].correctCount++;
          }
        } else {
          records.push({
            date: today,
            count: 0,
            durationMinutes: 0,
            correctCount: isCorrect ? 1 : 0,
            totalAnswered: 1,
          });
        }

        set({
          dailyRecords: records,
          lastLearnedAt: Date.now(),
        });
      },

      /**
       * 开始学习会话
       */
      startSession: () => {
        set({ sessionStartTime: Date.now() });
      },

      /**
       * v1.2.0: 累加一次 LLM JSON 修复 (jsonrepair 触发时).
       * 由 jsonParser.parseLLMResponse 在检测到 repaired=true 时调用.
       */
      incrementLLMRepair: () => {
        set((s) => ({ llmRepairCount: s.llmRepairCount + 1 }));
      },

      /**
       * 结束学习会话
       * 计算本次学习时长并累加到今日记录
       */
      endSession: () => {
        const { sessionStartTime, dailyRecords } = get();
        if (!sessionStartTime) return;

        const durationSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
        const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));

        const today = getTodayString();
        const records = [...dailyRecords];
        const existingIndex = records.findIndex((r) => r.date === today);

        if (existingIndex >= 0) {
          records[existingIndex].durationMinutes += durationMinutes;
        } else {
          records.push({ date: today, count: 0, durationMinutes, correctCount: 0, totalAnswered: 0 });
        }

        set({
          dailyRecords: records,
          sessionStartTime: null,
          lastLearnedAt: Date.now(),
        });
      },

      /**
       * 获取学习曲线数据
       * 返回最近指定天数的每日学习记录
       *
       * @param days 天数
       * @returns 学习曲线数据
       */
      getLearningCurve: (days: number) => {
        const records = get().dailyRecords;
        const result: DailyLearningRecord[] = [];
        const today = new Date();

        for (let i = days - 1; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const existing = records.find((r) => r.date === dateStr);
          result.push({
            date: dateStr,
            count: existing?.count || 0,
            durationMinutes: existing?.durationMinutes || 0,
            correctCount: existing?.correctCount || 0,
            totalAnswered: existing?.totalAnswered || 0,
          });
        }

        return result;
      },

      /**
       * 获取连续学习天数
       *
       * v1.5.3 fix V2-P3-001: 统一使用 useStreakStore.currentStreak 作为唯一 streak 来源.
       * 之前从 dailyRecords 独立计算, 与 useStreakStore 可能产生不同结果
       * (e.g. loadSession 后立即退出: streak store 记 1 天, analytics store 记 0 天).
       * 成就引擎用 useStreakStore.currentStreak, 分析面板应用同一来源避免分歧.
       */
      getStreak: () => {
        try {
          return useStreakStore.getState().currentStreak;
        } catch {
          return 0;
        }
      },

      /**
       * 获取正确率趋势数据
       * 返回最近指定天数的每日正确率
       *
       * @param days 天数
       * @returns 正确率趋势数据
       */
      getAccuracyTrend: (days: number) => {
        const records = get().dailyRecords;
        const result: { date: string; accuracy: number }[] = [];
        const today = new Date();

        for (let i = days - 1; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const existing = records.find((r) => r.date === dateStr);
          const accuracy = existing && existing.totalAnswered > 0
            ? Math.round((existing.correctCount / existing.totalAnswered) * 100)
            : 0;
          result.push({ date: dateStr, accuracy });
        }

        return result;
      },

      /**
       * 获取每日学习时长数据
       * 返回最近指定天数的每日学习时长
       *
       * @param days 天数
       * @returns 每日学习时长数据
       */
      getDailyDuration: (days: number) => {
        const records = get().dailyRecords;
        const result: { date: string; duration: number }[] = [];
        const today = new Date();

        for (let i = days - 1; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const existing = records.find((r) => r.date === dateStr);
          result.push({ date: dateStr, duration: existing?.durationMinutes || 0 });
        }

        return result;
      },
    }),
    {
      name: 'wordaydream:analytics',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        dailyRecords: state.dailyRecords,
        lastLearnedAt: state.lastLearnedAt,
        llmRepairCount: state.llmRepairCount,
      }),
    }
  )
);