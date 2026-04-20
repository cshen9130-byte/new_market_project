import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function _GET(_req: Request) {
  try {
    const [accountRows, productRows] = await Promise.all([
      // Distinct accounts that have any futures trade records
      query<{ account: string }>(
        `SELECT DISTINCT TRIM("账户") AS account
         FROM mom_futures_trade_details
         WHERE "账户" IS NOT NULL AND TRIM("账户") != ''
         ORDER BY 1`,
        [],
      ),

      // Distinct product codes (leading alpha chars before the expiry number)
      query<{ product: string }>(
        `SELECT DISTINCT UPPER(REGEXP_REPLACE(TRIM("合约"), '[0-9].*$', '')) AS product
         FROM mom_futures_trade_details
         WHERE "合约" ~ '^[a-zA-Z]'
           AND "合约" IS NOT NULL
           AND TRIM("合约") != ''
         ORDER BY 1`,
        [],
      ),
    ])

    return NextResponse.json({
      ok: true,
      accounts: accountRows.map(r => r.account),
      // Filter out any noise (valid codes are 1-4 uppercase letters)
      products: productRows.map(r => r.product).filter(p => /^[A-Z]{1,4}$/.test(p)),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("au-trading-meta", _GET)
