"use client"

import type { CSSProperties, ReactNode } from "react"
import { ELEMENT_TYPE_META, type TemplateElement } from "@/lib/ma/report-template-types"

function ModuleHeader({ title, bindLabel }: { title: string; bindLabel?: string | null }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900/40 shrink-0">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
      <span className="text-[10px] font-semibold truncate flex-1">{title}</span>
      {bindLabel && <span className="text-[9px] text-red-500 truncate max-w-[40%]">{bindLabel}</span>}
    </div>
  )
}

function MiniTable({ rows, cols }: { rows: number; cols: string[] }) {
  return (
    <div className="flex-1 overflow-hidden text-[8px]">
      <div className="flex bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200">
        {cols.map((c) => (
          <div key={c} className="flex-1 px-1 py-0.5 font-medium truncate border-r last:border-r-0">{c}</div>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex border-b border-zinc-100 last:border-0">
          {cols.map((c) => (
            <div key={c} className="flex-1 px-1 py-0.5 text-zinc-400 truncate border-r last:border-r-0">—</div>
          ))}
        </div>
      ))}
    </div>
  )
}

function MiniLineChart({ color = "#ef4444" }: { color?: string }) {
  return (
    <div className="flex-1 flex items-end px-1 pb-1 gap-px min-h-[40px]">
      {[35, 48, 42, 55, 50, 62, 58, 70, 65, 75].map((h, i) => (
        <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${h * 0.6}%`, backgroundColor: `${color}88` }} />
      ))}
    </div>
  )
}

function MiniCalendar() {
  const months = ["1月", "2月", "3月", "4月", "5月", "6月"]
  return (
    <div className="flex-1 grid grid-cols-6 gap-0.5 p-1.5 text-[7px]">
      {months.map((m) => (
        <div key={m} className="rounded bg-zinc-100 dark:bg-zinc-800 p-1 text-center">
          <div className="text-zinc-400 mb-0.5">{m}</div>
          <div className="font-medium text-emerald-600">+1.2%</div>
        </div>
      ))}
    </div>
  )
}

function SectionTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[8px] text-zinc-500 mr-2 mb-1">
      <span className="h-1 w-1 rounded-full bg-red-400" />
      {label}
    </span>
  )
}

export function ReportTemplateModulePreview({
  el,
  bindLabel,
  style,
  ring,
  onSelect,
}: {
  el: TemplateElement
  bindLabel?: string | null
  style: CSSProperties
  ring: string
  onSelect: () => void
}) {
  const meta = ELEMENT_TYPE_META[el.type]
  const sections = el.props.moduleSections ?? []
  const period = el.props.chartPeriod ?? el.props.metricPeriod ?? "近一年"

  const wrap = (title: string, body: ReactNode) => (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect() }}
      className={`h-full flex flex-col overflow-hidden rounded border border-zinc-200 dark:border-zinc-700 ${ring}`}
      style={style}
    >
      <ModuleHeader title={title} bindLabel={bindLabel} />
      {body}
    </div>
  )

  if (el.type === "pf-product-elements") {
    const fields = ["产品全称", "备案编号", "基金管理人", "成立日期", "开放日", "管理费率", "预警线", "平仓线"]
    return wrap(
      meta.label,
      <div className="flex-1 overflow-auto p-2 text-[8px]">
        {sections.map((sec) => (
          <div key={sec} className="mb-2">
            <SectionTag label={sec} />
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-1">
              {fields.slice(0, 4).map((f) => (
                <div key={f} className="flex gap-1">
                  <span className="text-zinc-400 shrink-0">{f}:</span>
                  <span className="truncate">—</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {sections.length === 0 && (
          <div className="grid grid-cols-2 gap-1">
            {fields.map((f) => (
              <div key={f} className="flex gap-1"><span className="text-zinc-400">{f}:</span><span>—</span></div>
            ))}
          </div>
        )}
      </div>,
    )
  }

  if (el.type === "pf-product-performance" || el.type === "pf-performance-indicators") {
    return wrap(
      `${meta.label} · ${period}`,
      <div className="flex-1 flex flex-col min-h-0 p-1 gap-1">
        <div className="flex flex-wrap gap-0.5 px-1">
          {(sections.length ? sections : ["净值曲线", "区间统计"]).map((s) => (
            <span key={s} className="text-[7px] px-1 py-0.5 rounded bg-red-50 text-red-600 dark:bg-red-950/30">{s}</span>
          ))}
        </div>
        <div className="flex-1 grid grid-cols-2 gap-1 min-h-0">
          <div className="rounded border border-zinc-100 flex flex-col overflow-hidden">
            <div className="text-[7px] px-1 py-0.5 bg-zinc-50 text-zinc-500">净值曲线</div>
            <MiniLineChart color={el.props.chartColor ?? "#ef4444"} />
          </div>
          <div className="rounded border border-zinc-100 flex flex-col overflow-hidden">
            <div className="text-[7px] px-1 py-0.5 bg-zinc-50 text-zinc-500">区间统计</div>
            <MiniTable rows={4} cols={["指标", "产品", "基准"]} />
          </div>
        </div>
        {sections.includes("动态回撤") && (
          <div className="h-8 rounded border border-zinc-100 flex items-end px-1 pb-0.5 gap-px">
            {[20, 15, 25, 18, 30, 22].map((h, i) => (
              <div key={i} className="flex-1 bg-orange-400/50 rounded-t-sm" style={{ height: `${h}%` }} />
            ))}
          </div>
        )}
      </div>,
    )
  }

  if (el.type === "pf-period-stats" || el.type === "pf-interval-metrics") {
    return wrap(
      `${meta.label} · ${period}`,
      <MiniTable rows={5} cols={["指标", "产品", "基准", "超额"]} />,
    )
  }

  if (el.type === "pf-monthly-returns") {
    return wrap(`${meta.label} · ${period}`, <MiniCalendar />)
  }

  if (el.type === "pf-annual-metrics") {
    return wrap(meta.label, <MiniTable rows={4} cols={["年份", "收益", "最大回撤", "夏普"]} />)
  }

  if (el.type === "pf-dynamic-drawdown") {
    return wrap(
      `${meta.label} · ${period}`,
      <div className="flex-1 relative mx-1 mb-1">
        <svg viewBox="0 0 100 30" className="w-full h-full" preserveAspectRatio="none">
          <path d="M0,5 L15,8 L30,12 L45,10 L60,18 L75,15 L90,22 L100,20 L100,30 L0,30 Z" fill="#f9731633" />
          <path d="M0,5 L15,8 L30,12 L45,10 L60,18 L75,15 L90,22 L100,20" fill="none" stroke="#f97316" strokeWidth="1" />
        </svg>
      </div>,
    )
  }

  if (el.type === "pf-drawdown-episodes") {
    return wrap(
      meta.label,
      <MiniTable rows={3} cols={["开始", "结束", "回撤", "回补天数"]} />,
    )
  }

  if (el.type === "pf-win-rate") {
    return wrap(
      `${meta.label} · ${period}`,
      <div className="flex-1 flex items-center justify-center gap-3 p-2">
        <div className="text-center">
          <div className="text-lg font-bold text-emerald-600">62%</div>
          <div className="text-[8px] text-zinc-400">周胜率</div>
        </div>
        <div className="h-12 w-px bg-zinc-200" />
        <div className="text-center">
          <div className="text-lg font-bold text-red-500">-3.2%</div>
          <div className="text-[8px] text-zinc-400">最大单周亏损</div>
        </div>
      </div>,
    )
  }

  if (el.type === "pf-fund-profile") {
    return wrap(
      meta.label,
      <div className="flex-1 p-2 text-[8px] space-y-1.5 overflow-auto">
        {(sections.length ? sections : ["策略说明", "投资范围"]).map((s) => (
          <div key={s}>
            <div className="font-medium text-zinc-600 mb-0.5">{s}</div>
            <div className="text-zinc-400 leading-relaxed">基于绑定产品自动加载…</div>
          </div>
        ))}
      </div>,
    )
  }

  if (el.type === "pf-fund-rating") {
    return wrap(
      meta.label,
      <div className="flex-1 flex items-center justify-center gap-4 p-2">
        <div className="text-3xl font-bold text-red-500">A</div>
        <div className="text-[8px] text-zinc-500 space-y-0.5">
          <div>综合评分 85</div>
          <div>收益能力 ★★★★</div>
          <div>风控能力 ★★★★★</div>
        </div>
      </div>,
    )
  }

  if (el.type === "pf-scenario-analysis") {
    return wrap(
      meta.label,
      <MiniTable rows={4} cols={["情景", "预期收益", "概率", "备注"]} />,
    )
  }

  if (el.type === "pf-nav-attribution") {
    return wrap(
      meta.label,
      <div className="flex-1 flex items-center justify-center gap-2 p-2">
        <div className="h-14 w-14 rounded-full border-[8px] border-red-400 border-r-blue-400 border-b-emerald-400" />
        <div className="text-[8px] text-zinc-400 space-y-0.5">
          <div>Alpha 贡献 65%</div>
          <div>Beta 贡献 25%</div>
          <div>其他 10%</div>
        </div>
      </div>,
    )
  }

  if (el.type === "pf-fund-company") {
    return wrap(
      meta.label,
      <div className="flex-1 p-2 text-[8px] overflow-auto">
        {(sections.length ? sections : ["公司简介", "管理规模"]).map((s) => (
          <div key={s} className="mb-1.5">
            <div className="font-medium text-zinc-600">{s}</div>
            <div className="h-6 bg-zinc-100 dark:bg-zinc-800 rounded mt-0.5" />
          </div>
        ))}
      </div>,
    )
  }

  if (el.type === "pf-holdings-analysis") {
    return wrap(
      meta.label,
      <div className="flex-1 grid grid-cols-2 gap-1 p-1">
        <MiniTable rows={3} cols={["品种", "市值占比"]} />
        <MiniLineChart color="#3b82f6" />
      </div>,
    )
  }

  if (el.type === "pf-return-analysis") {
    return wrap(
      `${meta.label} · ${period}`,
      <div className="flex-1 flex flex-col p-1 gap-1">
        <MiniLineChart color="#10b981" />
        <MiniTable rows={2} cols={["区间", "收益", "波动"]} />
      </div>,
    )
  }

  if (el.type === "pf-materials") {
    return wrap(
      meta.label,
      <div className="flex-1 p-2 space-y-1 text-[8px]">
        {["产品合同", "招募说明书", "月报", "尽调报告"].map((f) => (
          <div key={f} className="flex items-center gap-2 py-1 border-b border-zinc-100 last:border-0">
            <span className="text-zinc-400">📄</span>
            <span className="truncate">{f}</span>
          </div>
        ))}
      </div>,
    )
  }

  return null
}
