"use client"

import { memo, useEffect, useState } from "react"

interface ProfileData {
  fund_name: string | null
  fund_type: string | null
  advisor: string | null
  fund_manager: string | null
  register_number: string | null
  inception_date: string | null
  operation_date: string | null
  custodian: string | null
  puton_date: string | null
  open_day: string | null
  redeemable_status: string | null
  fee_purchase: string | null
  add_amount: string | null
  fee_redeem: string | null
  risk_level: string | null
  precautious_line: string | null
  closed_period: string | null
  stop_line: string | null
  lock_period_desc: string | null
  fee_manage_rate: string | null
  fee_trust: string | null
  fee_manage: string | null
  fee_admin_service: string | null
  fee_pay: string | null
  fee_pay_formula: string | null
  updated_at: string | null
}

const PROFILE_SUB_TABS = [
  { key: "basic", label: "基础信息" },
  { key: "dividend", label: "分红拆分" },
  { key: "strategy", label: "策略变更" },
  { key: "holdings", label: "基金持仓" },
] as const

type ProfileSubTab = (typeof PROFILE_SUB_TABS)[number]["key"]

function val(v: string | null | undefined) {
  if (v == null || v === "") return "—"
  return v
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
      <span className="text-sm font-semibold text-zinc-800">{title}</span>
    </div>
  )
}

function ProfileRow({
  l1,
  v1,
  l2,
  v2,
  multiline1,
  multiline2,
}: {
  l1: string
  v1?: string | null
  l2?: string
  v2?: string | null
  multiline1?: boolean
  multiline2?: boolean
}) {
  return (
    <tr className="border-b border-zinc-100 last:border-0">
      <td className="py-2.5 px-3 text-sm text-zinc-500 bg-zinc-50/80 w-[7.5rem] whitespace-nowrap align-top">
        {l1}
      </td>
      <td
        className={[
          "py-2.5 px-4 text-sm text-zinc-800",
          multiline1 ? "whitespace-pre-wrap leading-relaxed" : "",
        ].join(" ")}
      >
        {val(v1)}
      </td>
      {l2 !== undefined && (
        <>
          <td className="py-2.5 px-3 text-sm text-zinc-500 bg-zinc-50/80 w-[7.5rem] whitespace-nowrap align-top">
            {l2}
          </td>
          <td
            className={[
              "py-2.5 px-4 text-sm text-zinc-800",
              multiline2 ? "whitespace-pre-wrap leading-relaxed" : "",
            ].join(" ")}
          >
            {val(v2)}
          </td>
        </>
      )}
    </tr>
  )
}

function BasicInfoContent({ data }: { data: ProfileData }) {
  const inceptionOp =
    data.inception_date || data.operation_date
      ? [data.inception_date, data.operation_date].map((d) => d ?? "—").join(" / ")
      : null

  return (
    <div className="space-y-5">
      <div>
        <SectionHeader title="基本信息" />
        <table className="w-full border border-zinc-100 rounded-lg overflow-hidden text-sm">
          <tbody>
            <ProfileRow l1="基金全称" v1={data.fund_name} l2="基金类型" v2={data.fund_type} />
            <ProfileRow l1="投资顾问" v1={data.advisor} l2="基金管理人" v2={data.fund_manager} />
            <ProfileRow l1="备案编号" v1={data.register_number} l2="成立日期/运作日期" v2={inceptionOp} />
            <ProfileRow l1="托管券商" v1={data.custodian} l2="备案日期" v2={data.puton_date} />
          </tbody>
        </table>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <SectionHeader title="申赎信息" />
          {data.updated_at && (
            <span className="text-xs text-zinc-400 -mt-2">最近更新: {data.updated_at}</span>
          )}
        </div>
        <table className="w-full border border-zinc-100 rounded-lg overflow-hidden text-sm">
          <tbody>
            <ProfileRow l1="开放日" v1={data.open_day} l2="是否可赎回" v2={data.redeemable_status} />
            <ProfileRow l1="申购费" v1={data.fee_purchase} l2="追加申购限制" v2={data.add_amount} />
            <ProfileRow l1="赎回费" v1={data.fee_redeem} l2="风险等级" v2={data.risk_level} />
            <ProfileRow l1="预警线" v1={data.precautious_line} l2="封闭期" v2={data.closed_period} />
            <ProfileRow l1="止损线" v1={data.stop_line} l2="锁定期说明" v2={data.lock_period_desc} />
            <ProfileRow l1="管理费率" v1={data.fee_manage_rate} l2="托管费" v2={data.fee_trust} />
            <ProfileRow l1="管理费说明" v1={data.fee_manage} l2="外包费" v2={data.fee_admin_service} multiline1 />
            <ProfileRow l1="业绩报酬说明" v1={data.fee_pay} l2="业绩报酬公式" v2={data.fee_pay_formula} multiline1 />
          </tbody>
        </table>
      </div>
    </div>
  )
}

export const FundProfilePanel = memo(function FundProfilePanel({
  beian_hao,
  fallback,
}: {
  beian_hao: string
  fallback?: {
    product_name?: string
    manager?: string
    inception_date?: string | null
  }
}) {
  const [subTab, setSubTab] = useState<ProfileSubTab>("basic")
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/profile`)
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败")
        return res.json() as Promise<ProfileData>
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

    return () => { cancelled = true }
  }, [beian_hao])

  const mergedData: ProfileData | null = data
    ? {
        ...data,
        fund_name: data.fund_name ?? fallback?.product_name ?? null,
        fund_manager: data.fund_manager ?? fallback?.manager ?? null,
        inception_date: data.inception_date ?? fallback?.inception_date ?? null,
        register_number: data.register_number ?? beian_hao,
      }
    : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PROFILE_SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setSubTab(tab.key)}
            className={[
              "inline-flex items-center px-3 py-1 rounded-full border text-sm transition-colors",
              subTab === tab.key
                ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                : "border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="min-h-[320px] flex items-center justify-center text-sm text-zinc-400">
          加载中…
        </div>
      )}

      {!loading && error && (
        <div className="min-h-[320px] flex items-center justify-center text-sm text-zinc-400">
          {error}
        </div>
      )}

      {!loading && !error && subTab === "basic" && mergedData && (
        <BasicInfoContent data={mergedData} />
      )}

      {!loading && !error && subTab !== "basic" && (
        <div className="min-h-[320px] flex items-center justify-center text-sm text-zinc-400">
          暂无内容
        </div>
      )}
    </div>
  )
})
