"use client"

import ReactECharts from "echarts-for-react"
import { QuantChartHelp, type ChartHelpSpec } from "@/components/ma/quant-strategy-help"
import type { DosePoint, DoseShape, FactorDmlReport, FactorDmlRow, FactorVerdict } from "@/lib/ma/quant-factor-dml"
import type { CausalEdge, CausalGraph } from "@/lib/ma/quant-factor-divot"
import type { IrlFactor, IrlReport, IrlShape } from "@/lib/ma/quant-factor-irl"
import type { AuditFactor, AuditVerdict, FactorAudit } from "@/lib/ma/quant-factor-screen"

const SHAPE_LABEL: Record<DoseShape, string> = {
  linear: "直线",
  threshold_high: "只在最高档跳变",
  threshold_low: "离开最低档就变",
  u: "两头才动",
  inv_u: "中间才动",
  steep_high: "高位变陡",
  steep_low: "低位变陡",
  uneven_up: "单调但不均匀",
  uneven_down: "单调向下但不均匀",
  nonmonotone: "非单调",
}

const UP = "#ef4444"
const DOWN = "#10b981"
const MUTED = "#94a3b8"

export const FACTOR_DML_HELP: ChartHelpSpec = {
  heading: "因子推断 · DML",
  blocks: [
    {
      title: "在做什么",
      paragraphs: [
        "把几百个常见量化因子逐个当成处理变量 F，看它会不会改变这个盘手下一交易日的开仓。网格盖住动量、反转、均线、通道、波动、成交量、持仓和期限结构的多个窗口。方向类因子看净开仓（买开−卖开），波动和成交量看开仓手数。因子用前一交易日收盘就能算出来的值，避免用到当天收盘。",
      ],
    },
    {
      title: "混淆怎么处理",
      paragraphs: [
        "账户风险度、星期、波动、成交量、量能、非流动性、偏度、南华动量、板块动量、升贴水、持仓量变化和持仓拥挤会同时影响因子和开仓。这些进干扰函数 g(X)、m(X)，用随机傅里叶特征近似 RBF 核的岭回归（训练折上用 GCV 选惩罚），再加几棵深度为 2 的残差树。昨日持仓不放进混淆：它是策略自己留下的状态，扣掉之后会把已经按这个因子持有的仓一并抹掉。",
      ],
      formula: "直线：Y = θF + g(X) + ε\n剂量：Y = ψ(F) + g(X) + ε\nψ = 五个分位档，不是一条直线",
    },
    {
      title: "交叉拟合和 Neyman 正交",
      paragraphs: [
        "交易日分成两折。g 和每一档虚拟变量只在另一折上训练，再拿到这一折上算残差。直线斜率 θ，以及五档相对最低档的效应，都由 Neyman 正交得分估计，标准误按交易日聚类。",
        "线性检验：五个档的效应是否落在一条直线上，Wald 检验，再做 BH 校正。没拒绝直线，才写成「越高越偏多」。拒绝了，就按弯的形状写：只在最高档跳、离开最低档就变、两头才动、中间才动、高位变陡。",
      ],
      formula: "θ̂ = (Ṽ'Ṽ)⁻¹ Ṽ'Ỹ\nψᵢ = Ṽᵢ (Ỹᵢ − Ṽᵢ'θ)",
    },
    {
      title: "怎么读",
      bullets: [
        "θ 仍是平均斜率，单位是标准差。它概括不了阈值和 U 型。",
        "剂量图的纵轴是相对最低档的效应。一条斜线 = 线性；最后一档才翘起来 = 阈值。",
        "非线性要 p≤0.05 且校正后 q≤0.10，并且五档高低差至少 0.04 个标准差。",
        "几个趋势因子一起呈直线，通常说明在跟趋势，不代表阈值就是 20 日。",
      ],
    },
    {
      title: "因果图用的是 DIVOT",
      paragraphs: [
        "哪些因子直接连到开仓，不靠 PC 或加性噪声检验来判定。方向用最优传输：在假定原因的切片里，结果排序后和噪声排序的差越接近一个常数，这条方向越像因果方向。损失更小的一侧当作原因。",
        "金融序列会换机制。同一条边要在三个时间段里至少两段都比打乱之后更像「因子导致交易」，才保留。两个变量各自的分布会把原始损失往一边拉，所以方向是相对打乱结果之后的基准来判的，不是看原始损失哪边更小。更强的因子先入选；后面的因子要在扣掉这些更强因子之后仍然超过打乱基准，才算直接边，否则记成间接。因子用的是前收，时间顺序不允许把「今天的开仓导致昨天的因子」画成原因。",
      ],
    },
    {
      title: "奖励函数用的是最大熵 IRL",
      paragraphs: [
        "把每一笔开仓看成一次决策。状态是前收就能算出的因子，再加上昨日净持仓和账户风险度。动作是下一交易日的净开仓或开仓手数。奖励是偏离「最想要的开仓」的二次损失，最大熵策略就是围绕这个最想要的开仓的正态分布。最想要的开仓是状态的非线性函数（随机傅里叶特征），所以不要求因子和开仓先画成一条直线。",
        "因子算不算进了奖励，看打乱它之后，留出交易日上真实开仓的对数概率掉了多少。五档曲线是奖励最高的那档开仓随因子分位的变化。局部斜率是这个最想要的开仓对因子的导数。奖励函数只解释已经通过前面几层的因子，不单独把因子判成使用。",
      ],
    },
    {
      title: "四层合在一起才下结论",
      paragraphs: [
        "先用距离相关看因子和开仓有没有非线性依赖，门槛要高于一个随机因子，也要高于打乱配对。然后在这个账户没开仓的日子里，用因子五档估计当天收益，这是市场自己的规律；开仓里能被这条规律解释掉的部分扣掉，剩下的才算打破。还要高于把因子在品种内后移大约两周。DML 再在扣掉其他状态之后估计效应。用法看五档剂量，奖励函数只在前面都通过时帮忙看形状。",
        "随机因子走同一条距离相关。它过不了，结论才算数。只过一层，尤其是一条直线，不定论。",
      ],
    },
  ],
}

const AUDIT_LABEL: Record<AuditVerdict, string> = {
  used: "一致使用",
  dependent: "仅有依赖",
  confounded: "市场规律",
  timing: "只择时",
  absent: "未使用",
}

function AuditBlock({ audit }: { audit: FactorAudit }) {
  const shown = audit.factors.filter((f) => f.verdict !== "absent")
  return (
    <div className="space-y-2">
      {shown.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium">分层结果</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {shown.map((f: AuditFactor) => (
            <div
              key={`${f.outcome}-${f.id}`}
              className={`rounded-md border px-3 py-2.5 ${f.verdict === "used" ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-border"}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-xs font-medium">{f.name}</div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {AUDIT_LABEL[f.verdict]} · {f.outcome === "direction" ? "净开仓" : "开仓手数"} · {f.how}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{f.detail}</p>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}

const IRL_SHAPE: Record<IrlShape, string> = {
  linear: "接近线性",
  threshold_high: "只在最高档才奖",
  threshold_low: "离开最低档就奖",
  u: "两头才奖",
  inv_u: "中间才奖",
  uneven_up: "单调但不均匀",
  uneven_down: "单调向下但不均匀",
  nonmonotone: "非单调",
}

function IrlBlock({ report }: { report: IrlReport }) {
  const groups = (["direction", "intensity"] as const)
    .map((outcome) => ({
      outcome,
      label: outcome === "direction" ? "净开仓" : "开仓手数",
      factors: report.factors.filter((f) => f.outcome === outcome),
    }))
    .filter((g) => g.factors.length > 0)

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">奖励函数</div>
      <p className="text-sm leading-relaxed">{report.headline}</p>
      {groups.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {groups.flatMap((g) => g.factors.map((f: IrlFactor) => (
            <div key={`${f.outcome}-${f.id}`} className="rounded-md border border-violet-300 bg-violet-50/50 dark:border-violet-900 dark:bg-violet-950/20 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-xs font-medium">{f.name}</div>
                <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                  {IRL_SHAPE[f.shape]} · {g.label} · 斜率 {f.coef > 0 ? "+" : ""}{f.coef.toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{f.detail}</p>
              <DoseSpark curve={f.curve.map((effect, i) => ({ label: String(i), x: i, effect, lo: effect, hi: effect }))} />
            </div>
          )))}
        </div>
      )}
    </div>
  )
}

const KIND_LABEL = { direct: "直接", indirect: "间接", reverse: "反向" } as const

function CausalBlock({ graph }: { graph: CausalGraph }) {
  const direct = graph.edges.filter((e) => e.kind === "direct")
  const other = graph.edges.filter((e) => e.kind !== "direct")
  const groups = (["direction", "intensity"] as const)
    .map((outcome) => ({
      outcome,
      label: outcome === "direction" ? "净开仓" : "开仓手数",
      edges: direct.filter((e) => e.outcome === outcome),
    }))
    .filter((g) => g.edges.length > 0)

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">因果图</div>
      <p className="text-sm leading-relaxed">{graph.headline}</p>
      {groups.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {groups.map((g) => (
            <div key={g.outcome} className="rounded-md border border-sky-300 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/20 px-3 py-2.5">
              <div className="text-[11px] text-muted-foreground">{g.label}</div>
              <ul className="mt-1 space-y-1">
                {g.edges.map((e) => (
                  <li key={e.id} className="text-xs leading-relaxed">
                    <span className="font-medium">{e.name}</span>
                    <span className="text-muted-foreground"> → {g.label}</span>
                    <span className="text-muted-foreground tabular-nums"> · 相对打乱 {e.gap.toFixed(2)} · {e.blocksFor}/{e.blocks || "—"} 段</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {other.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">因子</th>
                <th className="py-1 pr-3 font-medium">结果</th>
                <th className="py-1 pr-3 font-medium">边</th>
                <th className="py-1 font-medium">相对打乱</th>
              </tr>
            </thead>
            <tbody>
              {other.map((e: CausalEdge) => (
                <tr key={`${e.outcome}-${e.id}`} className="border-t border-border">
                  <td className="py-1 pr-3">{e.name}</td>
                  <td className="py-1 pr-3">{e.outcome === "direction" ? "净开仓" : "开仓手数"}</td>
                  <td className="py-1 pr-3">{KIND_LABEL[e.kind]}</td>
                  <td className="py-1 tabular-nums">{e.gap.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const VERDICT_LABEL: Record<FactorVerdict, string> = {
  pos: "显著为正",
  neg: "显著为负",
  ns: "不显著",
  small: "效应偏小",
  weak: "识别不足",
  skip: "样本不足",
}

function fmtP(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "—"
  if (p < 0.001) return "<0.001"
  return p.toFixed(3)
}

function fmtTheta(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}`
}

function verdictColor(v: FactorVerdict): string {
  if (v === "pos") return UP
  if (v === "neg") return DOWN
  return MUTED
}

function outcomeLabel(row: FactorDmlRow): string {
  return row.outcome === "direction" ? "净开仓" : "开仓手数"
}

function isBent(row: FactorDmlRow): boolean {
  return row.shape != null && row.shape !== "linear"
}

function DoseSpark({ curve }: { curve: DosePoint[] }) {
  const max = Math.max(0.02, ...curve.map((c) => Math.abs(c.effect)))
  return (
    <div className="mt-1.5 flex items-stretch gap-1 h-8" aria-hidden>
      {curve.map((c) => {
        const h = Math.round((Math.abs(c.effect) / max) * 14)
        return (
          <div key={c.label} className="flex-1 flex flex-col justify-center min-w-0">
            <div className="flex items-end h-3.5">
              {c.effect > 0 && <div className="w-full rounded-sm bg-red-500/80" style={{ height: h }} />}
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-start h-3.5">
              {c.effect < 0 && <div className="w-full rounded-sm bg-emerald-500/80" style={{ height: h }} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function shapeColor(shape: DoseShape | null): string {
  if (shape === "u" || shape === "inv_u" || shape === "nonmonotone") return "#8b5cf6"
  if (shape === "threshold_high" || shape === "threshold_low" || shape === "steep_high" || shape === "steep_low" || shape === "uneven_up" || shape === "uneven_down") return "#d97706"
  return MUTED
}

export function FactorDmlPanel({
  report,
  period,
}: {
  report: FactorDmlReport
  period?: string
}) {
  const rows = report.rows
  const shown = rows
    .filter((r) => r.verdict === "pos" || r.verdict === "neg" || isBent(r))
    .sort((a, b) => Math.abs(b.theta ?? 0) - Math.abs(a.theta ?? 0))
    .slice(0, 24)
  const tableRows = [...rows].sort((a, b) => Math.abs(b.t ?? 0) - Math.abs(a.t ?? 0))
  const option = shown.length
    ? {
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          formatter: (params: Array<{ dataIndex: number }>) => {
            const row = shown[params[0]?.dataIndex ?? 0]
            if (!row) return ""
            return [
              `${row.name} · ${row.family}`,
              `θ ${fmtTheta(row.theta)}（${fmtTheta(row.ciLow)} ~ ${fmtTheta(row.ciHigh)}）`,
              `t=${row.t ?? "—"} · q=${fmtP(row.q)} · 识别 ${row.strength ?? "—"}`,
              VERDICT_LABEL[row.verdict],
            ].join("<br/>")
          },
        },
        grid: { left: 108, right: 16, top: 8, bottom: 28 },
        xAxis: {
          type: "value",
          name: "θ",
          nameTextStyle: { fontSize: 10 },
          axisLabel: { fontSize: 10 },
          splitLine: { lineStyle: { type: "dashed", opacity: 0.35 } },
        },
        yAxis: {
          type: "category",
          data: shown.map((r) => r.name),
          inverse: true,
          axisLabel: { fontSize: 11 },
        },
        series: [
          {
            type: "bar",
            barMaxWidth: 10,
            data: shown.map((r) => ({
              value: r.theta,
              itemStyle: { color: verdictColor(r.verdict), borderRadius: 2 },
            })),
          },
        ],
      }
    : null

  const bent = rows.filter(isBent)
  const linearSig = rows.filter((r) => (r.verdict === "pos" || r.verdict === "neg") && !isBent(r))
  const doseOption = bent.length
    ? {
        tooltip: { trigger: "axis" },
        legend: { top: 0, type: "scroll", textStyle: { fontSize: 11 } },
        grid: { left: 48, right: 16, top: 32, bottom: 28 },
        xAxis: {
          type: "category",
          data: ["最低", "偏低", "中等", "偏高", "最高"],
          axisLabel: { fontSize: 11 },
        },
        yAxis: {
          type: "value",
          name: "相对最低档",
          nameTextStyle: { fontSize: 10 },
          axisLabel: { fontSize: 10 },
          splitLine: { lineStyle: { type: "dashed", opacity: 0.35 } },
        },
        series: bent.map((r) => ({
          name: r.name,
          type: "line",
          symbol: "circle",
          symbolSize: 6,
          data: (r.curve ?? []).map((c) => c.effect),
          lineStyle: { width: 2, color: shapeColor(r.shape) },
          itemStyle: { color: shapeColor(r.shape) },
        })),
      }
    : null

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-medium">因子推断</h2>
          <QuantChartHelp spec={FACTOR_DML_HELP} />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {report.products} 个品种 · {report.dates} 个交易日 · 检验 {report.tested} 个 · 非线性 {report.nonlinear ?? 0} 个 · 直线 {Math.max(0, (report.significant ?? 0) - (report.nonlinear ?? 0))} 个
          </span>
          {period && (
            <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-medium tabular-nums">{period}</span>
          )}
        </div>
      </div>

      {report.audit && <AuditBlock audit={report.audit} />}

      {report.causal && <CausalBlock graph={report.causal} />}

      {report.irl && <IrlBlock report={report.irl} />}

      {bent.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium">非线性剂量反应</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {bent.map((r) => (
              <div key={r.id} className="rounded-md border border-amber-300 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-xs font-medium">{r.name}</div>
                  <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                    {SHAPE_LABEL[r.shape!]} · {outcomeLabel(r)} · 非线性 q={fmtP(r.nonlinearQ)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{r.detail}</p>
                {r.curve && <DoseSpark curve={r.curve} />}
              </div>
            ))}
          </div>
          {doseOption && (
            <ReactECharts option={doseOption} style={{ height: 280, width: "100%" }} notMerge />
          )}
        </div>
      )}

      {linearSig.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium">线性斜率</div>
          <p className="text-[11px] text-muted-foreground">
            这些因子的五档剂量反应没有拒绝直线，所以结论才是「越高越偏多 / 越偏空」。
            {linearSig.length > 8 ? "这里只放斜率最大的 8 个，其余在下面的表里。" : ""}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {linearSig.slice(0, 8).map((r) => (
              <div
                key={r.id}
                className={`rounded-md border px-3 py-2.5 ${
                  r.verdict === "pos"
                    ? "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20"
                    : "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-xs font-medium">{r.name}</div>
                  <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                    直线 · {outcomeLabel(r)} · θ={fmtTheta(r.theta)} · q={fmtP(r.q)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{r.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {option && (
        <div className="space-y-1">
          <div className="text-xs font-medium">平均斜率</div>
          <p className="text-[11px] text-muted-foreground">每根柱子是把因子当成一条直线时的 θ。弯的因子以上面的五档曲线为准。</p>
          <ReactECharts option={option} style={{ height: Math.max(280, shown.length * 22 + 36), width: "100%" }} notMerge />
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left font-medium py-1.5 pr-2">因子</th>
                <th className="text-left font-medium py-1.5 pr-2">形状</th>
                <th className="text-left font-medium py-1.5 pr-2">作用在</th>
                <th className="text-right font-medium py-1.5 px-2">θ</th>
                <th className="text-right font-medium py-1.5 px-2">95% 区间</th>
                <th className="text-right font-medium py-1.5 px-2">t</th>
                <th className="text-right font-medium py-1.5 px-2">q</th>
                <th className="text-right font-medium py-1.5 px-2">识别</th>
                <th className="text-right font-medium py-1.5 pl-2">判定</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 align-top">
                  <td className="py-1.5 pr-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground">{r.family} · {r.blurb}</div>
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap" style={{ color: isBent(r) ? shapeColor(r.shape) : undefined }}>
                    {r.shape ? SHAPE_LABEL[r.shape] : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-muted-foreground whitespace-nowrap">{outcomeLabel(r)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: r.verdict === "pos" || r.verdict === "neg" ? verdictColor(r.verdict) : undefined }}>
                    {fmtTheta(r.theta)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                    {r.ciLow == null ? "—" : `${fmtTheta(r.ciLow)} ~ ${fmtTheta(r.ciHigh)}`}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.t ?? "—"}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtP(r.q)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.strength ?? "—"}</td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap" style={{ color: verdictColor(r.verdict) }}>
                    {VERDICT_LABEL[r.verdict]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!rows.length && (
        <p className="text-xs text-muted-foreground">这一区间对不上足够的成交和行情，因子推断没有做。</p>
      )}
    </div>
  )
}
