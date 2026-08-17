"use client"

import { useEffect, useState, type ReactNode } from "react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { TrendHoverChart } from "@/components/ma/trend-hover-chart"

type ProfileData = {
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

function display(v: string | null | undefined): string {
  if (v == null || v === "") return "—"
  return v
}

function InfoRow({
  items,
}: {
  items: Array<{ label: string; value: string | null | undefined }>
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <div className="text-[11px] text-zinc-400">{item.label}</div>
          <div className="truncate text-xs text-zinc-800" title={display(item.value)}>
            {display(item.value)}
          </div>
        </div>
      ))}
    </div>
  )
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
      <span className="text-xs font-semibold text-zinc-800">{title}</span>
    </div>
  )
}

function ProductHoverBody({
  beian_hao,
  productName,
}: {
  beian_hao: string
  productName: string
}) {
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setProfile(null)
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/profile`)
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败")
        return res.json()
      })
      .then((data: ProfileData) => {
        if (cancelled) return
        setProfile(data)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "加载失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [beian_hao])

  const title = profile?.fund_name?.trim() || productName || beian_hao
  const inceptionOp =
    profile?.inception_date || profile?.operation_date
      ? [profile?.inception_date, profile?.operation_date].map((d) => d ?? "—").join(" / ")
      : null

  return (
    <div className="max-h-[min(70vh,560px)] w-[360px] overflow-auto">
      <div className="border-b border-zinc-100 px-3 py-2">
        <div className="truncate text-sm font-semibold text-zinc-800" title={title}>
          {title}
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-400">{beian_hao}</div>
      </div>

      <div className="border-b border-zinc-100">
        <div className="px-3 pt-2 text-xs font-semibold text-zinc-700">净值走势</div>
        <TrendHoverChart beian_hao={beian_hao} mode="nav" days={365} />
      </div>

      <div className="space-y-4 px-3 py-3">
        {loading ? (
          <div className="py-6 text-center text-xs text-zinc-400">加载基金档案…</div>
        ) : error ? (
          <div className="py-6 text-center text-xs text-zinc-400">{error}</div>
        ) : profile ? (
          <>
            <div>
              <SectionTitle title="基本信息" />
              <InfoRow
                items={[
                  { label: "基金类型", value: profile.fund_type },
                  { label: "备案编号", value: profile.register_number || beian_hao },
                  { label: "投资顾问", value: profile.advisor },
                  { label: "基金管理人", value: profile.fund_manager },
                  { label: "托管券商", value: profile.custodian },
                  { label: "成立/运作日期", value: inceptionOp },
                  { label: "备案日期", value: profile.puton_date },
                ]}
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <SectionTitle title="申赎信息" />
                {profile.updated_at ? (
                  <span className="mb-2 shrink-0 text-[10px] text-zinc-400">
                    更新 {profile.updated_at}
                  </span>
                ) : null}
              </div>
              <InfoRow
                items={[
                  { label: "开放日", value: profile.open_day },
                  { label: "是否可赎回", value: profile.redeemable_status },
                  { label: "申购费", value: profile.fee_purchase },
                  { label: "赎回费", value: profile.fee_redeem },
                  { label: "追加申购限制", value: profile.add_amount },
                  { label: "封闭期", value: profile.closed_period },
                  { label: "预警线", value: profile.precautious_line },
                  { label: "止损线", value: profile.stop_line },
                  { label: "风险等级", value: profile.risk_level },
                  { label: "管理费率", value: profile.fee_manage_rate },
                  { label: "托管费", value: profile.fee_trust },
                  { label: "锁定期说明", value: profile.lock_period_desc },
                  { label: "管理费说明", value: profile.fee_manage },
                  { label: "外包费", value: profile.fee_admin_service },
                  { label: "业绩报酬说明", value: profile.fee_pay },
                  { label: "业绩报酬公式", value: profile.fee_pay_formula },
                ]}
              />
            </div>
          </>
        ) : (
          <div className="py-6 text-center text-xs text-zinc-400">暂无档案信息</div>
        )}
      </div>
    </div>
  )
}

export function AssociatedProductHoverCard({
  beian_hao,
  productName,
  children,
}: {
  beian_hao: string
  productName: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={250} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-auto border border-zinc-200 bg-white p-0 shadow-xl"
      >
        {open ? (
          <ProductHoverBody beian_hao={beian_hao} productName={productName} />
        ) : null}
      </HoverCardContent>
    </HoverCard>
  )
}
