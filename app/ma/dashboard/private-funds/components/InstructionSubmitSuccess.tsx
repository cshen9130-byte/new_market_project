"use client"

import { CircleCheck } from "lucide-react"
import type { InstructionRecord } from "./instructions-store"

export function InstructionSubmitSuccess({
  record,
  onContinue,
}: {
  record: InstructionRecord
  onContinue: () => void
}) {
  const rows: { label: string; value: string }[] =
    record.category === "direct"
      ? [
          { label: "指令ID", value: record.id },
          { label: "投资者名称", value: record.fofFundName },
          { label: "基金名称", value: record.underlyingFundName },
          { label: "指令类型", value: record.type },
          { label: "申请金额", value: record.amount },
          { label: "交易申请日期", value: record.applyDate },
        ]
      : [
          { label: "指令ID", value: record.id },
          { label: "FOF基金", value: record.fofFundName },
          { label: "底层基金", value: record.underlyingFundName },
          { label: "指令类型", value: record.type },
          { label: "申请金额", value: record.amount },
          { label: "交易申请日期", value: record.applyDate },
        ]

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 py-16">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
        <CircleCheck className="h-10 w-10" strokeWidth={2.2} />
      </div>
      <h2 className="mt-5 text-xl font-semibold text-foreground">提交成功</h2>
      <dl className="mt-8 w-full max-w-md space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[7.5rem_1fr] items-start gap-3">
            <dt className="text-right text-zinc-400">{row.label}</dt>
            <dd className="text-left text-zinc-800 dark:text-zinc-100">{row.value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={onContinue}
        className="mt-10 h-10 min-w-[120px] rounded bg-red-500 px-8 text-sm font-medium text-white hover:bg-red-600"
      >
        继续发起
      </button>
    </div>
  )
}
