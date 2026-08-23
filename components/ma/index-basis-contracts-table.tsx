"use client"

import { useMemo } from "react"

import {
  HelpAnnualizedDiscount,
  HelpBasisPoints,
  HelpTodayClose,
} from "@/components/ma/realtime-chart-help"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  CFFEX_CONTRACT_ROLES,
  annualizedBasisPct,
  basisPoints,
  calendarDaysToCffexExpiry,
  cffexContractForRole,
  cffexExpiryYmd,
  listedCffexIndexContracts,
  parseIndexFuturesMonth,
  type CffexContractRole,
} from "@/lib/client/cffex-expiry"
import { INDEX_FUTURES, type CtpTick, type IndexProduct } from "@/lib/client/ctp-market"
import type { SpotSnapshot } from "@/lib/client/realtime-overlay"
import { cn } from "@/lib/utils"

type Props = {
  quotes: Record<string, CtpTick>
  listedQuotes: Record<string, CtpTick>
  asOf: string | null
  spots: Record<string, SpotSnapshot>
  selectedRole: CffexContractRole
  onSelectRole: (role: CffexContractRole) => void
}

function fmtPrice(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "--"
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtInt(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "--"
  return Math.round(n).toLocaleString("zh-CN")
}

function contractName(product: IndexProduct, symbol: string) {
  const meta = INDEX_FUTURES.find((item) => item.product === product)
  const yymm = symbol.slice(-4)
  return `${meta?.name || product}股指${yymm}`
}

function roleOfSymbol(symbol: string): CffexContractRole | null {
  const parsed = parseIndexFuturesMonth(symbol)
  if (!parsed) return null
  const listed = listedCffexIndexContracts(parsed.product)
  const index = listed.indexOf(symbol)
  return CFFEX_CONTRACT_ROLES.find((role) => role.index === index)?.id ?? null
}

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function weekdayLabel(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number)
  const names = ["日", "一", "二", "三", "四", "五", "六"]
  return names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

export function IndexBasisContractsTable({
  quotes,
  listedQuotes,
  asOf,
  spots,
  selectedRole,
  onSelectRole,
}: Props) {
  const mergedQuotes = useMemo(() => {
    const next = { ...listedQuotes }
    for (const [symbol, quote] of Object.entries(quotes)) {
      if (quote.last == null && quote.open_interest == null && quote.pre_close == null) continue
      next[symbol] = { ...next[symbol], ...quote }
    }
    return next
  }, [listedQuotes, quotes])

  const rows = INDEX_FUTURES.flatMap((item) =>
    listedCffexIndexContracts(item.product).map((symbol) => {
      const quote = mergedQuotes[symbol]
      const close = quote?.last ?? null
      const spot = spots[item.product]
      const spotPx = spot?.price ?? null
      const daysRaw = calendarDaysToCffexExpiry(symbol)
      const days = daysRaw == null ? null : Math.max(0, daysRaw)
      const basis = close != null && spotPx != null ? basisPoints(close, spotPx) : null
      const annualized =
        days != null && days > 0 && close != null && spotPx != null
          ? annualizedBasisPct(close, spotPx, days)
          : days === 0
            ? 0
            : null
      return {
        product: item.product,
        symbol,
        name: contractName(item.product, symbol),
        expiry: cffexExpiryYmd(symbol),
        oi: quote?.open_interest ?? null,
        preClose: quote?.pre_close ?? null,
        close,
        spotPx,
        basis,
        days,
        annualized,
        role: roleOfSymbol(symbol),
        selected: cffexContractForRole(item.product, selectedRole) === symbol,
      }
    }),
  )
  const today = shanghaiToday()
  const stale = !!asOf && asOf < today

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b px-4 py-3">
        <div>
          <div className="text-sm font-semibold">合约升贴水</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            中金所当前挂牌：近月 / 远月 / 当季 / 下季
            {asOf ? ` · 数据日期 ${asOf}（周${weekdayLabel(asOf)}）` : ""}
            {stale ? " · 休市，以下为最近交易日收盘" : ""}
          </p>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>合约代码</TableHead>
            <TableHead>合约名称</TableHead>
            <TableHead>交割日</TableHead>
            <TableHead className="text-right">持仓量</TableHead>
            <TableHead className="text-right">昨收盘价</TableHead>
            <TableHead className="text-right">
              <span className="inline-flex items-center justify-end gap-1">
                今收盘价
                <HelpTodayClose />
              </span>
            </TableHead>
            <TableHead className="text-right">现货指数价格</TableHead>
            <TableHead className="text-right">
              <span className="inline-flex items-center justify-end gap-1">
                基差
                <HelpBasisPoints />
              </span>
            </TableHead>
            <TableHead className="text-right">剩余天数</TableHead>
            <TableHead className="text-right">
              <span className="inline-flex items-center justify-end gap-1">
                年化升贴水率
                <HelpAnnualizedDiscount />
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.symbol}
              data-state={row.selected ? "selected" : undefined}
              className={cn(row.selected && "bg-muted/60")}
            >
              <TableCell>
                <button
                  type="button"
                  className="font-mono text-blue-600 hover:underline"
                  onClick={() => {
                    if (row.role) onSelectRole(row.role)
                  }}
                >
                  {row.symbol}
                </button>
              </TableCell>
              <TableCell>{row.name}</TableCell>
              <TableCell className="tabular-nums">{row.expiry || "--"}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(row.oi)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtPrice(row.preClose)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtPrice(row.close)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtPrice(row.spotPx)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtPrice(row.basis)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.days == null ? "--" : row.days}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.annualized == null ? "--" : `${row.annualized.toFixed(2)}%`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
