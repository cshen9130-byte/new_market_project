"use client"

import { useEffect, useState } from "react"
import { authService } from "@/lib/auth"

type LoginHistoryRow = {
  id: number
  logged_at: string
  success: boolean
  user_id: string | null
  name: string | null
  email: string | null
  identifier: string
  ip: string | null
  user_agent: string | null
  fail_reason: string | null
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function accountLabel(row: LoginHistoryRow) {
  return row.name || row.email || row.identifier || "—"
}

export function LoginHistoryPanel() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [days, setDays] = useState(7)
  const [rows, setRows] = useState<LoginHistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(nextDays = days) {
    const current = authService.getCurrentUser()
    if (!current || current.role !== "admin") return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/login-history?days=${nextDays}&limit=200`, {
        headers: { "x-market-user-id": current.id },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || "加载失败")
      setRows(Array.isArray(json.rows) ? json.rows : [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function init() {
      const current = await authService.refreshCurrentUser()
      if (cancelled) return
      const admin = current?.role === "admin"
      setIsAdmin(!!admin)
      setAuthChecked(true)
      if (admin) await load(7)
    }
    void init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!authChecked) {
    return <div className="text-sm text-muted-foreground py-10 text-center">加载中…</div>
  }

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
        仅系统管理员可查看登录历史
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">登录历史</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            记录每次账号密码登录，含成功与失败。从此功能上线后开始保存。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[1, 7, 30].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setDays(n)
                void load(n)
              }}
              className={[
                "px-3 py-1.5 text-xs border rounded transition-colors",
                days === n
                  ? "border-red-500 text-red-500 bg-red-50/40 dark:bg-red-950/20"
                  : "border-border text-zinc-600 dark:text-zinc-400 hover:border-zinc-400",
              ].join(" ")}
            >
              {n === 1 ? "今天" : `${n}天`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load(days)}
            className="px-3 py-1.5 text-xs border border-border rounded text-zinc-600 dark:text-zinc-400 hover:border-zinc-400"
          >
            刷新
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-500 mb-4">{error}</div>}

      {loading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">加载中…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
          这段时间内还没有登录记录
        </div>
      ) : (
        <div className="overflow-auto rounded border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-44">时间</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">账号</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">登录名</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">IP</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-20">结果</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{fmtTime(row.logged_at)}</td>
                  <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-200">{accountLabel(row)}</td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono text-xs">{row.identifier || "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono text-xs">{row.ip || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={row.success ? "text-emerald-600" : "text-red-500"}>
                      {row.success ? "成功" : "失败"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
