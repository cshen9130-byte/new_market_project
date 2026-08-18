"use client"

import { formatTemporaryOpen } from "@/lib/ma/fund-elements-extra"

export type ProductElementsData = Record<string, string | null | undefined>

function display(v: string | null | undefined) {
  if (v == null || String(v).trim() === "") return "—"
  return v
}

function Row2({
  l1,
  v1,
  l2,
  v2,
  multiline,
}: {
  l1: string
  v1?: string | null
  l2?: string
  v2?: string | null
  multiline?: boolean
}) {
  const labelClass = [
    "py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap",
    multiline ? "align-top" : "",
  ].join(" ")
  const valueClass = [
    "py-2 px-4 text-sm text-foreground",
    multiline ? "whitespace-pre-wrap leading-relaxed align-top" : "",
  ].join(" ")
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className={labelClass}>{l1}</td>
      <td className={valueClass}>{display(v1)}</td>
      {l2 !== undefined && (
        <>
          <td className={labelClass}>{l2}</td>
          <td className={valueClass}>{display(v2)}</td>
        </>
      )}
    </tr>
  )
}

function FullRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap align-top">
        {label}
      </td>
      <td className="py-2 px-4 text-sm text-foreground whitespace-pre-wrap leading-relaxed" colSpan={3}>
        {display(value)}
      </td>
    </tr>
  )
}

export function ProductElementsDialogContent({ data }: { data: ProductElementsData }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
        <span className="text-sm font-semibold">基本信息</span>
      </div>
      <table className="w-full border border-border rounded-lg overflow-hidden mb-5 text-sm">
        <tbody>
          <Row2 l1="产品全称" v1={data.fund_name} l2="备案编号" v2={data.register_number} />
          <Row2 l1="投资顾问" v1={data.advisor} l2="基金管理人" v2={data.fund_manager} />
          <Row2 l1="成立日期" v1={data.inception_date} l2="备案日期" v2={data.puton_date} />
          <FullRow label="托管券商" value={data.custodian} />
        </tbody>
      </table>

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
          <span className="text-sm font-semibold">申赎信息</span>
        </div>
        {data.updated_at ? (
          <span className="text-xs text-muted-foreground">最近更新: {data.updated_at}</span>
        ) : null}
      </div>
      <table className="w-full border border-border rounded-lg overflow-hidden text-sm">
        <tbody>
          <Row2 l1="开放日" v1={data.open_day} l2="是否可临开" v2={formatTemporaryOpen(data.is_temporary_open) ?? data.is_temporary_open} />
          <Row2 l1="申购费" v1={data.fee_purchase} l2="追加限制" v2={data.add_amount} />
          <Row2 l1="赎回费" v1={data.fee_redeem} l2="风险等级" v2={data.risk_level} multiline />
          <Row2 l1="预警线" v1={data.precautious_line} l2="封闭期" v2={data.closed_period} />
          <Row2 l1="平仓线" v1={data.stop_line} l2="锁定期说明" v2={data.lock_period_desc} multiline />
          <Row2 l1="管理费率" v1={data.fee_manage_rate} l2="托管费" v2={data.fee_trust} />
          <Row2 l1="管理费说明" v1={data.fee_manage} l2="外包费" v2={data.fee_admin_service} multiline />
          <FullRow label="业绩报酬说明" value={data.fee_pay} />
          <FullRow label="业绩报酬公式" value={data.fee_pay_formula} />
        </tbody>
      </table>
    </>
  )
}
