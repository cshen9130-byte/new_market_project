"use client"

import { useEffect, useState } from "react"
import { Download } from "lucide-react"
import { DateInput } from "@/components/ui/date-input"
import { authService } from "@/lib/auth"
import { downloadFundDataApiGuide } from "@/lib/ma/fund-data-api-guide"
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
  const [showApiKey, setShowApiKey] = useState(false)
  const [q, setQ] = useState("")
  const [regCode, setRegCode] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Envelope | null>(null)
  const [error, setError] = useState("")
  const [guideSaved, setGuideSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void authService.refreshCurrentUser().then((user) => {
      if (!cancelled) setApiKey(user?.api_key || "")
    })
    return () => { cancelled = true }
  }, [])

  const keyForDocs = showApiKey && apiKey ? apiKey : "YOUR_API_KEY"

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
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">基金数据 API</h2>
          <button
            type="button"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 border border-red-500 text-red-500 rounded text-sm hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
            onClick={() => {
              downloadFundDataApiGuide(apiKey)
              setGuideSaved(true)
              window.setTimeout(() => setGuideSaved(false), 1500)
            }}
          >
            <Download className="size-3.5" aria-hidden />
            {guideSaved ? "已下载" : "下载给 AI 的说明"}
          </button>
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
          生产环境只读接口。每个登录账号在「用户中心」都有一把 API Key，请求时必须带上，系统据此识别用户并访问正式库。
          下载的 Markdown 已写入你的 API Key 和全部接口说明，可直接发给模型。请只发给你信任的对话。
        </p>
        <div className="mt-4 border rounded-lg px-4 py-3 text-sm space-y-1">
          <p><span className="text-zinc-400 w-24 inline-block">网站</span><a className="text-red-500 hover:underline" href={FUND_DATA_PUBLIC_ORIGIN} target="_blank" rel="noreferrer">{FUND_DATA_PUBLIC_ORIGIN}</a></p>
          <p><span className="text-zinc-400 w-24 inline-block">HTTP 基址</span><code className="font-mono text-xs">{FUND_DATA_API_BASE}</code></p>
          <p><span className="text-zinc-400 w-24 inline-block">MCP 地址</span><code className="font-mono text-xs">{FUND_DATA_MCP_URL}</code></p>
          <p className="flex items-start gap-2">
            <span className="text-zinc-400 w-24 inline-block shrink-0">你的 API Key</span>
            {apiKey
              ? (
                <>
                  <code className="font-mono text-xs break-all flex-1">
                    {showApiKey ? apiKey : `${apiKey.slice(0, 3)}${"•".repeat(Math.max(12, apiKey.length - 3))}`}
                  </code>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-red-500 hover:underline"
                    onClick={() => setShowApiKey((v) => !v)}
                  >
                    {showApiKey ? "隐藏" : "查看"}
                  </button>
                </>
              )
              : <span className="text-zinc-400">登录后自动生成，也可到 用户中心 查看</span>}
          </p>
        </div>
      </header>

      <section>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">1. HTTP 接入</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 leading-relaxed">
          查询为 GET。跟踪池整本净值用 POST /price/bulk，备案号放 JSON。每个请求必须带 API Key，任选一种方式：请求头 <code className="font-mono text-xs">x-api-key</code>、
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
          <li>启用后可以直接用自然语言提问，例如对比两只基金、查净值、问某人在路演里看多什么。模型会按下面的工具名去调用。</li>
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
          公开工具（任何持有有效 Key 的账户）：fund_search、fund_info、fund_price、fund_price_bulk、fund_multi_price、fund_advanced_list、fund_view、company_info、company_fund_list。
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3 leading-relaxed">
          同一地址还会按<strong>当前 API Key 所属账户</strong>开放内部工具。没有对应页面权限时，tools/list 不会列出该工具，直接调用也会被拒绝。权限与网页相同。
        </p>
        <ul className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 space-y-1 list-disc pl-5">
          <li>跟踪池（需投资页）：tracking_pools、tracking_pool_list、tracking_pool_detail。detail 里的 team_note / personal_note 是跟踪池短备注。</li>
          <li>在管产品（需投资池权限）：managed_products_list。</li>
          <li>AI 研究员（需 AI 研究员）：ai_researcher_compare、ai_researcher_similar、ai_researcher_opposite、ai_researcher_roadshow、ai_researcher_team_background、ai_researcher_manager_profile。</li>
          <li>AI 知识库（需 AI 知识库）：问某人观点用 kb_ask，只要原文片段用 kb_search，读全文用 kb_read，看有哪些文件用 kb_list。见下方「问知识库」。</li>
          <li>外部业绩榜（需投资页，并且要有 AI 知识库）：external_rank_compare。用知识库里的点睛等业绩榜 xlsx，和跟踪池同一策略对比。见下方「外部业绩榜」。</li>
        </ul>
      </section>

      <section className="space-y-8">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">用法示例</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 -mt-6 leading-relaxed">
          连上 MCP 之后，用自然语言即可。下面给出模型实际应调用的工具和参数，方便对照结果。研究员和知识库没有对应的 GET 接口，只能走 MCP。
        </p>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            外部业绩榜对比跟踪池
          </h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2 leading-relaxed">
            点睛这类业绩榜是表格。不要用 kb_read 或 kb_ask 去读 xlsx，表格被抽成文字后名次和收益会对不齐。一次 <code className="font-mono text-xs">external_rank_compare</code> 会自己解析榜单，并按榜单截止日从净值库重算跟踪池里同一策略的收益。文件名保留「点睛」或「业绩榜」。不传 file_path 时，用该策略最新一份。一份文件里有多种策略时必须传 class。
          </p>
          <p className="text-xs text-zinc-400 mb-2">在 Cursor 里可以直接这样说</p>
          <CodeBlock
            text={`用知识库里最新的点睛主观多头榜，和 JY跟踪池比较。窗口按榜单自己的截止日期。
列出他们前 20 里我们池子没有的，以及两边都有但名次差超过 15 的。
只根据工具返回的数字说。needs_review 里的名字不要当成已经匹配。`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-2">模型应调用</p>
          <CodeBlock
            text={`{
  "name": "external_rank_compare",
  "arguments": {
    "class": "主观多头",
    "pools": "jy",
    "top_n": 20
  }
}`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3 leading-relaxed">
            收益是百分数：159.12 表示 159.12%。their_* 是榜单原数，our_* 是池内产品按同一窗口重算的结果，our_return 取该管理人池内这一策略里最高的一条。rank_gap = 池内名次 − 榜单名次，正数表示按我们的净值它排得更靠后。external_only 是榜上有、池子没有的候选；both 是已经对上的名称；pool_only 是池子里有、不在榜单前 N；needs_review 是名称只是部分相同，没有自动匹配。class 可用主观多头、量化股票、量化CTA、主观CTA，或具体分组如 500指增。pools 用 jy、selected 或 jy,selected。week_end 只用于提示和榜单截止日差多少天。
          </p>
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            问知识库：某人看多或看空哪些品种
          </h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2 leading-relaxed">
            路演、尽调笔记里「某人怎么看」走知识库，不走净值接口。一次 <code className="font-mono text-xs">kb_ask</code> 即可。它会按人名匹配文件路径，把路演笔记排在月报前面；同一份笔记若在两个文件夹各有一份，只读一份。笔记不长时读全文，所以姓名在第 1 页、观点在后面几页也能答出来。
          </p>
          <p className="text-xs text-zinc-400 mb-2">在 Cursor 里可以直接这样说</p>
          <CodeBlock
            text={`左广东看多的品种都有哪些？只根据知识库原文回答。
每一条结论都要带原文、文件路径和页码。资料没写他属于哪家基金，就写「资料未说明」。`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-2">模型应调用</p>
          <CodeBlock
            text={`{
  "name": "kb_ask",
  "arguments": {
    "question": "左广东看多的品种都有哪些？只引用路演笔记原文，没有写的不要推断。"
  }
}`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3 mb-2 leading-relaxed">
            先看 <code className="font-mono text-xs">citations</code>，再用 <code className="font-mono text-xs">answer</code>。每条引用都有原文 <code className="font-mono text-xs">quote</code>、文件 <code className="font-mono text-xs">path</code> 和页码 <code className="font-mono text-xs">page</code>。<code className="font-mono text-xs">citations_grounded</code> 为 true 时，<code className="font-mono text-xs">sources</code> 里只剩实际引用过的文件；为 false 时，模型没有给出能对上原文的句子，不要把回答当成已核实。资料没写的任职或产品归属会写成「资料未说明该关联」。
          </p>
          <CodeBlock
            text={`{
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
}`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3 mb-2 leading-relaxed">
            只想先看证据、先不写结论时，用 <code className="font-mono text-xs">kb_search</code>。片段里已经有答案就可以停。<code className="font-mono text-xs">suggest_full_read</code> 为 true，或片段里没有要的句子，再用返回的 <code className="font-mono text-xs">path</code> 调 <code className="font-mono text-xs">kb_read</code>。路径必须来自返回值，不要自己编。
          </p>
          <CodeBlock
            text={`{ "name": "kb_search", "arguments": { "question": "左广东看多的品种都有哪些？", "limit": 6 } }

{ "name": "kb_read", "arguments": { "path": "内部尽调资料/2025.12.25-左广东/左广东路演笔记-2025.12.25.pdf" } }`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">kb_search 返回。duplicate_paths 是已合并的另一份副本，不必再读</p>
          <CodeBlock
            text={`{
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
}`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3 mb-2 leading-relaxed">
            答案对不上时，给 <code className="font-mono text-xs">kb_ask</code> 加上 <code className="font-mono text-xs">debug: true</code>。多出来的 <code className="font-mono text-xs">passages</code> 与上面的 hits 相同，用来看模型读到了哪一段。问观点时不要把 <code className="font-mono text-xs">model</code> 设成 turbo。
          </p>
          <ParamTable
            rows={[
              ["question", "是", "string", "问题本身。把「只引用原文、没有写的不要推断」写进问题里"],
              ["folder_path", "否", "string", "路演和尽调留空，搜全库。只要团队投资笔记时填「投资笔记」"],
              ["file_path", "否", "string", "已经从 kb_search 或 kb_list 拿到路径时填写，只读这一份"],
              ["model", "否", "string", "默认 plus。turbo 更快，但不适合抽观点；max 更慢"],
              ["debug", "否", "boolean", "仅 kb_ask。true 时附上检索片段 passages"],
              ["limit", "否", "integer", "仅 kb_search。默认 8，最大 20"],
            ]}
          />
          <ul className="text-sm text-zinc-500 dark:text-zinc-400 space-y-1 list-disc pl-5 leading-relaxed">
            <li>需要账户有「AI 知识库」权限。没有权限时 tools/list 里不会出现这些工具。</li>
            <li>kb_ask 大约几十秒。kb_search 不写结论，通常更快。</li>
            <li>笔记大约超过 2.4 万字时不会整篇放入回答，kb_read 也会截断。这时以 citations 的页码为准，或把 file_path 指到该文件再问一次。</li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            对比几只基金
          </h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2 leading-relaxed">
            一次调用 <code className="font-mono text-xs">ai_researcher_compare</code>。先看返回里的 <code className="font-mono text-xs">resolved</code> 和 <code className="font-mono text-xs">bindings</code>。有一只没绑上时 <code className="font-mono text-xs">report</code> 为 null，不会写对比。都绑上之后，业绩在 <code className="font-mono text-xs">funds</code>，和 fund/view 相同。团队策略不同时 <code className="font-mono text-xs">same_strategy</code> 为 false，只分组，不排序。名称以「C类」结尾会绑到母基金。
          </p>
          <p className="text-xs text-zinc-400 mb-2">在 Cursor 里可以直接这样说</p>
          <CodeBlock
            text={`对比「幻方中证500指数增强」和「九坤日享中证500指数增强」。
先确认两只都绑定到备案号。业绩只用返回的 funds，不要另算。策略不同就分组，不要排序。`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-2">对应的 MCP 工具调用</p>
          <CodeBlock
            text={`{
  "name": "ai_researcher_compare",
  "arguments": {
    "subjects": ["幻方中证500指数增强", "九坤日享中证500指数增强"],
    "kb_path": "投资笔记"
  }
}`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">名称对不上时改传备案号。备案号整段精确匹配，不会用前缀撞到另一只产品</p>
          <CodeBlock
            text={`{
  "name": "ai_researcher_compare",
  "arguments": {
    "subjects": ["SR6089", "另一只产品的备案号"],
    "kb_path": "投资笔记"
  }
}`}
          />
          <ParamTable
            rows={[
              ["subjects", "是", "string[]", "至少 2 个。产品名或备案号，最多 10 个。名称以 A类 / B类 / C类 结尾时绑定母基金"],
              ["kb_path", "否", "string", "填「投资笔记」时只在该文件夹里找点名该基金的段落。留空则全库查找，仍然只保留点名该基金的段落"],
            ]}
          />
          <p className="text-xs text-zinc-400 mb-1">返回（MCP 文本里是这段 JSON）</p>
          <CodeBlock
            text={`{
  "resolved": true,
  "misses": [],
  "bindings": [
    { "query": "幻方中证500指数增强", "register_number": "SR6089", "fund_name": "幻方中证500指数增强", "match": "name", "match_score": 1, "nav_loaded": true, "nav_scope": "self" }
  ],
  "same_strategy": false,
  "funds": [
    { "register_number": "SR6089", "latest_nav": 1.23, "metrics": { "ret_1y": 12.4, "sharpe_1y": 1.1 }, "incomplete_windows": [] }
  ],
  "notes": [],
  "report": "# 基金对比\\n……"
}`}
          />
          <ul className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 space-y-1 list-disc pl-5 leading-relaxed">
            <li>需要账户有「AI 研究员」权限。</li>
            <li>有一只未绑定时，misses 写出查询词和原因，report 为 null。</li>
            <li>funds.metrics 的收益是百分数：12.4 表示 12.4%。夏普、卡玛是比率。incomplete_windows 里的字段不是完整区间。</li>
            <li>share_class 为 C 且 nav_scope 为 parent 时，净值是母基金公布值，不是该类单独净值。</li>
            <li>知识库「投资笔记」只包含已分享到团队的笔记。未分享的个人笔记不在这个文件夹里。</li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            自己取数再对比：HTTP 净值 + 知识库笔记
          </h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2 leading-relaxed">
            不想要自动写好的报告时，把原始净值和笔记分开取。净值走上面的 HTTP 接口，笔记走 MCP。
          </p>
          <p className="text-xs text-zinc-400 mb-2">1. 两只基金的净值序列和已计算指标</p>
          <CodeBlock
            text={`curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/price?reg_code=SR6089&start_date=2024-01-01&order=1"
curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/fund/view?reg_code=SR6089"
curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/price?reg_code=另一只产品的备案号&start_date=2024-01-01&order=1"
curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/fund/view?reg_code=另一只产品的备案号"`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-2">同一件事的 MCP 写法</p>
          <CodeBlock
            text={`{ "name": "fund_price", "arguments": { "reg_code": "SR6089", "start_date": "2024-01-01", "order": "1" } }
{ "name": "fund_view", "arguments": { "reg_code": "SR6089" } }`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-2">2. 先确认笔记文件在不在，再按两只基金提问</p>
          <CodeBlock
            text={`{ "name": "kb_list", "arguments": { "path": "投资笔记", "limit": 50 } }

{ "name": "kb_ask", "arguments": {
  "folder_path": "投资笔记",
  "question": "对比 SR6089 和另一只产品：策略逻辑、团队、容量、主要风险。只引用投资笔记原文，没有的写「笔记未提及」。"
} }

{ "name": "kb_read", "arguments": { "path": "投资笔记/幻方中证500指数增强投资笔记.html" } }`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
            <code className="font-mono text-xs">kb_read</code> 的 path 必须来自 <code className="font-mono text-xs">kb_list</code> 返回的文件路径，不要自己编文件名。
          </p>
          <p className="text-xs text-zinc-400 mt-3 mb-1">kb_list 返回</p>
          <CodeBlock
            text={`{
  "path": "投资笔记",
  "truncated": false,
  "entries": [
    { "type": "file", "path": "投资笔记/幻方500指增投资笔记.html", "name": "幻方500指增投资笔记.html", "size": 18240 }
  ]
}`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3 leading-relaxed">
            投资笔记的 <code className="font-mono text-xs">kb_ask</code> 同样返回 citations。字段怎么读，见上面「问知识库」。这里把 folder_path 设为「投资笔记」，避免路演和月报混进来。
          </p>
          <p className="text-xs text-zinc-400 mt-3 mb-1">kb_read 返回。正文超过约 2.4 万字时 truncated 为 true，text 末尾会截断</p>
          <CodeBlock
            text={`{
  "path": "投资笔记/幻方500指增投资笔记.html",
  "name": "幻方500指增投资笔记.html",
  "truncated": false,
  "text": "……笔记正文……"
}`}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            跟踪池短备注，不是投资笔记长文
          </h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2 leading-relaxed">
            产品卡片上的团队备注和个人备注用 <code className="font-mono text-xs">tracking_pool_detail</code>。字段是 <code className="font-mono text-xs">team_note</code> 和 <code className="font-mono text-xs">personal_note</code>。个人备注只返回当前 API Key 账户自己写的那条。
          </p>
          <p className="text-xs text-zinc-400 mb-2">先按备案号取这一只</p>
          <CodeBlock
            text={`{ "name": "tracking_pool_detail", "arguments": { "reg_code": "SR6089" } }`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">返回里和笔记相关的字段</p>
          <CodeBlock
            text={`{
  "beian_hao": "SR6089",
  "strategy_tags": ["500指增"],
  "personal_tags": ["重点"],
  "team_note": "团队短备注正文",
  "team_note_updated_by": "张三",
  "personal_note": "我自己的短备注"
}`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-2">按池和策略翻列表。pool 用 tracking_pools 返回的 key，all 表示全部可见池</p>
          <CodeBlock
            text={`{ "name": "tracking_pools", "arguments": {} }

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
}`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
            列表每一行与投资页跟踪池相同，并多出 strategy_tags、personal_tags。page_size 最大 50。
          </p>
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">在管产品</h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2 leading-relaxed">
            需要投资池（在管产品）权限。没有该权限时，MCP 的 tools/list 里不会出现这个工具。
          </p>
          <CodeBlock
            text={`{
  "name": "managed_products_list",
  "arguments": {
    "keyword": "500",
    "strategy_l1": "股票多头",
    "run_status": "running",
    "page": 1,
    "page_size": 20
  }
}`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
            run_status：running 在运作（默认），liquidated 已清算，all 全部。返回里带策略分级、策略标签、净值、规模、托管余额、开放日和费率。
          </p>
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">相似基金、相反基金</h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2 leading-relaxed">
            都需要「AI 研究员」权限。工具会用净值相关性在全库里找产品，再用 kb_path 限定定性材料。只要投资笔记就填「投资笔记」。subject 和 reg_code 至少给一个。
          </p>
          <p className="text-xs text-zinc-400 mb-2">可以说：「给 SR6089 找最相似的产品，补充说明只看投资笔记。」</p>
          <CodeBlock
            text={`{
  "name": "ai_researcher_similar",
  "arguments": {
    "reg_code": "SR6089",
    "kb_path": "投资笔记",
    "file_note": "优先同策略、同基准"
  }
}`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-2">可以说：「找和这只净值走势相反、适合做对冲的产品。」</p>
          <CodeBlock
            text={`{
  "name": "ai_researcher_opposite",
  "arguments": { "reg_code": "SR6089", "kb_path": "投资笔记" }
}`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">两者都返回 plan、steps、report。相似基金另外带 matches：按净值相关性排序</p>
          <CodeBlock
            text={`{
  "plan": "……",
  "steps": [{ "step": 3, "summary": "已计算净值相关性" }],
  "matches": [
    { "rank": 1, "beian_hao": "SXXXXX", "product_name": "……", "correlation": 0.86, "score": 0.91, "overlapMonths": 24, "navPoints": 96 }
  ],
  "report": "# 相似度分析\\n……"
}`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
            相反基金的候选和负相关系数写在 report 里，没有单独的 matches 字段。correlation 为负表示走势相反。
          </p>
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">路演漏洞扫描</h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2 leading-relaxed">
            材料必须已经在知识库里。先 kb_list 找到路演或月报的相对路径，再交给扫描。reg_code 可选，用来把材料对上数据库里的净值。
          </p>
          <CodeBlock
            text={`{ "name": "kb_list", "arguments": { "path": "尽调/某管理人", "limit": 50 } }

{
  "name": "ai_researcher_roadshow",
  "arguments": {
    "kb_path": "尽调/某管理人/2026-03路演.pdf",
    "reg_code": "SR6089"
  }
}`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
            返回同样是 plan、steps、report。报告会扫策略矛盾、叙事不一致、容量、幸存者偏差、隐藏杠杆等尽调风险点。
          </p>
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">团队背景、管理人画像</h4>
          <p className="text-xs text-zinc-400 mb-2">可以说：「找出团队里有高盛背景的管理人，证据优先用投资笔记。」</p>
          <CodeBlock
            text={`{
  "name": "ai_researcher_team_background",
  "arguments": { "keyword": "高盛", "kb_path": "投资笔记" }
}`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-2">可以说：「给杭州幻方科技写一份管理人画像，笔记放进定性部分。」</p>
          <CodeBlock
            text={`{
  "name": "ai_researcher_manager_profile",
  "arguments": { "manager_name": "杭州幻方科技", "kb_path": "投资笔记" }
}`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
            keyword、manager_name 必填。kb_path 留空则全库（路演、月报、尽调、笔记一起用）。返回 plan、steps、report。
          </p>
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">AI 填表助手</h4>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2 leading-relaxed">
            网页上的「填表助手」在 AI 知识库页面：列是产品或管理人，行是维度，逐格提问后可以导出 CSV / Excel。MCP 没有单独的填表工具。在 Cursor 里做同一张表，对每个单元格调一次 <code className="font-mono text-xs">kb_ask</code>。打板策略横向比较表要搜全库，不要传 folder_path。量道在外部尽调路演稿，六妙星在在线笔记和内部尽调，衍复在投资笔记。
          </p>
          <p className="text-xs text-zinc-400 mb-2">可以说：「填一张打板策略横向比较表。列是量道、六妙星、衍复，行是代表产品、基金经理、细分策略。检索全库。每一格只采用出现了该列名称的段落，没有就写暂无数据。」</p>
          <CodeBlock
            text={`代表产品
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
} }`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">用户明确只要某一个文件夹时才加 folder_path</p>
          <CodeBlock
            text={`{ "name": "kb_ask", "arguments": {
  "folder_path": "投资笔记",
  "question": "填写「打板策略横向比较表」。列：「衍复」，行：「代表产品」。只输出产品名称，不超过 30 字，不要解释。只采用出现了「衍复」的段落。没有产品名则写「暂无数据」。"
} }`}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
            每一格用返回的 value。sources 记在这一格，每条 quote 都要含列名；路径和正文都没有该列名称的丢掉。没有段落出现列名时 value 为「暂无数据」，sources 为空。正文已经有内容时，末尾再写的「暂无数据」丢掉。近名不算：六九星、衍宏不会填进六妙星、衍复。代表产品要是产品名称，量道应接近「千石资本量道对冲1号」。基金经理要是投资负责人，量道填程余，余晓锋是首席运营官兼技术总监。不要用 kb_list 判断全库里有没有这一列。kb_ask 默认 qwen-plus，填表不要改成 turbo。
          </p>
        </div>
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
        <p className="text-sm text-zinc-500 -mt-6 leading-relaxed">
          完整 URL = HTTP 基址 + 路径，例如 {FUND_DATA_API_BASE}/fund/info。下面每个接口都有可复制的 curl 和对应 MCP 调用。返回 JSON 只说明字段形状，产品名、净值和日期是示意，以实际返回为准。
        </p>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /fund/search
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: fund_search</span>
          </h4>
          <p className="text-sm text-zinc-500 mb-2">按产品名、备案号搜基金，同时搜管理人。名称不确定时先调这个，再用返回的 price_reg_code 调 /price。份额、A类/A类份额、私募基金/私募证券投资基金视为同一产品族，母基金会跟在份额旁边。测试产品不出现。</p>
          <ParamTable
            rows={[
              ["q 或 keyword", "是", "string", "名称或备案号"],
              ["limit", "否", "int", "1–40，默认 8"],
            ]}
          />
          <p className="text-xs text-zinc-400 mb-1">请求</p>
          <CodeBlock
            text={`curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/fund/search?q=幻方&limit=8"

MCP
{ "name": "fund_search", "arguments": { "q": "幻方", "limit": 8 } }`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">data</p>
          <CodeBlock
            text={`{
  "products": [{ "register_number": "AAK83C", "fund_name": "...", "fund_short_name": "...", "strategy_one": "...", "price_reg_code": "SAAK83", "parent_reg_code": "SAAK83", "share_class": "C" }],
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
          <p className="text-xs text-zinc-400 mb-1">请求</p>
          <CodeBlock
            text={`curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/fund/info?reg_code=SR6089"

MCP
{ "name": "fund_info", "arguments": { "reg_code": "SR6089" } }`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">data 示例（字段会按产品有无而增减）</p>
          <CodeBlock
            text={`{
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
}`}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /price
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: fund_price</span>
          </h4>
          <p className="text-sm text-zinc-500 mb-2">单只基金净值序列，最多 5000 行。份额代码会解析到母基金，series_reg_code 是实际取数的备案号。price_change 是百分比：0.2976 表示 +0.2976%。全序列第一天为 null，之后持平为 0。基金存在但没有净值时 error_code 为 0、data 为 []。</p>
          <p className="text-xs text-zinc-400 mb-1">请求：2025 年全年、按日期从早到晚</p>
          <CodeBlock
            text={`curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/price?reg_code=SR6089&start_date=2025-01-01&end_date=2025-12-31&order=1"

MCP
{ "name": "fund_price", "arguments": { "reg_code": "SR6089", "start_date": "2025-01-01", "end_date": "2025-12-31", "order": "1" } }`}
          />
          <ParamTable
            rows={[
              ["reg_code", "是", "string", "备案号或份额代码"],
              ["start_date", "否", "YYYY-MM-DD", "含当天；也接受 2025/1/1"],
              ["end_date", "否", "YYYY-MM-DD", "含当天"],
              ["order", "否", "0 | 1", "1 升序（默认），0 降序"],
              ["order_by", "否", "string", "price_date（默认）| nav | cumulative_nav | cumulative_nav_withdrawal | price_change"],
            ]}
          />
          <p className="text-xs text-zinc-400 mb-1">data[]。升序超过 5000 行时响应带 truncated 和 next_start_date</p>
          <CodeBlock
            text={`{ "reg_code": "SR6089", "nav": 1.348, "cumulative_nav_withdrawal": 1.348, "cumulative_nav": 1.348, "price_change": 0.2976, "price_date": "2025-01-07" }`}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            POST /price/bulk
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: fund_price_bulk</span>
          </h4>
          <p className="text-sm text-zinc-500 mb-2">跟踪池导出用这个。POST JSON 放整本备案号；GET 只适合少量代码。每页默认 10 只、最多 20 只。某只满 5000 行时 next_cursor 停在该只，形如 12@2024-03-01。找不到的代码写在该只的 error_code 2 上，整批仍成功。</p>
          <ParamTable
            rows={[
              ["reg_code / reg_codes", "是", "string 或 string[]", "备案号。GET 用逗号分隔；POST 用数组"],
              ["start_date", "否", "YYYY-MM-DD", "含当天"],
              ["end_date", "否", "YYYY-MM-DD", "含当天"],
              ["cursor", "否", "string", "上一页的 next_cursor"],
              ["batch", "否", "int", "每页基金数，默认 10，最大 20"],
              ["format", "否", "ndjson", "每只基金一行，最后一行是 next_cursor"],
            ]}
          />
          <p className="text-xs text-zinc-400 mb-1">请求</p>
          <CodeBlock
            text={`curl -H "x-api-key: ${keyForDocs}" -H "Content-Type: application/json" \\
  -d "{\\"reg_codes\\":[\\"SR6089\\",\\"AAK83C\\"],\\"start_date\\":\\"2020-01-01\\",\\"batch\\":10}" \\
  "${FUND_DATA_API_BASE}/price/bulk"

MCP
{ "name": "fund_price_bulk", "arguments": { "reg_code": "SR6089,AAK83C", "start_date": "2020-01-01", "batch": 10 } }`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">data.series[]。份额 AAK83C 的序列在母基金 SAAK83 上</p>
          <CodeBlock
            text={`{
  "series": [{
    "reg_code": "AAK83C",
    "price_reg_code": "SAAK83",
    "series_reg_code": "SAAK83",
    "parent_reg_code": "SAAK83",
    "share_class": "C",
    "truncated": false,
    "next_start_date": null,
    "error_code": 0,
    "points": [{ "reg_code": "SAAK83", "nav": 1.348, "price_change": 0.2976, "price_date": "2025-01-07" }]
  }],
  "next_cursor": "2"
}`}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /fund/price
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: fund_multi_price</span>
          </h4>
          <p className="text-sm text-zinc-500 mb-2">一次取最多 40 只基金在某日（或最新）的一条净值。整段历史用 /price/bulk。price_change 是百分比。</p>
          <ParamTable
            rows={[
              ["reg_code", "是", "string", "逗号分隔备案号，最多 40 个"],
              ["date", "否", "YYYY-MM-DD", "不传则每只取最新一条；传入则取该日或之前最近一条"],
              ["order", "否", "0 | 1", "默认 0 降序"],
              ["order_by", "否", "string", "nav（默认）| price_date | cumulative_nav | price_change"],
            ]}
          />
          <p className="text-xs text-zinc-400 mb-1">请求：两只基金的最新净值</p>
          <CodeBlock
            text={`curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/fund/price?reg_code=SR6089,SXXXXX"

指定日期（取该日或之前最近一条）
curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/fund/price?reg_code=SR6089,SXXXXX&date=2026-09-30"

MCP
{ "name": "fund_multi_price", "arguments": { "reg_code": "SR6089,SXXXXX", "date": "2026-09-30" } }`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">data[] 每只一行，带 reg_code</p>
          <CodeBlock
            text={`[
  { "reg_code": "SR6089", "nav": 1.84, "cumulative_nav": 2.10, "cumulative_nav_withdrawal": 2.05, "price_change": 0.40, "price_date": "2026-09-30" },
  { "reg_code": "SXXXXX", "nav": 1.21, "cumulative_nav": 1.33, "cumulative_nav_withdrawal": 1.30, "price_change": -0.20, "price_date": "2026-09-26" }
]`}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1">
            GET /fund/advancedlist
            <span className="ml-2 font-mono text-xs font-normal text-zinc-400">MCP: fund_advanced_list</span>
          </h4>
          <p className="text-sm text-zinc-500 mb-2">分页列表，可按策略、类型、运作状态、关键字筛选。每行带 price_reg_code、parent_reg_code、share_class。测试产品不出现。</p>
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
          <p className="text-xs text-zinc-400 mb-1">请求：团队策略里、正在运作的股票多头，按近一年收益降序</p>
          <CodeBlock
            text={`curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/fund/advancedlist?type=2&strategy_one=%E8%82%A1%E7%A5%A8%E5%A4%9A%E5%A4%B4&fund_state=1&order_by=ret_1y&order=0&page=1&pagesize=20"

MCP
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
}`}
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
          <p className="text-sm text-zinc-500 mb-2">已计算好的区间收益和风险指标。ret_* 与库内一致，是百分数数值（12.4 表示 12.4%，不是 0.124）。sharpe_1y、calmar_1y 是比率。</p>
          <ParamTable rows={[["reg_code", "是", "string", "备案号"]]} />
          <p className="text-xs text-zinc-400 mb-1">请求</p>
          <CodeBlock
            text={`curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/fund/view?reg_code=SR6089"

MCP
{ "name": "fund_view", "arguments": { "reg_code": "SR6089" } }`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">data 示例</p>
          <CodeBlock
            text={`{
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
}`}
          />
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
          <p className="text-xs text-zinc-400 mb-1">请求</p>
          <CodeBlock
            text={`curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/company/info?code=P1032021"
curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/company/info?name_cn=%E5%B9%BB%E6%96%B9"

MCP
{ "name": "company_info", "arguments": { "code": "P1032021" } }
{ "name": "company_info", "arguments": { "name_cn": "幻方" } }`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">data 示例</p>
          <CodeBlock
            text={`{
  "name_cn": "杭州幻方科技",
  "register_code": "P1032021",
  "found_date": "2016-01-01",
  "scale": "100亿元以上",
  "member_type": "普通会员",
  "core_strategy": "股票多头",
  "active_product_count": 12
}`}
          />
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
          <p className="text-xs text-zinc-400 mb-1">请求：某管理人旗下正常运作的产品，第 1 页</p>
          <CodeBlock
            text={`curl -H "x-api-key: ${keyForDocs}" "${FUND_DATA_API_BASE}/company/fund/list?code=P1032021&fund_state=1&page=1&pagesize=20"

MCP
{ "name": "company_fund_list", "arguments": { "code": "P1032021", "fund_state": 1, "page": 1, "pagesize": 20 } }`}
          />
          <p className="text-xs text-zinc-400 mt-3 mb-1">data 示例</p>
          <CodeBlock
            text={`{
  "total": 12,
  "page": 1,
  "pagesize": 20,
  "list": [
    { "fund_name": "幻方中证500指数增强", "register_number": "SR6089", "price_reg_code": "SR6089", "parent_reg_code": "SR6089", "share_class": null, "inception_date": "2019-01-01", "price_nav": 1.84, "price_date": "2026-09-30", "fund_type": 2, "fund_state": 1 }
  ]
}`}
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
