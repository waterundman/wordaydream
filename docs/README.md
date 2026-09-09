# Wordaydream 文档索引

## 快速入口

| 你想... | 去哪里 |
|---------|--------|
| 了解项目是什么 | [../README.md](../README.md) |
| 部署到服务器 | [../DEPLOY.md](../DEPLOY.md) |
| 理解整体架构 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 了解 FSRS 算法 | [FSRS.md](FSRS.md) |
| 配置 LLM Provider | [LLM.md](LLM.md) |
| 运维手册 | [OPERATIONS.md](OPERATIONS.md) |
| 查看版本历史 | [../CHANGELOG.md](../CHANGELOG.md) |

---

## 技术文档

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Feature-Sliced Design 架构、Zustand Store 结构、数据流、LLM 集成、错误处理 |
| [FSRS.md](FSRS.md) | FSRS 间隔重复算法原理、遗忘曲线公式、评分等级、卡片生命周期 |
| [LLM.md](LLM.md) | LLM Provider 配置 (Mock/OpenAI/Anthropic/DeepSeek)、Edge Function 代理、灰度发布 |
| [OPERATIONS.md](OPERATIONS.md) | 运维手册：Netlify 部署、API key 配置、Lighthouse 跑分、Playwright E2E |
| [llm-router-guide.md](llm-router-guide.md) | LLM Router 配置全规格指南：国内外厂商、聚合路由、OpenRouter 配置 |

---

## 版本规范 (spec/)

每个版本的合同规范文档，记录该版本的设计目标、数据契约和验收标准：

| 版本 | 主题 |
|------|------|
| [v0.8.0](spec/v0.8.0/main.md) | 阅读主舞台视觉连续性 |
| [v0.9.0](spec/v0.9.0/main.md) | 功能完整性 |
| [v1.0.0](spec/v1.0.0/main.md) | 数据可信 + 状态持久 + 移动合规 (正式版基线) |
| [v1.1.0](spec/v1.1.0/main.md) | 真实 LLM 集成 |
| [v1.2.0](spec/v1.2.0/main.md) | 段落达标率 + 划线精准度 |
| [v1.3.0](spec/v1.3.0/main.md) | Edge Function 代理架构 |
| [v1.4.0](spec/v1.4.0/main.md) | 函数式 Provider 路由 |
| [v1.4.1](spec/v1.4.1/main.md) | Streaming + PWA |
| [v1.5.0](spec/v1.5.0/main.md) | PWA 升级 + 灰度发布 |
| [v1.5.1](spec/v1.5.1/main.md) | 4 阻塞点文档化 + 主页布局优化 |
| [v1.5.2](spec/v1.5.2/main.md) | 主题切换 + 阅读时长 + 滚动进度条 + 函数化推广 (当前版本) |

---

## 版本反思 (vault/)

| 文档 | 说明 |
|------|------|
| [v1.5.2-history.md](vault/v1.5.2-history.md) | v1.5.2 版本反思：关键收获、失败教训、下一版方向 |
| [v1.5.3-NEXT-VERSION-DIRECTION.md](vault/v1.5.3-NEXT-VERSION-DIRECTION.md) | v1.5.3 规划：用户认证 (Supabase Auth)、i18n、词卡复习 |

---

## 归档报告 (reports/)

历史代码审查和 E2E 测试报告，按版本归档：

### 代码审查报告

| 文档 | 说明 |
|------|------|
| [CODE_REVIEW_REPORT_V4.md](reports/CODE_REVIEW_REPORT_V4.md) | V4 审查：V3 修复回归 + 持久化迁移 + PWA/SW (最新) |

初版审查报告 (V1–V3) 已归档至 [archive/](archive/)。

### E2E 测试报告

| 文档 | 说明 |
|------|------|
| [E2E_REPORT_v110.md](reports/E2E_REPORT_v110.md) | v1.1.0 E2E |
| [E2E_REPORT_v120.md](reports/E2E_REPORT_v120.md) | v1.2.0 E2E |
| [E2E_REPORT_v130.md](reports/E2E_REPORT_v130.md) | v1.3.0 E2E |
| [E2E_REPORT_v140.md](reports/E2E_REPORT_v140.md) | v1.4.0 E2E |
| [E2E_REPORT_v141.md](reports/E2E_REPORT_v141.md) | v1.4.1 E2E |
| [E2E_REPORT_v150.md](reports/E2E_REPORT_v150.md) | v1.5.0 E2E |
| [E2E_REPORT_v151.md](reports/E2E_REPORT_v151.md) | v1.5.1 E2E |
| [E2E_REPORT_v152.md](reports/E2E_REPORT_v152.md) | v1.5.2 E2E (最新, 30/30 contracts PASS) |

---

## 历史归档 (archive/)

早期版本的过程文档，仅供追溯，不再维护：

| 目录 | 内容 |
|------|------|
| [archive/bayesian/](archive/bayesian/) | v0.1.0–v0.3.0-harmony、v2.3.0 的 Bayesian 规划/状态/历史记录 |
| [archive/release/](archive/release/) | v0.2.0–v0.3.0-harmony 的发布清单、性能基线、技术路径、审计报告、INDEX |
| [archive/CODE_REVIEW_REPORT*.md](archive/) | 初版代码审查报告 (V1–V3，最新为 [V4](reports/CODE_REVIEW_REPORT_V4.md)) |

> 一次性数据修复/生成脚本 (v0.3.0 时代) 已随仓库清理移除，其产出结果均已体现在对应文档中。
