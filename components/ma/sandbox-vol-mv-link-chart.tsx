"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"

export type VolMvLinkPoint = {
  prod: string
  name: string
  sector: string
  /** Daily return volatility, in percent. */
  volPct: number
  /** Signed market value, yuan. Shorts are negative. */
  mv: number
  /** Correlation of this holding's P&L with the book, in [-1, 1]. */
  corr: number
  /** Share of absolute marginal risk, in percent. Same basis as the sandbox pies. */
  riskPct: number
}

export type VolMvLink = {
  source: string
  target: string
  corr: number
}

const SECTOR_COLOR: Record<string, string> = {
  能源化工: "#5470c6",
  黑色: "#73c0de",
  有色: "#3ba272",
  贵金属: "#fc8452",
  农产: "#91cc75",
  生鲜: "#fac858",
  新能源: "#48b0f1",
  股指: "#ef4444",
  国债: "#9a60b4",
  航运: "#ea7ccc",
  其他: "#94a3b8",
}

const LONG = "#dc2626"
const SHORT = "#3b82f6"
const ANN_FACTOR = Math.sqrt(252)

type Agg = {
  key: string
  label: string
  sub: string
  longMv: number
  shortMv: number
  longRisk: number
  shortRisk: number
  longDv: number
  shortDv: number
}

function annVol(dailyPct: number): number {
  return dailyPct * ANN_FACTOR
}

function wan(yuan: number): number {
  return yuan / 10000
}

function fmtWan(yuan: number, signed = false): string {
  const v = wan(yuan)
  const sign = !signed ? "" : v > 0 ? "+" : v < 0 ? "-" : ""
  const absWan = Math.abs(v)
  if (absWan >= 10000) return `${sign}${(absWan / 10000).toFixed(2)}亿`
  const body = absWan >= 100 ? absWan.toFixed(0) : absWan.toFixed(1)
  return `${sign}${body}万`
}

function emptyAgg(key: string, label: string, sub = ""): Agg {
  return { key, label, sub, longMv: 0, shortMv: 0, longRisk: 0, shortRisk: 0, longDv: 0, shortDv: 0 }
}

function addPoint(agg: Agg, point: VolMvLinkPoint) {
  const dv = Math.abs(point.mv) * (point.volPct / 100)
  if (point.mv >= 0) {
    agg.longMv += point.mv
    agg.longRisk += point.riskPct
    agg.longDv += dv
  } else {
    agg.shortMv += -point.mv
    agg.shortRisk += point.riskPct
    agg.shortDv += dv
  }
}

function netMv(row: Agg): number {
  return row.longMv - row.shortMv
}

function grossMv(row: Agg): number {
  return row.longMv + row.shortMv
}

function riskOf(row: Agg): number {
  return row.longRisk + row.shortRisk
}

function explain(scope: string, row: Agg): string {
  return `${scope}多头市值 ${fmtWan(row.longMv)}、空头市值 ${fmtWan(row.shortMv)}，轧差 ${fmtWan(netMv(row), true)}。风险贡献 ${riskOf(row).toFixed(1)}% 是多头 ${row.longRisk.toFixed(1)} 个点和空头 ${row.shortRisk.toFixed(1)} 个点相加。多头一日波动约 ${fmtWan(row.longDv)}，空头约 ${fmtWan(row.shortDv)}。`
}

function NetVsRiskChart({
  rows,
  onPick,
  showNet,
}: {
  rows: Agg[]
  onPick: ((label: string) => void) | null
  showNet: boolean
}) {
  const option = useMemo(() => {
    const labels = rows.map((row) => row.label)
    const byLabel = new Map(rows.map((row) => [row.label, row]))
    const maxAbsMv = Math.max(...rows.map((row) => Math.max(row.longMv, row.shortMv)), 1) / 10000
    const maxRisk = Math.max(...rows.map((row) => riskOf(row)), 1)
    const tip = (label: string) => {
      const row = byLabel.get(label)
      if (!row) return label
      const title = row.sub ? `${row.label}（${row.sub}）` : row.label
      return [
        `<b>${title}</b>`,
        `多头市值：<b>${fmtWan(row.longMv)}</b>`,
        `空头市值：<b>${fmtWan(row.shortMv)}</b>`,
        `轧差（多 − 空）：<b>${fmtWan(netMv(row), true)}</b>`,
        `风险贡献：<b>${riskOf(row).toFixed(1)}%</b>（多 ${row.longRisk.toFixed(1)} / 空 ${row.shortRisk.toFixed(1)}）`,
        `一日波动：多 ${fmtWan(row.longDv)} / 空 ${fmtWan(row.shortDv)}`,
      ].join("<br/>")
    }
    return {
      backgroundColor: "transparent",
      animation: false,
      legend: {
        top: 0,
        left: 8,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 11, color: "#334155" },
        data: showNet ? ["多头", "空头", "轧差"] : ["多头", "空头"],
      },
      tooltip: {
        trigger: "item",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => tip(p.data?.rowLabel ?? p.name),
      },
      grid: [
        { left: 78, width: "36%", top: 32, bottom: 36 },
        { left: "58%", right: 52, top: 32, bottom: 36 },
      ],
      xAxis: [
        {
          gridIndex: 0,
          type: "value",
          name: "市值（万元）  ← 空    多 →",
          nameLocation: "middle",
          nameGap: 22,
          min: -maxAbsMv * 1.18,
          max: maxAbsMv * 1.18,
          nameTextStyle: { color: "#334155", fontSize: 11 },
          axisLabel: { color: "#475569", fontSize: 10, hideOverlap: true, formatter: (v: number) => Math.round(v).toString() },
          splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,0.35)" } },
        },
        {
          gridIndex: 1,
          type: "value",
          name: "风险贡献 (%)",
          nameLocation: "middle",
          nameGap: 22,
          min: 0,
          max: maxRisk * 1.28,
          nameTextStyle: { color: "#334155", fontSize: 11 },
          axisLabel: { color: "#475569", fontSize: 10, hideOverlap: true, formatter: (v: number) => `${Math.round(v)}` },
          splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,0.35)" } },
        },
      ],
      yAxis: [
        {
          gridIndex: 0,
          type: "category",
          data: labels,
          inverse: true,
          triggerEvent: true,
          axisTick: { show: false },
          axisLabel: { color: "#0f172a", fontSize: labels.length > 18 ? 10 : 11 },
        },
        {
          gridIndex: 1,
          type: "category",
          data: labels,
          inverse: true,
          axisTick: { show: false },
          axisLabel: { show: false },
        },
      ],
      series: [
        {
          name: "空头",
          type: "bar",
          xAxisIndex: 0,
          yAxisIndex: 0,
          stack: "mv",
          barMaxWidth: 16,
          itemStyle: { color: SHORT },
          data: rows.map((row) => ({ value: -wan(row.shortMv), name: row.label, rowLabel: row.label })),
        },
        {
          name: "多头",
          type: "bar",
          xAxisIndex: 0,
          yAxisIndex: 0,
          stack: "mv",
          barMaxWidth: 16,
          itemStyle: { color: LONG },
          data: rows.map((row) => ({ value: wan(row.longMv), name: row.label, rowLabel: row.label })),
        },
        ...(showNet ? [{
          name: "轧差",
          type: "scatter",
          xAxisIndex: 0,
          yAxisIndex: 0,
          symbol: "diamond",
          symbolSize: 11,
          itemStyle: { color: "#0f172a" },
          z: 5,
          data: rows
            .filter((row) => row.longMv > 0 && row.shortMv > 0)
            .map((row) => ({ value: [wan(netMv(row)), row.label], name: row.label, rowLabel: row.label })),
        }] : []),
        {
          name: "空头",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          stack: "risk",
          barMaxWidth: 16,
          itemStyle: { color: SHORT },
          data: rows.map((row) => ({ value: row.shortRisk, name: row.label, rowLabel: row.label })),
        },
        {
          name: "多头",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          stack: "risk",
          barMaxWidth: 16,
          itemStyle: { color: LONG },
          label: {
            show: true,
            position: "right",
            fontSize: 10,
            color: "#334155",
            formatter: (p: { data?: { rowLabel?: string } }) => {
              const row = byLabel.get(p.data?.rowLabel ?? "")
              if (!row) return ""
              const total = riskOf(row)
              return total >= 0.8 ? `${total.toFixed(1)}%` : ""
            },
          },
          data: rows.map((row) => ({ value: row.longRisk, name: row.label, rowLabel: row.label })),
        },
      ],
    }
  }, [rows, showNet])

  const height = Math.min(560, Math.max(260, 72 + rows.length * (rows.length > 18 ? 18 : 24)))

  return (
    <ReactECharts
      option={option}
      style={{ height }}
      notMerge
      onEvents={onPick ? {
        click: (params: { componentType?: string; name?: string; value?: string }) => {
          const label = params.componentType === "yAxis" ? String(params.value ?? "") : String(params.name ?? "")
          if (label && rows.some((row) => row.label === label)) onPick(label)
        },
      } : undefined}
    />
  )
}

export default function SandboxVolMvLinkChart({
  points,
  links,
}: {
  points: VolMvLinkPoint[]
  links: VolMvLink[]
}) {
  const [focus, setFocus] = useState<string | null>(null)

  const sectorRows = useMemo(() => {
    const map = new Map<string, Agg>()
    for (const point of points) {
      const agg = map.get(point.sector) ?? emptyAgg(point.sector, point.sector)
      addPoint(agg, point)
      map.set(point.sector, agg)
    }
    return [...map.values()].sort((a, b) => riskOf(b) - riskOf(a))
  }, [points])

  const activeFocus = focus && sectorRows.some((row) => row.key === focus) ? focus : null

  const productRows = useMemo(() => {
    if (!activeFocus) return []
    const individuals = points
      .filter((point) => point.sector === activeFocus)
      .map((point) => {
        const agg = emptyAgg(point.prod, point.prod, point.name)
        addPoint(agg, point)
        return agg
      })
    const keep = individuals.filter((row) => riskOf(row) >= 1.5 || Math.max(row.longMv, row.shortMv) >= 8_000_000)
    const kept = new Set(keep.map((row) => row.key))
    const restLong = emptyAgg("其余多头", "其余多头")
    const restShort = emptyAgg("其余空头", "其余空头")
    const longCodes: string[] = []
    const shortCodes: string[] = []
    for (const row of individuals) {
      if (kept.has(row.key)) continue
      if (row.longMv > 0) {
        restLong.longMv += row.longMv
        restLong.longRisk += row.longRisk
        restLong.longDv += row.longDv
        longCodes.push(row.label)
      } else {
        restShort.shortMv += row.shortMv
        restShort.shortRisk += row.shortRisk
        restShort.shortDv += row.shortDv
        shortCodes.push(row.label)
      }
    }
    if (longCodes.length > 0) {
      restLong.label = `其余多头 ${longCodes.length}`
      restLong.sub = longCodes.join(" ")
    }
    if (shortCodes.length > 0) {
      restShort.label = `其余空头 ${shortCodes.length}`
      restShort.sub = shortCodes.join(" ")
    }
    const body = [...keep, ...(longCodes.length > 0 ? [restLong] : []), ...(shortCodes.length > 0 ? [restShort] : [])]
      .sort((a, b) => netMv(b) - netMv(a))
    const total = emptyAgg("合计", "合计")
    for (const row of body) {
      total.longMv += row.longMv
      total.shortMv += row.shortMv
      total.longRisk += row.longRisk
      total.shortRisk += row.shortRisk
      total.longDv += row.longDv
      total.shortDv += row.shortDv
    }
    return [...body, total]
  }, [points, activeFocus])

  const rows = activeFocus ? productRows : sectorRows
  const book = useMemo(() => {
    const agg = emptyAgg("all", "当前持仓")
    for (const point of points) addPoint(agg, point)
    return agg
  }, [points])
  const focused = activeFocus ? sectorRows.find((row) => row.key === activeFocus) ?? null : null
  const visibleCodes = useMemo(() => {
    const list = activeFocus ? points.filter((point) => point.sector === activeFocus) : points
    return new Set(list.map((point) => point.prod))
  }, [points, activeFocus])

  const linkOption = useMemo(() => {
    const shown = points.filter((point) => visibleCodes.has(point.prod))
    const sectors = [...new Set(shown.map((point) => point.sector))]
    const colorOf = (sector: string) => SECTOR_COLOR[sector] ?? "#94a3b8"
    const vols = shown.map((point) => annVol(point.volPct))
    const mvs = shown.map((point) => wan(point.mv))
    const xMax = Math.max(...vols, 1) * 1.12
    const yPad = Math.max((Math.max(...mvs, 0) - Math.min(...mvs, 0)) * 0.08, 50)
    const shownLinks = links.filter((link) => visibleCodes.has(link.source) && visibleCodes.has(link.target))
    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => {
          if (p.dataType === "edge") {
            const corr = Number(p.data?.corr ?? 0)
            return `${p.data?.source} — ${p.data?.target}<br/>相关性：<b>${corr.toFixed(2)}</b>`
          }
          const vol = Number(p.value?.[0] ?? 0)
          const mvWan = Number(p.value?.[1] ?? 0)
          const cn = p.data?.cn ? `（${p.data.cn}）` : ""
          const risk = Number(p.data?.riskPct ?? 0)
          return [
            `<b>${p.name}${cn}</b>`,
            `板块：${p.data?.sector ?? ""}`,
            `年化波动率：<b>${vol.toFixed(1)}%</b>`,
            `持仓市值：<b>${mvWan.toFixed(1)} 万</b>${mvWan < 0 ? "（空）" : "（多）"}`,
            `风险贡献：<b>${risk.toFixed(1)}%</b>`,
          ].join("<br/>")
        },
      },
      grid: { left: 64, right: 24, top: 16, bottom: 48 },
      xAxis: {
        type: "value",
        name: "年化波动率 (%)",
        nameLocation: "middle",
        nameGap: 28,
        min: 0,
        max: xMax,
        nameTextStyle: { color: "#334155", fontSize: 12 },
        axisLabel: { color: "#475569", fontSize: 10, formatter: (v: number) => v.toFixed(0) },
        splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,0.35)" } },
      },
      yAxis: {
        type: "value",
        name: "持仓市值（万元）",
        nameLocation: "middle",
        nameGap: 48,
        min: Math.min(0, ...mvs) - yPad,
        max: Math.max(0, ...mvs) + yPad,
        nameTextStyle: { color: "#334155", fontSize: 12 },
        axisLabel: { color: "#475569", fontSize: 10, formatter: (v: number) => v.toFixed(0) },
        splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,0.35)" } },
        axisLine: { onZero: true },
      },
      series: [{
        type: "graph",
        layout: "none",
        coordinateSystem: "cartesian2d",
        categories: sectors.map((sector) => ({ name: sector, itemStyle: { color: colorOf(sector) } })),
        symbolSize: (_v: number[], params: { data?: { riskPct?: number } }) => {
          const risk = Number(params.data?.riskPct ?? 0)
          return Math.max(8, Math.min(40, 8 + Math.sqrt(risk) * 7))
        },
        label: {
          show: true,
          position: "top",
          fontSize: 10,
          color: "#0f172a",
          formatter: (p: { name?: string; data?: { riskPct?: number } }) => {
            const risk = Number(p.data?.riskPct ?? 0)
            return activeFocus || risk >= 1.5 ? (p.name ?? "") : ""
          },
        },
        edgeSymbol: ["none", "none"],
        lineStyle: { color: "#64748b", curveness: 0.08 },
        emphasis: { focus: "adjacency", lineStyle: { width: 3 } },
        itemStyle: { borderColor: "#ffffff", borderWidth: 1 },
        data: shown.map((point) => ({
          name: point.prod,
          cn: point.name,
          sector: point.sector,
          riskPct: point.riskPct,
          category: sectors.indexOf(point.sector),
          value: [Number(annVol(point.volPct).toFixed(2)), Number(wan(point.mv).toFixed(2))],
        })),
        links: shownLinks.map((link) => ({
          source: link.source,
          target: link.target,
          corr: link.corr,
          lineStyle: {
            width: 1 + (link.corr - 0.5) * 4,
            opacity: 0.35 + (link.corr - 0.5),
          },
        })),
      }],
    }
  }, [points, links, visibleCodes, activeFocus])

  if (points.length === 0) return null

  const summary = focused ?? book
  const scope = focused ? `${focused.label}：` : "全部持仓："

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 px-2 pb-2">
        <button
          type="button"
          onClick={() => setFocus(null)}
          className={`rounded-full border px-2.5 py-0.5 text-xs ${activeFocus == null ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600"}`}
        >
          全部板块
        </button>
        {sectorRows.map((row) => {
          const color = SECTOR_COLOR[row.key] ?? "#94a3b8"
          const on = activeFocus === row.key
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => setFocus(row.key)}
              className="rounded-full border px-2.5 py-0.5 text-xs"
              style={{
                borderColor: color,
                background: on ? color : "transparent",
                color: on ? "#ffffff" : "#334155",
              }}
            >
              {row.label} {riskOf(row).toFixed(0)}%
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 px-2 pb-2 sm:grid-cols-4">
        <Stat label="轧差市值" value={fmtWan(netMv(summary), true)} hint={`毛市值 ${fmtWan(grossMv(summary))}`} />
        <Stat label="多头市值" value={fmtWan(summary.longMv)} hint={`一日波动 ${fmtWan(summary.longDv)}`} />
        <Stat label="空头市值" value={fmtWan(summary.shortMv)} hint={`一日波动 ${fmtWan(summary.shortDv)}`} />
        <Stat label="风险贡献" value={`${riskOf(summary).toFixed(1)}%`} hint={`多${summary.longRisk.toFixed(1)}+空${summary.shortRisk.toFixed(1)}`} />
      </div>
      <p className="px-2 pb-1 text-xs leading-5 text-muted-foreground">
        {explain(scope, summary)}
        {activeFocus
          ? "右边每一段都计入板块风险。"
          : "点一个板块看每个品种。菱形靠近零、左右两翼仍很长的板块，就是轧差小、风险大。"}
      </p>

      <NetVsRiskChart
        rows={rows}
        onPick={activeFocus ? null : (label) => { if (label !== "合计") setFocus(label) }}
        showNet={rows.some((row) => row.longMv > 0 && row.shortMv > 0)}
      />

      <p className="px-2 pt-3 text-xs text-muted-foreground">
        下面每个点是一个品种，横轴年化波动率，纵轴持仓市值，点的大小是风险贡献。收益率相关性大于 0.5 的品种连线，同一板块里的连线越密，这些多空越像同一个赌注。
      </p>
      <ReactECharts option={linkOption} style={{ height: 380 }} notMerge />
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="whitespace-nowrap text-sm font-medium tabular-nums">{value}</div>
      <div className="whitespace-nowrap text-[11px] text-muted-foreground">{hint}</div>
    </div>
  )
}
