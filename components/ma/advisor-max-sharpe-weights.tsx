"use client"

import { useState, useEffect, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type AccountPoint = {
  account: string
  optimalWeight: number
  equalWeight: number
  sharpe: number
  annualReturn: number
  vol: number
  sector: string
}

const WINDOW_OPTIONS = [
  { value: "20",  label: "近 20 日" },
  { value: "60",  label: "近 60 日" },
  { value: "120", label: "近 120 日" },
  { value: "",    label: "全部" },
]

const CAP_OPTIONS = [
  { value: "0.05",  label: "5%" },
  { value: "0.10",  label: "10%" },
  { value: "0.15",  label: "15%" },
  { value: "0.20",  label: "20%" },
  { value: "0.30",  label: "30%" },
  { value: "1",     label: "不限" },
]

export default function AdvisorMaxSharpeWeights({ height = 400 }: { height?: number }) {
  const [win,      setWin]      = useState("60")
  const [cap,      setCap]      = useState("0.15")
  const [accounts, setAccounts] = useState<AccountPoint[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (win) params.set("window", win)
    params.set("cap", cap)
    const url = `/ma/api/mom-analysis/risk-return?${params.toString()}`
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) { setError(j.error ?? "加载失败"); return }
        setAccounts(j.accounts ?? [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setLoading(false))
  }, [win, cap])

  const option = useMemo(() => {
    // Sort by optimal weight descending, filter to top 30 for readability
    const sorted = [...accounts]
      .sort((a, b) => b.optimalWeight - a.optimalWeight)
      .slice(0, 30)

    const names = sorted.map((d) => d.account)
    const equalW = sorted[0]?.equalWeight ?? 0
    const equalPct = Math.round(equalW * 10000) / 100

    return {
      grid: { left: 52, right: 24, top: 36, bottom: 64 },
      legend: {
        top: 4,
        left: "center",
        textStyle: { fontSize: 11 },
        itemWidth: 14,
        itemHeight: 8,
        data: ["最优权重", "等权基准"],
      },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { fontSize: 10, rotate: 45, interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "权重 (%)",
        nameLocation: "end",
        nameTextStyle: { fontSize: 11 },
        axisLabel: {
          fontSize: 10,
          formatter: (v: number) => `${(v * 100).toFixed(1)}%`,
        },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { seriesName: string; name: string; value: number; dataIndex: number }[]) => {
          const idx = params[0]?.dataIndex
          const acc = idx !== undefined ? sorted[idx] : undefined
          if (!acc) return ""
          const optPct = (acc.optimalWeight * 100).toFixed(2)
          const eqPct = (acc.equalWeight * 100).toFixed(2)
          const diff = ((acc.optimalWeight - acc.equalWeight) * 100).toFixed(2)
          const sign = acc.optimalWeight >= acc.equalWeight ? "+" : ""
          return [
            `<b>${acc.account}</b>`,
            `最优权重：${optPct}%`,
            `等权基准：${eqPct}%`,
            `差值：${sign}${diff}%`,
            `夏普比率：${(acc.sharpe ?? 0).toFixed(3)}`,
            `年化收益：${(acc.annualReturn ?? 0).toFixed(1)}%`,
            `年化波动：${(acc.vol ?? 0).toFixed(1)}%`,
          ].join("<br/>")
        },
      },
      series: [
        {
          name: "最优权重",
          type: "bar",
          data: sorted.map((d) => d.optimalWeight),
          barMaxWidth: 24,
          itemStyle: {
            color: (params: { dataIndex: number }) => {
              const d = sorted[params.dataIndex]
              // Green if overweight vs equal, red if underweight
              return d.optimalWeight >= d.equalWeight ? "#ef4444" : "#22c55e"
            },
          },
          label: {
            show: sorted.length <= 20,
            position: "top",
            fontSize: 9,
            formatter: (params: { value: number }) =>
              `${(params.value * 100).toFixed(1)}%`,
          },
        },
        {
          name: "等权基准",
          type: "line",
          data: sorted.map(() => equalW),
          showSymbol: false,
          lineStyle: { width: 1.5, type: "dashed", color: "#94a3b8" },
          itemStyle: { color: "#94a3b8" },
          tooltip: { show: false },
        },
      ],
      graphic: [
        {
          type: "text",
          right: 28,
          top: 36,
          style: {
            text: `等权 ${equalPct}%`,
            fontSize: 10,
            fill: "#94a3b8",
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
              <h3 className="font-semibold text-base">最优权重计算方法</h3>
              <button onClick={() => setShowHelp(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="space-y-4 text-muted-foreground leading-relaxed">
              <p>
                本图通过 <strong className="text-foreground">蒙特卡洛模拟</strong>（默认 3000 次随机抽组）在给定权重上限约束下，寻找夏普比率最高的投顾分配权重。
              </p>

              {/* Step 1 */}
              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第一步：随机抽取权重（Dirichlet 分布）</p>
                <p>对每次模拟，先独立抽取 N 个均匀随机数 uᵢ ~ Uniform(0,1)，通过指数变换生成满足 Σwᵢ = 1 的非负权重向量：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                  <div>wᵢ<sup>raw</sup> = −ln(uᵢ) / Σⱼ [−ln(uⱼ)]</div>
                  <div className="text-muted-foreground">其中 uᵢ ~ Uniform(0, 1)，i = 1, 2, …, N</div>
                </div>
                <p className="text-xs">此方法等价于 Dirichlet(1,1,…,1) 采样，确保权重在单纯形上全局均匀分布。</p>
              </div>

              {/* Step 2 */}
              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第二步：施加权重上限（迭代裁剪）</p>
                <p>将超过上限 c（默认 15%）的权重固定在 c，将超出部分按比例补充给未被裁剪的账户，反复迭代直至所有权重均满足约束：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                  <div>若 wᵢ &gt; c，则令 wᵢ ← c</div>
                  <div>其余账户：wᵢ ← wᵢ × (1 − Σ<sub>j:wⱼ&gt;c</sub> c) / Σ<sub>j:wⱼ≤c</sub> wⱼ</div>
                  <div className="text-muted-foreground">重复以上步骤，直到所有 wᵢ ≤ c</div>
                </div>
                <p className="text-xs">当账户数 N 较少时，上限自动放宽至 1/N 以保证权重可行。</p>
              </div>

              {/* Step 3 */}
              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第三步：计算每个组合的夏普比率</p>
                <p>组合年化收益率（算术平均日收益 × 252 个交易日）：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs">
                  μₚ = Σᵢ wᵢ × r̄ᵢ × 252
                </div>
                <p className="mt-1">组合年化波动率（通过协方差矩阵 Σ 计算）：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
                  <div>σₚ² = wᵀ Σ w = Σᵢ Σⱼ wᵢ wⱼ Σᵢⱼ × 252</div>
                  <div>σₚ = √(σₚ²)</div>
                </div>
                <p className="mt-1">夏普比率（以无风险利率 = 0 简化）：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs">
                  Sharpeₚ = μₚ / σₚ
                </div>
              </div>

              {/* Step 4 */}
              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">第四步：取最优解</p>
                <p>在 3000 次模拟中选取夏普比率最高的组合，其权重向量即为最优分配：</p>
                <div className="bg-muted rounded px-3 py-2 font-mono text-xs">
                  w* = argmax Sharpeₚ，p ∈ {"{"}1, 2, …, 3000{"}"}
                </div>
                <p className="text-xs mt-1">柱状图展示的 <strong className="text-foreground">最优权重 wᵢ*</strong> 即为账户 i 在该最优组合中的配置比例。红柱（wᵢ* &gt; 等权）表示应增配，绿柱表示应减配。</p>
              </div>

              <p className="text-xs border-t border-border pt-3">
                ⚠️ <strong className="text-foreground">注意</strong>：这是蒙特卡洛<strong className="text-foreground">近似最优</strong>，并非解析精确解。精确求解需使用二次规划（如 SLSQP）。在约 54 个账户、3000 次模拟的规模下，近似效果合理，但不同次运行结果会有微小差异。模拟次数越多，结果越稳定。
              </p>
            </div>
          </div>
        </div>
      )}
      <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm font-medium">最优夏普组合权重 vs 等权基准</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            红柱 = 应增配（最优 &gt; 等权）· 绿柱 = 应减配 · 按最优权重降序排列（前 30）
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowHelp(true)}
            className="w-5 h-5 rounded-full border border-border text-muted-foreground hover:text-foreground text-xs leading-none flex items-center justify-center flex-shrink-0"
            title="计算方法说明"
          >?</button>
          <select
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className="text-xs border border-border rounded px-1.5 py-0.5 bg-background text-foreground"
          >
            {CAP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>上限 {o.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
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
          </div>
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
        ) : accounts.length === 0 ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            暂无数据
          </div>
        ) : (
          <ReactECharts
            key={`max-sharpe-${win}-${accounts.length}`}
            option={option}
            style={{ height, width: "100%" }}
            notMerge
          />
        )}
      </CardContent>
    </Card>
  )
}
