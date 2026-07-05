"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import ReactECharts from "echarts-for-react"
import { ArrowLeft } from "lucide-react"
import { FundDatabaseShell } from "@/components/ma/fund-database-shell"
import { amacManagerUrl } from "@/lib/amac-urls"
import { ManagerTeamPanel } from "./components/ManagerTeamPanel"
import { ManagerFundsPanel } from "./components/ManagerFundsPanel"
import { ManagerHoldingsPanel } from "./components/ManagerHoldingsPanel"
import { ManagerEnterprisePanel } from "./components/ManagerEnterprisePanel"
import { ManagerRiskPanel } from "./components/ManagerRiskPanel"
import { ManagerNewsPanel } from "./components/ManagerNewsPanel"
import { ManagerScorecardPanel } from "./components/ManagerScorecardPanel"

const MANAGER_TABS = [
  { key: "overview", label: "公司概况" },
  { key: "team", label: "团队信息" },
  { key: "funds", label: "旗下基金" },
  { key: "holdings", label: "基金持股" },
  { key: "enterprise", label: "企业信息" },
  { key: "risk", label: "风险扫描" },
  { key: "news", label: "管理人资讯" },
  { key: "scorecard", label: "评分表" },
  { key: "materials", label: "相关资料" },
] as const

type ManagerTab = (typeof MANAGER_TABS)[number]["key"]

interface ScaleTrendPoint {
  period: string
  active_product_count: number
  mgmt_scale: string | null
  mgmt_scale_value: number | null
}

interface ManagerDetail {
  manager_name: string
  display_name: string
  core_strategy: string | null
  mgmt_scale: string | null
  active_product_count: number | null
  inception_date: string | null
  member_type: string | null
  registration_no: string
  actual_controller: string | null
  full_time_employees: number | null
  fund_qualified_employees: number | null
  company_intro: string | null
  investment_philosophy: string | null
  investment_strategy: string | null
  scale_trend: ScaleTrendPoint[]
}

function fmtCell(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—"
  return value
}

function StatCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <span className="text-xs text-zinc-400 whitespace-nowrap">{label}</span>
      <div className="text-sm font-medium text-zinc-800 truncate">{children}</div>
    </div>
  )
}

function TextSection({ title, content }: { title: string; content: string | null }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-3">
        <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
        {title}
      </div>
      <p className="text-sm text-zinc-500 leading-relaxed">
        {content?.trim() ? content : "暂无内容"}
      </p>
    </div>
  )
}

function buildScaleChartOption(trend: ScaleTrendPoint[]): Record<string, unknown> {
  const periods = trend.map((p) => p.period)
  const productCounts = trend.map((p) => p.active_product_count)
  const scaleValues = trend.map((p) => p.mgmt_scale_value)

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      top: 0,
      left: 0,
      textStyle: { fontSize: 11, color: "#52525b" },
      itemWidth: 10,
      itemHeight: 10,
      data: ["管理规模(协会披露)", "运作中产品数"],
    },
    grid: { left: 56, right: 56, top: 48, bottom: 40, containLabel: true },
    xAxis: {
      type: "category",
      data: periods,
      axisLabel: { fontSize: 11, color: "#a1a1aa", interval: Math.max(0, Math.floor(periods.length / 8)) },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: "value",
        name: "管理规模(亿元)",
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: { fontSize: 11, color: "#a1a1aa" },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
      },
      {
        type: "value",
        name: "运作中产品数",
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: { fontSize: 11, color: "#a1a1aa" },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "管理规模(协会披露)",
        type: "line",
        yAxisIndex: 0,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#ef4444" },
        itemStyle: { color: "#ef4444" },
        data: scaleValues,
      },
      {
        name: "运作中产品数",
        type: "bar",
        yAxisIndex: 1,
        barMaxWidth: 18,
        itemStyle: { color: "#3b82f6" },
        data: productCounts,
      },
    ],
  }
}

export default function PrivateFundManagerDetailPage() {
  const params = useParams()
  const router = useRouter()
  const registrationNo =
    typeof params.registration_no === "string" ? decodeURIComponent(params.registration_no) : ""

  const [data, setData] = useState<ManagerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ManagerTab>("overview")

  useEffect(() => {
    if (!registrationNo) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/ma/api/private-fund-managers/${encodeURIComponent(registrationNo)}`)
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error === "Manager not found" ? "未找到该管理人" : "加载失败")
        }
        return res.json() as Promise<ManagerDetail>
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

  const navigate = useCallback(
    (tab: string, side?: string) => {
      if (tab === "funds" && side === "fund-managers-org") return
      const sideItem = side ?? "private-funds"
      router.push(`/ma/dashboard/private-funds?tab=${tab}&side=${sideItem}`)
    },
    [router],
  )

  const chartOption = useMemo(
    () => (data?.scale_trend?.length ? buildScaleChartOption(data.scale_trend) : null),
    [data?.scale_trend],
  )
  const chartRef = useRef<ReactECharts>(null)

  useEffect(() => {
    if (!chartOption) return
    const resize = () => chartRef.current?.getEchartsInstance()?.resize()
    resize()
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [chartOption])

  const backHref = "/ma/dashboard/private-funds?tab=funds&side=fund-managers-org"

  return (
    <FundDatabaseShell activeSideItem="fund-managers-org" onNavigate={navigate}>
      <div className="w-full min-w-0">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 mb-4 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回管理人列表
        </Link>

        {loading ? (
          <div className="space-y-4 animate-pulse w-full">
            <div className="h-8 w-40 rounded bg-zinc-100" />
            <div className="grid grid-cols-7 gap-4">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="h-14 rounded bg-zinc-100" />
              ))}
            </div>
            <div className="h-[420px] rounded-xl bg-zinc-100 w-full" />
          </div>
        ) : error || !data ? (
          <div className="flex items-center justify-center h-40 text-red-500 text-sm">
            加载失败：{error ?? "未知错误"}
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-zinc-100 bg-white px-5 py-5 mb-4 w-full">
              <h1 className="text-xl font-bold text-zinc-900 mb-5">{data.display_name}</h1>
              <div className="flex flex-wrap lg:flex-nowrap w-full gap-x-6 xl:gap-x-10 gap-y-4">
                <StatCell label="实际控制人">{fmtCell(data.actual_controller)}</StatCell>
                <StatCell label="管理规模">{fmtCell(data.mgmt_scale)}</StatCell>
                <StatCell label="登记编号">
                  <a
                    href={amacManagerUrl(data.registration_no)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {data.registration_no}
                  </a>
                </StatCell>
                <StatCell label="成立日期">{fmtCell(data.inception_date?.slice(0, 10))}</StatCell>
                <StatCell label="运作中产品">
                  {data.active_product_count != null ? `${data.active_product_count}只` : "—"}
                </StatCell>
                <StatCell label="全职员工人数">{fmtCell(data.full_time_employees)}</StatCell>
                <StatCell label="取得基金从业人数">{fmtCell(data.fund_qualified_employees)}</StatCell>
              </div>
            </div>

            <div className="border-b border-zinc-200 mb-4 w-full">
              <nav className="flex items-center gap-0 overflow-x-auto w-full">
                {MANAGER_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={[
                      "relative px-5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none shrink-0",
                      activeTab === tab.key
                        ? "text-red-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-red-500"
                        : "text-zinc-500 hover:text-zinc-800",
                    ].join(" ")}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            {activeTab === "overview" && (
              <div className="space-y-4 w-full">
                <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-3">
                    <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
                    管理规模
                  </div>
                  {chartOption ? (
                    <div className="w-full min-w-0">
                      <ReactECharts
                        ref={chartRef}
                        option={chartOption}
                        style={{ height: 420, width: "100%" }}
                        className="!w-full"
                        notMerge
                        lazyUpdate
                      />
                    </div>
                  ) : (
                    <div className="h-[420px] flex items-center justify-center text-sm text-zinc-400 w-full">
                      暂无规模走势数据
                    </div>
                  )}
                </div>
                <TextSection title="公司简介" content={data.company_intro} />
                <TextSection title="投资理念" content={data.investment_philosophy} />
                <TextSection title="投资策略" content={data.investment_strategy} />
              </div>
            )}

            {activeTab === "team" && (
              <ManagerTeamPanel registrationNo={registrationNo} />
            )}

            {activeTab === "funds" && (
              <ManagerFundsPanel registrationNo={registrationNo} />
            )}

            {activeTab === "holdings" && (
              <ManagerHoldingsPanel registrationNo={registrationNo} />
            )}

            {activeTab === "enterprise" && (
              <ManagerEnterprisePanel registrationNo={registrationNo} />
            )}

            {activeTab === "risk" && (
              <ManagerRiskPanel registrationNo={registrationNo} />
            )}

            {activeTab === "news" && (
              <ManagerNewsPanel registrationNo={registrationNo} />
            )}

            {activeTab === "scorecard" && (
              <ManagerScorecardPanel registrationNo={registrationNo} />
            )}

            {activeTab !== "overview" && activeTab !== "team" && activeTab !== "funds" && activeTab !== "holdings" && activeTab !== "enterprise" && activeTab !== "risk" && activeTab !== "news" && activeTab !== "scorecard" && (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm rounded-lg border border-zinc-100 bg-white w-full">
                该功能正在建设中，敬请期待
              </div>
            )}
          </>
        )}
      </div>
    </FundDatabaseShell>
  )
}
