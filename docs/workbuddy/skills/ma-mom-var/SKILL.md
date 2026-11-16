---
name: ma-mom-var
description: "读取并解释 MOM 母基金的持仓 VaR、边际贡献、次日预测和单账户历史模拟 VaR。当用户问 VaR、在险价值、持仓VaR走势、板块或品种贡献、VaR/资本、集中度或次日预测时使用。必须通过用户自己已连接的 MA MOM数据 MCP，且账户已开通 MOM数据API。"
description_zh: "解释 MOM 持仓 VaR、贡献占比与历史走势（需本人 MOM数据API 权限）"
version: 1.0.0
author: MA
---
# MOM 持仓 VaR

本技能只使用「MA MOM数据」连接器。这是 MOM 母基金日间风控和持仓分析的 VaR，不是单账户监控中心。

## 登录与权限（必须遵守）

1. 只通过用户已经在 WorkBuddy 中连接的「MA MOM数据」MCP 调用本系统。不要手写 API Key，不要使用环境变量、文档、聊天记录或同事提供的 Key。
2. 若连接器未连接、授权失效，或工具列表为空/报 401，立即停止，请用户点击输入框上方的连接卡片（或到「专家·技能·连接器 → 连接器」里点击 +），用**自己的** MA 系统账号登录并允许授权。然后继续当前任务，不要换一种未授权的方式重试。
3. 不要编造 VaR、资本、占比或权限。工具因没有页面权限被隐藏或拒绝时，如实说明「当前账户没有该权限」，让用户去网站管理员处开通，而不是改用别人的身份。
4. 基金数据与 MOM 数据是两个连接器。本技能不使用基金数据 MCP。

## 先分清三套数

| 用户在问 | 口径 | 工具 |
| --- | --- | --- |
| 今天组合 VaR、品种/板块占比、VaR/资本 | 持仓参数法，与「MOM 每日风控 → 日间风控」VaR 沙盒相同 | `mom_risk_var` |
| 过去每个交易日的组合金额和板块/品种贡献 | 已入库的持仓 VaR，表 `public.mom_position_var_daily`，与「持仓VaR走势」默认窗口相同 | `mom_risk_var_history` |
| 换波动或相关窗口后的历史占比 | 按每日持仓现算，只有占比，没有金额 | `mom_risk_marginal` |
| 下一交易日 VaR、突破率、回测 | 用最近持仓估计次日，回测现算 | `mom_risk_var_forecast` |
| 某一个 MOM 资金账号的历史亏损分位 | 历史模拟法：日收益率 = 当日净盈亏 / 上一日客户权益 | `mom_account_metrics` |

单账户监控中心（`cfmmc_*`，国投/监控中心结算单）没有这套参数法 VaR。不要用它回答 MOM 持仓 VaR，也不要把母基金 VaR 安到那些账号上。

保证金风险度用 `mom_risk_margin`，不是 VaR。`risk_ratio` 是保证金 / 基金净值 × 100。

## 默认窗口

页面和入库表的默认是：置信度 95、正态分布、波动 20 日、相关 252 日，z = 1.6449。用户没指定窗口时不要改参数。

`mom_risk_var_history` 只存这一套。传入别的 `confidence`、`vol_days`、`corr_days` 或 `dist` 会直接报错。要别的窗口时：当前持仓用 `mom_risk_var`，历史占比用 `mom_risk_marginal`，并写明这不是已入库走势。

`mom_risk_var_forecast` 的 `dist` 还可以是 `kde`。回测序列要传 `history=1`，大约最近 180 个交易日。`mom_risk_marginal` 默认最近 120 个交易日。`mom_risk_var_history` 默认最近 250 个交易日，`limit` 最大 2000，只保留窗口末尾。

## 字段读法

- `total_var`、`next_day_var`、`component_var` 的单位是元。正的 `total_var` 是组合 1 日亏损金额。对用户写成万元时保留「万元」。同一天各品种的 `component_var` 相加等于 `total_var`，其中可以有负数，不要收成 0。
- `marginal_pct`、`breach_rate`、`risk_ratio`、`var_to_capital_pct` 是百分点。`30` 表示 30%，不是 0.30。集中度看 `marginal_pct`，不要用 `component_var / total_var` 代替饼图。
- `var_to_capital_pct` 和 `cum_capital` 只出现在 `mom_risk_var`。历史接口没有资本。不要拿某一天的 `total_var` 去除自己另找的权益。
- `mom_account_metrics` 里 `var_95_loss = 0.018` 表示 5% 分位的单日亏损大约是上一日权益的 1.8%。`var_95_pnl` 是金额，通常为负。日收益率样本少于 20 时 VaR 为 null，照抄 `var.note`。
- 接口里的板块名「农产」在页面上写成「农产品」。
- 不含国信账户（GUOXIN / GUOSEN / 665300200077）。账号以 `mom_accounts` 的返回为准。
- 返回 `error_code` 非 0，或说明持仓 VaR 历史尚未入库时，直接告诉用户。不要改用现算结果冒充 `mom_position_var_daily`。

## 集中度和预算怎么读

这些线与网站建议面板一致。只对照接口已经返回的数，不下达减仓手数。

| 对象 | 软线 | 硬线 |
| --- | --- | --- |
| 品种 `marginal_pct` | 30 | 50 |
| 板块 `marginal_pct` | 50 | 65 |
| 1 日 95% VaR / 累计净资本 | 2.07 | 5 |

2.07 是 20% 年化风险预算换成 1 日 95% VaR 的日度上限（1.6449 × 20 / √252）。只在 `mom_risk_var` 给出 `var_to_capital_pct` 时做这个比较。

连续天数只按本次返回的交易日从最近一天往前数。中间缺日不要补。

正式硬砍还要看「当日 VaR 上升是持仓还是市场驱动」。这些工具不返回这个拆分。因此只报告：谁过了哪条线、连续几个已返回的交易日、当日 VaR/资本落在哪一侧。不要宣布正式硬砍，不要给减仓数量。市场驱动会冻结数量减仓，这一点在没有驱动拆分时也不要替用户判断。

## 执行步骤

1. 确认 MOM 连接器已连接，且账户已开通 MOM数据API。401/403 时按登录规则处理。
2. 先判断是组合持仓 VaR，还是某一个 MOM 账号的历史模拟 VaR。
3. 问今天：只调一次 `mom_risk_var`。问历史金额或走势：只调一次 `mom_risk_var_history`。`group` 默认 `all`；只要板块用 `sector`，只要品种用 `product`，大类用 `category`，子板块用 `sub`。不要按天循环调用 `mom_risk_var`。
4. 问次日或突破率：`mom_risk_var_forecast`。要曲线再加 `history=1`。
5. 问某个账号的历史 VaR：先 `mom_accounts`，再用返回的账号调 `mom_account_metrics`。

## 输出

先用一句话写明口径：参数法或历史模拟、置信度、分布、波动窗口、相关窗口、日期或区间。

然后用表格给出日期、组合 VaR（万元）、VaR/资本（有则写）、前几名板块或品种的 `marginal_pct` 和 `component_var`。过线单独列名称、占比、对照的线和连续交易日数。

缺失写「接口未返回」。不编造资本、账号或减仓数量。
