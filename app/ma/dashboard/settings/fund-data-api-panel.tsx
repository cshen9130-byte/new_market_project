"use client"

import { useEffect, useState } from "react"
import { DateInput } from "@/components/ui/date-input"
import { authService } from "@/lib/auth"
import {
  FUND_DATA_API_BASE,
  FUND_DATA_MCP_URL,
  FUND_DATA_PUBLIC_ORIGIN,
} from "@/lib/ma/fund-data-public"

type Envelope = {
  error_code: number
  msg: string
  data: unknown
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative group">
      <pre className="text-xs bg-muted/40 border rounded-lg p-3 overflow-x-auto whitespace-pre font-mono text-zinc-700 dark:text-zinc-300">
        {text}
      </pre>
      <button
        type="button"
        className="absolute top-2 right-2 text-[11px] px-2 py-0.5 border rounded bg-background/90 hover:bg-muted"
        onClick={() => {
          void navigator.clipboard.writeText(text)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  )
}

function ParamTable({ rows }: { rows: Array<[string, string, string, string]> }) {
  return (
    <div className="border rounded-lg overflow-hidden mb-3">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-zinc-500">
          <tr>
            <th className="text-left font-medium px-3 py-2">参数</th>
            <th className="text-left font-medium px-3 py-2">必填</th>
            <th className="text-left font-medium px-3 py-2">类型</th>
            <th className="text-left font-medium px-3 py-2">说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, req, type, desc]) => (
            <tr key={name} className="border-t">
              <td className="px-3 py-1.5 font-mono text-xs">{name}</td>
              <td className="px-3 py-1.5 text-zinc-500">{req}</td>
              <td className="px-3 py-1.5 text-zinc-500">{type}</td>
              <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

async function callApi(path: string, params: Record<string, string>, apiKey: string): Promise<Envelope> {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value.trim()) qs.set(key, value.trim())
  }
  const url = qs.toString() ? `${path}?${qs}` : path
  const res = await fetch(url, {
    headers: apiKey ? { "x-api-key": apiKey } : {},
  })
  return res.json() as Promise<Envelope>
}

export function FundDataApiPanel() {
  const [apiKey, setApiKey] = useState("")
  const [q, setQ] = useState("")
  const [regCode, setRegCode] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Envelope | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    void authService.refreshCurrentUser().then((user) => {
      if (!cancelled) setApiKey(user?.api_key || "")
    })
    return () => { cancelled = true }
  }, [])

  const keyForDocs = apiKey || "YOUR_API_KEY"

  async function run(path: string, params: Record<string, string>) {
    setLoading(true)
    setError("")
    try {
      const data = await callApi(path, params, apiKey)
      setResult(data)
      if (data.error_code === 0 && path.endsWith("/fund/search")) {
        const products = (data.data as { products?: Array<{ register_number?: string }> } | null)?.products
        const first = products?.[0]?.register_number
        if (first) setRegCode(first)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败")
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-10">
      <header>
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200 mb-2">基金数据 API</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          生产环境只读接口。每个登录账号在「用户中心」都有一把 API Key，请求时必须带上，系统据此识别用户并访问正式库。
        </p>
        <div className="mt-4 border rounded-lg px-4 py-3 text-sm space-y-1">
          <p><span className="text-zinc-400 w-24 inline-block">网站</span><a className="text-red-500 hover:underline" href={FUND_DATA_PUBLIC_ORIGIN} target="_blank" rel="noreferrer">{FUND_DATA_PUBLIC_ORIGIN}</a></p>
          <p><span className="text-zinc-400 w-24 inline-block">HTTP 基址</span><code className="font-mono text-xs">{FUND_DATA_API_BASE}</code></p>
          <p><span className="text-zinc-400 w-24 inline-block">MCP 地址</span><code className="font-mono text-xs">{FUND_DATA_MCP_URL}</code></p>
          <p className="flex items-start gap-0">
            <span className="text-zinc-400 w-24 inline-block shrink-0">你的 API Key</span>
            {apiKey
              ? <code className="font-mono text-xs break-all">{apiKey}</code>
              : <span className="text-zinc-400">登录后自动生成，也可到 用户中心 查看</span>}
          </p>
        </div>
      </header>

      <section>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">1. HTTP 接入</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 leading-relaxed">
          全部为 GET。每个请求必须带 API Key，任选一种方式：请求头 <code className="font-mono text-xs">x-api-key</code>、
          <code className="font-mono text-xs">Authorization: Bearer</code>，或 query <code className="font-mono text-xs">api_key</code>。
          Key 在「用户中心」查看或重新生成。
        </p>
        <p className="text-xs text-zinc-400 mb-2">curl</p>
        <CodeBlock
          text={`curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/fund/info?reg_code=SR6089"
curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/price?reg_code=SR6089&start_date=2025-01-01&order=1"
curl "${FUND_DATA_API_BASE}/fund/search?q=幻方&limit=8&api_key=${keyForDocs}"`}
        />
        <p className="text-xs text-zinc-400 mt-3 mb-2">Python</p>
        <CodeBlock
          text={`import requests

BASE = "${FUND_DATA_API_BASE}"
HEADERS = {"x-api-key": "${keyForDocs}"}

info = requests.get(f"{BASE}/fund/info", params={"reg_code": "SR6089"}, headers=HEADERS).json()
navs = requests.get(f"{BASE}/price", params={
    "reg_code": "SR6089",
    "start_date": "2025-01-01",
    "end_date": "2026-01-01",
    "order": "1",
    "order_by": "price_date",
}, headers=HEADERS).json()
print(info["error_code"], info["data"]["fund_name"] if info["error_code"] == 0 else info["msg"])`}
        />
        <p className="text-xs text-zinc-400 mt-3 mb-2">JavaScript / fetch</p>
        <CodeBlock
          text={`const res = await fetch("${FUND_DATA_API_BASE}/fund/search?q=SR6089", {
  headers: { "x-api-key": "${keyForDocs}" },
})
const json = await res.json()  // { error_code, msg, data }`}
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">2. MCP 接入（Cursor / Claude）</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 leading-relaxed">
          在 Cursor 或 Claude Desktop 的 MCP 配置里填生产地址，并用你的 API Key 作为请求头。
        </p>
        <ol className="text-sm text-zinc-500 dark:text-zinc-400 space-y-2 list-decimal pl-5 mb-3 leading-relaxed">
          <li>打开 Cursor Settings → MCP（或 Claude Desktop → Developer → Edit Config）。</li>
          <li>新增 <code className="font-mono text-xs">fund-data</code>，类型选 URL，把下面 JSON 贴进去（替换 API Key）。</li>
          <li>启用后即可按备案号或产品名提问。</li>
        </ol>
        <CodeBlock
          text={`{
  "mcpServers": {
    "fund-data": {
      "url": "${FUND_DATA_MCP_URL}",
      "headers": {
        "x-api-key": "${keyForDocs}"
      }
    }
  }
}`}
        />
        <p className="text-xs text-zinc-400 mt-3">
          可用工具：fund_search、fund_info、fund_price、fund_multi_price、fund_advanced_list、fund_view、company_info、company_fund_list。
        </p>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">3. 统一返回格式</h3>
        <CodeBlock
          text={`{
  "error_code": 0,
  "msg": "success",
  "data": { ... }
}`}
        />
        <ul className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 space-y-1 list-disc pl-5">
          <li><code className="font-mono text-xs">0</code> 成功（HTTP 200）</li>
          <li><code className="font-mono text-xs">401</code> 缺少或错误的 API Key（HTTP 401）</li>
          <li><code className="font-mono text-xs">1</code> 参数错误（HTTP 400）</li>
          <li><code className="font-mono text-xs">2</code> 找不到基金/管理人（HTTP 404）</li>
          <li><code className="font-mono text-xs">3</code> 服务端错误（HTTP 500）</li>
        </ul>
      </section>

      <section className="space-y-8">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">4. 接口说明</h3>
        <p className="text-sm text-zinc-500 -mt-6">完整 URL = HTTP 基址 + 路径，例如 {FUND_DATA_API_BASE}/fund/info</p>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /fund/search
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: fund_search</span>
          </h4>
          <p className="text-sm text-zinc-500 mb-2">按产品名、备案号搜基金，同时搜管理人。</p>
          <ParamTable
            rows={[
              ["q 或 keyword", "是", "string", "名称或备案号"],
              ["limit", "否", "int", "1–40，默认 8"],
            ]}
          />
          <p className="text-xs text-zinc-400 mb-1">data</p>
          <CodeBlock
            text={`{
  "products": [{ "register_number": "SR6089", "fund_name": "...", "fund_short_name": "...", "strategy_one": "..." }],
  "managers": [{ "registration_no": "P1032021", "manager_name": "..." }]
}`}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /fund/info
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: fund_info</span>
          </h4>
          <p className="text-sm text-zinc-500 mb-2">单只基金档案。reg_code 也可传产品名，会先解析备案号。</p>
          <ParamTable rows={[["reg_code 或 register_number", "是", "string", "备案号，或可解析的产品名"]]} />
          <p className="text-xs text-zinc-400 mb-1">data 主要字段</p>
          <CodeBlock
            text={`fund_name, fund_short_name, register_number, advisor, mandator_name,
inception_date, puton_date, fund_type, fund_type_name, fund_state, fund_state_name,
latest_nav, latest_nav_date,
strategy.company.strategy_one|two|three,
strategy.platform.strategy_one|two|three,
FundsBase.open_day, fee_manage, fee_pay, scale, register_code,
managers[]`}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /price
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: fund_price</span>
          </h4>
          <p className="text-sm text-zinc-500 mb-2">单只基金净值序列，最多 5000 行。</p>
          <ParamTable
            rows={[
              ["reg_code", "是", "string", "备案号"],
              ["start_date", "否", "YYYY-MM-DD", "含当天；也接受 2025/1/1"],
              ["end_date", "否", "YYYY-MM-DD", "含当天"],
              ["order", "否", "0 | 1", "1 升序（默认），0 降序"],
              ["order_by", "否", "string", "price_date（默认）| nav | cumulative_nav | cumulative_nav_withdrawal | price_change"],
            ]}
          />
          <p className="text-xs text-zinc-400 mb-1">data[]</p>
          <CodeBlock
            text={`{ "nav": 1.0123, "cumulative_nav_withdrawal": 1.02, "cumulative_nav": 1.03, "price_change": 0.001, "price_date": "2025-01-06" }`}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /fund/price
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: fund_multi_price</span>
          </h4>
          <p className="text-sm text-zinc-500 mb-2">一次取最多 40 只基金在某日（或最新）的净值。</p>
          <ParamTable
            rows={[
              ["reg_code", "是", "string", "逗号分隔备案号，最多 40 个"],
              ["date", "否", "YYYY-MM-DD", "不传则每只取最新一条；传入则取该日或之前最近一条"],
              ["order", "否", "0 | 1", "默认 0 降序"],
              ["order_by", "否", "string", "nav（默认）| price_date | cumulative_nav | price_change"],
            ]}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /fund/advancedlist
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: fund_advanced_list</span>
          </h4>
          <p className="text-sm text-zinc-500 mb-2">分页列表，可按策略、类型、运作状态、关键字筛选。</p>
          <ParamTable
            rows={[
              ["strategy_one / two / three", "否", "string", "一级/二/三级策略；不传或「不限」表示不过滤"],
              ["type", "否", "1 | 2", "1 用平台策略（默认），2 用团队策略"],
              ["fund_type", "否", "int", "2 私募证券；3/12 券商资管；5 保险资管；6/13 信托；8/16 公募专户；9/17 期货资管；14 资产配置"],
              ["fund_state", "否", "int", "1 正常运作；2 正常清算；3 提前清算；4 延期清算；5 投顾协议已终止；6 非正常清算。不传=全部"],
              ["keyword", "否", "string", "匹配产品名、备案号、管理人"],
              ["page", "否", "int", "从 1 开始，默认 1"],
              ["pagesize", "否", "int", "默认 10，最大 1000"],
              ["order", "否", "0 | 1", "默认 0 降序"],
              ["order_by", "否", "string", "price_date（默认）| inception_date | price_nav | ret_1y | sharpe_1y | calmar_1y"],
            ]}
          />
          <p className="text-xs text-zinc-400 mb-1">data</p>
          <CodeBlock
            text={`{ "list": [{ "register_number", "fund_name", "advisor", "price_nav", "price_date", "strategy_one", ... }], "total": 0, "page": 1, "pagesize": 10 }`}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /fund/view
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: fund_view</span>
          </h4>
          <p className="text-sm text-zinc-500 mb-2">已计算好的收益与风险指标（小数，非百分数）。</p>
          <ParamTable rows={[["reg_code", "是", "string", "备案号"]]} />
          <CodeBlock text={`register_number, fund_name, latest_nav, latest_nav_date, ret_1w, ret_1m, ret_3m, ret_6m, ret_1y, sharpe_1y, calmar_1y, strategy`} />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /company/info
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: company_info</span>
          </h4>
          <ParamTable
            rows={[
              ["code", "二选一", "string", "管理人登记编号，如 P1032021；也可用 registration_no / register_code"],
              ["name_cn", "二选一", "string", "管理人名称模糊匹配"],
            ]}
          />
          <CodeBlock text={`name_cn, register_code, found_date, scale, member_type, core_strategy, active_product_count`} />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /company/fund/list
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: company_fund_list</span>
          </h4>
          <ParamTable
            rows={[
              ["code", "是", "string", "管理人登记编号"],
              ["page / pagesize", "否", "int", "默认 1 / 20，pagesize 最大 200"],
              ["fund_state", "否", "int", "0 或不传=全部；1–6 同列表接口"],
            ]}
          />
        </div>
      </section>

      <section className="space-y-3 pb-8">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">5. 在线调试</h3>
        <p className="text-sm text-zinc-500">在本页直接试查，返回格式与生产接口相同。</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-zinc-500 mb-1">搜索（名称 / 备案号）</span>
            <input
              className="border rounded px-3 py-1.5 text-sm w-56 bg-background outline-none focus:ring-1 focus:ring-ring"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="产品名或备案号"
              onKeyDown={(e) => e.key === "Enter" && q.trim() && run("/ma/api/fund-data/fund/search", { q })}
            />
          </label>
          <button
            disabled={loading || !q.trim()}
            onClick={() => run("/ma/api/fund-data/fund/search", { q })}
            className="px-3 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 disabled:opacity-40"
          >
            搜索
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-zinc-500 mb-1">备案号</span>
            <input
              className="border rounded px-3 py-1.5 text-sm w-40 bg-background outline-none focus:ring-1 focus:ring-ring"
              value={regCode}
              onChange={(e) => setRegCode(e.target.value)}
              placeholder="备案号"
            />
          </label>
          <label className="text-sm">
            <span className="block text-zinc-500 mb-1">开始日期</span>
            <DateInput value={startDate} onChange={setStartDate} placeholder="请选择日期" className="w-40" />
          </label>
          <label className="text-sm">
            <span className="block text-zinc-500 mb-1">结束日期</span>
            <DateInput value={endDate} onChange={setEndDate} placeholder="请选择日期" className="w-40" />
          </label>
          <button
            disabled={loading || !regCode.trim()}
            onClick={() => run("/ma/api/fund-data/fund/info", { reg_code: regCode })}
            className="px-3 py-1.5 border rounded text-sm hover:bg-muted disabled:opacity-40"
          >
            基本信息
          </button>
          <button
            disabled={loading || !regCode.trim()}
            onClick={() => run("/ma/api/fund-data/price", {
              reg_code: regCode,
              start_date: startDate,
              end_date: endDate,
              order: "0",
            })}
            className="px-3 py-1.5 border rounded text-sm hover:bg-muted disabled:opacity-40"
          >
            净值
          </button>
          <button
            disabled={loading || !regCode.trim()}
            onClick={() => run("/ma/api/fund-data/fund/view", { reg_code: regCode })}
            className="px-3 py-1.5 border rounded text-sm hover:bg-muted disabled:opacity-40"
          >
            业绩
          </button>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {loading && <p className="text-sm text-muted-foreground">查询中…</p>}
        {result && (
          <pre className="text-xs bg-muted/40 border rounded-lg p-4 overflow-auto max-h-[480px] whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </section>
    </div>
  )
}
