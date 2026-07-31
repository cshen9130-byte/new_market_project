import { query } from "@/lib/db"
import { sqlFundNameBase } from "@/lib/server/fund-name-match"

export type ShareClassLetter = "A" | "B" | "C"

export const SHARE_CLASS_OPTIONS: ShareClassLetter[] = ["A", "B", "C"]

export interface ShareClassProductInfo {
  beian_hao: string
  product_name: string
  short_name: string | null
  share_class: ShareClassLetter | null
}

export interface ShareClassPreview {
  main: {
    beian_hao: string
    product_name: string
    short_name: string | null
  }
  existing: ShareClassProductInfo[]
  preview: {
    share_class: ShareClassLetter
    fund_full_name: string
    fund_short_name: string
    beian_code: string
  } | null
}

export function shareClassFromProductName(name: string): ShareClassLetter | null {
  const m = String(name ?? "").match(/([ABC])类/u)
  return m ? (m[1] as ShareClassLetter) : null
}

export function stripShareClassSuffix(name: string): string {
  return String(name ?? "").replace(/[ABC]类$/u, "").trim()
}

function hasLegalFundSuffix(name: string): boolean {
  return /(私募证券投资基金|私募基金|证券投资基金|投资基金)$/u.test(name)
}

export function buildTieredFullName(baseName: string, letter: ShareClassLetter): string {
  let name = stripShareClassSuffix(baseName)
  if (!hasLegalFundSuffix(name)) {
    name = `${name}私募证券投资基金`
  }
  return `${name}${letter}类`
}

export function buildTieredShortName(
  shortName: string | null,
  productName: string,
  letter: ShareClassLetter,
): string {
  const base = stripShareClassSuffix(shortName?.trim() || productName)
  return `${base}${letter}类`
}

export function buildTieredBeianCode(baseCode: string, letter: ShareClassLetter): string {
  let code = String(baseCode ?? "").trim().toUpperCase()
  code = code.replace(/[ABC]$/u, "")
  // S-prefixed AMAC codes (e.g. SBCU82) tier to BCU82B, not SBCU82B.
  if (code.startsWith("S") && code.length > 1) {
    const withoutS = code.slice(1)
    if (/^[A-Z][A-Z0-9]{4,7}$/u.test(withoutS)) {
      code = withoutS
    }
  }
  return `${code}${letter}`
}

/**
 * Normalize mistaken S-prefixed share-class codes (SBTH74B → BTH74B, STA891A → TA891A).
 * Parent codes without A/B/C suffix are returned unchanged.
 */
export function canonicalizeShareClassBeianCode(code: string | null | undefined): string | null {
  const raw = String(code ?? "").trim().toUpperCase()
  if (!raw) return null
  const m = raw.match(/^(.+?)([ABC])$/u)
  if (!m) return raw
  return buildTieredBeianCode(m[1], m[2] as ShareClassLetter)
}

/** SQL: same normalization as canonicalizeShareClassBeianCode. */
export function sqlCanonicalShareClassBeian(codeExpr: string): string {
  return `CASE
    WHEN UPPER(BTRIM(${codeExpr})) ~ '^[A-Z0-9]+[ABC]$'
    THEN (
      CASE
        WHEN regexp_replace(UPPER(BTRIM(${codeExpr})), '[ABC]$', '') ~ '^S[A-Z][A-Z0-9]{4,7}$'
        THEN substring(regexp_replace(UPPER(BTRIM(${codeExpr})), '[ABC]$', '') from 2)
             || right(UPPER(BTRIM(${codeExpr})), 1)
        ELSE UPPER(BTRIM(${codeExpr}))
      END
    )
    ELSE NULLIF(BTRIM(${codeExpr}), '')
  END`
}

export async function loadShareClassPreview(
  beianHao: string,
  shareClass?: ShareClassLetter | null,
): Promise<ShareClassPreview | null> {
  const mainRows = await query<{
    beian_hao: string
    product_name: string
    short_name: string | null
  }>(
    `SELECT beian_hao, product_name, short_name
     FROM private_fund_info_bfl
     WHERE beian_hao = $1
     LIMIT 1`,
    [beianHao],
  )
  const main = mainRows[0]
  if (!main) return null

  const existingRows = await query<{
    beian_hao: string
    product_name: string
    short_name: string | null
  }>(
    `WITH main AS (
       SELECT product_name FROM private_fund_info_bfl WHERE beian_hao = $1
     )
     SELECT b.beian_hao, b.product_name, b.short_name
     FROM private_fund_info_bfl b
     CROSS JOIN main m
     WHERE ${sqlFundNameBase("b.product_name")} = ${sqlFundNameBase("m.product_name")}
       AND b.product_name ~ '[ABC]类$'
     ORDER BY b.product_name ASC`,
    [beianHao],
  )

  const existing = existingRows.map((row) => ({
    beian_hao: row.beian_hao,
    product_name: row.product_name,
    short_name: row.short_name,
    share_class: shareClassFromProductName(row.product_name),
  }))

  const preview = shareClass
    ? {
        share_class: shareClass,
        fund_full_name: buildTieredFullName(main.product_name, shareClass),
        fund_short_name: buildTieredShortName(main.short_name, main.product_name, shareClass),
        beian_code: buildTieredBeianCode(main.beian_hao, shareClass),
      }
    : null

  return {
    main: {
      beian_hao: main.beian_hao,
      product_name: main.product_name,
      short_name: main.short_name,
    },
    existing,
    preview,
  }
}

export async function createShareClassProduct(params: {
  main_beian_hao: string
  share_class: ShareClassLetter
}): Promise<{ ok: true } | { error: string }> {
  const preview = await loadShareClassPreview(params.main_beian_hao, params.share_class)
  if (!preview) return { error: "main_not_found" }

  const taken = preview.existing.some((row) => row.share_class === params.share_class)
  if (taken) return { error: "share_class_exists" }

  const beianCode = preview.preview?.beian_code
  if (!beianCode) return { error: "invalid_preview" }

  const dupRows = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM private_fund_info_bfl WHERE beian_hao = $1 LIMIT 1`,
    [beianCode],
  )
  if (dupRows[0]?.ok) return { error: "beian_exists" }

  // Tiered products are synced from the upstream platform; acknowledge the request here.
  return { ok: true }
}
