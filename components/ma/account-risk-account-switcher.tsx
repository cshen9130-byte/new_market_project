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
      <span className="text-[10px] text-muted-foreground shrink-0">账户</span>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium truncate focus:outline-none focus:ring-1 focus:ring-ring"
        title={current ? `${current.label} ${current.accountNo}` : "全部账户"}
      >
        {accounts.length > 1 && <option value="all">全部账户（汇总）</option>}
        {accounts.some((a) => a.kind === "book") && (
          <optgroup label="命名账户">
            {accounts.filter((a) => a.kind === "book").map((a) => (
              <option key={a.accountNo} value={a.accountNo} disabled={!a.imported}>
                {a.label}{a.imported ? "" : "（未导入）"}
              </option>
            ))}
          </optgroup>
        )}
        {accounts.some((a) => a.kind !== "book") && (
          <optgroup label="资金账号">
            {accounts.filter((a) => a.kind !== "book").map((a) => (
              <option key={a.accountNo} value={a.accountNo} disabled={!a.imported}>
                {`${a.label}${a.label !== a.accountNo ? ` · ${a.accountNo}` : ""}`}
                {a.imported ? "" : "（未导入）"}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  )
}
