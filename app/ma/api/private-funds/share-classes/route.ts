import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { sqlFundNameBase } from "@/lib/server/fund-name-match"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SHARE_CLASS_LETTERS = ["A", "B", "C"] as const

/**
 * SQL: collapse a beian/product-code to its "family key" (strip trailing A/B/C
 * and the leading S on AMAC codes) so SBLF14, BLF14A, BLF14C all resolve to BLF14.
 * Mirror of sqlBeianFamilyKey in share-class-product.ts (inlined — that file imports db).
 */
function sqlFamilyKey(expr: string): string {
  const base = `regexp_replace(UPPER(BTRIM(${expr})), '[ABC]$', '')`
  return `NULLIF(CASE WHEN ${base} ~ '^S[A-Z][A-Z0-9]{4,7}$' THEN substring(${base} from 2) ELSE ${base} END, '')`
}

/** Mirror of buildTieredBeianCode (pure, no db). */
function tieredBeianCode(baseCode: string, letter: string): string {
  let code = String(baseCode ?? "").trim().toUpperCase().replace(/[ABC]$/, "")
  if (code.startsWith("S") && code.length > 1) {
    const withoutS = code.slice(1)
    if (/^[A-Z][A-Z0-9]{4,7}$/.test(withoutS)) code = withoutS
  }
  return `${code}${letter}`
}

/** Mirror of buildTieredFullName (pure, no db). */
function tieredFullName(baseName: string, letter: string): string {
  let name = String(baseName ?? "").replace(/[ABC]类$/, "").trim()
  const hasSuffix = /(私募证券投资基金|私募基金|证券投资基金|投资基金)$/.test(name)
  if (!hasSuffix) name = `${name}私募证券投资基金`
  return `${name}${letter}类`
}

function isShareClassCode(code: string): boolean {
  return /[ABC]$/i.test(String(code ?? "").trim())
}

type ChildRow = { beian_hao: string; product_name: string }

/**
 * Given parent beian_hao codes, return A/B/C share-class children grouped by parent.
 *
 * Checks three sources (in priority order for name resolution):
 *   1. private_fund_info_bfl  — name-base match
 *   2. ops_team_data_products — beian family-key match (manual / 分级 additions)
 *   3. ops_email_nav_records  — beian family-key match (email-discovered funds)
 *
 * For parents with no real children in any source, synthesizes A/B/C entries from
 * the parent beian code so the user can still link to a specific class.
 *
 * GET /ma/api/private-funds/share-classes?parents=SAEC67,SBLF14,...
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const parentsRaw = (searchParams.get("parents") || "").trim()
  const parentCodes = parentsRaw
    ? parentsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : []

  if (parentCodes.length === 0) return NextResponse.json({ data: {} })

  const eligibleCodes = parentCodes.filter((c) => !isShareClassCode(c))
  if (eligibleCodes.length === 0) return NextResponse.json({ data: {} })

  try {
    // ── Source 0: parent names (for synthesis fallback) ──────────────────────
    const parentRows = await query<{ beian_hao: string; product_name: string }>(
      `SELECT beian_hao, product_name
       FROM (
         SELECT beian_hao, product_name FROM private_fund_info     WHERE beian_hao = ANY($1::text[])
         UNION
         SELECT beian_hao, product_name FROM private_fund_info_bfl WHERE beian_hao = ANY($1::text[])
       ) t`,
      [eligibleCodes],
    )
    const parentNameMap: Record<string, string> = {}
    for (const row of parentRows) parentNameMap[row.beian_hao] = row.product_name

    // ── Source 1: private_fund_info_bfl (name-base match) ────────────────────
    const nameBase = sqlFundNameBase("p.product_name")
    const childBase = sqlFundNameBase("c.product_name")
    const bflRows = await query<{
      parent_beian_hao: string; beian_hao: string; product_name: string
    }>(
      `SELECT p.beian_hao AS parent_beian_hao, c.beian_hao, c.product_name
       FROM (
         SELECT beian_hao, product_name FROM private_fund_info     WHERE beian_hao = ANY($1::text[])
         UNION
         SELECT beian_hao, product_name FROM private_fund_info_bfl WHERE beian_hao = ANY($1::text[])
       ) p
       JOIN private_fund_info_bfl c ON
         ${childBase} IS NOT NULL AND ${nameBase} IS NOT NULL
         AND ${childBase} = ${nameBase}
         AND c.product_name ~ '[ABC]类$'
         AND c.beian_hao <> p.beian_hao
       ORDER BY p.beian_hao, c.product_name ASC`,
      [eligibleCodes],
    )

    // ── Source 2: ops_team_data_products (family-key match) ──────────────────
    const fkeyParent = sqlFamilyKey("p.beian_hao")
    const fkeyChild  = sqlFamilyKey("t.beian_hao")
    const teamRows = await query<{
      parent_beian_hao: string; beian_hao: string; product_name: string
    }>(
      `SELECT p.beian_hao AS parent_beian_hao,
              UPPER(BTRIM(t.beian_hao)) AS beian_hao,
              t.product_name
       FROM (
         SELECT beian_hao FROM private_fund_info     WHERE beian_hao = ANY($1::text[])
         UNION
         SELECT beian_hao FROM private_fund_info_bfl WHERE beian_hao = ANY($1::text[])
       ) p
       JOIN ops_team_data_products t ON
         ${fkeyChild} IS NOT NULL
         AND ${fkeyChild} = ${fkeyParent}
         AND UPPER(BTRIM(t.beian_hao)) ~ '[ABC]$'
         AND UPPER(BTRIM(t.beian_hao)) <> UPPER(BTRIM(p.beian_hao))
       ORDER BY p.beian_hao, t.product_name ASC`,
      [eligibleCodes],
    )

    // ── Source 3: ops_email_nav_records (family-key match, most-recent name) ─
    const fkeyEmail = sqlFamilyKey("e.product_code")
    const emailRows = await query<{
      parent_beian_hao: string; beian_hao: string; product_name: string
    }>(
      `SELECT DISTINCT ON (p.beian_hao, UPPER(BTRIM(e.product_code)))
         p.beian_hao AS parent_beian_hao,
         UPPER(BTRIM(e.product_code)) AS beian_hao,
         e.fund_name AS product_name
       FROM (
         SELECT beian_hao FROM private_fund_info     WHERE beian_hao = ANY($1::text[])
         UNION
         SELECT beian_hao FROM private_fund_info_bfl WHERE beian_hao = ANY($1::text[])
       ) p
       JOIN ops_email_nav_records e ON
         e.product_code IS NOT NULL
         AND NULLIF(BTRIM(e.product_code), '') IS NOT NULL
         AND UPPER(BTRIM(e.product_code)) ~ '[ABC]$'
         AND ${fkeyEmail} IS NOT NULL
         AND ${fkeyEmail} = ${fkeyParent}
         AND UPPER(BTRIM(e.product_code)) <> UPPER(BTRIM(p.beian_hao))
       ORDER BY p.beian_hao, UPPER(BTRIM(e.product_code)), e.nav_date DESC NULLS LAST`,
      [eligibleCodes],
    )

    // ── Merge: BFL name wins over team wins over email; dedup by beian_hao ───
    const realChildren: Record<string, Map<string, ChildRow>> = {}

    function addChild(rows: typeof bflRows) {
      for (const row of rows) {
        const key = UPPER(row.beian_hao)
        if (!realChildren[row.parent_beian_hao]) realChildren[row.parent_beian_hao] = new Map()
        if (!realChildren[row.parent_beian_hao].has(key)) {
          realChildren[row.parent_beian_hao].set(key, {
            beian_hao: row.beian_hao,
            product_name: row.product_name || row.beian_hao,
          })
        }
      }
    }

    addChild(bflRows)
    addChild(teamRows)
    addChild(emailRows)

    // ── Build final result, synthesizing for parents still with no children ──
    const data: Record<string, Array<ChildRow & { synthetic: boolean }>> = {}

    for (const code of eligibleCodes) {
      const childMap = realChildren[code]
      if (childMap && childMap.size > 0) {
        data[code] = Array.from(childMap.values())
          .sort((a, b) => a.product_name.localeCompare(b.product_name, "zh"))
          .map((r) => ({ ...r, synthetic: false }))
        continue
      }

      const parentName = parentNameMap[code]
      if (!parentName) continue

      data[code] = SHARE_CLASS_LETTERS.map((letter) => ({
        beian_hao: tieredBeianCode(code, letter),
        product_name: tieredFullName(parentName, letter),
        synthetic: true,
      }))
    }

    return NextResponse.json({ data })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load share classes"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function UPPER(s: string) {
  return (s ?? "").trim().toUpperCase()
}
