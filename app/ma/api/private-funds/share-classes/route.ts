import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { sqlFundNameBase } from "@/lib/server/fund-name-match"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Given a list of parent beian_hao codes, return any A/B/C share-class children
 * stored in private_fund_info_bfl, grouped by parent beian_hao.
 *
 * GET /ma/api/private-funds/share-classes?parents=SAEC67,SBHQ60,...
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const parentsRaw = (searchParams.get("parents") || "").trim()
  const parentCodes = parentsRaw
    ? parentsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : []

  if (parentCodes.length === 0) {
    return NextResponse.json({ data: {} })
  }

  try {
    const nameBase = sqlFundNameBase("p.product_name")
    const childBase = sqlFundNameBase("c.product_name")

    const rows = await query<{
      parent_beian_hao: string
      beian_hao: string
      product_name: string
    }>(
      `SELECT
         p.beian_hao AS parent_beian_hao,
         c.beian_hao,
         c.product_name
       FROM (
         SELECT beian_hao, product_name FROM private_fund_info   WHERE beian_hao = ANY($1::text[])
         UNION
         SELECT beian_hao, product_name FROM private_fund_info_bfl WHERE beian_hao = ANY($1::text[])
       ) p
       JOIN private_fund_info_bfl c ON
         ${childBase} IS NOT NULL
         AND ${nameBase} IS NOT NULL
         AND ${childBase} = ${nameBase}
         AND c.product_name ~ '[ABC]类$'
         AND c.beian_hao <> p.beian_hao
       ORDER BY p.beian_hao, c.product_name ASC`,
      [parentCodes],
    )

    const data: Record<string, Array<{ beian_hao: string; product_name: string }>> = {}
    for (const row of rows) {
      if (!data[row.parent_beian_hao]) data[row.parent_beian_hao] = []
      data[row.parent_beian_hao].push({
        beian_hao: row.beian_hao,
        product_name: row.product_name,
      })
    }

    return NextResponse.json({ data })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load share classes"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
