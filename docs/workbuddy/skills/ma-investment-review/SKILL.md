---
name: ma-investment-review
description: "读取 FOF底层汇总、周度回顾(股票)、周度回顾(期货)、近三周数据状态、公募指增周度回顾和外部私募业绩排行，并调用与页面相同的生成周报 Excel。当用户问这些表、周报、指增超额、外部榜或盈米代销时使用。必须通过用户自己已连接的 MA 基金数据 MCP。只读，不改跟踪池或榜单。"
description_zh: "FOF底层与周度回顾、外部业绩榜（需本人投资页或投资池权限）"
version: 1.0.0
author: MA
---
# FOF底层与周度回顾

本技能只使用「MA 基金数据」连接器。FOF底层用 `fof_underlying`。周度回顾和生成 Excel 用 `weekly_review`。外部榜用 `external_rank`。和跟踪池对名次仍用 `external_rank_compare`，不要用本技能的榜单自己对。

## 登录与权限（必须遵守）

1. 只通过用户已经在 WorkBuddy 中连接的「MA 基金数据」MCP 调用本系统。不要手写 API Key，不要使用环境变量、文档、聊天记录或同事提供的 Key。
2. 若连接器未连接、授权失效，或工具列表为空/报 401，立即停止，请用户点击输入框上方的连接卡片（或到「专家·技能·连接器 → 连接器」里点击 +），用**自己的** MA 系统账号登录并允许授权。然后继续当前任务，不要换一种未授权的方式重试。
3. `fof_underlying` 不出现，或提示没有「在管产品」权限时，说明当前账户没有投资池权限。`weekly_review` 和 `external_rank` 需要投资页权限。如实说明，让用户去网站管理员处开通，不要改用别人的身份。
4. 不要编造产品、收益或文件。接口没有的字段写「接口未返回」。

## 先选工具

| 用户要看的 | 调用 |
| --- | --- |
| FOF底层 / 底层汇总 | `fof_underlying` |
| 近三周净值齐不齐 | `weekly_review`，`report=status`，`variant=equity` 或 `futures` |
| 某一周有哪些策略组、各多少产品 | `weekly_review`，`report=preview` |
| 周度回顾(股票) 的收益、超额，或生成周报 Excel | `weekly_review`，`report=run`，`variant=equity` |
| 周度回顾(期货) | `report=run`，`variant=futures` |
| 公募指增 · 周度回顾 | `report=run`，`variant=public` |
| 外部私募业绩排行里的周报文件 | `external_rank`，`source=files` |
| 盈米代销 | `external_rank`，`source=yingmi` |
| 把本周外部榜合成一份 Excel | `weekly_review`，`report=run`，`variant=external` |

`pools` 只用于股票和期货：`jy` 是 JY跟踪池（默认），`selected` 是 JY精选池，`jy,selected` 是全部。公募指增和外部榜不看跟踪池。

只要分析、不要文件时，`report=run` 加 `file=0`。用户要 Excel 时不要加 `file=0`。

用户要每周自动把 JY 跟踪池的股票和期货 Excel 下载到他自己的文件夹时，用技能 `ma-jy-weekly-download` 建定时任务。那次运行只执行他本机的脚本，不在对话里调用 `weekly_review`，也不写分析报告。

## 生成 Excel 与分析

1. `report=run` 马上返回 `job_id` 和 `status=pending`。这是页面红色按钮背后的同一套计算，可能要几分钟。
2. 用同一个 `job_id` 再调用。未完成就继续用这个 `job_id`，不要新开一个 `report=run`。
3. `status=done` 时，分析只引用 `analysis`。要文件时，这一次加上 `file=1`，把 `content_base64` 解码写成 `file_name`，告诉用户文件放在哪。不要把 base64 贴进对话，也不要打开 xlsx 重算收益。
4. `status=error` 但带有 `analysis` 时，先按分析回答，并说明 Excel 没有生成及 `error`。两者都没有时，转述 `error`。
5. 页面上的「周度归因分析」Word 不在这些工具里。用户要买入建议文档时，说明请到网站周度回顾页生成。

## 字段读法

不要把百分点再乘 100，也不要把超额和绝对收益加在一起。

- `0.61` 表示 +0.61%，`-0.36` 表示 -0.36%。FOF 的 `price_change_pct`、`ret_*_pct`，周报的 `week_pct`、`ret_*_pct`、`excess_*_pct`，市场的 `ret_pct`，外部榜的 `ytd_pct`、`ret_1w_pct`、`ret_1y_pct` 都是这样。
- 超额分组的 `week_pct` 已经是超额。绝对收益分组的 `week_pct` 是收益。期货各组都是绝对收益。
- `sharpe_1y`、`calmar_1y` 是比率。`market_value` 和 `total_market_value` 是元。`avg_amount_yi` 是亿元。
- 近三周表的 `missing` 是该周还没有净值的产品数。`0` 就是页面上的「齐」。`missing_sources` 只描述缺净值的那些产品。
- 默认每个分组只返回前几名和后几名，`count` 和 `median_week_pct` 仍是全组。要某一只时传 `q`。要更多行时重跑并加 `full=1`。
- `truncated` 为 true 时，说明这组没有列全。

## 输出

先写区间、池子和全表数量，再写结论。股票周报先写市场一周涨跌（`analysis.market`），再按分组写中位数和领先、落后的产品。FOF 先写 `total` 和 `total_market_value`，表里列出产品、备案号、策略、净值、涨跌幅和市值。缺数写「接口未返回」。不把描述写成投资建议。
