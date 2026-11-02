import { NextResponse } from "next/server"

import type { IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_IV } from "@/lib/client/realtime-overlay"
import { clampIvLookbackDays } from "@/lib/client/iv-lookback"
import { getQvixDailyBars } from "@/lib/server/qvix-realtime"
import { appendCffexMonthLiveTip, appendCffexSinaTip, fetchCffexAtmIvMinutes } from "@/lib/server/cffex-atm-iv-minute"
import { fetchEtfAtmIvMinutes, fetchEtfStrikeIvMinutes } from "@/lib/server/atm-iv-minute"
import { kickOptionMinuteCapture, readArchivedIv } from "@/lib/server/option-minute-archive"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRODUCTS = new Set<IndexProduct>(["IH", "IF", "IC", "IM"])

const CHAIN: Record<IndexProduct, { etf: string | null; cffex: string | null }> = {
  IH: { etf: "50etf", cffex: "50index" },
  IF: { etf: "300etf", cffex: "300index" },
  IC: { etf: "500etf", cffex: null },
  IM: { etf: null, cffex: "1000index" },
}

function parseStrike(raw: string | null) {
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function archiveKey(product: IndexProduct, month: string | null) {
  const chain = CHAIN[product]
  if (month) return chain.cffex
  return chain.etf || chain.cffex
}

async function readArchive(product: IndexProduct, month: string | null, days: number, strike?: number | null) {
  const key = archiveKey(product, month)
  if (!key) return null
  const archived = await readArchivedIv({ key, month, days, strike })
  if (!archived) return null
  return { ...archived, key }
}

async function finishChosenStrike(
  product: IndexProduct,
  month: string | null,
  strike: number,
  row: { bars: { time: number; close: number }[]; contract: string | null; source: string },
) {
  const key = CHAIN[product].cffex
  // ETF underlyings already use a live Sina minute feed. 中证1000's stored
  // minutes are the delayed CFFEX file, so the chosen strike needs the same
  // live Sina tip as auto mode.
  if (!key || CHAIN[product].etf) return row
  const bars = await appendCffexSinaTip(key, strike, row.bars, month)
  const moved = bars.at(-1)?.time !== row.bars.at(-1)?.time
  return {
    ...row,
    bars,
    source: moved ? `qvix-cffex:${key}` : row.source,
  }
}

async function fetchChosenStrike(product: IndexProduct, month: string | null, days: number, strike: number) {
  const chain = CHAIN[product]
  const archived = await readArchive(product, month, days, strike)
  if (archived && archived.bars.length) {
    return finishChosenStrike(product, month, strike, {
      bars: archived.bars,
      contract: archived.contract,
      source: `archive:${archived.key}`,
    })
  }
  if (month && chain.cffex) {
    const live = await fetchCffexAtmIvMinutes(chain.cffex, month, days, strike)
    if (live && coversLookback(live.bars, days)) {
      return { bars: live.bars, contract: live.contract || null, source: `em-atm:${days}d` }
    }
    return null
  }
  if (!month && chain.etf) {
    const live = await fetchEtfStrikeIvMinutes(chain.etf, strike, days)
    if (live?.contract || live?.bars.length) {
      const enough = days <= 1 || new Set((live.bars || []).map((bar) => sessionDay(bar.time))).size >= 2
      if (enough) return { bars: live.bars, contract: live.contract || null, source: `sina-atm:${chain.etf}` }
    }
  }
  if (chain.cffex) {
    const live = await fetchCffexAtmIvMinutes(chain.cffex, month, days, strike)
    if (live && coversLookback(live.bars, days)) {
      return { bars: live.bars, contract: live.contract || null, source: `em-atm:${days}d` }
    }
  }
  if (chain.etf) {
    const live = await fetchEtfStrikeIvMinutes(chain.etf, strike)
    if (live) return { bars: live.bars, contract: live.contract || null, source: `sina-atm:${chain.etf}` }
  }
  return null
}

function sessionDay(unix: number) {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function coversLookback(bars: Array<{ time: number }>, days: number) {
  if (bars.length < 8) return false
  if (days <= 1) return true
  const seen = new Set(bars.map((bar) => sessionDay(bar.time)))
  return seen.size >= 2
}

async function fetchMultiDayMinutes(product: IndexProduct, month: string | null, days: number) {
  const meta = INDEX_IV[product]
  const archived = await readArchive(product, month, days)
  // Stored minutes win even when an earlier session is still blank. The chart
  // leaves that gap empty instead of switching to daily closes.
  if (archived && archived.bars.length) {
    const key = CHAIN[product].cffex
    const useCffexBook = !!month && key != null && archiveKey(product, month) === key
    const bars = useCffexBook ? await appendCffexMonthLiveTip(key, month, archived.bars) : archived.bars
    const tipped = bars.at(-1)?.time !== archived.bars.at(-1)?.time
    return {
      bars,
      contract: archived.contract,
      source: tipped ? `qvix-cffex:${key}` : `archive:${archived.key}`,
      resolution: "minute" as const,
    }
  }
  if (!month) {
    const etf = await fetchEtfAtmIvMinutes(meta.key, days)
    if (etf && coversLookback(etf.bars, days)) {
      return {
        bars: etf.bars,
        contract: etf.contract || null,
        source: `sina-atm:${meta.key}`,
        resolution: "minute" as const,
      }
    }
  }
  const keys = [...new Set([meta.fallback, meta.key])]
  for (const code of keys) {
    const live = await fetchCffexAtmIvMinutes(code, month, days)
    if (live && coversLookback(live.bars, days)) {
      return { bars: live.bars, contract: live.contract || null, source: `em-atm:${days}d`, resolution: "minute" as const }
    }
  }
  if (days === 1 && !month) {
    for (const code of keys) {
      const live = await fetchEtfAtmIvMinutes(code)
      if (live && live.bars.length >= 8) {
        return { bars: live.bars, contract: live.contract || null, source: `sina-atm:${code}`, resolution: "minute" as const }
      }
    }
  }
  return null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const product = (url.searchParams.get("product") || "").trim().toUpperCase()
  const month = (url.searchParams.get("month") || "").trim().toUpperCase() || null
  const days = clampIvLookbackDays(url.searchParams.get("days") || 1)
  const strike = parseStrike(url.searchParams.get("strike"))
  if (!PRODUCTS.has(product as IndexProduct)) {
    return NextResponse.json({ ok: false, error: "invalid product" }, { status: 400 })
  }
  try {
    kickOptionMinuteCapture()
    if (strike != null) {
      const live = await fetchChosenStrike(product as IndexProduct, month, days, strike)
      return NextResponse.json({
        ok: true,
        product,
        month,
        days,
        strike,
        source: live?.source ?? null,
        resolution: "minute" as const,
        contract: live?.contract ?? null,
        bars: live?.bars ?? [],
      })
    }
    if (month || days > 1) {
      const live = await fetchMultiDayMinutes(product as IndexProduct, month, days)
      if (live) {
        return NextResponse.json({
          ok: true,
          product,
          month,
          days,
          source: live.source,
          resolution: live.resolution,
          contract: live.contract,
          bars: live.bars,
        })
      }
      return NextResponse.json({
        ok: true,
        product,
        month,
        days,
        source: null,
        resolution: "minute" as const,
        bars: [],
      })
    }
    const bars = await getQvixDailyBars(product as IndexProduct)
    return NextResponse.json({ ok: true, product, bars })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "QVIX fetch failed" },
      { status: 502 },
    )
  }
}
