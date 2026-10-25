import { ACCOUNT_RISK_DATA_API_BASE, MOM_DATA_API_BASE, MOM_DATA_MCP_URL, MOM_DATA_PUBLIC_ORIGIN } from "@/lib/ma/mom-data-public"

const FENCE = "```"

/** Markdown an external model can follow to call the MOM data HTTP API and MCP. */
export function buildMomDataApiGuide(apiKey?: string): string {
  const key = apiKey?.trim() || "YOUR_API_KEY"
  return `# MOM数据 API 接入说明

生产环境只读接口，读的是已经入库的 MOM 核算与成交。这把 Key 只在「设置 → MOM数据API」里生成，和基金数据 API 的 Key 不是同一把。基金数据 Key 调这个接口会返回 401。管理员取消「MOM数据API」后，这把 Key 立即失效。管理员账号默认可用。

内部账户（国信 / GUOXIN / GUOSEN / 665300200077）不会出现。MOM 母基金结算在本基址的 \`/accounts\`、\`/account/*\`。单账户监控中心导入在同一基址的 \`/cfmmc/*\`，使用同一把 Key。例如国泰君安期货账号 85121150 的复权净值：\`GET /cfmmc/account/nav?account=85121150&company=国泰君安期货\`。同一账号的历史逐日持仓、成交、平仓：\`GET /cfmmc/account/positions\`、\`/cfmmc/account/trades\`、\`/cfmmc/account/closes\`，传 \`start_date\` 和 \`end_date\`。

| 项 | 值 |
| --- | --- |
| 网站 | ${MOM_DATA_PUBLIC_ORIGIN} |
| HTTP 基址 | \`${MOM_DATA_API_BASE}\` |
| MCP 地址 | \`${MOM_DATA_MCP_URL}\` |
| API Key | \`${key}\` |

每个请求任选一种方式带 Key：请求头 \`x-api-key\`、\`Authorization: Bearer\`，或 query \`api_key\`。成功时 \`error_code\` 为 0，正文在 \`data\`。

## 1. 先看有哪些账户

\`GET /accounts\`

可选 \`q\` 按账号、投顾名称或板块模糊匹配。\`limit\` 默认 500，最大 2000。\`offset\` 翻页，\`next_offset\` 为空表示没有下一页。

每条账户带投顾名称、板块、风格、公司、首尾日期，以及最新一天的权益、保证金占用、可用资金、当日净盈亏、保证金使用率和结算单风险度。

${FENCE}bash
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/accounts?limit=20"
${FENCE}

${FENCE}json
{
  "account": "12345678",
  "advisor_name": "张三",
  "sector": "黑色",
  "first_date": "2024-01-02",
  "last_date": "2026-10-10",
  "trading_days": 420,
  "latest": {
    "date": "2026-10-10",
    "equity": 2500000,
    "margin": 875000,
    "margin_usage": 0.35,
    "margin_usage_pct": 35,
    "risk_degree": "35.00%",
    "risk_degree_pct": 35,
    "daily_pnl_net": 12000
  }
}
${FENCE}

\`margin_usage\` 是小数，0.35 表示 35%。\`margin_usage_pct\` 是百分点。\`risk_degree\` 是结算单原文，\`risk_degree_pct\` 是去掉百分号后的数值。

## 2. 单账户每日核算

\`GET /account/daily?account=账号\`

这是每个交易日的资金快照，也是后面风险指标的底稿。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| account | 是 | 资金账号 |
| start_date / end_date | 否 | YYYY-MM-DD，含当天 |
| order | 否 | 1 升序（默认），0 降序 |
| limit / offset | 否 | 默认 500，最大 2000 |

主要字段：

| 字段 | 含义 |
| --- | --- |
| prev_balance | 上日结存 |
| equity | 客户权益 |
| cashflow | 当日存取合计，正数净入金 |
| cash_balance | 实有货币资金 |
| daily_pnl | 当日盈亏（结算单原值，未扣费） |
| fee | 当日手续费 |
| ending_balance | 当日结存 |
| margin | 保证金占用 |
| available | 可用资金 |
| margin_usage / margin_usage_pct | 保证金占用 / 客户权益 |
| risk_degree / risk_degree_pct | 结算单风险度 |
| option_long_mv / option_short_mv | 多头 / 空头期权市值 |
| premium_in / premium_out | 权利金收入 / 支出 |
| close_pnl / position_pnl | 平仓盈亏 / 持仓盈亏 |
| daily_pnl_net | 当日盈亏 − 手续费 + 权利金收入 − 权利金支出 |
| cum_pnl_net | 从该账户入库首日累加的净盈亏。即使用 start_date 截断，累计值仍包含更早的日子 |
| prev_equity | 上一交易日客户权益 |
| daily_return | daily_pnl_net / prev_equity。第一天为 null |

${FENCE}bash
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/account/daily?account=12345678&start_date=2026-01-01&order=1"
${FENCE}

## 3. 成交、持仓、平仓、品种

这些接口返回结算单原文，金额字段保持文本，避免把「--」收成 0。

### GET /account/trades

期货在 \`mom_futures_trade_details\`，期权在 \`mom_options_trade_details\`。\`market\` 取 \`all\`（默认）、\`futures\`、\`options\`。默认 \`order=0\`，最近的成交在前。\`limit\` 默认 200。

字段：\`date\`、\`contract\` 合约、\`trade_id\` 成交编号、\`trade_time\`、\`side\` 买/卖、\`hedge_flag\` 投机/套保、\`price\`、\`lots\`、\`turnover\`、\`offset_flag\` 开/平、\`fee\`、\`close_pnl\`、\`premium\`、\`account_order_id\` 资金账户报单编号、\`actual_date\` 成交日期、\`account_trade_id\` 资金账户成交编号、\`exchange\`。\`market\` 为 futures、options，或 \`detail\`。\`detail\` 读的是结算单「成交明细」原表 \`mom_trade_details\`，不会和期货、期权两张表混在默认的 \`all\` 里，避免同一笔成交出现两次。

### GET /account/positions

不传 \`date\` 时，取该账户期货与期权持仓里最近的一个交易日。\`market\` 同上。

字段：\`contract\`、\`long_lots\` / \`long_price\`、\`short_lots\` / \`short_price\`、\`prev_settle\`、\`settle\`、\`position_pnl\`、\`margin\`、\`market_value\`、\`option_long_mv\`、\`option_short_mv\`、\`hedge_flag\`、\`trade_code\`、\`actual_date\`、\`option_mv\`、\`exchange\`。\`market=detail\` 读「持仓明细」原表，不并进默认的期货加期权结果。

### GET /account/closes

平仓明细。字段：\`contract\`、\`side\`、\`close_price\`、\`open_price\`、\`open_price_2\`、\`lots\`、\`prev_settle\`、\`close_pnl\`、\`premium\`、\`open_date\`、\`open_trade_id\`、\`tick_close_pnl\`、\`exchange\`。默认降序，\`limit\` 默认 200。

### GET /account/orders

委托明细，表 \`mom_order_details\`。字段：\`order_id\`、\`order_time\`、\`contract\`、\`side\`、\`offset_flag\`、\`hedge_flag\`、\`price\`、\`order_lots\`、\`filled_lots\`、\`status\`、\`sheet_trade_date\`、\`exchange\`。默认降序。

### GET /account/products

品种汇总。每个交易日每个品种一行：\`product\`、\`lots\`、\`turnover\`、\`fee\`、\`close_pnl\`。

### GET /account/cashflows

核算日报「期货期权账户出入金明细」。\`occur_date\`、\`direction\`、\`max_loss_amount\`、\`protected_amount\`、\`note\` 按入库原文返回。看当天净出入金，用每日核算里的 \`cashflow\`。

翻页：看 \`total\` 和 \`next_offset\`。\`next_offset\` 为 null 就到头了。

${FENCE}bash
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/account/trades?account=12345678&market=futures&start_date=2026-09-01&limit=100"
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/account/positions?account=12345678"
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/account/closes?account=12345678&start_date=2026-09-01"
${FENCE}

## 4. 已经能从入库数据算出的风险指标

\`GET /account/metrics?account=账号&start_date=&end_date=\`

不传日期就是该账户全部入库交易日。返回区间汇总，不返回逐日序列；逐日保证金使用率和日收益率在 \`/account/daily\`。

| 字段 | 算法 |
| --- | --- |
| total_pnl_net | 区间内 daily_pnl_net 之和 |
| win_rate | 净盈亏大于 0 的天数 / 交易日数 |
| profit_factor | 盈利日净盈亏之和 / 亏损日净盈亏绝对值之和 |
| annualized_vol | 日收益率样本标准差 × sqrt(252) |
| sharpe | 日收益率均值 / 样本标准差 × sqrt(252)，无风险利率按 0 |
| max_drawdown | 客户权益的峰值回撤，0.12 表示回撤 12% |
| margin_usage.latest | 区间最后一天的 保证金占用 / 客户权益 |
| margin_usage.average / p10 / p90 / max | 区间内每个有权益的交易日的使用率分布 |
| var.var_95_return | 日收益率升序后的 5% 分位，通常为负 |
| var.var_95_loss | max(0, −var_95_return)，把亏损写成正的比例 |
| var.var_99_return / var_99_loss | 1% 分位，同样一对 |
| var.cvar_95_return / cvar_95_loss | 不超过 95% 分位的那些日收益率的平均，即期望亏损 |
| var.var_95_pnl / var_99_pnl | 当日净盈亏（金额）的 5% / 1% 分位，单位元 |

日收益率 = 当日净盈亏 / 上一日客户权益。上一日权益不大于 0 的日子不进入收益率样本。历史 VaR 至少要 20 个日收益率，否则 \`var.note\` 会说明，VaR 字段为 null。

这是历史模拟法的 1 日 VaR，用的是已经入库的每日净盈亏，不是风控页上按持仓和合约波动重算的参数法 VaR。

${FENCE}bash
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/account/metrics?account=12345678&start_date=2026-01-01"
${FENCE}

${FENCE}json
{
  "error_code": 0,
  "data": {
    "account": "12345678",
    "trading_days": 180,
    "total_pnl_net": 860000,
    "win_rate": 0.54,
    "sharpe": 1.4,
    "max_drawdown": 0.08,
    "margin_usage": { "latest": 0.35, "average": 0.31, "p10": 0.12, "p90": 0.48, "max": 0.62 },
    "var": {
      "method": "historical",
      "horizon": "1d",
      "observations": 179,
      "var_95_loss": 0.018,
      "var_99_loss": 0.031,
      "cvar_95_loss": 0.024,
      "var_95_pnl": -45000
    }
  }
}
${FENCE}

读法：\`var_95_loss = 0.018\` 表示按历史日收益率，5% 分位的单日亏损大约是上一日权益的 1.8%。\`var_95_pnl = -45000\` 是金额口径的同一分位。

## 5. HTTP 示例

${FENCE}python
import requests

BASE = "${MOM_DATA_API_BASE}"
HEADERS = {"x-api-key": "${key}"}

accounts = requests.get(f"{BASE}/accounts", headers=HEADERS, timeout=60).json()
account = accounts["data"]["accounts"][0]["account"]
daily = requests.get(f"{BASE}/account/daily", params={"account": account, "limit": 5, "order": "0"}, headers=HEADERS, timeout=60).json()
metrics = requests.get(f"{BASE}/account/metrics", params={"account": account}, headers=HEADERS, timeout=60).json()
print(account, daily["data"]["rows"][0]["margin_usage_pct"], metrics["data"]["var"]["var_95_loss"])
${FENCE}

## 6. MCP（Cursor / Claude）

账户没有「MOM数据API」权限时，这个地址直接 403，\`tools/list\` 也不会出现。

${FENCE}json
{
  "mcpServers": {
    "mom-data": {
      "url": "${MOM_DATA_MCP_URL}",
      "headers": { "x-api-key": "${key}" }
    }
  }
}
${FENCE}

工具：\`mom_accounts\`、\`mom_account_daily\`、\`mom_account_trades\`、\`mom_account_positions\`、\`mom_account_closes\`、\`mom_account_orders\`、\`mom_account_products\`、\`mom_account_cashflows\`、\`mom_account_metrics\`、\`cfmmc_accounts\`、\`cfmmc_account_nav\`、\`cfmmc_account_daily\`、\`cfmmc_account_positions\`、\`cfmmc_account_trades\`、\`cfmmc_account_closes\`、\`cfmmc_rows\`。参数与上面的 query 同名。\`cfmmc_rows\` 用 \`dataset\` 选择单账户导入表，其中 \`nav\` 是复权净值。返回仍是 \`{ error_code, msg, data }\`。

先 \`mom_accounts\` 拿到 MOM 母基金账号，再查 daily 或 metrics。单账户用 \`cfmmc_accounts\` 和 \`cfmmc_account_nav\`。账号以接口返回为准。

查「国泰君安期货 85121150」的净值时，调用 \`cfmmc_account_nav\`，\`account\` 填 \`85121150\`，\`company\` 填 \`国泰君安期货\`。母基金每日核算用 \`mom_account_daily\`。

还原单账户开平仓节奏时，调用 \`cfmmc_account_positions\`、\`cfmmc_account_trades\`、\`cfmmc_account_closes\`，并传入 \`start_date\` 和 \`end_date\`。持仓不传日期时响应只含最近一个交易日，\`history\` 里有库内首尾日期。

## 7. 单账户监控中心导入

这是另一套入库，表在 \`public.cfmmc_*\`，对应页面「单账户每日风控」。和 MOM 母基金的 \`public.mom_*\` 不是同一批账户。同一把 MOM Key，挂在本基址的 \`/cfmmc\` 下。\`/ma/api/account-risk/data\` 是同一批数据的另一条路径，没有 \`cfmmc\` 前缀。

| 路径 | 入库表 | 内容 |
| --- | --- | --- |
| GET /cfmmc/accounts | cfmmc_daily_summary | 已导入账号。q 或 company 按期货公司、产品名、账号模糊匹配 |
| GET /cfmmc/account/nav | cfmmc_daily_summary | 复权净值，与单账户总览净值曲线相同 |
| GET /cfmmc/account/daily | cfmmc_daily_summary | 每日结算摘要的全部数值列 |
| GET /cfmmc/account/products | cfmmc_product_pnl | 品种盈亏 |
| GET /cfmmc/account/positions | cfmmc_positions | 历史逐日持仓。传 start_date 与 end_date 返回区间内每个交易日；不传日期时只返回最近一个交易日，并在 history 里给出库内首尾日期 |
| GET /cfmmc/account/trades | cfmmc_trades | 历史成交明细，含开/平、成交时间、实际成交日期。传 start_date 与 end_date |
| GET /cfmmc/account/closes | cfmmc_closes | 历史平仓明细，含开仓价、平仓价、原成交序号。传 start_date 与 end_date |
| GET /cfmmc/account/cashflows | cfmmc_cash_flows | 出入金 |
| GET /cfmmc/account/option-trades | cfmmc_option_trades | 期权成交 |
| GET /cfmmc/account/securities | cfmmc_securities | 证券成交 |
| GET /cfmmc/account/export | cfmmc_* + ops | 一次性导出该账号全部入库 CSV（含历史逐日持仓）。默认 `format=zip`；`format=dir` 只写目录并返回 JSON 清单；单表可 `format=csv&dataset=positions`。可选 `company`、`datasets`、`start_date`、`end_date` |

\`/accounts\` 每条有 \`account\`、\`fund_name\`、\`company\`（期货公司简称，例如国泰君安期货）、\`company_name\`（结算单原文）、\`first_date\`、\`last_date\`、\`trading_days\`，以及最新一天的权益、保证金、当日盈亏和风险度。

### 复权净值

\`GET /cfmmc/account/nav?account=资金账号&company=期货公司\`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| account | 是 | 资金账号，例如 85121150 |
| company | 否 | 期货公司或产品名，例如 国泰君安期货。用来核对账号，对不上返回 404 |
| start_date / end_date | 否 | YYYY-MM-DD。净值仍从该账户入库首日复利，再按日期截取 |
| order | 否 | 1 升序（默认），0 降序 |
| limit / offset | 否 | 默认 2000，最大 2000 |

每行：\`date\`、\`nav\`（从 1 复利）、\`daily_return\`、\`pnl\`（当日盈亏，权益口径）、\`cum_pnl\`、\`equity\`（客户权益）、\`net_flow\`（出入金）。\`latest\` 是请求区间的最后一天，不受分页影响。

日收益率 = (当日客户权益 − 上日客户权益 − 出入金) / 上日客户权益。出入金含当日存取合计，以及结算单未记入存取、但改变了结存的大额整数划转。这和页面上的净值曲线是同一个函数。不要用平仓盈亏加浮动盈亏去重算。

### 历史逐日持仓、成交、平仓

每个已导入交易日的持仓和成交都在库里，用来还原建仓、加仓、减仓、换月。传 \`start_date\` 和 \`end_date\`。持仓三个日期都不传时，响应只含最近一个交易日，并带 \`history.first_date\`、\`history.last_date\`、\`history.trading_days\` 和 \`history.note\`。单日持仓用 \`date\`。翻页看 \`total\` 和 \`next_offset\`，\`next_offset\` 为 null 才是最后一页。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| account | 是 | 资金账号，先从 /cfmmc/accounts 取 |
| start_date / end_date | 查历史时填 | YYYY-MM-DD，含当天 |
| date | 否 | 只要某一个交易日的持仓 |
| order | 否 | 持仓默认升序；成交和平仓默认降序 |
| limit / offset | 否 | 持仓默认 500，成交和平仓默认 200，最大 2000 |

持仓字段：\`instrument\` 合约、\`trade_no\` 成交序号、\`bs\` 买/卖、\`buy_lots\` / \`buy_price\`、\`sell_lots\` / \`sell_price\`、\`prev_settle\`、\`settl_price\`、\`floating_pl\`、\`actual_date\` 实际成交日期。

成交字段：\`instrument\`、\`trade_time\`、\`bs\`、\`oc\` 开/平、\`price\`、\`lots\`、\`turnover\`、\`commission\`、\`realized_pl\`、\`actual_date\`。开仓行的平仓盈亏可能是 \`--\`。

平仓字段：\`instrument\`、\`bs\`、\`price\` 平仓价、\`open_price\`、\`lots\`、\`prev_settle\`、\`realized_pl\`、\`orig_trade_no\`、\`actual_date\`。

${FENCE}bash
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/cfmmc/accounts?q=国泰君安期货"
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/cfmmc/account/nav?account=85121150&company=国泰君安期货"
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/cfmmc/account/positions?account=85121150&start_date=2026-01-01&end_date=2026-10-20"
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/cfmmc/account/trades?account=85121150&start_date=2026-01-01&end_date=2026-10-20"
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/cfmmc/account/closes?account=85121150&start_date=2026-01-01&end_date=2026-10-20"
curl -H "x-api-key: ${key}" "${ACCOUNT_RISK_DATA_API_BASE}/account/nav?account=85121150&company=国泰君安期货"
curl -H "x-api-key: ${key}" -OJ "${MOM_DATA_API_BASE}/cfmmc/account/export?account=10800677&company=正信期货"
curl -H "x-api-key: ${key}" -OJ "${MOM_DATA_API_BASE}/cfmmc/account/positions?account=10800677&format=csv"
curl -H "x-api-key: ${key}" "${MOM_DATA_API_BASE}/cfmmc/account/export?account=10800677&format=dir"
${FENCE}

字段形状如下，数字只说明类型，不是该账户的实时净值。

${FENCE}json
{
  "account": "85121150",
  "fund_name": "常熟国投1号私募证券投资基金",
  "company_name": "国泰君安期货",
  "latest": { "date": "2026-10-20", "nav": 1.02, "daily_return": 0.001, "equity": 15000000 },
  "rows": [{ "date": "2026-01-02", "nav": 1, "daily_return": 0, "pnl": 0, "equity": 14000000 }]
}
${FENCE}

MOM 母基金每日核算另外还返回入库原文里的非货币充抵、货币充抵、冻结资金、追加保证金、市值权益、当日总权利金、行权手续费、行权盈亏、申报费。

## 8. 错误码

| error_code | HTTP | 含义 |
| --- | --- | --- |
| 0 | 200 | 成功 |
| 401 | 401 | 没带 Key，或 Key 无效 |
| 403 | 403 | Key 有效，但该账户没有 MOM数据API 权限 |
| 1 | 400 | 参数错误，或路径不存在 |
| 2 | 404 | 账号不存在，或数据还没入库。单账户净值的 company 与期货公司对不上时也是 2 |
| 3 | 500 | 服务器错误 |
`
}

export function downloadMomDataApiGuide(apiKey?: string) {
  const markdown = buildMomDataApiGuide(apiKey)
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "MOM数据API-给AI的说明.md"
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
