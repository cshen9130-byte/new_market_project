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

/**
 * Collapse parent / share-class / mistaken S-prefix codes to one family key
 * so SALF51, ALF51 and ALF51B all match.
 */
export function beianFamilyKey(code: string | null | undefined): string | null {
  const raw = String(code ?? "").trim().toUpperCase()
  if (!raw) return null
  let base = raw.replace(/[ABC]$/u, "")
  if (base.startsWith("S") && base.length > 1) {
    const withoutS = base.slice(1)
    if (/^[A-Z][A-Z0-9]{4,7}$/u.test(withoutS)) {
      base = withoutS
    }
  }
  return base || null
}

/** SQL: same normalization as beianFamilyKey. */
export function sqlBeianFamilyKey(codeExpr: string): string {
  const base = `regexp_replace(UPPER(BTRIM(${codeExpr})), '[ABC]$', '')`
  return `NULLIF(
    CASE
      WHEN ${base} ~ '^S[A-Z][A-Z0-9]{4,7}$' THEN substring(${base} from 2)
      ELSE ${base}
    END
  , '')`
}

export function sqlBeianFamilyMatch(leftExpr: string, rightExpr: string): string {
  return `(
    ${sqlBeianFamilyKey(leftExpr)} IS NOT NULL
    AND ${sqlBeianFamilyKey(leftExpr)} = ${sqlBeianFamilyKey(rightExpr)}
  )`
}

async function loadMainProduct(beianHao: string): Promise<{
  beian_hao: string
  product_name: string
  short_name: string | null
} | null> {
  const bflRows = await query<{
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
  if (bflRows[0]) return bflRows[0]

  // AMAC / non-BFL funds are still valid mains for creating A/B/C tiers.
  const amacRows = await query<{
    beian_hao: string
    product_name: string
  }>(
    `SELECT beian_hao, product_name
     FROM private_fund_info
     WHERE beian_hao = $1
     LIMIT 1`,
    [beianHao],
  )
  const amac = amacRows[0]
  if (!amac) return null
  return {
    beian_hao: amac.beian_hao,
    product_name: amac.product_name,
    short_name: null,
  }
}

async function loadExistingShareClasses(mainProductName: string): Promise<ShareClassProductInfo[]> {
  const existingRows = await query<{
    beian_hao: string
    product_name: string
    short_name: string | null
  }>(
    `SELECT beian_hao, product_name, short_name
     FROM (
       SELECT beian_hao, product_name, short_name
       FROM private_fund_info_bfl
       WHERE ${sqlFundNameBase("product_name")} = ${sqlFundNameBase("$1")}
         AND product_name ~ '[ABC]类$'
       UNION
       SELECT beian_hao, product_name, NULL::text AS short_name
       FROM private_fund_info
       WHERE ${sqlFundNameBase("product_name")} = ${sqlFundNameBase("$1")}
         AND product_name ~ '[ABC]类$'
     ) t
     ORDER BY product_name ASC`,
    [mainProductName],
  )

  return existingRows.map((row) => ({
    beian_hao: row.beian_hao,
    product_name: row.product_name,
    short_name: row.short_name,
    share_class: shareClassFromProductName(row.product_name),
  }))
}

/** Parent product plus any existing A/B/C share classes that share the same fund name base. */
export async function listFundFamilyProducts(beianHao: string): Promise<Array<{
  beian_hao: string
  product_name: string
}>> {
  const code = String(beianHao ?? "").trim()
  if (!code) return []
  const current = await loadMainProduct(code)
  const name = current?.product_name?.trim()
  const seen = new Set<string>()
  const out: Array<{ beian_hao: string; product_name: string }> = []

  if (name) {
    const rows = await query<{ beian_hao: string; product_name: string }>(
      `SELECT beian_hao, product_name
       FROM (
         SELECT beian_hao, product_name
         FROM private_fund_info_bfl
         WHERE ${sqlFundNameBase("product_name")} = ${sqlFundNameBase("$1")}
         UNION
         SELECT beian_hao, product_name
         FROM private_fund_info
         WHERE ${sqlFundNameBase("product_name")} = ${sqlFundNameBase("$1")}
       ) t
       ORDER BY
         CASE WHEN product_name ~ '[ABC]类' THEN 1 ELSE 0 END,
         product_name ASC`,
      [name],
    )
    for (const row of rows) {
      const beian = row.beian_hao.trim()
      if (!beian || seen.has(beian.toUpperCase())) continue
      seen.add(beian.toUpperCase())
      out.push({ beian_hao: beian, product_name: row.product_name })
    }
  }

  if (!seen.has(code.toUpperCase())) {
    out.unshift({ beian_hao: code, product_name: name || code })
  }

  try {
    const family = beianFamilyKey(code)
    if (family) {
      const fofRows = await query<{ beian_hao: string; product_name: string }>(
        `SELECT DISTINCT beian_hao, COALESCE(NULLIF(BTRIM(product_name), ''), beian_hao) AS product_name
         FROM ops_fof_overview_list_cache
         WHERE ${sqlBeianFamilyKey("beian_hao")} = $1
           AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL`,
        [family],
      )
      for (const row of fofRows) {
        const beian = row.beian_hao.trim()
        if (!beian || seen.has(beian.toUpperCase())) continue
        seen.add(beian.toUpperCase())
        out.push({ beian_hao: beian, product_name: row.product_name })
      }
    }
  } catch {
    // FOF cache may be unavailable
  }

  return out
}

export async function loadShareClassPreview(
  beianHao: string,
  shareClass?: ShareClassLetter | null,
): Promise<ShareClassPreview | null> {
  const main = await loadMainProduct(beianHao)
  if (!main) return null

  const existing = await loadExistingShareClasses(main.product_name)

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
}): Promise<{ ok: true; beian_hao: string; product_name: string } | { error: string }> {
  const preview = await loadShareClassPreview(params.main_beian_hao, params.share_class)
  if (!preview) return { error: "main_not_found" }

  const taken = preview.existing.some((row) => row.share_class === params.share_class)
  if (taken) return { error: "share_class_exists" }

  const beianCode = preview.preview?.beian_code
  const productName = preview.preview?.fund_full_name
  const shortName = preview.preview?.fund_short_name ?? null
  if (!beianCode || !productName) return { error: "invalid_preview" }

  const dupRows = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM (
       SELECT beian_hao FROM private_fund_info_bfl WHERE beian_hao = $1
       UNION ALL
       SELECT beian_hao FROM private_fund_info WHERE beian_hao = $1
     ) t
     LIMIT 1`,
    [beianCode],
  )
  if (dupRows[0]?.ok) return { error: "beian_exists" }

  await query(
    `INSERT INTO private_fund_info_bfl (beian_hao, product_name, short_name, updated_at)
     VALUES ($1, $2, $3, NOW())`,
    [beianCode, productName, shortName],
  )

  return { ok: true, beian_hao: beianCode, product_name: productName }
}

async function fundBeianExists(beianHao: string): Promise<boolean> {
  const code = beianHao.trim()
  if (!code) return false
  const rows = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM (
       SELECT beian_hao FROM private_fund_info_bfl WHERE beian_hao = $1
       UNION ALL
       SELECT beian_hao FROM private_fund_info WHERE beian_hao = $1
       UNION ALL
       SELECT register_number FROM type6_ops_team_full WHERE register_number = $1
     ) t
     LIMIT 1`,
    [code],
  ).catch(() => [] as { ok: number }[])
  return Boolean(rows[0]?.ok)
}

/**
 * Fund pickers may synthesize A/B/C share-class codes (SAJD58 → AJD58B) that are not
 * yet rows in private_fund_info(_bfl). Materialize the tier from the main product so
 * product-page / contract links resolve instead of 404.
 */
export async function ensureShareClassBeianProduct(beianHao: string): Promise<{
  beian_hao: string
  product_name: string
  created: boolean
} | null> {
  const raw = String(beianHao ?? "").trim().toUpperCase()
  if (!raw) return null
  const canonical = canonicalizeShareClassBeianCode(raw) || raw

  for (const code of [canonical, raw]) {
    if (!(await fundBeianExists(code))) continue
    const main = await loadMainProduct(code)
    return {
      beian_hao: code,
      product_name: main?.product_name ?? code,
      created: false,
    }
  }

  const m = canonical.match(/^([A-Z][A-Z0-9]{3,10})([ABC])$/u)
  if (!m) return null
  const base = m[1]
  const letter = m[2] as ShareClassLetter

  const mainCandidates = Array.from(new Set([`S${base}`, base]))
  for (const mainCode of mainCandidates) {
    const main = await loadMainProduct(mainCode)
    if (!main) continue
    const expected = buildTieredBeianCode(main.beian_hao, letter)
    if (expected !== canonical && expected !== raw) continue

    const existing = (await loadExistingShareClasses(main.product_name))
      .find((row) => row.share_class === letter)
    if (existing) {
      return {
        beian_hao: existing.beian_hao,
        product_name: existing.product_name,
        created: false,
      }
    }

    const result = await createShareClassProduct({
      main_beian_hao: main.beian_hao,
      share_class: letter,
    })
    if ("ok" in result) {
      return { beian_hao: result.beian_hao, product_name: result.product_name, created: true }
    }
    if (result.error === "beian_exists" || result.error === "share_class_exists") {
      return {
        beian_hao: expected,
        product_name: buildTieredFullName(main.product_name, letter),
        created: false,
      }
    }
  }

  return null
}
