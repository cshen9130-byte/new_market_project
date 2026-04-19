"use client"

import { useState, useEffect, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ReallocAccount = {
  account: string; sector: string; currentWan: number; optimalWan: number; delta: number; optimalWeight: number
}
type RCAccount = {
  account: string; sector: string; nominalWan: number; capitalSharePct: number; riskContribPct: number; overContrib: number
}

const WINDOW_OPTIONS = [
  { value: "20",  label: "近 20 日" },
  { value: "60",  label: "近 60 日" },
  { value: "120", label: "近 120 日" },
  { value: "",    label: "全部" },
]
const CAP_OPTIONS = [
  { value: "0.10", label: "10%" }, { value: "0.15", label: "15%" },
  { value: "0.20", label: "20%" }, { value: "0.30", label: "30%" }, { value: "1", label: "不限" },
]

function ReallocHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg shadow-xl p-5 max-w-xl w-full mx-4 text-sm max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-base">最优名义规模配置：计算方法</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="space-y-4 text-muted-foreground leading-relaxed">
          <p>本图将 <strong className="text-foreground">蒙特卡洛最优夏普组合权重</strong> 乘以当前总 AUM，直接换算为每个投顾账户的建议名义规模，告诉基金经理 "把多少钱从哪个账户调到哪个账户"。</p>
          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">第一步：蒙特卡洛寻找最优权重</p>
            <p>对 N 个投顾账户随机抽取 3000 组权重（Dirichlet 均匀分布 + 迭代裁剪上限 c），保留夏普比率最高的一组：</p>
            <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
              <div>μₚ = Σᵢ wᵢ · r̄ᵢ · 252　（组合年化收益率）</div>
              <div>σₚ = √(wᵀ Σ w · 252)　（组合年化波动率）</div>
              <div>Sharpeₚ = μₚ / σₚ</div>
              <div className="text-muted-foreground">w* = argmax Sharpeₚ，满足 Σwᵢ = 1，0 ≤ wᵢ ≤ c</div>
            </div>
            <p className="text-xs">权重上限 c（默认 15%）防止优化器将所有资金集中到单一账户（角点解）。</p>
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">第二步：权重转换为名义规模</p>
            <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
              <div>AUM<sub>total</sub> = Σᵢ equity_wanᵢ</div>
              <div>最优规模ᵢ = wᵢ* × AUM<sub>total</sub></div>
              <div>调整量ᵢ = 最优规模ᵢ − 当前规模ᵢ</div>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">读取建议</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted rounded px-3 py-2"><p className="font-semibold text-red-500 mb-1">红色（正值）= 增配</p><p>该账户在最优组合中权重更高，建议追加名义规模。</p></div>
              <div className="bg-muted rounded px-3 py-2"><p className="font-semibold text-green-500 mb-1">绿色（负值）= 减配</p><p>该账户在最优组合中权重更低，建议收回部分名义规模。</p></div>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">注意事项</p>
            <ul className="list-disc list-inside text-xs space-y-1">
              <li>优化基于历史收益率，不代表未来表现。</li>
              <li>建议结合左侧<strong className="text-foreground">资本效率气泡图</strong>交叉验证，避免将资金集中到高杠杆低效账户。</li>
              <li>更改「窗口」可观察不同周期下的配置稳健性；若短期与长期建议方向一致，则信号更可靠。</li>
              <li>更改「上限」可控制集中度：上限越低，分配越分散。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function RCHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg shadow-xl p-5 max-w-xl w-full mx-4 text-sm max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-base">风险贡献 vs 资本占比：计算方法</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="space-y-4 text-muted-foreground leading-relaxed">
          <p>每个投顾账户的 <strong className="text-foreground">风险贡献</strong> 衡量其在当前资本配置下对整体组合波动率的拉动程度，与 <strong className="text-foreground">资本占比</strong> 对比可识别"风险过载"或"风险闲置"账户。</p>
          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">第一步：确定当前资本权重</p>
            <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
              <div>wᵢ = equity_wanᵢ / Σⱼ equity_wanⱼ</div>
              <div className="text-muted-foreground">若某账户 equity_wan 缺失，则按等权处理</div>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">第二步：构建年化协方差矩阵</p>
            <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
              <div>Σᵢⱼ = Cov(rᵢ, rⱼ) × 252</div>
              <div>rᵢ = 当日盈亏 / 客户权益（日收益率）</div>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">第三步：计算风险贡献（Euler 分解）</p>
            <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
              <div>(Σw)ᵢ = Σⱼ Σᵢⱼ · wⱼ</div>
              <div>RCᵢ = wᵢ · (Σw)ᵢ / σₚ²　　满足 Σᵢ RCᵢ = 1</div>
              <div>差值ᵢ = RCᵢ (%) − wᵢ (%)</div>
            </div>
            <p className="text-xs mt-1">RCᵢ 即欧拉分解意义下的方差归因，对次加性风险度量严格成立。</p>
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">读取信号</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted rounded px-3 py-2"><p className="font-semibold text-red-500 mb-1">红色（差值 &gt; 0）= 风险过载</p><p>风险贡献超过资本份额 → 建议减配或降低波动。</p></div>
              <div className="bg-muted rounded px-3 py-2"><p className="font-semibold text-green-500 mb-1">绿色（差值 &lt; 0）= 风险偏低</p><p>风险贡献低于资本份额 → 可适当增配或提高杠杆。</p></div>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">注意事项</p>
            <ul className="list-disc list-inside text-xs space-y-1">
              <li>基于历史协方差，不代表未来风险结构。</li>
              <li>建议与"最优规模配置"视图交叉验证：两图方向一致时信号更强。</li>
              <li>协方差矩阵对窗口长度敏感，建议同时观察近 20 日和更长历史。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AdvisorReallocation({ height = 480 }: { height?: number }) {
  const [mode,     setMode]     = useState<"realloc" | "rc">("realloc")
  const [win,      setWin]      = useState("60")
  const [cap,      setCap]      = useState("0.15")
  const [showHelp, setShowHelp] = useState(false)

  const [reallocData, setReallocData] = useState<{ accounts: ReallocAccount[]; totalAUM: number } | null>(null)
  const [reallocLoad, setReallocLoad] = useState(false)
  const [reallocErr,  setReallocErr]  = useState<string | null>(null)

  const [rcData, setRcData] = useState<{ accounts: RCAccount[]; portVolPct: number } | null>(null)
  const [rcLoad, setRcLoad] = useState(false)
  const [rcErr,  setRcErr]  = useState<string | null>(null)

  useEffect(() => {
    setReallocLoad(true)
    setReallocErr(null)
    const params = new URLSearchParams({ cap })
    if (win) params.set("window", win)
    fetch(`/ma/api/mom-analysis/reallocation?${params}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) { setReallocErr(j.error ?? "加载失败"); return }
        setReallocData({ accounts: j.accounts ?? [], totalAUM: j.totalAUM ?? 0 })
      })
      .catch((e) => setReallocErr(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setReallocLoad(false))
  }, [win, cap])

  useEffect(() => {
    setRcLoad(true)
    setRcErr(null)
    const url = win
      ? `/ma/api/mom-analysis/risk-contribution?window=${win}`
      : "/ma/api/mom-analysis/risk-contribution"
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) { setRcErr(j.error ?? "加载失败"); return }
        setRcData({ accounts: j.accounts ?? [], portVolPct: j.portVolPct ?? 0 })
      })
      .catch((e) => setRcErr(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setRcLoad(false))
  }, [win])

  function switchToRC() { setMode("rc"); setWin("20") }

  const reallocOption = useMemo(() => {
    if (!reallocData?.accounts.length) return {}
    const sorted = [...reallocData.accounts].sort((a, b) => b.delta - a.delta)
    return {
      grid: { left: 100, right: 88, top: 36, bottom: 36 },
      legend: { top: 4, right: 10, data: ["当前规模", "最优规模"], textStyle: { fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
      xAxis: { type: "value", name: "名义规模 (万)", nameLocation: "middle", nameGap: 24, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: "dashed", opacity: 0.2 } } },
      yAxis: { type: "category", data: sorted.map((a) => a.account), axisLabel: { fontSize: 10, width: 88, overflow: "truncate" } },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (params: { dataIndex: number }[]) => {
          const a = sorted[params[0].dataIndex]
          const sign = a.delta >= 0 ? "+" : ""
          const color = a.delta >= 0 ? "#ef4444" : "#22c55e"
          return [`<b>${a.account}</b>  <span style="color:#94a3b8">${a.sector}</span>`, `当前规模：${a.currentWan.toFixed(0)} 万`, `最优规模：${a.optimalWan.toFixed(0)} 万  (${(a.optimalWeight * 100).toFixed(1)}%)`, `<span style="color:${color}">调整量：${sign}${a.delta.toFixed(0)} 万</span>`].join("<br/>")
        },
      },
      series: [
        { name: "当前规模", type: "bar", data: sorted.map((a) => a.currentWan), barMaxWidth: 14, itemStyle: { color: "#64748b", borderRadius: [0, 3, 3, 0] }, label: { show: false } },
        {
          name: "最优规模", type: "bar", data: sorted.map((a) => a.optimalWan), barMaxWidth: 14,
          itemStyle: { color: "#f59e0b", borderRadius: [0, 3, 3, 0] },
          label: {
            show: true, position: "right", fontSize: 9,
            formatter: (p: { dataIndex: number }) => { const a = sorted[p.dataIndex]; const sign = a.delta >= 0 ? "+" : ""; return `{${a.delta >= 0 ? "pos" : "neg"}|${sign}${a.delta.toFixed(0)}万}` },
            rich: { pos: { color: "#ef4444", fontSize: 9 }, neg: { color: "#22c55e", fontSize: 9 } },
          },
        },
      ],
    }
  }, [reallocData])

  const rcOption = useMemo(() => {
    if (!rcData?.accounts.length) return {}
    const sorted = [...rcData.accounts].sort((a, b) => b.overContrib - a.overContrib)
    return {
      grid: { left: 100, right: 90, top: 36, bottom: 36 },
      legend: { top: 4, right: 10, data: ["资本占比", "风险贡献"], textStyle: { fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
      xAxis: { type: "value", name: "%", nameLocation: "end", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10, formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { type: "dashed", opacity: 0.2 } } },
      yAxis: { type: "category", data: sorted.map((a) => a.account), axisLabel: { fontSize: 10, width: 88, overflow: "truncate" } },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (params: { dataIndex: number }[]) => {
          const a = sorted[params[0].dataIndex]
          const sign = a.overContrib >= 0 ? "+" : ""
          const color = a.overContrib >= 0 ? "#ef4444" : "#22c55e"
          const tag = a.overContrib >= 0 ? "风险过载 ↓ 建议减配" : "风险偏低 ↑ 建议增配"
          return [`<b>${a.account}</b>  <span style="color:#94a3b8">${a.sector}</span>`, `名义规模：${a.nominalWan.toFixed(0)} 万`, `资本占比：${a.capitalSharePct.toFixed(2)}%`, `风险贡献：${a.riskContribPct.toFixed(2)}%`, `<span style="color:${color}">差值：${sign}${a.overContrib.toFixed(2)} pp　${tag}</span>`].join("<br/>")
        },
      },
      series: [
        { name: "资本占比", type: "bar", barMaxWidth: 12, barGap: "30%", data: sorted.map((a) => ({ value: a.capitalSharePct, itemStyle: { color: "rgba(100,116,139,0.7)", borderRadius: [0, 3, 3, 0] } })) },
        {
          name: "风险贡献", type: "bar", barMaxWidth: 12,
          data: sorted.map((a) => ({ value: a.riskContribPct, itemStyle: { color: a.overContrib > 0 ? "rgba(239,68,68,0.85)" : "rgba(34,197,94,0.85)", borderRadius: [0, 3, 3, 0] } })),
          label: {
            show: true, position: "right", fontSize: 9,
            formatter: (p: { dataIndex: number }) => { const a = sorted[p.dataIndex]; const sign = a.overContrib >= 0 ? "+" : ""; return `{${a.overContrib >= 0 ? "pos" : "neg"}|${sign}${a.overContrib.toFixed(1)}pp}` },
            rich: { pos: { color: "#ef4444", fontSize: 9 }, neg: { color: "#22c55e", fontSize: 9 } },
          },
        },
      ],
    }
  }, [rcData])

  const isRealloc = mode === "realloc"
  const loading   = isRealloc ? reallocLoad : rcLoad
  const error     = isRealloc ? reallocErr  : rcErr
  const hasData   = isRealloc ? (reallocData?.accounts.length ?? 0) > 0 : (rcData?.accounts.length ?? 0) > 0
  const chartOpt  = isRealloc ? reallocOption : rcOption
  const chartKey  = isRealloc
    ? `realloc-${win}-${cap}-${reallocData?.accounts.length}`
    : `rc-${win}-${rcData?.accounts.length}`

  return (
    <Card className="h-full">
      {showHelp && isRealloc  && <ReallocHelp onClose={() => setShowHelp(false)} />}
      {showHelp && !isRealloc && <RCHelp      onClose={() => setShowHelp(false)} />}

      <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
        <div>
          {isRealloc ? (
            <>
              <CardTitle className="text-sm font-medium">最优名义规模配置建议</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                最大夏普比率权重 × 总AUM{reallocData ? ` · 总AUM ${reallocData.totalAUM.toFixed(0)} 万` : ""}{" · "}红=增配 绿=减配
              </p>
            </>
          ) : (
            <>
              <CardTitle className="text-sm font-medium">风险贡献 vs 资本占比</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                基于当前名义规模权重 · 红=风险过载（减配）绿=风险偏低（增配）{rcData ? ` · 组合年化波动率 ${rcData.portVolPct.toFixed(1)}%` : ""}
              </p>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center rounded border border-border overflow-hidden text-xs">
            <button onClick={() => setMode("realloc")} className={`px-2 py-0.5 transition-colors ${isRealloc ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              最优规模
            </button>
            <button onClick={switchToRC} className={`px-2 py-0.5 transition-colors border-l border-border ${!isRealloc ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              风险贡献
            </button>
          </div>

          <div className="flex items-center gap-1">
            {WINDOW_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => setWin(o.value)} className={`px-2 py-0.5 text-xs rounded border transition-colors ${win === o.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {o.label}
              </button>
            ))}
          </div>

          {isRealloc && (
            <select value={cap} onChange={(e) => setCap(e.target.value)} className="text-xs border border-border rounded px-1 py-0.5 bg-background">
              {CAP_OPTIONS.map((o) => (<option key={o.value} value={o.value}>上限 {o.label}</option>))}
            </select>
          )}

          <button onClick={() => setShowHelp(true)} className="flex-shrink-0 w-5 h-5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground text-xs flex items-center justify-center transition-colors" title="计算说明">
            ?
          </button>
        </div>
      </CardHeader>

      <CardContent className="pt-1">
        {loading ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>加载中…</div>
        ) : error ? (
          <div className="flex items-center justify-center text-sm text-destructive" style={{ height }}>{error}</div>
        ) : !hasData ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>暂无数据</div>
        ) : (
          <ReactECharts key={chartKey} option={chartOpt} style={{ height, width: "100%" }} notMerge />
        )}
      </CardContent>
    </Card>
  )
}
