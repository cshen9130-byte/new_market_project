"use client"

import { useState, useEffect, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type AccountData = {
  account: string
  sector: string
  nominalWan: number
  capitalSharePct: number
  riskContribPct: number
  overContrib: number  // riskContribPct - capitalSharePct (pp)
}

const WINDOW_OPTIONS = [
  { value: "20",  label: "近 20 日" },
  { value: "60",  label: "近 60 日" },
  { value: "120", label: "近 120 日" },
  { value: "",    label: "全部" },
]

export default function AdvisorRiskContribution({ height = 480 }: { height?: number }) {
  const [win,      setWin]      = useState("60")
  const [meta,     setMeta]     = useState<{ totalAUM: number; portVolPct: number } | null>(null)
  const [accounts, setAccounts] = useState<AccountData[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const url = win
      ? `/ma/api/mom-analysis/risk-contribution?window=${win}`
      : "/ma/api/mom-analysis/risk-contribution"
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) { setError(j.error ?? "加载失败"); return }
        setAccounts(j.accounts ?? [])
        setMeta({ totalAUM: j.totalAUM ?? 0, portVolPct: j.portVolPct ?? 0 })
      })
      .catch((e) => setError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setLoading(false))
  }, [win])

  const option = useMemo(() => {
    if (!accounts.length) return {}

    // Sort by overContrib descending: risk hogs at top, under-contributors at bottom
    const sorted = [...accounts].sort((a, b) => b.overContrib - a.overContrib)
    const names = sorted.map((a) => a.account)

    // Risk bar colour: red if risk > capital (hog), green if risk < capital (under)
    const riskBarData = sorted.map((a) => ({
      value: a.riskContribPct,
      itemStyle: {
        color: a.overContrib > 0 ? "rgba(239,68,68,0.85)" : "rgba(34,197,94,0.85)",
        borderRadius: [0, 3, 3, 0],
      },
    }))

    return {
      grid: { left: 100, right: 90, top: 36, bottom: 36 },
      legend: {
        top: 4,
        right: 10,
        data: ["资本占比", "风险贡献"],
        textStyle: { fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8,
      },
      xAxis: {
        type: "value",
        name: "%",
        nameLocation: "end",
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.2 } },
      },
      yAxis: {
        type: "category",
        data: names,
        inverse: false,
        axisLabel: { fontSize: 10, width: 88, overflow: "truncate" },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { dataIndex: number }[]) => {
          const i = params[0].dataIndex
          const a = sorted[i]
          const sign  = a.overContrib >= 0 ? "+" : ""
          const color = a.overContrib >= 0 ? "#ef4444" : "#22c55e"
          const tag   = a.overContrib >= 0 ? "风险过载 ↓ 建议减配" : "风险偏低 ↑ 建议增配"
          return [
            `<b>${a.account}</b>  <span style="color:#94a3b8">${a.sector}</span>`,
            `名义规模：${a.nominalWan.toFixed(0)} 万`,
            `资本占比：${a.capitalSharePct.toFixed(2)}%`,
            `风险贡献：${a.riskContribPct.toFixed(2)}%`,
            `<span style="color:${color}">差值：${sign}${a.overContrib.toFixed(2)} pp　${tag}</span>`,
          ].join("<br/>")
        },
      },
      series: [
        {
          name: "资本占比",
          type: "bar",
          data: sorted.map((a) => ({
            value: a.capitalSharePct,
            itemStyle: { color: "rgba(100,116,139,0.7)", borderRadius: [0, 3, 3, 0] },
          })),
          barMaxWidth: 12,
          barGap: "30%",
        },
        {
          name: "风险贡献",
          type: "bar",
          data: riskBarData,
          barMaxWidth: 12,
          label: {
            show: true,
            position: "right",
            fontSize: 9,
            formatter: (p: { dataIndex: number }) => {
              const a = sorted[p.dataIndex]
              const sign = a.overContrib >= 0 ? "+" : ""
              return `{${a.overContrib >= 0 ? "pos" : "neg"}|${sign}${a.overContrib.toFixed(1)}pp}`
            },
            rich: {
              pos: { color: "#ef4444", fontSize: 9 },
              neg: { color: "#22c55e", fontSize: 9 },
            },
          },
        },
      ],
    }
  }, [accounts])

  return (
    <Card className="h-full">
      {/* Help modal */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-background border border-border rounded-lg shadow-xl p-5 max-w-xl w-full mx-4 text-sm max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-base">风险贡献 vs 资本占比：计算方法</h3>
              <button onClick={() => setShowHelp(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="space-y-4 text-muted-foreground leading-relaxed">
              <p>
                每个投顾账户的 <strong className="text-foreground">风险贡献</strong> 衡量其在当前资本配置下对整体组合波动率的拉动程度，与 <strong className="text-foreground">资本占比</strong> 对比可识别"风险过载"或"风险闲置"账户。
              </p>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第一步：确定当前资本权重</p>
                <p>以名义规模（equity_wan，万元）占总 AUM 的比例作为当前资本权重 w：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                  <div>wᵢ = equity_wanᵢ / Σⱼ equity_wanⱼ</div>
                  <div className="text-muted-foreground">若某账户 equity_wan 缺失，则按等权处理</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第二步：构建协方差矩阵</p>
                <p>基于选定时间窗口内的日收益率序列，计算 N×N 年化协方差矩阵 Σ：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                  <div>Σᵢⱼ = Cov(rᵢ, rⱼ) × 252</div>
                  <div>其中 rᵢ = 当日盈亏 / 客户权益（日收益率）</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第三步：计算风险贡献（Component Variance）</p>
                <p>组合方差为 σₚ² = wᵀ Σ w；账户 i 对组合方差的贡献定义为：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                  <div>(Σw)ᵢ = Σⱼ Σᵢⱼ · wⱼ　　（协方差加权求和）</div>
                  <div>RCᵢ = wᵢ · (Σw)ᵢ / σₚ²　　（风险贡献比例）</div>
                  <div className="text-muted-foreground">满足：Σᵢ RCᵢ = 1（所有账户风险贡献之和 = 100%）</div>
                </div>
                <p className="text-xs">RCᵢ 即欧拉分解（Euler decomposition）意义下的方差归因，对次加性风险度量严格成立。</p>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第四步：读取差值信号</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                  <div>差值ᵢ = RCᵢ (%) − wᵢ (%)</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mt-1">
                  <div className="bg-muted rounded px-3 py-2">
                    <p className="font-semibold text-red-500 mb-1">红色（差值 &gt; 0）= 风险过载</p>
                    <p>该账户的风险贡献超过其资本份额 → 建议减配或要求降低波动。</p>
                  </div>
                  <div className="bg-muted rounded px-3 py-2">
                    <p className="font-semibold text-green-500 mb-1">绿色（差值 &lt; 0）= 风险偏低</p>
                    <p>该账户的风险贡献低于其资本份额 → 可适当增配或允许提高杠杆。</p>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">注意事项</p>
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>基于历史协方差，不代表未来风险结构。</li>
                  <li>建议结合右侧<strong className="text-foreground">最优规模配置图</strong>使用：两图方向一致时信号更强。</li>
                  <li>协方差矩阵对窗口长度敏感，建议同时观察近 60 日和全部历史。</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm font-medium">风险贡献 vs 资本占比</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            基于当前名义规模权重 · 红=风险过载（减配）绿=风险偏低（增配）
            {meta ? ` · 组合年化波动率 ${meta.portVolPct.toFixed(1)}%` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {WINDOW_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setWin(o.value)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                win === o.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
          <button
            onClick={() => setShowHelp(true)}
            className="flex-shrink-0 w-5 h-5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground text-xs flex items-center justify-center transition-colors"
            title="计算说明"
          >
            ?
          </button>
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        {loading ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            加载中…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center text-sm text-destructive" style={{ height }}>
            {error}
          </div>
        ) : !accounts.length ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            暂无数据
          </div>
        ) : (
          <ReactECharts
            key={`risk-contrib-${win}-${accounts.length}`}
            option={option}
            style={{ height, width: "100%" }}
            notMerge
          />
        )}
      </CardContent>
    </Card>
  )
}
