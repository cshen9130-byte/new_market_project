"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { BadgeCheck, UserRound } from "lucide-react"

interface ManagerExecutive {
  name: string
  roles: string[]
  has_fund_qualification: boolean
  qualification_note: string
}

interface WorkHistoryEntry {
  period: string
  employer: string
  department: string
  position: string
}

interface FundManagerProfile {
  name: string
  bio: string | null
}

interface ManagerTeamData {
  executives: ManagerExecutive[]
  legal_rep_name: string | null
  work_history: WorkHistoryEntry[]
  team_members: string | null
  fund_managers: FundManagerProfile[]
}

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-4">
        <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
        {title}
      </div>
      {children}
    </div>
  )
}

function ExecutiveCard({ executive }: { executive: ManagerExecutive }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50/40 px-4 py-4 min-w-0 flex-1">
      <div className="flex items-start gap-3 mb-3">
        <div className="h-10 w-10 rounded-full bg-zinc-200 flex items-center justify-center shrink-0">
          <UserRound className="h-5 w-5 text-zinc-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-zinc-900">{executive.name}</span>
            {executive.has_fund_qualification && (
              <BadgeCheck className="h-4 w-4 text-sky-500 shrink-0" aria-label="具有基金从业资格" />
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{executive.roles.join(" ")}</p>
        </div>
      </div>
      {executive.has_fund_qualification && (
        <div className="flex items-center gap-2 text-xs text-zinc-500 pl-[52px]">
          <span className="inline-block h-2 w-2 rounded-full bg-orange-400 shrink-0" />
          <span>
            具有基金从业资格 — {executive.qualification_note}
          </span>
        </div>
      )}
    </div>
  )
}

export function ManagerTeamPanel({ registrationNo }: { registrationNo: string }) {
  const [data, setData] = useState<ManagerTeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/ma/api/private-fund-managers/${encodeURIComponent(registrationNo)}/team`)
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败")
        return res.json() as Promise<ManagerTeamData>
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

  if (loading) {
    return (
      <div className="space-y-4 w-full animate-pulse">
        <div className="h-36 rounded-lg bg-zinc-100" />
        <div className="h-64 rounded-lg bg-zinc-100" />
        <div className="h-24 rounded-lg bg-zinc-100" />
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
      <SectionBlock title="高管信息">
        {data.executives.length > 0 ? (
          <div className="flex flex-col lg:flex-row gap-4 w-full">
            {data.executives.map((exec) => (
              <ExecutiveCard key={exec.name} executive={exec} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">暂无内容</p>
        )}
      </SectionBlock>

      <SectionBlock title="法人代表（委派代表）工作履历">
        {data.legal_rep_name && (
          <p className="text-sm font-medium text-zinc-800 mb-4">{data.legal_rep_name}</p>
        )}
        {data.work_history.length > 0 ? (
          <div className="w-full overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[minmax(7rem,0.9fr)_minmax(10rem,1.4fr)_minmax(10rem,1.4fr)_minmax(10rem,1.2fr)] gap-x-4 px-3 py-2 text-xs text-zinc-400 border-b border-zinc-100">
                <span>时间</span>
                <span>任职单位</span>
                <span>任职部门</span>
                <span>职位</span>
              </div>
              {data.work_history.map((row, idx) => (
                <div
                  key={`${row.period}-${idx}`}
                  className={[
                    "grid grid-cols-[minmax(7rem,0.9fr)_minmax(10rem,1.4fr)_minmax(10rem,1.4fr)_minmax(10rem,1.2fr)] gap-x-4 px-3 py-3 text-xs text-zinc-700 border-b border-zinc-50 last:border-b-0",
                    idx % 2 === 1 ? "bg-zinc-50/60" : "bg-white",
                  ].join(" ")}
                >
                  <span className="tabular-nums whitespace-nowrap">{row.period}</span>
                  <span>{row.employer}</span>
                  <span>{row.department}</span>
                  <span>{row.position}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">暂无内容</p>
        )}
      </SectionBlock>

      <SectionBlock title="团队成员">
        <p className="text-sm text-zinc-400">
          {data.team_members?.trim() ? data.team_members : "暂无内容"}
        </p>
      </SectionBlock>

      <SectionBlock title="基金经理">
        {data.fund_managers.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
            {data.fund_managers.map((mgr) => (
              <div
                key={mgr.name}
                className="rounded-lg border border-zinc-100 bg-white px-4 py-4 min-h-[120px] flex flex-col"
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-zinc-100 flex items-center justify-center shrink-0">
                      <UserRound className="h-4 w-4 text-zinc-500" />
                    </div>
                    <span className="text-sm font-medium text-zinc-800 truncate">{mgr.name}</span>
                  </div>
                  <Link
                    href={`/ma/dashboard/private-funds?tab=funds&side=fund-managers&keyword=${encodeURIComponent(mgr.name)}`}
                    className="text-xs text-blue-600 hover:underline shrink-0"
                  >
                    查看详情
                  </Link>
                </div>
                <p className="text-sm text-zinc-400 text-center flex-1 flex items-center justify-center">
                  {mgr.bio?.trim() ? mgr.bio : "-暂无简介-"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">暂无内容</p>
        )}
      </SectionBlock>
    </div>
  )
}
