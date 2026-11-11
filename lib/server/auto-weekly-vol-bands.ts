import { query } from "@/lib/db"
import { volBandFromProductTags, type ReportVolBand } from "@/lib/server/fof-weekly-report"

export type ManagerViewVolBand = "低波" | "中波" | "高波"

const SHORT_BAND: Record<ReportVolBand, ManagerViewVolBand> = {
  低波动: "低波",
  中波动: "中波",
  高波动: "高波",
}

function defaultVolBand(beianHao: string | null | undefined): ManagerViewVolBand {
  return (beianHao || "").trim().toUpperCase() === "SGM223" ? "中波" : "低波"
}

/** Batch-resolve 低波/中波/高波 for team-report products. One SQL, not N+1. */
export async function lookupProductVolBands(
  products: Array<{ beian_hao?: string | null }>,
): Promise<Map<string, ManagerViewVolBand>> {
  const codes = [
    ...new Set(
      products
        .map((product) => (product.beian_hao || "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ]

  const tagsByCode = new Map<string, string[]>()
  if (codes.length > 0) {
    try {
      const rows = await query<{ beian_hao: string; tag_name: string }>(
        `SELECT beian_hao, tag_name FROM ops_fund_tags
         WHERE UPPER(BTRIM(beian_hao)) = ANY($1)
         ORDER BY created_at ASC`,
        [codes],
      )
      for (const row of rows) {
        const key = (row.beian_hao || "").trim().toUpperCase()
        if (!key) continue
        const list = tagsByCode.get(key)
        if (list) list.push(row.tag_name)
        else tagsByCode.set(key, [row.tag_name])
      }
    } catch (err) {
      console.warn("[auto-weekly-vol-bands] tag lookup failed:", err)
    }
  }

  const result = new Map<string, ManagerViewVolBand>()
  for (const code of codes) {
    const fromTags = volBandFromProductTags(tagsByCode.get(code) ?? [])
    result.set(code, fromTags ? SHORT_BAND[fromTags] : defaultVolBand(code))
  }
  return result
}

export function resolveProductVolBand(
  beianHao: string | null | undefined,
  bands: Map<string, ManagerViewVolBand>,
): ManagerViewVolBand {
  const code = (beianHao || "").trim().toUpperCase()
  if (code) {
    const band = bands.get(code)
    if (band) return band
  }
  return defaultVolBand(beianHao)
}
