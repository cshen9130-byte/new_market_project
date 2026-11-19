import { NextResponse } from "next/server"
import { withMomCache } from "@/lib/server/mom-cache"
import { momAccountEqualsSql, parseMomSubAccountParam } from "@/lib/server/mom-sub-account"
import { parseQuantIdList, parseSleeveParam, sleeveFilterSql } from "@/lib/ma/quant-accounts"
import { computeMomPositionVarHistory } from "@/lib/server/mom-position-var-history"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function accountParam(req: Request): string | null | false {
  return parseMomSubAccountParam(new URL(req.url).searchParams.get("account"))
}

async function _GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const volDays  = Math.max(5, Math.min(120, parseInt(searchParams.get("volDays")  ?? "20",  10)))
  const corrDays = Math.max(5, Math.min(756, parseInt(searchParams.get("corrDays") ?? "252", 10)))
  const account = accountParam(req)
  if (account === false) {
    return NextResponse.json({ ok: false, error: "无效账户" }, { status: 400 })
  }
  const accountSql = account
    ? ` AND ${momAccountEqualsSql(`"账户"`, 1)}`
    : ""
  const params = account ? [account] : []
  const sleeve = parseSleeveParam(searchParams.get("sleeve"))
  const quantIds = parseQuantIdList(searchParams.get("quantIds"))
  const sleeveSqlClause = sleeveFilterSql(sleeve, quantIds)

  try {
    const { shares } = await computeMomPositionVarHistory({
      volDays,
      corrDays,
      accountSql,
      sleeveSql: sleeveSqlClause,
      params,
    })
    return NextResponse.json({ ok: true, ...shares })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({
        ok: true, dates: [], catData: {}, sectorData: {}, subSectorData: {},
        corrNetCat: {}, corrNetSector: {}, corrNetSub: {},
        avgCorrCat: {}, avgCorrSector: {}, avgCorrSub: {},
      })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("var-sector-timeseries-avgcorr", _GET)
