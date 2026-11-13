---
name: ma-ai-researcher
description: "对比基金、找相似或相反产品、扫描路演漏洞、整理团队背景与管理人画像。当用户要做研究员对比分析时使用。必须通过用户自己已连接的 MA 基金数据 MCP，且账户具备 AI 研究员权限。"
description_zh: "调用 AI 研究员工具做对比与画像（需本人权限）"
version: 1.0.0
author: MA
---
# AI研究员

## 登录与权限（必须遵守）

1. 只通过用户已经在 WorkBuddy 中连接的「MA 基金数据」或「MA MOM数据」MCP 调用本系统。不要手写 API Key，不要使用环境变量、文档、聊天记录或同事提供的 Key。
2. 若连接器未连接、授权失效，或工具列表为空/报 401，立即停止，请用户点击输入框上方的连接卡片（或到「专家·技能·连接器 → 连接器」里点击 +），用**自己的** MA 系统账号登录并允许授权。然后继续当前任务，不要换一种未授权的方式重试。
3. 不要编造净值、持仓、观点或权限。工具因没有页面权限被隐藏或拒绝时，如实说明「当前账户没有该权限」，让用户去网站管理员处开通，而不是改用别人的身份。
4. 基金数据与 MOM 数据是两个连接器；需要哪边的数据就检查哪边是否已连接。


## 使用的 MCP 工具

连接器：MA 基金数据。账户需要「AI 研究员」权限，否则这些工具不会出现。

- `ai_researcher_compare`：对比几只基金。先看 `resolved` 和 `bindings`。`resolved` 为 false 时 `report` 为 null，不要据此编对比。`same_strategy` 为 false 时不要把这几只排成同一策略。`incomplete_windows` 里的字段不是完整区间业绩。`nav_scope` 为 `parent` 时，净值属于母代码。
- `ai_researcher_similar`、`ai_researcher_opposite`
- `ai_researcher_roadshow`
- `ai_researcher_team_background`、`ai_researcher_manager_profile`

策略评论只引用投资笔记里点名该基金的段落；业绩数字以净值库（工具返回的 `funds` 或 `fund_price` / `fund_view`）为准。

## 执行步骤

1. 确认连接器和 AI 研究员工具可用。
2. 名称不确定时先 `fund_search`。
3. 按用户任务选择上面的工具，不要一次调用所有工具。
4. 需要观点原文时，再使用「知识库问答」技能（`kb_ask`），不要在本技能里编造引文。

