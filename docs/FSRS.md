# FSRS 算法使用文档

## 概述

FSRS（Free Spaced Repetition Scheduler）是一种基于动态间隔重复的遗忘算法，由 SuperMemo 的 DSR 模型扩展而来。Wordaydream 使用 `ts-fsrs` 库实现 FSRS 算法，用于智能安排词汇复习时间。

## 核心概念

### 遗忘曲线

FSRS 基于以下遗忘曲线公式：

```
R = exp(-t/S) * (1 - D) + D
```

其中：
- `R`：回忆概率（0-1）
- `t`：距离上次复习的时间（天）
- `S`：稳定性（stability）
- `D`：难度（difficulty）

### 四个评分等级

| 评分 | 含义 | 对稳定性的影响 |
|------|------|---------------|
| Again | 重来，完全忘记 | 降低稳定性 |
| Hard | 困难，勉强记住 | 小幅提升稳定性 |
| Good | 良好，正常记住 | 中等提升稳定性 |
| Easy | 简单，轻松记住 | 大幅提升稳定性 |

## 记忆卡片状态

### 生命周期

```
new → learning → review → relearning → review
        ↑              ↓         ↑
        └──────────────┘         └── lapses
```

### 状态定义

| 状态 | 说明 | 条件 |
|------|------|------|
| new | 新卡片 | reps = 0 |
| learning | 学习中 | reps > 0 且未进入复习阶段 |
| review | 复习中 | 已完成初始学习 |
| relearning | 重新学习 | 遗忘后重新学习 |

## FSRS 参数

### MemoryCard 中的参数

```typescript
interface MemoryCard {
  stability: number;    // 稳定性：越高代表记忆越牢固
  difficulty: number;   // 难度：0-1，越高代表越难
  elapsedDays: number;  // 已过去天数
  scheduledDays: number; // 计划间隔天数
  reps: number;         // 复习次数
  lapses: number;       // 遗忘次数
  due: number;          // 下次复习时间戳
  status: 'new' | 'learning' | 'review' | 'relearning';
}
```

### 参数含义

| 参数 | 范围 | 含义 |
|------|------|------|
| stability | > 0 | 记忆稳定性，决定复习间隔长度 |
| difficulty | 0-1 | 词汇难度，0 最简单，1 最难 |
| reps | ≥ 0 | 累计复习次数 |
| lapses | ≥ 0 | 累计遗忘次数 |
| elapsedDays | ≥ 0 | 距离上次复习的天数 |
| scheduledDays | > 0 | 计划下次复习的间隔天数 |

## 使用流程

### 创建新卡片

```typescript
import { Card, FSRS } from 'ts-fsrs';

const fsrs = new FSRS();
const card = fsrs.next(card, 'good'); // 初始评分
```

### 评分并更新

```typescript
const reviewRecord = fsrs.next(card, rating);
// reviewRecord.card: 更新后的卡片
// reviewRecord.nextReview: 下次复习时间
```

### 获取待复习卡片

```typescript
const now = Date.now();
const dueCards = Array.from(cards.values()).filter(card => card.due <= now);
```

## 项目中的实现

### SchedulerAdapter

`SchedulerAdapter` 封装了 FSRS 的调用逻辑：

```typescript
class SchedulerAdapter {
  private fsrs = new FSRS();

  rateCard(card: MemoryCard, rating: Rating): ReviewUpdate {
    const fsrsCard = this.toFSRSCard(card);
    const record = this.fsrs.next(fsrsCard, rating);
    return this.fromFSRSRecord(record);
  }
}
```

### 评分映射

```typescript
const ratingMap: Record<Rating, Rating> = {
  again: 'again',
  hard: 'hard',
  good: 'good',
  easy: 'easy',
};
```

## 掌握判断

项目中定义掌握的标准：

```typescript
// 状态为 review，且复习次数 ≥ 3，且无遗忘记录
const isMastered = card.status === 'review' && card.reps >= 3 && card.lapses === 0;
```

## 数据分析

### 复习统计

```typescript
getReviewStats(): { due: number; mastered: number; total: number }
```

### 难度分布

```typescript
getDifficultyDistribution(): DifficultyDistribution[]
```

### 掌握率

```typescript
getMasteryRate(): number // 0-100
```

## 最佳实践

### 评分建议

| 场景 | 推荐评分 |
|------|---------|
| 完全不知道 | Again |
| 想了很久才想起 | Hard |
| 正常回忆 | Good |
| 轻松回忆 | Easy |

### 学习策略

1. **初期学习**：连续学习直到卡片进入 review 状态
2. **定期复习**：每天完成所有待复习卡片
3. **保持连续**：利用连续学习天数激励自己

## 参考资料

- [FSRS 官方文档](https://github.com/open-spaced-repetition/fsrs)
- [ts-fsrs GitHub](https://github.com/open-spaced-repetition/ts-fsrs)
- [间隔重复学习科学](https://www.supermemo.com/en/archives1990-2015/english/ol/sm2)
