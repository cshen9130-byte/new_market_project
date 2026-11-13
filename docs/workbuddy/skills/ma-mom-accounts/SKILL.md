---
name: ma-mom-accounts
description: "查询 MOM 母基金账户、每日核算、成交持仓、以及单账户监控中心的复权净值和历史明细。当用户问 MOM 账户、盘手持仓、保证金或历史 VaR 时使用。必须通过用户自己已连接的 MA MOM数据 MCP，且账户已开通 MOM数据API。"
description_zh: "查询 MOM 账户、持仓与风险指标（需本人 MOM数据API 权限）"
version: 1.0.0
author: MA
---
# MOM账户与持仓

## 登录与权限（必须遵守）

1. 只通过用户已经在 WorkBuddy 中连接的「MA 基金数据」或「MA MOM数据」MCP 调用本系统。不要手写 API Key，不要使用环境变量、文档、聊天记录或同事提供的 Key。
2. 若连接器未连接、授权失效，或工具列表为空/报 401，立即停止，请用户点击输入框上方的连接卡片（或到「专家·技能·连接器 → 连接器」里点击 +），用**自己的** MA 系统账号登录并允许授权。然后继续当前任务，不要换一种未授权的方式重试。
3. 不要编造净值、持仓、观点或权限。工具因没有页面权限被隐藏或拒绝时，如实说明「当前账户没有该权限」，让用户去网站管理员处开通，而不是改用别人的身份。
4. 基金数据与 MOM 数据是两个连接器；需要哪边的数据就检查哪边是否已连接。


本技能只使用「MA MOM数据」连接器，不要误用基金数据 Key 或基金数据 MCP。

## 使用的 MCP 工具

- 先列账户：`mom_accounts`（可选 `q`）
- 每日核算：`mom_account_daily`
- 成交 / 持仓 / 平仓 / 委托 / 品种 / 出入金：`mom_account_trades`、`mom_account_positions`、`mom_account_closes`、`mom_account_orders`、`mom_account_products`、`mom_account_cashflows`
- 区间风险指标：`mom_account_metrics`（单账户历史模拟法 1 日 VaR）
- 日间风控报告走 HTTP，MCP 只是去调这些接口：`GET /risk/var`、`GET /risk/margin`、`GET /risk/var-forecast`、`GET /risk/marginal`。工具名是 `mom_risk_var`、`mom_risk_margin`、`mom_risk_var_forecast`、`mom_risk_marginal`。这是风控页的参数法 VaR、保证金风险度和次日预测，不是 `mom_account_metrics`。
- 要历史时：保证金曲线给 `mom_risk_margin` 传 `history=1`；VaR 回测给 `mom_risk_var_forecast` 传 `history=1`（大约最近 180 个交易日）；板块边际贡献历史用 `mom_risk_marginal`。库里没有单独的 VaR 结果表。
- 单账户监控中心：`cfmmc_accounts`、`cfmmc_account_nav`、`cfmmc_account_daily`、`cfmmc_account_positions`、`cfmmc_account_trades`、`cfmmc_account_closes`、`cfmmc_rows`

内部账户（国信 / GUOXIN / GUOSEN / 665300200077）不会出现。不要编造账号；一律以接口返回为准。

查「国泰君安期货 85121150」的净值时，调用 `cfmmc_account_nav`，`account` 填 `85121150`，`company` 填 `国泰君安期货`。还原开平仓节奏时传入 `start_date` 和 `end_date`。持仓不传日期时只含最近一个交易日。

## 执行步骤

1. 确认 MOM 连接器已连接，且账户已开通 MOM数据API。401/403 时按登录与权限规则处理。
2. 先列账户再查明细。
3. `margin_usage` 是小数，0.35 表示 35%。`ret_*` 类字段按接口说明解读。
4. 金额字段若是文本（结算单原文），保持原样，不要把「--」收成 0。

