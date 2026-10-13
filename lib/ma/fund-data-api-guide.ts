import {
  FUND_DATA_API_BASE,
  FUND_DATA_MCP_URL,
  FUND_DATA_PUBLIC_ORIGIN,
} from "@/lib/ma/fund-data-public"

const FENCE = "@@FENCE@@"

/** Markdown an external model can follow to call the fund-data HTTP API and MCP. */
export function buildFundDataApiGuide(apiKey: string): string {
  const key = apiKey.trim() || "YOUR_API_KEY"
  return `# 基金数据 API 接入说明

把本文件整份交给模型即可。地址和 API Key 已经填好，直接按下面的接口调用，不要再向用户索要 Key，也不要编造未列出的路径或字段。

这是生产环境的只读接口。用 Key 识别调用方并访问正式库。

## 凭据

| 项 | 值 |
| --- | --- |
| 网站 | ${FUND_DATA_PUBLIC_ORIGIN} |
| HTTP 基址 | \`${FUND_DATA_API_BASE}\` |
| MCP 地址 | \`${FUND_DATA_MCP_URL}\` |
| API Key | \`${key}\` |

完整 URL = HTTP 基址 + 路径。例如 \`${FUND_DATA_API_BASE}/fund/info\`。

## 给模型的调用规则

- 能配 MCP 时，用下方 JSON 接入，再用自然语言提问。实际请求必须落到本文列出的工具名和参数上。
- 查询用 GET。跟踪池整本净值用 POST \`/price/bulk\`（备案号放 JSON，不放进 URL）。每个请求都要带 API Key。
- 名称或备案号不确定时，先调用 \`fund_search\` / \`GET /fund/search\`，再用返回的 \`register_number\` 调后续接口。
- 业绩数字以净值库为准（\`fund_price\`、\`fund_view\`，或 \`ai_researcher_compare\` 返回的 \`funds\`）。策略评论只引用投资笔记里点名该基金的段落。
- \`ai_researcher_compare\` 先看 \`resolved\` 和 \`bindings\`。\`resolved\` 为 false 时 \`report\` 为 null，不要据此编对比。\`same_strategy\` 为 false 时不要把这几只排成同一策略。\`incomplete_windows\` 里的字段不是完整区间业绩。\`nav_scope\` 为 \`parent\` 时，净值属于母代码，不是查询里的份额类别单独净值。
- 问某人看多、看空或路演观点时，调用一次 \`kb_ask\`。以 \`citations\` 里的 \`quote\`、\`path\`、\`page\` 为准。\`citations_grounded\` 为 false 时不要把回答当成已核实。资料没写的任职或产品归属写成「资料未说明该关联」，不要推断。
- 只要原文片段、不要结论时用 \`kb_search\`。\`suggest_full_read\` 为 true 或片段里没有答案时，用 \`hits[].path\` 调用 \`kb_read\`，不要编造路径。问观点时不要把 \`kb_ask\` 的 \`model\` 设为 turbo。
- \`ret_*\` 与库内一致，是百分数数值：\`12.4\` 表示 12.4%，不是 \`0.124\`。\`sharpe_1y\`、\`calmar_1y\` 是比率。
- 返回 JSON 里的产品名、净值和日期若出现在示例中，只说明字段形状，以实际返回为准。
- AI 研究员和知识库没有对应的 GET 接口，只能走 MCP，并且受当前 Key 所属账户的页面权限控制。没有权限时 \`tools/list\` 不会列出该工具，直接调用也会被拒绝。

## 1. HTTP 接入

全部为 GET。任选一种方式带上 API Key：

- 请求头 \`x-api-key: ${key}\`
- 请求头 \`Authorization: Bearer ${key}\`
- query \`api_key=${key}\`

Key 在网站「用户中心」查看或重新生成。

### curl

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/fund/info?reg_code=SR6089"
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/price?reg_code=SR6089&start_date=2025-01-01&order=1"
curl "${FUND_DATA_API_BASE}/fund/search?q=幻方&limit=8&api_key=${key}"
${FENCE}

### Python

${FENCE}python
import requests

BASE = "${FUND_DATA_API_BASE}"
HEADERS = {"x-api-key": "${key}"}

info = requests.get(f"{BASE}/fund/info", params={"reg_code": "SR6089"}, headers=HEADERS).json()
navs = requests.get(f"{BASE}/price", params={
    "reg_code": "SR6089",
    "start_date": "2025-01-01",
    "end_date": "2026-01-01",
    "order": "1",
    "order_by": "price_date",
}, headers=HEADERS).json()
print(info["error_code"], info["data"]["fund_name"] if info["error_code"] == 0 else info["msg"])
${FENCE}

### JavaScript / fetch

${FENCE}javascript
const res = await fetch("${FUND_DATA_API_BASE}/fund/search?q=SR6089", {
  headers: { "x-api-key": "${key}" },
})
const json = await res.json()  // { error_code, msg, data }
${FENCE}

## 2. MCP 接入（Cursor / Claude）

在 Cursor 或 Claude Desktop 的 MCP 配置里填生产地址，并用 API Key 作为请求头。

1. 打开 Cursor Settings → MCP（或 Claude Desktop → Developer → Edit Config）。
2. 新增 \`fund-data\`，类型选 URL，把下面 JSON 贴进去。
3. 启用后可以直接用自然语言提问，例如对比两只基金、查净值、问某人在路演里看多什么。模型会按下面的工具名去调用。

${FENCE}json
{
  "mcpServers": {
    "fund-data": {
      "url": "${FUND_DATA_MCP_URL}",
      "headers": {
        "x-api-key": "${key}"
      }
    }
  }
}
${FENCE}

公开工具（任何持有有效 Key 的账户）：\`fund_search\`、\`fund_info\`、\`fund_price\`、\`fund_price_bulk\`、\`fund_multi_price\`、\`fund_advanced_list\`、\`fund_view\`、\`company_info\`、\`company_fund_list\`、\`amac_fund\`、\`amac_fund_search\`、\`amac_manager\`、\`amac_manager_funds\`。

同一地址还会按当前 API Key 所属账户开放内部工具。权限与网页相同。

- 跟踪池（需投资页）：\`tracking_pools\`、\`tracking_pool_list\`、\`tracking_pool_detail\`。detail 里的 \`team_note\` / \`personal_note\` 是跟踪池短备注。
- 在管产品（需投资池权限）：\`managed_products_list\`。
- AI 研究员（需 AI 研究员）：\`ai_researcher_compare\`、\`ai_researcher_similar\`、\`ai_researcher_opposite\`、\`ai_researcher_roadshow\`、\`ai_researcher_team_background\`、\`ai_researcher_manager_profile\`。
- AI 知识库（需 AI 知识库）：问某人观点用 \`kb_ask\`，只要原文片段用 \`kb_search\`，读全文用 \`kb_read\`，看有哪些文件用 \`kb_list\`。见下方「问知识库」。
- 外部业绩榜（需投资页，并且要有 AI 知识库）：\`external_rank_compare\`。用知识库里的点睛等业绩榜 xlsx，和跟踪池同一策略对比。见下方「外部业绩榜」。

## 用法示例

连上 MCP 之后，用自然语言即可。下面给出模型实际应调用的工具和参数。研究员和知识库没有对应的 GET 接口，只能走 MCP。

### 外部业绩榜对比跟踪池

和跟踪池对名次用 \`external_rank_compare\`。它解析业绩榜，并按榜单截止日从净值库重算跟踪池里同一策略的收益。问榜上某一列谁最高，用下一节的 \`kb_ask\` 或 \`kb_read\`，两边的第一名相同。

文件名保留「点睛」或「业绩榜」。不传 \`file_path\` 时，用该策略最新一份。一份文件里有多种策略（例如量化 CTA 和主观 CTA 在同一张表）时必须传 \`class\`。

在 Cursor 里可以直接这样说：

${FENCE}text
用知识库里最新的点睛主观多头榜，和 JY跟踪池比较。窗口按榜单自己的截止日期。
列出他们前 20 里我们池子没有的，以及两边都有但名次差超过 15 的。
只根据工具返回的数字说。needs_review 里的名字不要当成已经匹配。
${FENCE}

模型应调用：

${FENCE}json
{
  "name": "external_rank_compare",
  "arguments": {
    "class": "主观多头",
    "pools": "jy",
    "top_n": 20
  }
}
${FENCE}

收益是百分数：\`159.12\` 表示 159.12%。\`their_*\` 是榜单原数，\`our_*\` 是池内产品按同一窗口重算的结果，\`our_return\` 取该管理人池内这一策略里最高的一条。\`rank_gap\` = 池内名次 − 榜单名次，正数表示按我们的净值它排得更靠后。

- \`external_only\`：榜上有、池子里没有，作为候选。
- \`both\`：名称已经对上。
- \`pool_only\`：池子里有、不在榜单前 N。
- \`needs_review\`：名称只是部分相同，没有自动匹配。

\`class\` 可用：主观多头、量化股票、量化CTA、主观CTA，或具体分组如 500指增。\`pools\` 用 jy、selected 或 jy,selected。\`week_end\` 只用于提示和榜单截止日差多少天，不会改计算窗口。

### 点睛排行：某一列谁最高

截止 2025-09-30 的主观多头榜，按成立以来夏普比率从高到低，第一名是国源信达 1.96。原表按今年以来收益率排列，北京禧悦私募在第 1 行，夏普是 1.31。\`kb_ask\` 在服务端按问题里的列排序，模型不再重排。\`kb_read\` 返回工作表名、表头和一行一个对象，按同一列排序得到同一名次。\`ranking.sort_key\` 是排序列，文件名里的「今年来」是原表的今年以来收益率，不是这次的排序。

直接要答案：

${FENCE}json
{
  "name": "kb_ask",
  "arguments": {
    "question": "点睛排行榜截止20250930，主观多头基金管理人里，成立以来夏普比率最高的是谁？"
  }
}
${FENCE}

自己读表再排序。根目录 \`kb_list\` 会在 400 条停住，用 \`q\` 按文件名搜：

${FENCE}json
{ "name": "kb_list", "arguments": { "q": "点睛 930" } }
{ "name": "kb_read", "arguments": { "path": "外部私募业绩排行/点睛业绩放送_主观多头管理人业绩榜（今年来截止930）.xlsx" } }
${FENCE}

\`kb_read\` 的 \`sheets[]\`。按成立以来夏普比率降序后的第一行：

${FENCE}json
{
  "sheet": "主观多头(20250930)",
  "headers": ["基金管理人", "管理规模", "成立以来夏普比率"],
  "rows": [{ "基金管理人": "国源信达", "管理规模": "50-100亿", "成立以来夏普比率": 1.96 }]
}
${FENCE}

### 问知识库：某人看多或看空哪些品种

路演、尽调笔记里「某人怎么看」走知识库，不走净值接口。一次 \`kb_ask\` 即可。它会按人名匹配文件路径，把路演笔记排在月报前面；同一份笔记若在两个文件夹各有一份，只读一份。笔记不长时读全文，所以姓名在第 1 页、观点在后面几页也能答出来。

在 Cursor 里可以直接这样说：

${FENCE}text
左广东看多的品种都有哪些？只根据知识库原文回答。
每一条结论都要带原文、文件路径和页码。资料没写他属于哪家基金，就写「资料未说明」。
${FENCE}

模型应调用：

${FENCE}json
{
  "name": "kb_ask",
  "arguments": {
    "question": "左广东看多的品种都有哪些？只引用路演笔记原文，没有写的不要推断。"
  }
}
${FENCE}

先看 \`citations\`，再用 \`answer\`。每条引用都有原文 \`quote\`、文件 \`path\` 和页码 \`page\`。\`citations_grounded\` 为 true 时，\`sources\` 里只剩实际引用过的文件；为 false 时，模型没有给出能对上原文的句子，不要把回答当成已核实。资料没写的任职或产品归属会写成「资料未说明该关联」。

${FENCE}json
{
  "answer": "左广东在 2025-12-25 华泰期货路演里放在多头方向的是铜、铝、黄金、铂金、碳酸锂【1】。",
  "sources": ["内部尽调资料/2025.12.25-左广东/左广东路演笔记-2025.12.25.pdf"],
  "citations": [
    {
      "n": 1,
      "quote": "多头方向：铜、铝、黄金、铂金、碳酸锂",
      "path": "内部尽调资料/2025.12.25-左广东/左广东路演笔记-2025.12.25.pdf",
      "page": 2
    }
  ],
  "citations_grounded": true,
  "model": "qwen-plus"
}
${FENCE}

只想先看证据、先不写结论时，用 \`kb_search\`。片段里已经有答案就可以停。\`suggest_full_read\` 为 true，或片段里没有要的句子，再用返回的 \`path\` 调 \`kb_read\`。路径必须来自返回值，不要自己编。

${FENCE}json
{ "name": "kb_search", "arguments": { "question": "左广东看多的品种都有哪些？", "limit": 6 } }

{ "name": "kb_read", "arguments": { "path": "内部尽调资料/2025.12.25-左广东/左广东路演笔记-2025.12.25.pdf" } }
${FENCE}

\`kb_search\` 返回。\`duplicate_paths\` 是已合并的另一份副本，不必再读：

${FENCE}json
{
  "anchors": ["左广东"],
  "hits": [
    {
      "path": "内部尽调资料/2025.12.25-左广东/左广东路演笔记-2025.12.25.pdf",
      "score": 129.2,
      "page": 2,
      "snippet": "多头方向：铜、铝、黄金、铂金、碳酸锂",
      "duplicate_paths": ["MOM尽调资料/左广东/左广东路演笔记-2025.12.25.pdf"],
      "suggest_full_read": false,
      "coverage": "full"
    }
  ]
}
${FENCE}

答案对不上时，给 \`kb_ask\` 加上 \`"debug": true\`。多出来的 \`passages\` 与上面的 hits 相同，用来看模型读到了哪一段。问观点时不要把 \`model\` 设成 turbo。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| question | 是 | string | 问题本身。把「只引用原文、没有写的不要推断」写进问题里 |
| folder_path | 否 | string | 路演和尽调留空，搜全库。只要团队投资笔记时填「投资笔记」 |
| file_path | 否 | string | 已经从 kb_search 或 kb_list 拿到路径时填写，只读这一份 |
| model | 否 | string | 默认 plus。turbo 更快，但不适合抽观点；max 更慢 |
| debug | 否 | boolean | 仅 kb_ask。true 时附上检索片段 passages |
| limit | 否 | integer | 仅 kb_search。默认 8，最大 20 |

- 需要账户有「AI 知识库」权限。没有权限时 tools/list 里不会出现这些工具。
- \`kb_ask\` 大约几十秒。\`kb_search\` 不写结论，通常更快。
- 笔记大约超过 2.4 万字时不会整篇放入回答，\`kb_read\` 也会截断。这时以 citations 的页码为准，或把 \`file_path\` 指到该文件再问一次。

### 对比几只基金

一次调用 \`ai_researcher_compare\`。它先绑定数据库里的基金，再返回和 \`fund_view\` 相同的指标。名称里的「C类」会绑到母基金，并说明公布净值属于母代码。

先看 \`resolved\`。只要有一只没绑上，\`resolved\` 为 false，\`report\` 为 null，不会写对比，也不会用别的笔记填业绩。\`bindings\` 列出每一次绑定：备案号、基金名、匹配方式、有没有净值。

都绑上之后看 \`same_strategy\`。团队策略不同时只给出分组，不做同策略排序，也不给配置权重。业绩在 \`funds\` 里。\`incomplete_windows\` 里的字段（例如刚成立几周的 \`ret_1y\`）与成立以来涨跌相同，不能当成完整区间。

投资笔记只在有段落写明该基金名称或备案号时出现在 \`notes\`。没有这样的段落就省略笔记。

在 Cursor 里可以直接这样说：

${FENCE}text
对比「幻方中证500指数增强」和「九坤日享中证500指数增强」。
先确认两只都绑定到备案号。业绩只用返回的 funds，不要另算。策略不同就分组，不要排序。
${FENCE}

对应的 MCP 工具调用：

${FENCE}json
{
  "name": "ai_researcher_compare",
  "arguments": {
    "subjects": ["幻方中证500指数增强", "九坤日享中证500指数增强"],
    "kb_path": "投资笔记"
  }
}
${FENCE}

名称对不上时改传备案号。备案号按整段精确匹配，不会用前缀去撞另一只产品：

${FENCE}json
{
  "name": "ai_researcher_compare",
  "arguments": {
    "subjects": ["SR6089", "另一只产品的备案号"],
    "kb_path": "投资笔记"
  }
}
${FENCE}

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| subjects | 是 | string[] | 至少 2 个。产品名或备案号，最多 10 个。名称以「A类 / B类 / C类」结尾时绑定母基金 |
| kb_path | 否 | string | 填「投资笔记」时只在该文件夹里找点名该基金的段落。留空则在全库里找，仍然只保留点名该基金的段落 |

返回（MCP 文本里是这段 JSON）：

${FENCE}json
{
  "resolved": true,
  "misses": [],
  "bindings": [
    {
      "query": "幻方中证500指数增强",
      "register_number": "SR6089",
      "fund_name": "幻方中证500指数增强",
      "match": "name",
      "match_score": 1,
      "share_class": null,
      "nav_loaded": true,
      "nav_scope": "self"
    }
  ],
  "same_strategy": false,
  "strategy_groups": [{ "strategy": "股票多头 / 指数增强", "register_numbers": ["SR6089"] }],
  "funds": [
    {
      "register_number": "SR6089",
      "fund_name": "幻方中证500指数增强",
      "latest_nav": 1.23,
      "metrics": { "ret_1y": 12.4, "sharpe_1y": 1.1, "calmar_1y": 0.8 },
      "incomplete_windows": []
    }
  ],
  "notes": [],
  "report": "# 基金对比\\n……"
}
${FENCE}

- 需要账户有「AI 研究员」权限。
- 有一只未绑定时，\`misses\` 写出查询词和原因，\`report\` 为 null。
- \`funds.metrics\` 的收益是百分数：\`12.4\` 表示 12.4%。夏普、卡玛是比率。
- \`share_class\` 为 \`C\` 且 \`nav_scope\` 为 \`parent\` 时，净值是母基金公布值，库里没有单独的 C 类序列。
- 知识库「投资笔记」只包含已分享到团队的笔记。未分享的个人笔记不在这个文件夹里。

### 自己取数再对比：HTTP 净值 + 知识库笔记

不想要自动写好的报告时，把原始净值和笔记分开取。净值走 HTTP，笔记走 MCP。

1. 两只基金的净值序列和已计算指标：

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/price?reg_code=SR6089&start_date=2024-01-01&order=1"
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/fund/view?reg_code=SR6089"
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/price?reg_code=另一只产品的备案号&start_date=2024-01-01&order=1"
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/fund/view?reg_code=另一只产品的备案号"
${FENCE}

同一件事的 MCP 写法：

${FENCE}json
{ "name": "fund_price", "arguments": { "reg_code": "SR6089", "start_date": "2024-01-01", "order": "1" } }
{ "name": "fund_view", "arguments": { "reg_code": "SR6089" } }
${FENCE}

2. 先确认笔记文件在不在，再按两只基金提问：

${FENCE}json
{ "name": "kb_list", "arguments": { "path": "投资笔记", "limit": 50 } }

{ "name": "kb_ask", "arguments": {
  "folder_path": "投资笔记",
  "question": "对比 SR6089 和另一只产品：策略逻辑、团队、容量、主要风险。只引用投资笔记原文，没有的写「笔记未提及」。"
} }

{ "name": "kb_read", "arguments": { "path": "投资笔记/幻方中证500指数增强投资笔记.html" } }
${FENCE}

\`kb_read\` 的 path 必须来自 \`kb_list\` 返回的文件路径，不要自己编文件名。

\`kb_list\` 返回：

${FENCE}json
{
  "path": "投资笔记",
  "truncated": false,
  "entries": [
    { "type": "file", "path": "投资笔记/幻方500指增投资笔记.html", "name": "幻方500指增投资笔记.html", "size": 18240 }
  ]
}
${FENCE}

投资笔记的 \`kb_ask\` 同样返回 citations。字段怎么读，见上面「问知识库」。这里把 \`folder_path\` 设为「投资笔记」，避免路演和月报混进来。

\`kb_read\` 返回。正文超过约 2.4 万字时 \`truncated\` 为 true，\`text\` 末尾会截断：

${FENCE}json
{
  "path": "投资笔记/幻方500指增投资笔记.html",
  "name": "幻方500指增投资笔记.html",
  "truncated": false,
  "text": "……笔记正文……"
}
${FENCE}

### 跟踪池短备注，不是投资笔记长文

产品卡片上的团队备注和个人备注用 \`tracking_pool_detail\`。字段是 \`team_note\` 和 \`personal_note\`。个人备注只返回当前 API Key 账户自己写的那条。

先按备案号取这一只：

${FENCE}json
{ "name": "tracking_pool_detail", "arguments": { "reg_code": "SR6089" } }
${FENCE}

返回里和笔记相关的字段：

${FENCE}json
{
  "beian_hao": "SR6089",
  "strategy_tags": ["500指增"],
  "personal_tags": ["重点"],
  "team_note": "团队短备注正文",
  "team_note_updated_by": "张三",
  "personal_note": "我自己的短备注"
}
${FENCE}

按池和策略翻列表。\`pool\` 用 \`tracking_pools\` 返回的 key，\`all\` 表示全部可见池：

${FENCE}json
{ "name": "tracking_pools", "arguments": {} }

{
  "name": "tracking_pool_list",
  "arguments": {
    "pool": "jy",
    "strategy_source": "company",
    "strategy_l1": "股票多头",
    "keyword": "500",
    "page": 1,
    "page_size": 20
  }
}
${FENCE}

列表每一行与投资页跟踪池相同，并多出 \`strategy_tags\`、\`personal_tags\`。\`page_size\` 最大 50。

### 在管产品

需要投资池（在管产品）权限。没有该权限时，MCP 的 tools/list 里不会出现这个工具。

${FENCE}json
{
  "name": "managed_products_list",
  "arguments": {
    "keyword": "500",
    "strategy_l1": "股票多头",
    "run_status": "running",
    "page": 1,
    "page_size": 20
  }
}
${FENCE}

\`run_status\`：\`running\` 在运作（默认），\`liquidated\` 已清算，\`all\` 全部。返回里带策略分级、策略标签、净值、规模、托管余额、开放日和费率。

### 相似基金、相反基金

都需要「AI 研究员」权限。工具会用净值相关性在全库里找产品，再用 \`kb_path\` 限定定性材料。只要投资笔记就填「投资笔记」。\`subject\` 和 \`reg_code\` 至少给一个。

可以说：「给 SR6089 找最相似的产品，补充说明只看投资笔记。」

${FENCE}json
{
  "name": "ai_researcher_similar",
  "arguments": {
    "reg_code": "SR6089",
    "kb_path": "投资笔记",
    "file_note": "优先同策略、同基准"
  }
}
${FENCE}

可以说：「找和这只净值走势相反、适合做对冲的产品。」

${FENCE}json
{
  "name": "ai_researcher_opposite",
  "arguments": { "reg_code": "SR6089", "kb_path": "投资笔记" }
}
${FENCE}

两者都返回 \`plan\`、\`steps\`、\`report\`。相似基金另外带 \`matches\`：按净值相关性排序。

${FENCE}json
{
  "plan": "……",
  "steps": [{ "step": 3, "summary": "已计算净值相关性" }],
  "matches": [
    { "rank": 1, "beian_hao": "SXXXXX", "product_name": "……", "correlation": 0.86, "score": 0.91, "overlapMonths": 24, "navPoints": 96 }
  ],
  "report": "# 相似度分析\\n……"
}
${FENCE}

相反基金的候选和负相关系数写在 \`report\` 里，没有单独的 \`matches\` 字段。\`correlation\` 为负表示走势相反。

### 路演漏洞扫描

材料必须已经在知识库里。先 \`kb_list\` 找到路演或月报的相对路径，再交给扫描。\`reg_code\` 可选，用来把材料对上数据库里的净值。

${FENCE}json
{ "name": "kb_list", "arguments": { "path": "尽调/某管理人", "limit": 50 } }

{
  "name": "ai_researcher_roadshow",
  "arguments": {
    "kb_path": "尽调/某管理人/2026-03路演.pdf",
    "reg_code": "SR6089"
  }
}
${FENCE}

返回同样是 \`plan\`、\`steps\`、\`report\`。报告会扫策略矛盾、叙事不一致、容量、幸存者偏差、隐藏杠杆等尽调风险点。

### 团队背景、管理人画像

可以说：「找出团队里有高盛背景的管理人，证据优先用投资笔记。」

${FENCE}json
{
  "name": "ai_researcher_team_background",
  "arguments": { "keyword": "高盛", "kb_path": "投资笔记" }
}
${FENCE}

可以说：「给杭州幻方科技写一份管理人画像，笔记放进定性部分。」

${FENCE}json
{
  "name": "ai_researcher_manager_profile",
  "arguments": { "manager_name": "杭州幻方科技", "kb_path": "投资笔记" }
}
${FENCE}

\`keyword\`、\`manager_name\` 必填。\`kb_path\` 留空则全库（路演、月报、尽调、笔记一起用）。返回 \`plan\`、\`steps\`、\`report\`。

### AI 填表助手

网页上的「填表助手」在 AI 知识库页面：列是产品或管理人，行是维度，逐格提问后可以导出 CSV / Excel。MCP 没有单独的填表工具。在 Cursor 里做同一张表，对每个单元格调一次 \`kb_ask\`。

打板策略横向比较表要搜全库，不要传 \`folder_path\`。量道在外部尽调的路演稿，六妙星在在线笔记和内部尽调，衍复在投资笔记。加上 \`folder_path: "投资笔记"\` 时，量道和六妙星对不上文件，格子会是「暂无数据」。

可以说：「填一张打板策略横向比较表。列是量道、六妙星、衍复，行是代表产品、基金经理、细分策略。检索全库。每一格只采用出现了该列名称的段落，没有就写暂无数据。」

${FENCE}json
代表产品
{ "name": "kb_ask", "arguments": {
  "question": "填写「打板策略横向比较表」。列：「量道」，行：「代表产品」。只输出产品名称，不超过 30 字，不要解释。只采用出现了「量道」的段落。没有产品名则写「暂无数据」。不要把策略名称当成产品。"
} }

基金经理
{ "name": "kb_ask", "arguments": {
  "question": "填写「打板策略横向比较表」。列：「六妙星」，行：「基金经理」。只输出负责投资或该策略的基金经理姓名，不超过 15 字，不要解释。不要填写运营、技术或市场负责人。只采用出现了「六妙星」的段落。没有则写「暂无数据」。"
} }

细分策略
{ "name": "kb_ask", "arguments": {
  "question": "填写「打板策略横向比较表」。列：「衍复」，行：「细分策略」。只输出单元格内容，1 到 4 句，不要开场白，不要来源脚注。只采用出现了「衍复」的段落。没有则写「暂无数据」。"
} }
${FENCE}

用户明确只要某一个文件夹时才加 \`folder_path\`，例如只要投资笔记：

${FENCE}json
{ "name": "kb_ask", "arguments": {
  "folder_path": "投资笔记",
  "question": "填写「打板策略横向比较表」。列：「衍复」，行：「代表产品」。只输出产品名称，不超过 30 字，不要解释。只采用出现了「衍复」的段落。没有产品名则写「暂无数据」。"
} }
${FENCE}

每一格用返回的 \`value\`。\`sources\` 是这一格的引用，每条有 \`path\` 和 \`quote\`，\`quote\` 里要有列名。没有段落出现列名时：

${FENCE}json
{ "value": "暂无数据", "answer": "暂无数据", "sources": [], "citations_grounded": true }
${FENCE}

列名出现并且格子有内容时，\`sources\` 类似：

${FENCE}json
{
  "value": "程余",
  "answer": "程余",
  "sources": [{ "path": "外部尽调资料/量道量化择时多空指数增强策略.pdf", "quote": "投资总监程余" }],
  "citations_grounded": true
}
${FENCE}

- 正文已经有内容时，末尾如果还带「暂无数据」，丢掉这四个字，只保留内容。
- 近名不算。六九星、衍宏不会填进六妙星、衍复。
- 代表产品要是产品名称。量道应接近「千石资本量道对冲1号」，不要填策略标题。六妙星应接近「代表一号、代表三号、代表六号」。衍复应接近「衍复优享中证1000指数增强一号」。
- 基金经理要是投资负责人。量道稿里余晓锋是首席运营官兼技术总监，投资总监是程余，这一格填程余。六妙星打板经理只写了姓「程」。衍复代表性产品的投资经理是高亢。
- 不要用 \`kb_list\` 判断全库里有没有这一列。\`kb_list\` 一次最多 400 条，也没有翻页，列出的「投资笔记」盖不住路演和尽调。
- 文件名含有列名、并且文件不长时，这一格会读入全文。衍复尽调里的指数增强、市场中性因此能进「细分策略」。
- \`kb_ask\` 默认 qwen-plus。填表不要改成 turbo。

## 3. 统一返回格式

${FENCE}json
{
  "error_code": 0,
  "msg": "success",
  "data": {}
}
${FENCE}

| error_code | 含义 | HTTP |
| --- | --- | --- |
| 0 | 成功 | 200 |
| 401 | 缺少或错误的 API Key | 401 |
| 1 | 参数错误 | 400 |
| 2 | 找不到基金/管理人 | 404 |
| 3 | 服务端错误 | 500 |

## 4. 接口说明

### GET /fund/search

MCP：\`fund_search\`

按产品名、备案号搜基金，同时搜管理人。名称不确定时先调这个，再用返回的 \`price_reg_code\` 调 \`/price\`。\`份额\`、\`A类\` / \`A类份额\`、\`私募基金\` / \`私募证券投资基金\` 视为同一产品族，母基金会跟在份额旁边返回。测试产品不出现。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| q 或 keyword | 是 | string | 名称或备案号 |
| limit | 否 | int | 1–40，默认 8 |

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/fund/search?q=幻方&limit=8"
${FENCE}

${FENCE}json
{ "name": "fund_search", "arguments": { "q": "幻方", "limit": 8 } }
${FENCE}

\`data\`：

${FENCE}json
{
  "products": [{ "register_number": "AAK83C", "fund_name": "...", "fund_short_name": "...", "strategy_one": "...", "price_reg_code": "SAAK83", "parent_reg_code": "SAAK83", "share_class": "C" }],
  "managers": [{ "registration_no": "P1032021", "manager_name": "..." }]
}
${FENCE}

### GET /fund/info

MCP：\`fund_info\`

单只基金档案。\`reg_code\` 也可传产品名，会先解析备案号。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| reg_code 或 register_number | 是 | string | 备案号，或可解析的产品名 |

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/fund/info?reg_code=SR6089"
${FENCE}

${FENCE}json
{ "name": "fund_info", "arguments": { "reg_code": "SR6089" } }
${FENCE}

\`data\` 示例（字段会按产品有无而增减）：

${FENCE}json
{
  "fund_name": "幻方中证500指数增强",
  "fund_short_name": "",
  "register_number": "SR6089",
  "price_reg_code": "SR6089",
  "parent_reg_code": "SR6089",
  "share_class": null,
  "advisor": "杭州幻方科技",
  "inception_date": "2019-01-01",
  "latest_nav": 1.234,
  "latest_nav_date": "2026-09-30",
  "strategy": {
    "company": { "strategy_one": "股票多头", "strategy_two": "指数增强", "strategy_three": "中证500" },
    "platform": { "strategy_one": "股票多头", "strategy_two": "指数增强", "strategy_three": "" }
  },
  "FundsBase": { "open_day": "每月15日", "fee_manage": "1%", "fee_pay": "20%" },
  "managers": ["某某"]
}
${FENCE}

### GET /price

MCP：\`fund_price\`

单只基金净值序列，最多 5000 行。份额代码（如 \`AAK83C\`）会解析到母基金序列，响应里的 \`series_reg_code\` / \`price_reg_code\` 是实际取数的备案号。搜索刚返回的代码不会 404。基金存在但没有净值时 \`error_code\` 为 0、\`data\` 为 \`[]\`；代码不存在才是 HTTP 404、\`error_code\` 2。

\`price_change\` 与 \`ret_*\` 一样是百分比：\`0.2976\` 表示上涨 0.2976%（净值从 1.344 到 1.348）。全序列第一天为 \`null\`，之后的持平日为 \`0\`。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| reg_code | 是 | string | 备案号或份额代码。也接受产品名 |
| start_date | 否 | YYYY-MM-DD | 含当天；也接受 2025/1/1 |
| end_date | 否 | YYYY-MM-DD | 含当天 |
| order | 否 | 0 \\| 1 | 1 升序（默认），0 降序 |
| order_by | 否 | string | price_date（默认）\\| nav \\| cumulative_nav \\| cumulative_nav_withdrawal \\| price_change |

升序且超过 5000 行时，响应带 \`truncated: true\` 和 \`next_start_date\`。用这个日期作为下一次的 \`start_date\` 接着取。

请求：2025 年全年、按日期从早到晚。

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/price?reg_code=SR6089&start_date=2025-01-01&end_date=2025-12-31&order=1"
${FENCE}

${FENCE}json
{ "name": "fund_price", "arguments": { "reg_code": "SR6089", "start_date": "2025-01-01", "end_date": "2025-12-31", "order": "1" } }
${FENCE}

\`data[]\` 中 \`reg_code\` 是序列所属备案号。响应另外带 \`series_reg_code\`、\`queried_reg_code\`、\`parent_reg_code\`、\`share_class\`、\`fund_name\`。

${FENCE}json
{ "reg_code": "SR6089", "nav": 1.348, "cumulative_nav_withdrawal": 1.348, "cumulative_nav": 1.348, "price_change": 0.2976, "price_date": "2025-01-07" }
${FENCE}

### POST /price/bulk

MCP：\`fund_price_bulk\`

跟踪池导出用这个，不要对每只基金各打一次 \`/price\`。GET 适合少量代码；整本备案号放进 POST JSON。每页默认 10 只、最多 20 只。\`data.series[]\` 每只一份序列，从早到晚。

某只达到 5000 行时，该只 \`truncated\` 为 true，\`next_cursor\` 停在这只（形如 \`12@2024-03-01\`），下次原样传回 \`cursor\`。没有截断时 \`next_cursor\` 前进到下一只；全部取完则为 \`null\`。

找不到的代码不会让整批失败：该只 \`error_code\` 为 2、\`points\` 为 \`[]\`。基金在库里但没有净值点时 \`error_code\` 为 0、\`points\` 为 \`[]\`。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| reg_code / reg_codes | 是 | string 或 string[] | 备案号。GET 用逗号分隔；POST 用数组 |
| start_date | 否 | YYYY-MM-DD | 含当天 |
| end_date | 否 | YYYY-MM-DD | 含当天 |
| cursor | 否 | string | 上一页的 next_cursor |
| batch | 否 | int | 每页基金数，默认 10，最大 20 |
| format | 否 | ndjson | 传 ndjson 时每只基金一行，最后一行是 \`{"next_cursor":...}\` |

${FENCE}bash
curl -H "x-api-key: ${key}" -H "Content-Type: application/json" \\
  -d '{"reg_codes":["SR6089","AAK83C"],"start_date":"2020-01-01","batch":10}' \\
  "${FUND_DATA_API_BASE}/price/bulk"
${FENCE}

${FENCE}json
{ "name": "fund_price_bulk", "arguments": { "reg_code": "SR6089,AAK83C", "start_date": "2020-01-01", "batch": 10 } }
${FENCE}

\`data.series[]\` 里 \`points[].reg_code\` 是 \`series_reg_code\`。份额 \`AAK83C\` 的序列在母基金 \`SAAK83\` 上。

${FENCE}json
{
  "series": [{
    "reg_code": "AAK83C",
    "fund_name": "...",
    "price_reg_code": "SAAK83",
    "series_reg_code": "SAAK83",
    "parent_reg_code": "SAAK83",
    "share_class": "C",
    "truncated": false,
    "next_start_date": null,
    "error_code": 0,
    "points": [{ "reg_code": "SAAK83", "nav": 1.348, "cumulative_nav": 1.348, "cumulative_nav_withdrawal": 1.348, "price_change": 0.2976, "price_date": "2025-01-07" }]
  }],
  "next_cursor": "2"
}
${FENCE}

### GET /fund/price

MCP：\`fund_multi_price\`

一次取最多 40 只基金在某日（或最新）的一条净值。整段历史用 \`/price/bulk\`。\`price_change\` 是百分比。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| reg_code | 是 | string | 逗号分隔备案号，最多 40 个 |
| date | 否 | YYYY-MM-DD | 不传则每只取最新一条；传入则取该日或之前最近一条 |
| order | 否 | 0 \\| 1 | 默认 0 降序 |
| order_by | 否 | string | nav（默认）\\| price_date \\| cumulative_nav \\| price_change |

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/fund/price?reg_code=SR6089,SXXXXX"
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/fund/price?reg_code=SR6089,SXXXXX&date=2026-09-30"
${FENCE}

${FENCE}json
{ "name": "fund_multi_price", "arguments": { "reg_code": "SR6089,SXXXXX", "date": "2026-09-30" } }
${FENCE}

\`data[]\` 每只一行，带 \`reg_code\`：

${FENCE}json
[
  { "reg_code": "SR6089", "nav": 1.84, "cumulative_nav": 2.10, "cumulative_nav_withdrawal": 2.05, "price_change": 0.40, "price_date": "2026-09-30" },
  { "reg_code": "SXXXXX", "nav": 1.21, "cumulative_nav": 1.33, "cumulative_nav_withdrawal": 1.30, "price_change": -0.20, "price_date": "2026-09-26" }
]
${FENCE}

### GET /fund/advancedlist

MCP：\`fund_advanced_list\`

分页列表，可按策略、类型、运作状态、关键字筛选。每行带 \`price_reg_code\`、\`parent_reg_code\`、\`share_class\`。测试产品不出现。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| strategy_one / two / three | 否 | string | 一级/二/三级策略；不传或「不限」表示不过滤 |
| type | 否 | 1 \\| 2 | 1 用平台策略（默认），2 用团队策略 |
| fund_type | 否 | int | 2 私募证券；3/12 券商资管；5 保险资管；6/13 信托；8/16 公募专户；9/17 期货资管；14 资产配置 |
| fund_state | 否 | int | 1 正常运作；2 正常清算；3 提前清算；4 延期清算；5 投顾协议已终止；6 非正常清算。不传=全部 |
| keyword | 否 | string | 匹配产品名、备案号、管理人 |
| page | 否 | int | 从 1 开始，默认 1 |
| pagesize | 否 | int | 默认 10，最大 1000 |
| order | 否 | 0 \\| 1 | 默认 0 降序 |
| order_by | 否 | string | price_date（默认）\\| inception_date \\| price_nav \\| ret_1y \\| sharpe_1y \\| calmar_1y |

请求：团队策略里、正在运作的股票多头，按近一年收益降序。query 里的中文需要 URL 编码，\`strategy_one\` 的值是「股票多头」。

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/fund/advancedlist?type=2&strategy_one=%E8%82%A1%E7%A5%A8%E5%A4%9A%E5%A4%B4&fund_state=1&order_by=ret_1y&order=0&page=1&pagesize=20"
${FENCE}

${FENCE}json
{
  "name": "fund_advanced_list",
  "arguments": {
    "type": 2,
    "strategy_one": "股票多头",
    "fund_state": 1,
    "order_by": "ret_1y",
    "order": "0",
    "page": 1,
    "pagesize": 20
  }
}
${FENCE}

\`data\`：

${FENCE}json
{ "list": [{ "register_number": "", "fund_name": "", "advisor": "", "price_nav": 0, "price_date": "", "strategy_one": "" }], "total": 0, "page": 1, "pagesize": 10 }
${FENCE}

### GET /fund/view

MCP：\`fund_view\`

已计算好的区间收益和风险指标。备案号整段匹配。SB595C 对应诚奇母基金 SSB595 的 C 类。涵崧的备案号是 SB5957。\`ai_researcher_compare\` 用同一套查找和同一套 \`fund/view\` 指标。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| reg_code | 是 | string | 备案号 |

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/fund/view?reg_code=SR6089"
${FENCE}

${FENCE}json
{ "name": "fund_view", "arguments": { "reg_code": "SR6089" } }
${FENCE}

\`data\` 示例：

${FENCE}json
{
  "register_number": "SR6089",
  "fund_name": "幻方中证500指数增强",
  "latest_nav": 1.84,
  "latest_nav_date": "2026-09-30",
  "ret_1w": 0.42,
  "ret_1m": 1.15,
  "ret_3m": 3.20,
  "ret_6m": 6.80,
  "ret_1y": 18.40,
  "sharpe_1y": 1.35,
  "calmar_1y": 1.10,
  "strategy": { "company": { "strategy_one": "股票多头" }, "platform": { "strategy_one": "股票多头" } }
}
${FENCE}

### GET /company/info

MCP：\`company_info\`

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| code | 二选一 | string | 管理人登记编号，如 P1032021；也可用 registration_no / register_code |
| name_cn | 二选一 | string | 管理人名称模糊匹配 |

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/company/info?code=P1032021"
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/company/info?name_cn=%E5%B9%BB%E6%96%B9"
${FENCE}

${FENCE}json
{ "name": "company_info", "arguments": { "code": "P1032021" } }
{ "name": "company_info", "arguments": { "name_cn": "幻方" } }
${FENCE}

\`data\` 示例：

${FENCE}json
{
  "name_cn": "杭州幻方科技",
  "register_code": "P1032021",
  "found_date": "2016-01-01",
  "scale": "100亿元以上",
  "member_type": "普通会员",
  "core_strategy": "股票多头",
  "active_product_count": 12
}
${FENCE}

### GET /company/fund/list

MCP：\`company_fund_list\`

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| code | 是 | string | 管理人登记编号 |
| page / pagesize | 否 | int | 默认 1 / 20，pagesize 最大 200 |
| fund_state | 否 | int | 0 或不传=全部；1–6 同列表接口 |

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/company/fund/list?code=P1032021&fund_state=1&page=1&pagesize=20"
${FENCE}

${FENCE}json
{ "name": "company_fund_list", "arguments": { "code": "P1032021", "fund_state": 1, "page": 1, "pagesize": 20 } }
${FENCE}

\`data\` 示例：

${FENCE}json
{
  "total": 12,
  "page": 1,
  "pagesize": 20,
  "list": [
    { "fund_name": "幻方中证500指数增强", "register_number": "SR6089", "inception_date": "2019-01-01", "price_nav": 1.84, "price_date": "2026-09-30", "fund_type": 2, "fund_state": 1 }
  ]
}
${FENCE}
### GET /amac/fund

MCP：\`amac_fund\`

按备案号读取已入库的基金业协会产品备案。先查私募基金，没有再查期货资管。份额代码会落到母基金备案号。这是协会披露原文，不含净值。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| reg_code 或 register_number | 是 | string | 备案号 |

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/amac/fund?reg_code=SR6089"
${FENCE}

${FENCE}json
{ "name": "amac_fund", "arguments": { "reg_code": "SR6089" } }
${FENCE}

\`data\` 示例：

${FENCE}json
{
  "source": "private",
  "fund_no": "SR6089",
  "fund_name": "幻方中证500指数增强",
  "manager_name": "杭州幻方科技",
  "working_state": "正在运作",
  "mandator_name": "某某托管",
  "establish_date": "2019-01-01",
  "put_on_record_date": "2019-01-15",
  "fund_type": "私募证券投资基金",
  "detail_url": "https://gs.amac.org.cn/...",
  "updated_at": "2026-10-12T20:00:00.000Z"
}
${FENCE}

\`source\` 为 \`private\`（私募）或 \`futures\`（期货资管）。期货资管还会带 \`due_date\`、\`investment_type\`、\`is_tiered\`。

### GET /amac/fund/search

MCP：\`amac_fund_search\`

在协会备案库里按产品名称、备案号或管理人搜索。\`q\` 为不少于 4 位的字母数字时按备案号精确匹配（含份额母代码）；否则按名称、管理人、备案号包含匹配。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| q 或 keyword | 是 | string | 至少 2 个字符，最长 80 |
| fund_type | 否 | string | 协会类型原文，如 私募证券投资基金 |
| working_state | 否 | string | 协会状态原文，如 正在运作、提前清算 |
| page / pagesize | 否 | int | 默认 1 / 20，pagesize 最大 50 |

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/amac/fund/search?q=%E5%B9%BB%E6%96%B9&working_state=%E6%AD%A3%E5%9C%A8%E8%BF%90%E4%BD%9C&page=1&pagesize=20"
${FENCE}

${FENCE}json
{ "name": "amac_fund_search", "arguments": { "q": "幻方", "working_state": "正在运作", "page": 1, "pagesize": 20 } }
${FENCE}

\`data\` 示例：

${FENCE}json
{
  "total": 12,
  "page": 1,
  "pagesize": 20,
  "list": [
    { "source": "private", "fund_no": "SR6089", "fund_name": "幻方中证500指数增强", "manager_name": "杭州幻方科技", "working_state": "正在运作", "fund_type": "私募证券投资基金" }
  ]
}
${FENCE}

### GET /amac/manager

MCP：\`amac_manager\`

协会管理人登记信息，附带高管和出资人。登记编号优先；名称按全称精确，其次前缀，再模糊。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| code | 二选一 | string | 登记编号，如 P1032021；也可用 registration_no |
| name_cn | 二选一 | string | 管理人名称 |

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/amac/manager?code=P1032021"
${FENCE}

${FENCE}json
{ "name": "amac_manager", "arguments": { "code": "P1032021" } }
${FENCE}

\`data\` 示例：

${FENCE}json
{
  "registration_no": "P1032021",
  "manager_name": "杭州幻方科技",
  "legal_rep_name": "某某",
  "mgmt_scale_range": "100亿元以上",
  "full_time_staff_count": 80,
  "actual_controller": "某某",
  "executives": [{ "person_name": "某某", "title": "总经理", "has_fund_qualification": "是" }],
  "shareholders": [{ "seq": 1, "investor_name": "某某", "holding_ratio": "60%" }]
}
${FENCE}

### GET /amac/manager/funds

MCP：\`amac_manager_funds\`

某管理人在协会披露的私募产品与期货资管。先解析登记编号或名称，再按协会管理人全称精确匹配。不含净值；要净值用 \`/company/fund/list\` 或 \`/price\`。

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| code | 二选一 | string | 管理人登记编号 |
| name_cn | 二选一 | string | 管理人名称 |
| working_state | 否 | string | 协会运作状态原文；不传为全部 |
| page / pagesize | 否 | int | 默认 1 / 20，pagesize 最大 100 |

${FENCE}bash
curl -H "x-api-key: ${key}" "${FUND_DATA_API_BASE}/amac/manager/funds?code=P1032021&working_state=%E6%AD%A3%E5%9C%A8%E8%BF%90%E4%BD%9C&page=1&pagesize=20"
${FENCE}

${FENCE}json
{ "name": "amac_manager_funds", "arguments": { "code": "P1032021", "working_state": "正在运作", "page": 1, "pagesize": 20 } }
${FENCE}

\`data\` 示例：

${FENCE}json
{
  "registration_no": "P1032021",
  "manager_name": "杭州幻方科技",
  "total": 12,
  "page": 1,
  "pagesize": 20,
  "list": [
    { "source": "private", "fund_no": "SR6089", "fund_name": "幻方中证500指数增强", "working_state": "正在运作", "fund_type": "私募证券投资基金" }
  ]
}
${FENCE}

`.replaceAll(FENCE, "```")
}

export function downloadFundDataApiGuide(apiKey: string) {
  const markdown = buildFundDataApiGuide(apiKey)
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "基金数据API接入说明.md"
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
