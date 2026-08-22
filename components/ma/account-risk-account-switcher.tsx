"use client"

import { useEffect, useState } from "react"
import { setActiveCfmmcAccount } from "@/lib/ma/risk-report-source"

const STORAGE_KEY = "account-risk-cfmmc-account"

export type CfmmcAccountOption = {
  accountNo: string
  label: string
  clientName: string | null
  toDate: string | null
  imported: boolean
  linked: boolean
  kind?: "account" | "book"
  source?: "upload" | "email" | "cfmmc"
  cfmmcUserId?: string | null
}

const SOURCE_GROUPS: { source: NonNullable<CfmmcAccountOption["source"]>; label: string }[] = [
  { source: "upload", label: "拖入文件" },
  { source: "email", label: "邮箱获取" },
  { source: "cfmmc", label: "监控中心" },
]

function optionLabel(a: CfmmcAccountOption) {
  if (a.source === "cfmmc") return a.label.replace(/^监控中心\s+/, "")
  if (a.source === "email") return a.label.replace(/^邮箱\s*/, "")
  return a.label
}

export type CfmmcAccountScope = {
  accounts: CfmmcAccountOption[]
  selected: string
  onChange: (value: string) => void
}

/** Idle scope for the MOM report so it never mounts the CFMMC account hook. */
export const IDLE_CFMMC_SCOPE: CfmmcAccountScope = {
  accounts: [],
  selected: "",
  onChange: () => {},
}

export function useCfmmcAccountScope(): CfmmcAccountScope {
  const [accounts, setAccounts] = useState<CfmmcAccountOption[]>([])
  const [selected, setSelected] = useState("")

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY) ?? ""
    const ac = new AbortController()
    fetch("/ma/api/account-risk/accounts", { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        const rows = (j.accounts ?? []) as CfmmcAccountOption[]
        setAccounts(rows)
        const imported = rows.filter((a) => a.imported)
        const namedBooks = imported.filter((a) => a.kind === "book")
        const next = saved && (saved === "all" || rows.some((a) => a.accountNo === saved))
          ? saved
          : namedBooks.length === 1
            ? namedBooks[0].accountNo
            : namedBooks.length > 1
              ? "all"
              : imported.length === 1
                ? imported[0].accountNo
                : imported.length > 1
                  ? "all"
                  : rows[0]?.accountNo ?? ""
        setSelected(next)
        setActiveCfmmcAccount(next === "all" ? "" : next)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  const onChange = (value: string) => {
    setSelected(value)
    setActiveCfmmcAccount(value === "all" ? "" : value)
    try { sessionStorage.setItem(STORAGE_KEY, value) } catch { /* ignore */ }
  }

  return { accounts, selected, onChange }
}

export function AccountRiskAccountSwitcher({
  accounts,
  selected,
  onChange,
  compact = false,
}: {
  accounts: CfmmcAccountOption[]
  selected: string
  onChange: (value: string) => void
  compact?: boolean
}) {
  if (accounts.length === 0) return null
  const current = accounts.find((a) => a.accountNo === selected)
  return (
    <label className={compact ? "flex items-center gap-2 min-w-0" : "flex flex-col gap-1 min-w-0"}>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium truncate focus:outline-none focus:ring-1 focus:ring-ring"
        title={current ? `${current.label} ${current.accountNo}` : "全部账户"}
      >
        {accounts.length > 1 && <option value="all">全部账户（汇总）</option>}
        {SOURCE_GROUPS.map((g) => {
          const rows = accounts.filter((a) => (a.source ?? "upload") === g.source)
          if (rows.length === 0) return null
          return (
            <optgroup key={g.source} label={g.label}>
              {rows.map((a) => (
                <option key={a.accountNo} value={a.accountNo}>
                  {optionLabel(a)}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>
    </label>
  )
}
