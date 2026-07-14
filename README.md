# Wordaydream

**语境化词汇学习应用** - 在真实文本中学习词汇，基于 FSRS 间隔重复算法巩固记忆。

## 核心特性

- 🌍 **双语言支持**：英语和德语
- 📊 **自适应难度**：1-5级难度文本生成
- 🤖 **LLM驱动**：支持 OpenAI/Anthropic 真实文本生成
- 📖 **语法教学**：自动检测语法点并提供解释
- 🧩 **德语复合词拆分**：可视化展示复合词组成
- 🔁 **FSRS复习系统**：科学安排复习时间
- 📈 **学习分析**：追踪学习进度和连续天数
- ⌨️ **键盘友好**：完整快捷键支持

## 快速开始

### 安装

```bash
npm install
```

### 开发

```bash
npm run dev
```

访问 http://localhost:5173

### 构建

```bash
npm run build
```

### 预览

```bash
npm run preview
```

## 使用指南

### 阅读模式

1. 选择语言（英语/德语）和难度等级（1-5）
2. 点击 "Generate New Text" 生成文本
3. 点击文本中的词汇查看释义
4. 点击语法高亮区域学习语法点
5. 标记词汇为已学习，进入记忆库

### 复习模式

1. 点击右侧 MemoryTray 的 "开始复习"
2. 输入词汇的中文释义
3. 系统自动判题（正确/部分/错误）
4. 选择评分（重来/困难/良好/简单）
5. 系统基于 FSRS 算法安排下次复习时间

### 快捷键

**阅读模式**
- `Tab` / `→`：下一个词汇
- `Shift+Tab` / `←`：上一个词汇
- `Enter` / `Space`：激活词汇
- `R`：重新生成文本
- `S`：打开设置
- `Esc`：关闭面板

**复习模式**
- `1-4`：快速评分（重来/困难/良好/简单）
- `←` / `→`：切换评分按钮焦点
- `Enter`：确认当前评分
- `Esc`：暂停复习

## LLM配置

在设置面板配置：

| Provider | 说明 | API Key | Base URL | 默认模型 |
|----------|------|---------|----------|----------|
| **Mock** | 无需API Key，使用内置示例数据 | - | - | - |
| **OpenAI** | 需配置 API Key | `OPENAI_API_KEY` | `https://api.openai.com/v1` | gpt-4o-mini |
| **Anthropic** | 需配置 API Key | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` | claude-3-5-sonnet-20241022 |
| **DeepSeek** | 需配置 API Key | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` | deepseek-chat |

API Key 存储在浏览器 localStorage，不上传服务器。

## 技术栈

- **框架**: React 19 + TypeScript + Vite 8
- **状态管理**: Zustand 5（带持久化中间件）
- **复习算法**: ts-fsrs 5.4.1（Free Spaced Repetition Scheduler）
- **代码规范**: Oxlint 1.71.0

## 项目结构

```
src/
├── domain/                # 领域层 (v2.0.0+ 事件总线 + 领域逻辑)
│   ├── events.ts          # 事件总线 (消除 store 循环依赖)
│   ├── memoryDomain.ts    # 记忆领域逻辑
│   ├── wordlistDomain.ts  # 词表领域逻辑
│   └── storeAccessors.ts  # store 访问器
├── data/                  # 数据层 (v2.0.0+ CSV 词库)
│   └── wordlists/         # CSV/JSON 词库 (en/de, A1-B2)
├── features/              # 功能模块
│   ├── reading/           # 阅读功能模块
│   │   ├── components/    # 阅读相关组件
│   │   ├── services/      # 阅读服务（文本生成等）
│   │   └── store/         # 阅读状态管理
│   ├── review/            # 复习系统模块
│   │   ├── components/    # 复习相关组件（MemoryTray、RatingBar）
│   │   ├── services/      # 复习服务（FSRS调度等）
│   │   └── store/         # 复习状态管理
│   ├── grammar/           # 语法教学模块
│   │   ├── components/    # 语法高亮、复合词展示组件
│   │   └── services/      # 语法检测、复合词拆分服务
│   ├── analytics/         # 学习分析模块
│   │   ├── components/    # 分析图表组件
│   │   └── store/         # 分析数据存储
│   ├── dictionary/        # 字典查询模块
│   │   └── services/      # 字典适配器（Wiktionary集成 + Gloss 缓存）
│   ├── evaluation/        # 答题评估模块
│   │   └── services/      # 答案评估服务
│   ├── llm/               # LLM服务路由模块
│   │   ├── services/      # LLM路由、连接测试
│   │   └── config/        # LLM提示词配置
│   ├── settings/          # 设置管理模块
│   │   ├── components/    # 设置面板组件
│   │   └── store/         # 设置状态管理
│   ├── achievements/      # 成就系统模块
│   │   ├── components/    # 成就 Toast、列表 Modal
│   │   ├── services/      # 成就引擎
│   │   └── store/         # 成就状态管理
│   ├── home/              # 主页模块
│   │   └── components/    # Hero/TodayCard/ProgressRing/AchievementWall
│   ├── streak/            # 连续学习天数模块
│   │   └── store/         # streak 状态管理
│   ├── wordlist/          # 词表浏览模块 (v1.6.0+)
│   │   ├── components/    # 词表行组件
│   │   └── store/         # 词表状态管理
│   ├── graduation/        # 毕业机制模块 (v1.6.0+)
│   │   └── components/    # 毕业弹窗
│   └── difficulty-coupling/ # 难度耦合模块
│       ├── components/    # 难度建议组件
│       └── services/      # 难度评估服务
├── components/            # 通用UI组件
│   ├── ErrorBoundary.tsx  # 全局错误边界
│   ├── EmptyState.tsx     # 通用空状态组件
│   └── ToastContainer.tsx # 全局提示容器
├── hooks/                 # 自定义Hooks
│   ├── useErrorHandler.ts # 统一错误处理
│   └── useKeyboardShortcuts.ts # 快捷键管理
├── types/                 # TypeScript类型定义
│   └── index.ts           # 核心类型定义
└── utils/                 # 工具函数
```

## 核心类型定义

### TokenOccurrence
文本中词汇的具体出现记录，包含词形、位置、解析状态等。

### LexemeGroup
词位组，将同一词位的多个出现记录分组管理。

### GrammarPoint
语法知识点，包含类型、难度、解释和例句。

### MemoryCard
记忆卡片，基于 FSRS 算法的学习卡片，包含稳定性、难度等参数。

### Passage
阅读文章，包含文本内容、词元解析、语法点等完整数据。

## 开发文档

详细技术文档见 `docs/` 目录。

## 版本历史

见 `CHANGELOG.md`。

## License

MIT