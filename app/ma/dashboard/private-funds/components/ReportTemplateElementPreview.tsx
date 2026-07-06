"use client"

import type { CSSProperties, ReactNode } from "react"
import {
  ELEMENT_TYPE_META,
  isPfModuleType,
  type TableColumnDef,
  type TemplateElement,
  type TemplateInputField,
} from "@/lib/ma/report-template-types"
import {
  formatMetricPreview,
  metricByKey,
  productFieldByKey,
} from "@/lib/ma/report-template-metrics"
import { ELEMENT_STYLE_PRESETS, styleToCss } from "@/lib/ma/report-template-style-presets"
import { ReportTemplateModulePreview } from "./ReportTemplateModulePreview"

function resolveStyle(el: TemplateElement): CSSProperties {
  const preset = ELEMENT_STYLE_PRESETS.find((p) => p.id === el.props.stylePreset)
  return styleToCss({ ...preset?.style, ...el.props.style })
}

function columnPreview(col: TableColumnDef): string {
  if (col.source === "static") return col.staticValue ?? "—"
  if (col.source === "product_field") {
    const f = productFieldByKey(col.productField ?? "")
    return f?.format === "text" ? "示例产品" : formatMetricPreview(f?.format ?? "text")
  }
  if (col.source === "metric") {
    const m = metricByKey(col.metricKey ?? "")
    return formatMetricPreview(m?.format ?? col.format ?? "number")
  }
  return "{输入}"
}

function ChartPlaceholder({
  title,
  color = "#ef4444",
  type = "line",
}: {
  title: string
  color?: string
  type?: "line" | "bar" | "area" | "pie"
}) {
  if (type === "pie") {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 p-2">
        <div className="h-16 w-16 rounded-full border-[10px] border-red-400 border-r-blue-400 border-b-emerald-400 border-l-amber-400" />
        <div className="text-[9px] text-zinc-400 space-y-0.5">
          <div>● A 35%</div><div>● B 28%</div><div>● C 37%</div>
        </div>
      </div>
    )
  }
  if (type === "bar") {
    return (
      <div className="flex-1 flex items-end px-2 pb-2 gap-0.5">
        {[40, 55, 48, 62, 58, 70, 65, 78].map((h, i) => (
          <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${h * 0.65}%`, backgroundColor: `${color}99` }} />
        ))}
      </div>
    )
  }
  if (type === "area") {
    return (
      <div className="flex-1 relative mx-2 mb-2">
        <svg viewBox="0 0 100 40" className="w-full h-full" preserveAspectRatio="none">
          <path d="M0,35 L10,28 L20,30 L30,22 L40,25 L50,18 L60,20 L70,12 L80,15 L90,8 L100,10 L100,40 L0,40 Z" fill={`${color}33`} />
          <path d="M0,35 L10,28 L20,30 L30,22 L40,25 L50,18 L60,20 L70,12 L80,15 L90,8 L100,10" fill="none" stroke={color} strokeWidth="1.5" />
        </svg>
      </div>
    )
  }
  return (
    <div className="flex-1 flex items-end px-2 pb-2 gap-0.5">
      {[40, 55, 48, 62, 58, 70, 65, 78, 72, 85].map((h, i) => (
        <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${h * 0.7}%`, backgroundColor: `${color}99` }} />
      ))}
    </div>
  )
}

export function ReportTemplateElementPreview({
  el,
  inputs,
  selected,
  onSelect,
  inputValues,
}: {
  el: TemplateElement
  inputs: TemplateInputField[]
  selected: boolean
  onSelect: () => void
  /** When generating a report, pass filled user input values */
  inputValues?: Record<string, string>
}) {
  const meta = ELEMENT_TYPE_META[el.type]
  const style = resolveStyle(el)
  const bindId = el.props.bindInputId || el.props.bindProductInputId
  const bound = bindId ? inputs.find((i) => i.id === bindId) : undefined
  const bindLabel = bound
    ? (inputValues?.[bound.id]?.trim() || `{${bound.label}}`)
    : null

  function interpolateText(text: string): string {
    if (!inputValues) return text
    let result = text
    for (const inp of inputs) {
      const val = inputValues[inp.id]?.trim()
      if (val) result = result.split(`{${inp.label}}`).join(val)
    }
    return result
  }
  const ring = selected ? "ring-2 ring-red-500 ring-offset-1" : ""

  if (isPfModuleType(el.type)) {
    return (
      <ReportTemplateModulePreview
        el={el}
        bindLabel={bindLabel}
        style={style}
        ring={ring}
        onSelect={onSelect}
      />
    )
  }

  const wrap = (children: ReactNode, extra?: CSSProperties) => (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect() }}
      className={`h-full w-full overflow-hidden ${ring}`}
      style={{ ...style, ...extra }}
    >
      {children}
    </div>
  )

  if (el.type === "title" || el.type === "subtitle") {
    // Explicit textColor overrides the Tailwind default; inline style wins over class.
    const explicitColor = el.props.style?.textColor
    return wrap(
      <div
        className={[
          "h-full flex items-center px-2 overflow-hidden",
          el.props.align === "center" ? "justify-center text-center" : el.props.align === "right" ? "justify-end text-right" : "justify-start",
        ].join(" ")}
        style={{ fontSize: el.props.fontSize ?? (el.type === "title" ? 28 : 16) }}
      >
        <span
          className={el.type === "title" ? "font-bold truncate" : "font-medium truncate"}
          style={{ color: explicitColor ?? (el.type === "subtitle" ? "#52525b" : undefined) }}
        >
          {bindLabel && el.props.bindInputId ? bindLabel : interpolateText(el.props.text ?? meta.label)}
        </span>
      </div>,
    )
  }

  if (el.type === "text" || el.type === "rich-text" || el.type === "date-display") {
    return wrap(
      <div
        className="h-full p-2 overflow-hidden leading-relaxed whitespace-pre-wrap"
        style={{
          fontSize: el.props.fontSize ?? 14,
          textAlign: el.props.align ?? "left",
          color: el.props.style?.textColor,
        }}
      >
        {bindLabel && el.props.bindInputId ? bindLabel : interpolateText(el.props.text ?? "文本内容")}
      </div>,
    )
  }

  const chartTypes = ["nav-chart", "return-chart", "drawdown-chart", "rolling-vol-chart", "bar-chart", "pie-chart", "scatter-chart", "heatmap", "benchmark-compare"] as const
  if (chartTypes.includes(el.type as typeof chartTypes[number])) {
    const chartType = el.type === "bar-chart" ? "bar" : el.type === "drawdown-chart" ? "area" : el.type === "pie-chart" ? "pie" : "line"
    return wrap(
      <div className="h-full flex flex-col overflow-hidden">
        <div className="px-2 py-1 text-[10px] opacity-70 border-b border-current/10 flex justify-between shrink-0">
          <span>{meta.label} · {el.props.chartPeriod ?? "近一年"}</span>
          {bindLabel && <span className="truncate max-w-[45%] text-red-500">{bindLabel}</span>}
        </div>
        <ChartPlaceholder title={meta.label} color={el.props.chartColor ?? "#ef4444"} type={chartType} />
      </div>,
    )
  }

  if (el.type === "metric-card") {
    const m = metricByKey(el.props.metricKey ?? "calmar_1y")
    const tc = el.props.style?.textColor
    return wrap(
      <div className="h-full flex flex-col items-center justify-center p-2 text-center" style={{ color: tc }}>
        <div className="text-[10px] opacity-70">{el.props.metricLabel ?? m?.label ?? "指标"}</div>
        <div className="text-xl font-bold mt-1" style={{ color: tc ?? "#c0392b" }}>{formatMetricPreview(m?.format ?? "number")}</div>
        <div className="text-[9px] opacity-50 mt-0.5">{el.props.metricPeriod ?? m?.period ?? "近一年"}</div>
        {bindLabel && <div className="text-[9px] text-red-500 mt-1 truncate max-w-full">{bindLabel}</div>}
      </div>,
    )
  }

  if (el.type === "metric-grid" || el.type === "kpi-row") {
    const keys = ["ret_1y", "sharpe_1y", "calmar_1y", "max_dd_1y"]
    return wrap(
      <div className={`h-full p-2 grid gap-1 ${el.type === "kpi-row" ? "grid-cols-4" : "grid-cols-2"}`}>
        {keys.map((k) => {
          const m = metricByKey(k)
          return (
            <div key={k} className="rounded bg-black/5 dark:bg-white/5 p-1.5 text-center">
              <div className="text-[8px] opacity-60 truncate">{m?.label}</div>
              <div className="text-xs font-semibold">{formatMetricPreview(m?.format ?? "number")}</div>
            </div>
          )
        })}
      </div>,
    )
  }

  if (el.type === "product-info") {
    return wrap(
      <div className="h-full p-2 text-[10px] space-y-1">
        <div className="font-semibold">{bindLabel ?? "产品名称"}</div>
        <div className="opacity-60">备案编码 · 策略 · 管理人</div>
        <div className="opacity-60">成立日期 · 最新净值 · 净值日期</div>
      </div>,
    )
  }

  if (el.type === "table") {
    const cols = el.props.tableColumns ?? []
    const fs = el.props.tableFontSize ?? 10
    return wrap(
      <div className="h-full flex flex-col overflow-hidden" style={{ fontSize: fs }}>
        <div className="px-2 py-0.5 opacity-70 flex justify-between shrink-0 border-b border-current/10">
          <span>数据表格 · {cols.length} 列</span>
          {bindLabel && <span className="text-red-500 truncate">{bindLabel}</span>}
        </div>
        <div className="flex-1 overflow-auto min-h-0">
          <div className="flex sticky top-0" style={{ backgroundColor: el.props.tableHeaderBg ?? "#fafafa" }}>
            {el.props.tableShowIndex && <div className="w-6 px-1 py-1 font-medium border-r border-zinc-200 shrink-0">#</div>}
            {cols.map((c) => (
              <div
                key={c.id}
                className="flex-1 px-1 py-1 font-medium truncate border-r last:border-r-0 border-zinc-200"
                style={{ textAlign: c.align ?? "left", flex: c.widthWeight ?? 1 }}
              >
                {c.header}
              </div>
            ))}
          </div>
          {[1, 2, 3].map((row) => (
            <div
              key={row}
              className={`flex border-b border-zinc-100 ${el.props.tableStriped && row % 2 === 0 ? "bg-zinc-50/80" : ""}`}
            >
              {el.props.tableShowIndex && <div className="w-6 px-1 py-1 text-zinc-400 border-r border-zinc-100 shrink-0">{row}</div>}
              {cols.map((c) => (
                <div
                  key={c.id}
                  className="flex-1 px-1 py-1 text-zinc-500 truncate border-r last:border-r-0 border-zinc-100"
                  style={{ textAlign: c.align ?? "left", flex: c.widthWeight ?? 1 }}
                >
                  {columnPreview(c)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>,
      { padding: 0 },
    )
  }

  if (el.type === "image" || el.type === "logo") {
    return wrap(
      <div className="h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-zinc-400 text-[10px]">
        {el.props.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={el.props.imageUrl} alt="" className="h-full w-full" style={{ objectFit: el.props.objectFit ?? "contain" }} />
        ) : (
          el.type === "logo" ? "Logo" : "图片"
        )}
      </div>,
    )
  }

  if (el.type === "divider" || el.type === "page-break") {
    return wrap(
      <div className="h-full flex items-center px-2">
        <div
          className="w-full"
          style={{
            borderTopWidth: el.props.dividerThickness ?? 1,
            borderTopStyle: el.props.dividerStyle ?? "solid",
            borderColor: el.props.style?.borderColor ?? "#d4d4d8",
          }}
        />
      </div>,
      { padding: 0, backgroundColor: "transparent" },
    )
  }

  if (el.type === "spacer") {
    // If the element has an explicit background color it's a decorative band (e.g. header, accent line).
    // Render it solid; otherwise show a dashed placeholder in the editor.
    const hasBg = !!el.props.style?.backgroundColor
    return wrap(
      <div className={`h-full w-full${!hasBg ? " border border-dashed border-zinc-200/60 rounded" : ""}`} />,
      { padding: 0, ...(hasBg ? {} : { backgroundColor: "transparent" }) },
    )
  }

  return wrap(<div className="h-full flex items-center justify-center text-xs opacity-50">{meta.label}</div>)
}
