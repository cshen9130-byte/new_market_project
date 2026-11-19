"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  fmtBookShare,
  fmtGrossCell,
  fmtWanCell,
  fmtYuanCell,
  type PositionExposure,
  type PositionExposureRow,
} from "@/lib/ma/quant-position-exposure"

type Api = PositionExposure & { ok?: boolean; error?: string }

function tone(n: number): string {
  if (n > 0) return "text-red-600 dark:text-red-400"
  if (n < 0) return "text-emerald-600 dark:text-emerald-400"
  return "text-muted-foreground"
}

function wanTone(yuan: number): string {
  if (!Number.isFinite(yuan) || Math.abs(yuan) < 10000) return "text-muted-foreground"
  return tone(Math.round(yuan / 10000))
}

function tip(
  long: number,
  short: number,
  pnl: number | null | undefined,
  share: string,
): string | undefined {
  const long0 = Math.round(long) === 0
  const short0 = Math.round(short) === 0
  const pnl0 = pnl == null || Math.round(pnl) === 0
  if (long0 && short0 && pnl0 && share === "—") return undefined
  const parts = [`多 ${fmtYuanCell(long)} 元`, `空 ${fmtYuanCell(short)} 元`]
  if (pnl != null) parts.push(`当日盈亏 ${fmtYuanCell(pnl)}`)
  if (share !== "—") parts.push(`占该户毛敞口 ${share}`)
  return parts.join(" · ")
}

function sectorPnl(row: PositionExposureRow, key: string): number | null {
  if (row.sectorPnl == null) return null
  return row.sectorPnl[key] ?? 0
}

export function QuantPositionExposure({
  reloadToken,
  onLoadingChange,
}: {
  reloadToken: number
  onLoadingChange?: (loading: boolean) => void
}) {
  const [data, setData] = useState<Api | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<"net" | "share">("net")

  useEffect(() => {
    let cancel = false
    setLoading(true)
    onLoadingChange?.(true)
    setError(null)
    fetch("/ma/api/mom-analysis/quant-positions", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json() as Api
        if (!res.ok || json.ok === false) throw new Error(json.error || "加载失败")
        if (!cancel) setData(json)
      })
      .catch((err: unknown) => {
        if (cancel) return
        setError(err instanceof Error ? err.message : "加载失败")
      })
      .finally(() => {
        if (cancel) return
        setLoading(false)
        onLoadingChange?.(false)
      })
    return () => {
      cancel = true
    }
  }, [reloadToken, onLoadingChange])

  if (loading && !data) {
    return <p className="text-sm text-muted-foreground py-8 text-center">正在读取最近一个交易日的持仓…</p>
  }
  if (error && !data) return <p className="text-sm text-destructive">{error}</p>
  if (!data?.date) {
    return <p className="text-sm text-muted-foreground">{data?.footnotes?.[0] || "核算表里还没有量化账户持仓。"}</p>
  }

  const sectors = data.sectors ?? []
  return (
    <div className={`space-y-4 ${loading ? "opacity-60" : ""}`}>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">量化组合持仓方向暴露</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
            {data.date} · {data.rows.length} 户 ·{" "}
            {mode === "net"
              ? "净暴露 = 多头市值 − 空头市值，单位万元。当日盈亏单位元。"
              : "敞口占比 = 该板块净暴露 ÷ 该户毛敞口。方向和净暴露相同，只是换成占本户的百分比，账户大不再把格子撑大。净方向、毛敞口、当日盈亏仍是金额。"}
            红字为净多或盈利，绿字为净空或亏损。
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={mode === "net" ? "default" : "outline"} onClick={() => setMode("net")}>
            净暴露
          </Button>
          <Button size="sm" variant={mode === "share" ? "default" : "outline"} onClick={() => setMode("share")}>
            敞口占比
          </Button>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">这一天没有持仓超过 1 万元的量化账户。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1100px] text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-muted-foreground">
                <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">账户</th>
                <th className="px-2 py-2 text-left font-medium">投顾</th>
                {sectors.map((sector) => (
                  <th key={sector.key} className="px-2 py-2 text-right font-medium whitespace-nowrap">{sector.label}</th>
                ))}
                <th className="px-2 py-2 text-right font-medium whitespace-nowrap">净方向</th>
                <th className="px-2 py-2 text-right font-medium whitespace-nowrap">毛敞口</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">当日盈亏</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="sticky left-0 z-10 bg-background px-3 py-1.5 font-medium whitespace-nowrap">{row.label}</td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{row.advisor || "—"}</td>
                  {sectors.map((sector) => {
                    const net = row.nets[sector.key] ?? 0
                    const shareText = fmtBookShare(net, row.gross)
                    return (
                      <td
                        key={sector.key}
                        title={tip(row.longs[sector.key] ?? 0, row.shorts[sector.key] ?? 0, sectorPnl(row, sector.key), shareText)}
                        className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${wanTone(net)}`}
                      >
                        {mode === "share" ? shareText : fmtWanCell(net)}
                      </td>
                    )
                  })}
                  <td className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${wanTone(row.net)}`}>{fmtWanCell(row.net)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtGrossCell(row.gross)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${tone(row.dailyPnl ?? 0)}`}>
                    {fmtYuanCell(row.dailyPnl)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 bg-muted font-medium">
                <td className="sticky left-0 z-10 bg-muted px-3 py-2 whitespace-nowrap">组合合计</td>
                <td className="px-2 py-2 text-muted-foreground">—</td>
                {sectors.map((sector) => {
                  const net = data.total.nets[sector.key] ?? 0
                  return (
                    <td key={sector.key} className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${wanTone(net)}`}>
                      {mode === "share" ? fmtBookShare(net, data.total.gross) : fmtWanCell(net)}
                    </td>
                  )
                })}
                <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${wanTone(data.total.net)}`}>{fmtWanCell(data.total.net)}</td>
                <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtGrossCell(data.total.gross)}</td>
                <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${tone(data.total.dailyPnl ?? 0)}`}>
                  {fmtYuanCell(data.total.dailyPnl)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {data.footnotes.length > 0 && (
        <div className="space-y-1 text-xs text-muted-foreground leading-relaxed">
          {data.footnotes.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">重点关注：与组合方向明显相悖的子账户</h3>
        {data.conflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有净暴露超过 100 万、且方向与组合相反的子账户。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">账户</th>
                  <th className="px-2 py-2 text-left font-medium">板块</th>
                  <th className="px-2 py-2 text-right font-medium">该户净暴露</th>
                  <th className="px-2 py-2 text-right font-medium">组合净暴露</th>
                  <th className="px-3 py-2 text-right font-medium">当日该板块盈亏</th>
                </tr>
              </thead>
              <tbody>
                {data.conflicts.map((row) => (
                  <tr key={`${row.account}-${row.sector}`} className="border-b border-border/60">
                    <td className="px-3 py-1.5 whitespace-nowrap" title={row.advisor ?? undefined}>{row.label}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{row.sectorLabel}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${wanTone(row.accountNet)}`}>{fmtWanCell(row.accountNet)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${wanTone(row.bookNet)}`}>{fmtWanCell(row.bookNet)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${tone(row.sectorPnl ?? 0)}`}>{fmtYuanCell(row.sectorPnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.bullets.length > 0 && (
        <ul className="space-y-1.5 text-sm leading-relaxed list-disc pl-5">
          {data.bullets.map((item) => (
            <li key={item.title}>
              <span className="font-medium">{item.title}：</span>
              {item.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
