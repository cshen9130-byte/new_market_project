"use client"

import { useEffect, useState } from "react"
import {
  AlertTriangle,
  Bell,
  Building2,
  FileWarning,
  Gavel,
  Inbox,
  Megaphone,
  ShieldAlert,
} from "lucide-react"

interface RiskSummaryCounts {
  public_opinion: number
  integrity: number
  prompt: number
  operating_abnormal: number
  legal: number
  court_announcement: number
  regulatory: number
}

interface RiskData {
  summary: RiskSummaryCounts
  public_opinion: Array<{ date: string; title: string; sentiment: string; source: string }>
  regulatory_measures: Array<{ date: string; title: string; source: string }>
  integrity: Array<{ prompt_content: string; reason: string }>
  prompts: Array<{ prompt_content: string; description: string }>
  operating_abnormal: Array<{
    inclusion_date: string
    reason: string
    removal_date: string | null
    removal_reason: string | null
  }>
  legal_proceedings: Array<{ case_name: string; case_type: string; cause: string; result: string }>
  court_announcements: Array<{
    announcement_type: string
    cause: string
    parties: string
    court_name: string
    publish_date: string
  }>
}

const SUMMARY_CARDS: Array<{
  key: keyof RiskSummaryCounts
  label: string
  icon: typeof Bell
}> = [
  { key: "public_opinion", label: "舆情预警", icon: Megaphone },
  { key: "integrity", label: "机构诚信信息", icon: ShieldAlert },
  { key: "prompt", label: "机构提示信息", icon: Bell },
  { key: "operating_abnormal", label: "经营异常", icon: Building2 },
  { key: "legal", label: "法律诉讼", icon: Gavel },
  { key: "court_announcement", label: "法院公告", icon: FileWarning },
  { key: "regulatory", label: "监管措施", icon: AlertTriangle },
]

function SectionTitle({ children, red = false }: { children: React.ReactNode; red?: boolean }) {
  return (
    <div className={[
      "flex items-center gap-2 text-sm font-semibold mb-4",
      red ? "text-red-600" : "text-zinc-800",
    ].join(" ")}>
      {!red && <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />}
      {children}
    </div>
  )
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 mb-3">
      <span className="text-zinc-400">•</span>
      {children}
    </div>
  )
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-14 text-center">
        <div className="flex flex-col items-center gap-2 text-zinc-400">
          <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
          <span className="text-sm">暂无数据</span>
        </div>
      </td>
    </tr>
  )
}

function DataTable({
  headers,
  rows,
  renderRow,
}: {
  headers: string[]
  rows: unknown[]
  renderRow: (row: never, idx: number) => React.ReactNode
}) {
  const thBase = "px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap bg-zinc-50/80"
  return (
    <div className="overflow-x-auto w-full mb-6 last:mb-0">
      <table className="text-sm border-collapse w-full">
        <thead>
          <tr className="border-b border-zinc-100">
            {headers.map((h) => (
              <th key={h} className={thBase}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={headers.length} />
          ) : (
            rows.map((row, idx) => renderRow(row as never, idx))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function ManagerRiskPanel({ registrationNo }: { registrationNo: string }) {
  const [data, setData] = useState<RiskData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/ma/api/private-fund-managers/${encodeURIComponent(registrationNo)}/risk`)
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败")
        return res.json() as Promise<RiskData>
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [registrationNo])

  const tdBase = "px-3 py-2.5 text-sm text-zinc-700 border-b border-zinc-50"

  if (loading) {
    return (
      <div className="space-y-4 w-full animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-zinc-100" />
          ))}
        </div>
        <div className="h-64 rounded-lg bg-zinc-100" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-40 text-red-500 text-sm rounded-lg border border-zinc-100 bg-white w-full">
        加载失败：{error ?? "未知错误"}
      </div>
    )
  }

  return (
    <div className="space-y-4 w-full">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 w-full">
        {SUMMARY_CARDS.map(({ key, label, icon: Icon }) => (
          <div
            key={key}
            className="rounded-lg border border-zinc-100 bg-white px-4 py-3 flex flex-col items-center text-center min-h-[96px] justify-center"
          >
            <div className="h-8 w-8 rounded-full bg-red-50 flex items-center justify-center mb-2">
              <Icon className="h-4 w-4 text-red-500" />
            </div>
            <div className="text-xs text-zinc-500 leading-snug mb-1">{label}</div>
            <div className="text-lg font-semibold text-red-500 tabular-nums">
              {data.summary[key]} <span className="text-xs font-normal text-zinc-400">条</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle red>舆情预警</SectionTitle>
        <SubTitle>舆情信息</SubTitle>
        <DataTable
          headers={["日期", "标题", "情感倾向", "新闻来源"]}
          rows={data.public_opinion}
          renderRow={(row, idx) => (
            <tr key={idx} className="hover:bg-zinc-50/40">
              <td className={`${tdBase} tabular-nums whitespace-nowrap`}>{row.date}</td>
              <td className={tdBase}>{row.title}</td>
              <td className={tdBase}>{row.sentiment}</td>
              <td className={tdBase}>{row.source}</td>
            </tr>
          )}
        />
        <SubTitle>监管措施</SubTitle>
        <DataTable
          headers={["日期", "标题", "信息来源"]}
          rows={data.regulatory_measures}
          renderRow={(row, idx) => (
            <tr key={idx} className="hover:bg-zinc-50/40">
              <td className={`${tdBase} tabular-nums whitespace-nowrap`}>{row.date}</td>
              <td className={tdBase}>{row.title}</td>
              <td className={tdBase}>{row.source}</td>
            </tr>
          )}
        />
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle red>协会信息</SectionTitle>
        <SubTitle>机构诚信信息</SubTitle>
        <DataTable
          headers={["提示内容", "异常原因"]}
          rows={data.integrity}
          renderRow={(row, idx) => (
            <tr key={idx} className="hover:bg-zinc-50/40">
              <td className={tdBase}>{row.prompt_content}</td>
              <td className={tdBase}>{row.reason}</td>
            </tr>
          )}
        />
        <SubTitle>机构提示信息</SubTitle>
        <DataTable
          headers={["提示内容", "提示说明"]}
          rows={data.prompts}
          renderRow={(row, idx) => (
            <tr key={idx} className="hover:bg-zinc-50/40">
              <td className={tdBase}>{row.prompt_content}</td>
              <td className={tdBase}>{row.description}</td>
            </tr>
          )}
        />
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle red>经营预警</SectionTitle>
        <SubTitle>经营异常</SubTitle>
        <DataTable
          headers={["列入日期", "异常原因", "移除异常日期", "移除异常原因"]}
          rows={data.operating_abnormal}
          renderRow={(row, idx) => (
            <tr key={idx} className="hover:bg-zinc-50/40">
              <td className={`${tdBase} tabular-nums whitespace-nowrap`}>{row.inclusion_date}</td>
              <td className={tdBase}>{row.reason}</td>
              <td className={`${tdBase} tabular-nums whitespace-nowrap`}>{row.removal_date ?? "—"}</td>
              <td className={tdBase}>{row.removal_reason ?? "—"}</td>
            </tr>
          )}
        />
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle red>司法诉讼</SectionTitle>
        <SubTitle>法律诉讼</SubTitle>
        <DataTable
          headers={["案件名称", "案件类型", "案件原由", "判决结果"]}
          rows={data.legal_proceedings}
          renderRow={(row, idx) => (
            <tr key={idx} className="hover:bg-zinc-50/40">
              <td className={tdBase}>{row.case_name}</td>
              <td className={tdBase}>{row.case_type}</td>
              <td className={tdBase}>{row.cause}</td>
              <td className={tdBase}>{row.result}</td>
            </tr>
          )}
        />
        <SubTitle>法院公告</SubTitle>
        <DataTable
          headers={["公告类型", "案件原由", "当事人", "法院名称", "发布日期"]}
          rows={data.court_announcements}
          renderRow={(row, idx) => (
            <tr key={idx} className="hover:bg-zinc-50/40">
              <td className={tdBase}>{row.announcement_type}</td>
              <td className={tdBase}>{row.cause}</td>
              <td className={tdBase}>{row.parties}</td>
              <td className={tdBase}>{row.court_name}</td>
              <td className={`${tdBase} tabular-nums whitespace-nowrap`}>{row.publish_date}</td>
            </tr>
          )}
        />
      </div>
    </div>
  )
}
