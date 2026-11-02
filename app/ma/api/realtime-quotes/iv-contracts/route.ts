import { NextResponse } from "next/server"

import type { IndexProduct } from "@/lib/client/ctp-market"
import { listEtfIvContracts } from "@/lib/server/atm-iv-minute"
import { listCffexIvContracts } from "@/lib/server/cffex-atm-iv-minute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRODUCTS = new Set<IndexProduct>(["IH", "IF", "IC", "IM"])

const CHAIN: Record<IndexProduct, { etf: string | null; cffex: string | null }> = {
  IH: { etf: "50etf", cffex: "50index" },
  IF: { etf: "300etf", cffex: "300index" },
  IC: { etf: "500etf", cffex: null },
  IM: { etf: null, cffex: "1000index" },
}

function strikeId(strike: number) {
  if (Math.abs(strike - Math.round(strike)) < 1e-6) return String(Math.round(strike))
  return strike.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const product = (url.searchParams.get("product") || "").trim().toUpperCase()
  const month = (url.searchParams.get("month") || "").trim().toUpperCase() || null
  if (!PRODUCTS.has(product as IndexProduct)) {
    return NextResponse.json({ ok: false, error: "invalid product" }, { status: 400 })
  }
  const chain = CHAIN[product as IndexProduct]
  try {
    let rows: Array<{ strike: number; label: string; atm: boolean }> = []
    if (month && chain.cffex) {
      rows = await listCffexIvContracts(chain.cffex, month)
    } else if (chain.etf) {
      rows = await listEtfIvContracts(chain.etf)
      if (!rows.length && chain.cffex) rows = await listCffexIvContracts(chain.cffex, null)
    } else if (chain.cffex) {
      rows = await listCffexIvContracts(chain.cffex, null)
    }
    return NextResponse.json({
      ok: true,
      product,
      month,
      contracts: rows.map((row) => ({
        id: strikeId(row.strike),
        label: row.label,
        atm: row.atm,
      })),
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "contract list failed" },
      { status: 502 },
    )
  }
}
