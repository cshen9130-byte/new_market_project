---
name: ma-fund-nav
description: "查询私募基金资料与净值，搜索备案号，读取协会与管理人信息。当用户要查基金、净值、成立以来业绩或协会备案时使用。必须通过用户自己已连接的 MA 基金数据 MCP 调用，未连接时停止并请用户用本人账号登录。"
description_zh: "查询基金资料与净值（使用本人 MA 账户的基金数据 MCP）"
version: 1.0.0
author: MA
---
# 基金查询与净值

用「MA 基金数据」MCP 查询基金资料和净值。这是只读查询。

## 登录与权限（必须遵守）

1. 只通过用户已经在 WorkBuddy 中连接的「MA 基金数据」或「MA MOM数据」MCP 调用本系统。不要手写 API Key，不要使用环境变量、文档、聊天记录或同事提供的 Key。
2. 若连接器未连接、授权失效，或工具列表为空/报 401，立即停止，请用户点击输入框上方的连接卡片（或到「专家·技能·连接器 → 连接器」里点击 +），用**自己的** MA 系统账号登录并允许授权。然后继续当前任务，不要换一种未授权的方式重试。
3. 不要编造净值、持仓、观点或权限。工具因没有页面权限被隐藏或拒绝时，如实说明「当前账户没有该权限」，让用户去网站管理员处开通，而不是改用别人的身份。
4. 基金数据与 MOM 数据是两个连接器；需要哪边的数据就检查哪边是否已连接。


## 使用的 MCP 工具

连接器：MA 基金数据。

- 不确定名称或备案号时，先用 `fund_search`（参数 `q`，可选 `limit`），再用返回的 `register_number` 调用后续工具。
- 基本资料：`fund_info`
- 单只净值：`fund_price`（可传 `start_date`、`end_date`、`order`）
- 多只或跟踪池整本净值：`fund_price_bulk` 或 `fund_multi_price`
- 业绩与视图：`fund_view`、`fund_advanced_list`
- 公司与协会：`company_info`、`company_fund_list`、`amac_fund`、`amac_fund_search`、`amac_manager`、`amac_manager_funds`
- 估值表走基金数据 HTTP 接口，MCP 只是去调这些接口：`GET /valuation/products`、`GET /valuation/dates`、`GET /valuation/sheet`。工具名分别是 `valuation_products`、`valuation_dates`、`valuation_sheet`。不传 `date` 为最新一天。

## 执行步骤

1. 确认基金数据连接器已连接。否则按上面的登录规则处理。
2. 先搜索再取数，不要猜测备案号。画一只产品的净值曲线时，只调用一次 `fund_search` 和一次 `fund_price`，不要再查资料、业绩或协会。
3. `fund_price` 的 `summary` 已经算好最新净值、`return_pct` 和 `max_drawdown_pct`（`12.07` 表示回撤 12.07%）。直接引用，不要逐点重算。曲线只用 `price_date` 和 `nav`。用户只要求画曲线时，出图并附一行摘要，不要写分段走势复盘。
4. `ret_*` 是百分数数值：`12.4` 表示 12.4%，不是 `0.124`。
5. 示例中的产品名、净值和日期只说明字段形状，以实际返回为准。
6. 本技能不调用知识库或 AI 研究员；那些任务改用对应技能。

## 输出

用户要曲线时，出图并附一行：名称、备案号、最新净值、区间收益率、最大回撤，数值用 `summary`。其它查询用表格或短列表。缺失的字段写「接口未返回」，不要补造。

