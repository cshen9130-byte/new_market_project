import { NextResponse } from "next/server"
import { query, fmtIso, n } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
}

type CurrentRow = {
  run_date: Date | string
  current_month: Date | string
  pmi_chg_z: string | null
  yield_chg_z: string | null
  spread_chg_z: string | null
  nhci_yoy_z: string | null
  afre_z: string | null
  m1_z: string | null
  cpi_z: string | null
}

type TopRow = {
  rank: number
  similar_month: Date | string
  distance: string | null
  pmi_chg_z: string | null
  yield_chg_z: string | null
  spread_chg_z: string | null
  nhci_yoy_z: string | null
  afre_z: string | null
  m1_z: string | null
  cpi_z: string | null
}

type DistRow = {
  hist_month: Date | string
  distance: string | null
}

export async function GET() {
  try {
    // Get the latest run_date
    const latestRun = await query<{ run_date: Date | string }>(
      `SELECT run_date FROM regime_current_zscores ORDER BY run_date DESC LIMIT 1`
    )

    if (!latestRun.length) {
      return NextResponse.json({
        run_date: null,
        current_month: null,
        current_zscores: null,
        top20: [],
        all_distances: [],
      }, { headers: NO_STORE_HEADERS })
    }

    const runDate = fmtIso(latestRun[0].run_date)

    const [currentRows, top20Rows, distRows] = await Promise.all([
      query<CurrentRow>(
        `SELECT run_date, current_month, pmi_chg_z, yield_chg_z, spread_chg_z,
                nhci_yoy_z, afre_z, m1_z, cpi_z
         FROM regime_current_zscores WHERE run_date = $1`,
        [runDate]
      ),
      query<TopRow>(
        `SELECT rank, similar_month, distance,
                pmi_chg_z, yield_chg_z, spread_chg_z, nhci_yoy_z,
                afre_z, m1_z, cpi_z
         FROM regime_similarity_top WHERE run_date = $1 ORDER BY rank`,
        [runDate]
      ),
      query<DistRow>(
        `SELECT hist_month, distance FROM regime_all_distances
         WHERE run_date = $1 ORDER BY hist_month`,
        [runDate]
      ),
    ])

    const cur = currentRows[0]
    const top20Set = new Set(top20Rows.map((r) => fmtIso(r.similar_month).slice(0, 7)))

    return NextResponse.json({
      run_date: runDate,
      current_month: cur ? fmtIso(cur.current_month).slice(0, 7) : null,
      current_zscores: cur
        ? {
            pmi_chg:    n(cur.pmi_chg_z),
            yield_chg:  n(cur.yield_chg_z),
            spread_chg: n(cur.spread_chg_z),
            nhci_yoy:   n(cur.nhci_yoy_z),
            afre:       n(cur.afre_z),
            m1:         n(cur.m1_z),
            cpi:        n(cur.cpi_z),
          }
        : null,
      top20: top20Rows.map((r) => ({
        date:        fmtIso(r.similar_month).slice(0, 7),
        rank:        r.rank,
        distance:    n(r.distance),
        pmi_chg_z:   n(r.pmi_chg_z),
        yield_chg_z: n(r.yield_chg_z),
        spread_chg_z:n(r.spread_chg_z),
        nhci_yoy_z:  n(r.nhci_yoy_z),
        afre_z:      n(r.afre_z),
        m1_z:        n(r.m1_z),
        cpi_z:       n(r.cpi_z),
      })),
      all_distances: distRows.map((r) => ({
        date:     fmtIso(r.hist_month).slice(0, 7),
        distance: n(r.distance),
        in_top20: top20Set.has(fmtIso(r.hist_month).slice(0, 7)),
      })),
    }, { headers: NO_STORE_HEADERS })
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "unknown error" },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
