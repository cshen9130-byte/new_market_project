"use client"

import { useEffect, useState } from "react"
import { Download } from "lucide-react"
import { DateInput } from "@/components/ui/date-input"
import { authService, type User } from "@/lib/auth"
import { downloadMomDataApiGuide } from "@/lib/ma/mom-data-api-guide"
import { ACCOUNT_RISK_DATA_API_BASE, MOM_DATA_API_BASE, MOM_DATA_MCP_URL, MOM_DATA_PUBLIC_ORIGIN } from "@/lib/ma/mom-data-public"
import { canAccessMomDataApi } from "@/lib/permissions"

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

function ParamTable({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <div className="border rounded-lg overflow-hidden mb-3">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-zinc-500">
          <tr>
            <th className="text-left font-medium px-3 py-2">参数</th>
            <th className="text-left font-medium px-3 py-2">必填</th>
            <th className="text-left font-medium px-3 py-2">说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, req, desc]) => (
            <tr key={name} className="border-t">
              <td className="px-3 py-1.5 font-mono text-xs">{name}</td>
              <td className="px-3 py-1.5 text-zinc-500">{req}</td>
              <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FieldTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="border rounded-lg overflow-hidden mb-3">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-zinc-500">
          <tr>
            <th className="text-left font-medium px-3 py-2">字段</th>
            <th className="text-left font-medium px-3 py-2">含义</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, desc]) => (
            <tr key={name} className="border-t align-top">
              <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{name}</td>
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
  const res = await fetch(url, { headers: apiKey ? { "x-api-key": apiKey } : {} })
  return res.json() as Promise<Envelope>
}

export function MomDataApiPanel() {
  const [user, setUser] = useState<User | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [showApiKey, setShowApiKey] = useState(false)
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyMsg, setKeyMsg] = useState("")
  const [account, setAccount] = useState("")
  const [company, setCompany] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Envelope | null>(null)
  const [error, setError] = useState("")
  const [guideSaved, setGuideSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void authService.refreshCurrentUser().then((current) => {
      if (cancelled) return
      setUser(current)
      setApiKey(current?.mom_api_key || "")
    })
    return () => { cancelled = true }
  }, [])

  const allowed = canAccessMomDataApi(user)
  const keyForDocs = showApiKey && apiKey ? apiKey : "YOUR_MOM_API_KEY"

  async function issueKey() {
    if (apiKey && !window.confirm("重新生成后，旧的 MOM Key 会立刻失效。基金数据 API 的 Key 不会变。")) return
    setKeyBusy(true)
    setKeyMsg("")
    const res = await authService.regenerateMomApiKey()
    setKeyBusy(false)
    if (!res.success || !res.mom_api_key) {
      setKeyMsg(res.error || "生成失败")
      return
    }
    setApiKey(res.mom_api_key)
    setShowApiKey(true)
    setUser((prev) => (prev ? { ...prev, mom_api_key: res.mom_api_key } : prev))
    setKeyMsg(apiKey ? "已更换。旧 Key 已失效。" : "已生成。请复制后保存，关闭页面后仍可在这里查看。")
  }

  async function run(path: string, params: Record<string, string>) {
    setLoading(true)
    setError("")
    try {
      const data = await callApi(path, params, apiKey)
      setResult(data)
      if (data.error_code === 0 && path.endsWith("/accounts")) {
        const accounts = (data.data as { accounts?: Array<{ account?: string }> } | null)?.accounts
        const first = accounts?.[0]?.account
        if (first && !account) setAccount(first)
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
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">MOM数据 API</h2>
          <button
            type="button"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 border border-red-500 text-red-500 rounded text-sm hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
            onClick={() => {
              downloadMomDataApiGuide(apiKey)
              setGuideSaved(true)
              window.setTimeout(() => setGuideSaved(false), 1500)
            }}
          >
            <Download className="size-3.5" aria-hidden />
            {guideSaved ? "已下载" : "下载给 AI 的说明"}
          </button>
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          只读接口。这把 Key 只在本页生成，和用户中心的基金数据 API Key 分开。基金数据 Key 调这里会返回 401。
          管理员取消勾选后，本页不再显示，已经发出的 Key 也会立刻失效。
          下载的 Markdown 会写入当前这把 MOM Key 和全部字段说明。
        </p>
        <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          当前账户已开通 MOM数据API。下面的试调会打到正式库，请先在本页生成 Key。
        </div>
        <div className="mt-4 border rounded-lg px-4 py-3 text-sm space-y-1">
          <p><span className="text-zinc-400 w-24 inline-block">网站</span><a className="text-red-500 hover:underline" href={MOM_DATA_PUBLIC_ORIGIN} target="_blank" rel="noreferrer">{MOM_DATA_PUBLIC_ORIGIN}</a></p>
          <p><span className="text-zinc-400 w-24 inline-block">HTTP 基址</span><code className="font-mono text-xs">{MOM_DATA_API_BASE}</code></p>
          <p><span className="text-zinc-400 w-24 inline-block">MCP 地址</span><code className="font-mono text-xs">{MOM_DATA_MCP_URL}</code></p>
          <p className="flex items-start gap-2">
            <span className="text-zinc-400 w-24 inline-block shrink-0">MOM API Key</span>
            {apiKey
              ? (
                <>
                  <code className="font-mono text-xs break-all flex-1">
                    {showApiKey ? apiKey : `${apiKey.slice(0, 3)}${"•".repeat(Math.max(12, apiKey.length - 3))}`}
                  </code>
                  <button type="button" className="shrink-0 text-xs text-red-500 hover:underline" onClick={() => setShowApiKey((v) => !v)}>
                    {showApiKey ? "隐藏" : "查看"}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-red-500 hover:underline"
                    onClick={() => {
                      void navigator.clipboard.writeText(apiKey)
                      setKeyMsg("已复制")
                    }}
                  >
                    复制
                  </button>
                </>
              )
              : <span className="text-zinc-400">还没有。点下面的按钮生成，不会使用基金数据 API 的 Key。</span>}
          </p>
          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={keyBusy || !allowed}
              className="px-3 py-1 border border-red-500 text-red-500 rounded text-sm hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/20"
              onClick={() => { void issueKey() }}
            >
              {keyBusy ? "生成中…" : apiKey ? "重新生成" : "生成 Key"}
            </button>
            {keyMsg ? <span className="text-xs text-zinc-500">{keyMsg}</span> : null}
          </div>
        </div>
      </header>

      <section>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">1. HTTP 接入</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 leading-relaxed">
          全部是 GET。Key 任选一种：请求头 <code className="font-mono text-xs">x-api-key</code>、
          <code className="font-mono text-xs">Authorization: Bearer</code>，或 query <code className="font-mono text-xs">api_key</code>。
          成功时 <code className="font-mono text-xs">error_code</code> 为 0，正文在 <code className="font-mono text-xs">data</code>。
          国信、GUOXIN、GUOSEN 和账号 665300200077 不会返回。下面的 <code className="font-mono text-xs">/account/*</code> 是 MOM 母基金。
          单账户监控中心的结算单在同一基址的 <code className="font-mono text-xs">/cfmmc/*</code>，例如国泰君安期货 85121150 的净值。
        </p>
        <p className="text-xs text-zinc-400 mb-2">curl</p>
        <CodeBlock
          text={`curl -H "x-api-key: ${keyForDocs}" "${MOM_DATA_API_BASE}/accounts?limit=20"
curl -H "x-api-key: ${keyForDocs}" "${MOM_DATA_API_BASE}/account/daily?account=12345678&start_date=2026-01-01&order=1"
curl -H "x-api-key: ${keyForDocs}" "${MOM_DATA_API_BASE}/account/metrics?account=12345678"
curl -H "x-api-key: ${keyForDocs}" "${MOM_DATA_API_BASE}/cfmmc/account/nav?account=85121150&company=国泰君安期货"`}
        />
        <p className="text-xs text-zinc-400 mt-3 mb-2">Python</p>
        <CodeBlock
          text={`import requests

BASE = "${MOM_DATA_API_BASE}"
HEADERS = {"x-api-key": "${keyForDocs}"}

accounts = requests.get(f"{BASE}/accounts", headers=HEADERS, timeout=60).json()
account = accounts["data"]["accounts"][0]["account"]
metrics = requests.get(f"{BASE}/account/metrics", params={"account": account}, headers=HEADERS, timeout=60).json()
print(account, metrics["data"]["margin_usage"]["latest"], metrics["data"]["var"]["var_95_loss"])`}
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">2. MCP 接入（Cursor / Claude）</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 leading-relaxed">
          和基金数据是两个 MCP，也是两把 Key。请求头里要带本页生成的 MOM Key。基金数据 Key 会 401，权限被取消后 Key 失效。
        </p>
        <CodeBlock
          text={`{
  "mcpServers": {
    "mom-data": {
      "url": "${MOM_DATA_MCP_URL}",
      "headers": { "x-api-key": "${keyForDocs}" }
    }
  }
}`}
        />
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3 leading-relaxed">
          工具与下面的 GET 一一对应：mom_accounts、mom_account_daily、mom_account_trades、mom_account_positions、mom_account_closes、mom_account_products、mom_account_cashflows、mom_account_metrics。
          单账户另有 cfmmc_accounts、cfmmc_account_nav、cfmmc_rows。查国泰君安期货 85121150 的净值用 cfmmc_account_nav，account 填 85121150，company 填国泰君安期货。
          先列账户，再用返回的 account 查流水和指标。不要编造账号。
        </p>
      </section>

      <section className="space-y-8">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">3. 账户与每日核算</h3>

        <div>
          <h4 className="text-sm font-medium mb-2">GET /accounts</h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 leading-relaxed">
            账户列表。每条含投顾名称、板块、首尾日期，以及最新一天的权益、保证金占用、保证金使用率和结算单风险度。
          </p>
          <ParamTable rows={[
            ["q", "否", "账号、投顾名称或板块，模糊匹配"],
            ["limit", "否", "默认 500，最大 2000"],
            ["offset", "否", "默认 0。看 next_offset 翻页"],
          ]} />
          <FieldTable rows={[
            ["account", "资金账号"],
            ["advisor_name / sector / style / company", "投顾资料。没有导入时为 null"],
            ["first_date / last_date / trading_days", "该账户在库里的区间"],
            ["latest.equity", "最新客户权益"],
            ["latest.margin", "最新保证金占用"],
            ["latest.margin_usage", "保证金占用 / 客户权益，0.35 表示 35%"],
            ["latest.margin_usage_pct", "同一比率的百分点"],
            ["latest.risk_degree", "结算单「风险度」原文"],
            ["latest.risk_degree_pct", "去掉百分号后的数值，单位是百分点"],
            ["latest.daily_pnl_net", "最新一天的净盈亏"],
          ]} />
        </div>

        <div>
          <h4 className="text-sm font-medium mb-2">GET /account/daily</h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 leading-relaxed">
            单账户每个交易日的核算快照。净盈亏和页面上的账户日盈亏同一口径：当日盈亏 − 当日手续费 + 权利金收入 − 权利金支出。
            保证金使用率按当天的占用除以客户权益现算。累计净盈亏从入库第一天加总，即使用 start_date 截断，也不会把更早的盈亏丢掉。
          </p>
          <ParamTable rows={[
            ["account", "是", "资金账号"],
            ["start_date / end_date", "否", "YYYY-MM-DD，含当天"],
            ["order", "否", "1 升序（默认），0 降序"],
            ["limit / offset", "否", "默认 500，最大 2000"],
          ]} />
          <FieldTable rows={[
            ["prev_balance", "上日结存"],
            ["equity", "客户权益"],
            ["cashflow", "当日存取合计。正数是净入金"],
            ["cash_balance", "实有货币资金"],
            ["daily_pnl / fee", "当日盈亏原文，以及当日手续费"],
            ["ending_balance / available", "当日结存、可用资金"],
            ["margin", "保证金占用"],
            ["margin_usage / margin_usage_pct", "占用 / 权益"],
            ["risk_degree / risk_degree_pct", "结算单风险度"],
            ["premium_in / premium_out", "权利金收入、权利金支出"],
            ["close_pnl / position_pnl", "平仓盈亏、持仓盈亏"],
            ["option_long_mv / option_short_mv", "多头、空头期权市值"],
            ["daily_pnl_net", "扣费并计入权利金后的当日净盈亏"],
            ["cum_pnl_net", "从该账户首个入库交易日累加的净盈亏"],
            ["prev_equity", "上一交易日客户权益"],
            ["daily_return", "当日净盈亏 / 上一日客户权益。第一天为 null"],
          ]} />
        </div>
      </section>

      <section className="space-y-8">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">4. 成交与持仓</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 -mt-6 leading-relaxed">
          成交、持仓、平仓、品种汇总保持结算单原文，金额是文本。这样「--」不会被收成 0。翻页看 total 和 next_offset。
        </p>

        <div>
          <h4 className="text-sm font-medium mb-2">GET /account/trades</h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">期货成交与期权成交。market=detail 单独读取「成交明细」原表。默认结果还带资金账户报单编号、成交日期和资金账户成交编号。默认最近的在前。</p>
          <ParamTable rows={[
            ["account", "是", "资金账号"],
            ["market", "否", "all（默认）、futures、options、detail"],
            ["start_date / end_date", "否", "YYYY-MM-DD"],
            ["order", "否", "0 降序（默认），1 升序"],
            ["limit / offset", "否", "默认 200，最大 2000"],
          ]} />
          <FieldTable rows={[
            ["market", "futures 或 options"],
            ["contract / trade_id / trade_time", "合约、成交编号、成交时间"],
            ["side / offset_flag / hedge_flag", "买/卖、开/平、投机/套保"],
            ["price / lots / turnover", "成交价、手数、成交额"],
            ["fee / close_pnl / premium / exchange", "手续费、平仓盈亏、权利金收支、交易所"],
          ]} />
        </div>

        <div>
          <h4 className="text-sm font-medium mb-2">GET /account/positions</h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">不传 date 时，返回该账户期货与期权持仓中最近的一个交易日。</p>
          <ParamTable rows={[
            ["account", "是", "资金账号"],
            ["date", "否", "YYYY-MM-DD，不传为最近交易日"],
            ["market", "否", "all、futures、options、detail（持仓明细原表）"],
            ["limit / offset", "否", "默认 500，最大 2000"],
          ]} />
          <FieldTable rows={[
            ["long_lots / long_price", "买持仓、买入价"],
            ["short_lots / short_price", "卖持仓、卖出价"],
            ["prev_settle / settle", "昨结算价、今结算价"],
            ["position_pnl / margin / market_value", "持仓盈亏、保证金、持仓市值"],
            ["option_long_mv / option_short_mv", "多头、空头期权市值"],
          ]} />
        </div>

        <div>
          <h4 className="text-sm font-medium mb-2">GET /account/closes</h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">平仓明细。默认降序，limit 默认 200。</p>
          <FieldTable rows={[
            ["contract / side / lots", "合约、买/卖、手数"],
            ["open_price / close_price / prev_settle", "开仓价、平仓价、昨结算价"],
            ["close_pnl / tick_close_pnl", "平仓盈亏、逐笔平仓盈亏"],
            ["open_date / open_trade_id", "开仓日期、开仓成交编号"],
            ["premium / exchange", "权利金收支、交易所"],
          ]} />
        </div>

        <div>
          <h4 className="text-sm font-medium mb-2">GET /account/products</h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">品种汇总。每个交易日、每个品种一行：product、lots、turnover、fee、close_pnl。日期参数与 daily 相同，默认升序。</p>
        </div>

        <div>
          <h4 className="text-sm font-medium mb-2">GET /account/cashflows</h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 leading-relaxed">
            核算日报里的出入金明细：occur_date、direction、max_loss_amount、protected_amount、note，按入库原文返回。
            当天净出入金看 /account/daily 的 cashflow（当日存取合计）。
          </p>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">5. 保证金使用率、VaR 和其他已计算指标</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 leading-relaxed">
          GET /account/metrics。不传日期就是该账户全部入库交易日。这些数不是另一张结果表，而是用已经入库的每日核算现算的，口径和 MOM 页面一致。
          逐日的保证金使用率和日收益率在 /account/daily，这里给的是区间汇总。
        </p>
        <ParamTable rows={[
          ["account", "是", "资金账号"],
          ["start_date / end_date", "否", "YYYY-MM-DD。不传为全部历史"],
        ]} />
        <FieldTable rows={[
          ["total_pnl_net", "区间净盈亏之和"],
          ["win_rate", "净盈亏大于 0 的天数 / 交易日"],
          ["profit_factor", "盈利日之和 / 亏损日绝对值之和"],
          ["annualized_vol", "日收益率样本标准差 × √252"],
          ["sharpe", "日收益率均值 / 样本标准差 × √252，无风险利率按 0"],
          ["max_drawdown", "客户权益峰值回撤。0.08 表示回撤 8%"],
          ["margin_usage.latest", "最后一天的占用 / 权益"],
          ["margin_usage.average / p10 / p90 / max", "区间内每日保证金使用率的均值和分位"],
          ["var.var_95_return", "日收益率的 5% 分位，通常为负"],
          ["var.var_95_loss", "把这个亏损写成正数。0.018 表示大约 1.8% 的上一日权益"],
          ["var.var_99_loss", "1% 分位的亏损比例"],
          ["var.cvar_95_loss", "比 95% 分位更差的那些日子的平均亏损比例"],
          ["var.var_95_pnl / var_99_pnl", "当日净盈亏金额的 5% / 1% 分位，单位元"],
          ["var.note", "日收益率少于 20 个时 VaR 为空，这里说明原因"],
        ]} />
        <div className="text-sm text-zinc-500 dark:text-zinc-400 space-y-2 leading-relaxed">
          <p>日收益率 = 当日净盈亏 / 上一日客户权益。上一日权益不大于 0 的日子不进样本。</p>
          <p>VaR 是历史模拟的 1 日 VaR。它用的是入库日盈亏，不是风控页按持仓和合约波动重算的参数法 VaR。</p>
          <p>保证金使用率只在客户权益大于 0 时计算。结算单上的风险度另外原样返回，两者可以对照，计算来源不同。</p>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">6. 入库表全部可查</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          MOM 结算包里的每日核算、成交明细、期货成交、期权成交、持仓明细、期货持仓、期权持仓、平仓、委托、品种汇总、出入金，都从 <code className="font-mono text-xs">public.mom_*</code> 读出。
          每日核算补上了非货币充抵、货币充抵、冻结资金、追加保证金、市值权益、当日总权利金、行权手续费、行权盈亏、申报费。
          委托在 <code className="font-mono text-xs">GET /account/orders</code>。
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          单账户监控中心导入写的是另一套表 <code className="font-mono text-xs">public.cfmmc_*</code>，挂在本基址
          <code className="font-mono text-xs"> {MOM_DATA_API_BASE}/cfmmc</code>
          。同一把 MOM Key。净值与单账户总览曲线相同：
          <code className="font-mono text-xs">GET /cfmmc/account/nav?account=85121150&company=国泰君安期货</code>
          。<code className="font-mono text-xs">company</code> 用来核对期货公司，对不上就 404。
          其余路径有 accounts、daily、products、positions、trades、closes、cashflows、option-trades、securities。
          <code className="font-mono text-xs">{ACCOUNT_RISK_DATA_API_BASE}</code> 是同一批数据，没有 cfmmc 前缀。
        </p>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">7. 错误码</h3>
        <FieldTable rows={[
          ["0 / HTTP 200", "成功"],
          ["401", "没带 Key、Key 无效，或误用了基金数据 API 的 Key"],
          ["403", "MOM Key 还在，但这个账户的 MOM数据API 权限已被取消"],
          ["1 / HTTP 400", "参数错误，或路径不存在"],
          ["2 / HTTP 404", "账号不存在，或 MOM 数据还没入库"],
          ["3 / HTTP 500", "服务器错误"],
        ]} />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">7. 试调</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">用当前登录账号的 Key 打正式库。先拉账户列表，账号会填进下面的输入框。</p>
        <div className="flex flex-wrap gap-2 mb-3">
          <button type="button" className="px-3 py-1.5 text-sm border rounded hover:bg-muted" disabled={loading} onClick={() => run("/ma/api/mom-data/accounts", { limit: "20" })}>
            账户列表
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-4 mb-3">
          <label className="text-xs text-zinc-500">
            账号
            <input className="mt-1 w-full border rounded px-2 py-1.5 text-sm bg-background" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="85121150" />
          </label>
          <label className="text-xs text-zinc-500">
            期货公司
            <input className="mt-1 w-full border rounded px-2 py-1.5 text-sm bg-background" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="国泰君安期货" />
          </label>
          <label className="text-xs text-zinc-500">
            开始日期
            <DateInput value={startDate} onChange={setStartDate} placeholder="请选择日期" className="mt-1 w-full" />
          </label>
          <label className="text-xs text-zinc-500">
            结束日期
            <DateInput value={endDate} onChange={setEndDate} placeholder="请选择日期" className="mt-1 w-full" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          <button type="button" className="px-3 py-1.5 text-sm border rounded hover:bg-muted" disabled={loading || !account} onClick={() => run("/ma/api/mom-data/account/daily", { account, start_date: startDate, end_date: endDate, limit: "5", order: "0" })}>
            最近核算
          </button>
          <button type="button" className="px-3 py-1.5 text-sm border rounded hover:bg-muted" disabled={loading || !account} onClick={() => run("/ma/api/mom-data/account/trades", { account, start_date: startDate, end_date: endDate, limit: "5" })}>
            最近成交
          </button>
          <button type="button" className="px-3 py-1.5 text-sm border rounded hover:bg-muted" disabled={loading || !account} onClick={() => run("/ma/api/mom-data/account/metrics", { account, start_date: startDate, end_date: endDate })}>
            风险指标
          </button>
          <button type="button" className="px-3 py-1.5 text-sm border rounded hover:bg-muted" disabled={loading} onClick={() => run("/ma/api/mom-data/cfmmc/accounts", { limit: "20", q: company })}>
            单账户列表
          </button>
          <button type="button" className="px-3 py-1.5 text-sm border rounded hover:bg-muted" disabled={loading || !account} onClick={() => run("/ma/api/mom-data/cfmmc/account/nav", { account, company, start_date: startDate, end_date: endDate, limit: "5", order: "0" })}>
            单账户净值
          </button>
        </div>
        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
        {result && (
          <pre className="text-xs bg-muted/40 border rounded-lg p-3 overflow-x-auto max-h-96 font-mono">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </section>
    </div>
  )
}
