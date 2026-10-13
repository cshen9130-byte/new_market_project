### GET /amac/fund

MCP：`amac_fund`

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

`data` 示例：

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

`source` 为 `private`（私募）或 `futures`（期货资管）。期货资管还会带 `due_date`、`investment_type`、`is_tiered`。

### GET /amac/fund/search

MCP：`amac_fund_search`

在协会备案库里按产品名称、备案号或管理人搜索。`q` 为不少于 4 位的字母数字时按备案号精确匹配（含份额母代码）；否则按名称、管理人、备案号包含匹配。

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

`data` 示例：

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

MCP：`amac_manager`

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

`data` 示例：

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

MCP：`amac_manager_funds`

某管理人在协会披露的私募产品与期货资管。先解析登记编号或名称，再按协会管理人全称精确匹配。不含净值；要净值用 `/company/fund/list` 或 `/price`。

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

`data` 示例：

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
