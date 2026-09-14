import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { sqlFundNameBase } from "@/lib/server/fund-name-match"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SHARE_CLASS_LETTERS = ["A", "B", "C"] as const

/**
 * SQL: collapse a beian/product-code to its "family key" (strip trailing A/B/C
 * and the leading S on AMAC codes) so SBLF14, BLF14A, BLF14C all resolve to BLF14.
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

/** AEC67B → [AEC67, SAEC67] so a share-class page can still load siblings. */
function expandParentCodes(codes: string[]): string[] {
  const out = new Set<string>()
  for (const raw of codes) {
    const c = String(raw ?? "").trim().toUpperCase()
    if (!c) continue
    if (!isShareClassCode(c)) {
      out.add(c)
      continue
    }
    let family = c.replace(/[ABC]$/i, "")
    if (family.startsWith("S") && family.length > 1) {
      const withoutS = family.slice(1)
      if (/^[A-Z][A-Z0-9]{4,7}$/.test(withoutS)) family = withoutS
    }
    if (!family) continue
    out.add(family)
    out.add(`S${family}`)
  }
  return [...out]
}

function shareClassLetterOf(beian: string, name: string): "A" | "B" | "C" | null {
  const fromCode = String(beian ?? "").trim().match(/([ABC])$/i)
  if (fromCode) return fromCode[1].toUpperCase() as "A" | "B" | "C"
  const fromName = String(name ?? "").match(/([ABC])类/u)
  return fromName ? (fromName[1] as "A" | "B" | "C") : null
}

function keepLatestDate(map: Map<string, string>, code: string, date: string | null | undefined) {
  const d = String(date ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
  const key = code.trim().toUpperCase()
  if (!key) return
  const prev = map.get(key)
  if (!prev || d > prev) map.set(key, d)
}

async function loadLatestNavDates(
  children: Array<{ beian_hao: string; product_name: string }>,
): Promise<Map<string, string>> {
  const dates = new Map<string, string>()
  const codes = [...new Set(children.map((c) => c.beian_hao.trim().toUpperCase()).filter(Boolean))]
  const names = [...new Set(children.map((c) => c.product_name.trim()).filter(Boolean))]
  if (codes.length === 0) return dates

  try {
    const cacheRows = await query<{ beian_hao: string; tip_nav_date: string | null }>(
      `SELECT UPPER(BTRIM(beian_hao)) AS beian_hao, tip_nav_date::text AS tip_nav_date
       FROM ops_private_fund_detail_nav_cache
       WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])
         AND tip_nav_date IS NOT NULL`,
      [codes],
    )
    for (const row of cacheRows) keepLatestDate(dates, row.beian_hao, row.tip_nav_date)
  } catch {
    // cache table may be absent in some environments
  }

  try {
    const emailCodeRows = await query<{ beian_hao: string; nav_date: string | null }>(
      `SELECT DISTINCT ON (UPPER(BTRIM(product_code)))
         UPPER(BTRIM(product_code)) AS beian_hao,
         nav_date::text AS nav_date
       FROM ops_email_nav_records
       WHERE UPPER(BTRIM(product_code)) = ANY($1::text[])
         AND nav_date IS NOT NULL
       ORDER BY UPPER(BTRIM(product_code)), nav_date DESC NULLS LAST`,
      [codes],
    )
    for (const row of emailCodeRows) keepLatestDate(dates, row.beian_hao, row.nav_date)
  } catch {
    // ignore
  }

  if (names.length > 0) {
    try {
      const emailNameRows = await query<{ product_name: string; nav_date: string | null }>(
        `SELECT DISTINCT ON (BTRIM(fund_name))
           BTRIM(fund_name) AS product_name,
           nav_date::text AS nav_date
         FROM ops_email_nav_records
         WHERE BTRIM(fund_name) = ANY($1::text[])
           AND nav_date IS NOT NULL
         ORDER BY BTRIM(fund_name), nav_date DESC NULLS LAST`,
        [names],
      )
      const nameToCode = new Map(children.map((c) => [c.product_name.trim(), c.beian_hao]))
      for (const row of emailNameRows) {
        const code = nameToCode.get(row.product_name)
        if (code) keepLatestDate(dates, code, row.nav_date)
      }
    } catch {
      // ignore
    }
  }

  try {
    const infoRows = await query<{ beian_hao: string; latest_nav_date: string | null }>(
      `SELECT UPPER(BTRIM(beian_hao)) AS beian_hao, latest_nav_date::text AS latest_nav_date
       FROM (
         SELECT beian_hao, latest_nav_date FROM private_fund_info
         WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])
         UNION ALL
         SELECT beian_hao, latest_nav_date FROM private_fund_info_bfl
         WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])
       ) x
       WHERE latest_nav_date IS NOT NULL`,
      [codes],
    )
    for (const row of infoRows) keepLatestDate(dates, row.beian_hao, row.latest_nav_date)
  } catch {
    // ignore
  }

  return dates
}

type ChildRow = { beian_hao: string; product_name: string }

/**
 * Return A/B/C share-class children for a set of parent beian_hao codes.
 *
 * Checks four sources (later sources fill gaps not covered by earlier ones):
 *   1. private_fund_info_bfl  — name-base match
 *   2. ops_team_data_products — beian family-key match
 *   3. ops_email_nav_records  — product_code family-key match (code ends in A/B/C)
 *   4. ops_email_nav_records  — fund_name match (name ends in A类/B类/C类, no code)
 *
 * If none of the above find children, synthesizes A/B/C from the parent beian code.
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

  const eligibleCodes = expandParentCodes(parentCodes)
  if (eligibleCodes.length === 0) return NextResponse.json({ data: {} })

  // Inline parent subquery (reused in several JOINs below)
  const parentSrc = `(
    SELECT beian_hao, product_name FROM private_fund_info     WHERE beian_hao = ANY($1::text[])
    UNION
    SELECT beian_hao, product_name FROM private_fund_info_bfl WHERE beian_hao = ANY($1::text[])
  ) p`

  const parentSrcCodeOnly = `(
    SELECT beian_hao FROM private_fund_info     WHERE beian_hao = ANY($1::text[])
    UNION
    SELECT beian_hao FROM private_fund_info_bfl WHERE beian_hao = ANY($1::text[])
  ) p`

  try {
    // ── Step 0: parent names (for synthesis fallback) ─────────────────────────
    const parentRows = await query<{ beian_hao: string; product_name: string }>(
      `SELECT beian_hao, product_name FROM ${parentSrc}`,
      [eligibleCodes],
    )
    const parentNameMap: Record<string, string> = {}
    for (const row of parentRows) parentNameMap[row.beian_hao] = row.product_name

    // ── Source 1: private_fund_info_bfl — name-base match ────────────────────
    const nameBaseP = sqlFundNameBase("p.product_name")
    const nameBaseC = sqlFundNameBase("c.product_name")
    const bflRows = await query<{ parent_beian_hao: string; beian_hao: string; product_name: string }>(
      `SELECT p.beian_hao AS parent_beian_hao, c.beian_hao, c.product_name
       FROM ${parentSrc}
       JOIN private_fund_info_bfl c ON
         ${nameBaseC} IS NOT NULL AND ${nameBaseP} IS NOT NULL
         AND ${nameBaseC} = ${nameBaseP}
         AND c.product_name ~ '[ABC]类$'
         AND c.beian_hao <> p.beian_hao
       ORDER BY p.beian_hao, c.product_name ASC`,
      [eligibleCodes],
    )

    // ── Source 2: ops_team_data_products — beian family-key match ────────────
    const fkP = sqlFamilyKey("p.beian_hao")
    const fkT = sqlFamilyKey("t.beian_hao")
    const teamRows = await query<{ parent_beian_hao: string; beian_hao: string; product_name: string }>(
      `SELECT p.beian_hao AS parent_beian_hao,
              UPPER(BTRIM(t.beian_hao)) AS beian_hao,
              t.product_name
       FROM ${parentSrcCodeOnly}
       JOIN ops_team_data_products t ON
         ${fkT} IS NOT NULL AND ${fkP} IS NOT NULL
         AND ${fkT} = ${fkP}
         AND UPPER(BTRIM(t.beian_hao)) ~ '[ABC]$'
         AND UPPER(BTRIM(t.beian_hao)) <> UPPER(BTRIM(p.beian_hao))
       ORDER BY p.beian_hao, t.product_name ASC`,
      [eligibleCodes],
    )

    // ── Source 3: ops_email_nav_records — product_code family-key match ───────
    const fkE = sqlFamilyKey("e.product_code")
    const emailCodeRows = await query<{ parent_beian_hao: string; beian_hao: string; product_name: string }>(
      `SELECT DISTINCT ON (p.beian_hao, UPPER(BTRIM(e.product_code)))
         p.beian_hao AS parent_beian_hao,
         UPPER(BTRIM(e.product_code)) AS beian_hao,
         e.fund_name AS product_name
       FROM ${parentSrcCodeOnly}
       JOIN ops_email_nav_records e ON
         e.product_code IS NOT NULL
         AND NULLIF(BTRIM(e.product_code), '') IS NOT NULL
         AND UPPER(BTRIM(e.product_code)) ~ '[ABC]$'
         AND ${fkE} IS NOT NULL AND ${fkP} IS NOT NULL
         AND ${fkE} = ${fkP}
         AND UPPER(BTRIM(e.product_code)) <> UPPER(BTRIM(p.beian_hao))
       ORDER BY p.beian_hao, UPPER(BTRIM(e.product_code)), e.nav_date DESC NULLS LAST`,
      [eligibleCodes],
    )

    // ── Source 4: ops_email_nav_records — fund_name match ────────────────────
    // Handles emails where product_code is blank/parent-only but fund_name carries
    // the share class (e.g. "众量资产聚宝10号C类").
    const nameBaseE = sqlFundNameBase("e.fund_name")
    const emailNameRows = await query<{ parent_beian_hao: string; letter: string; product_name: string }>(
      `SELECT DISTINCT ON (p.beian_hao,
           CASE WHEN e.fund_name ~ 'A类$' THEN 'A' WHEN e.fund_name ~ 'B类$' THEN 'B' ELSE 'C' END)
         p.beian_hao AS parent_beian_hao,
         CASE WHEN e.fund_name ~ 'A类$' THEN 'A' WHEN e.fund_name ~ 'B类$' THEN 'B' ELSE 'C' END AS letter,
         e.fund_name AS product_name
       FROM ${parentSrc}
       JOIN ops_email_nav_records e ON
         (e.fund_name ~ 'A类$' OR e.fund_name ~ 'B类$' OR e.fund_name ~ 'C类$')
         AND ${nameBaseE} IS NOT NULL AND ${nameBaseP} IS NOT NULL
         AND ${nameBaseE} = ${nameBaseP}
       ORDER BY p.beian_hao,
         CASE WHEN e.fund_name ~ 'A类$' THEN 'A' WHEN e.fund_name ~ 'B类$' THEN 'B' ELSE 'C' END,
         e.nav_date DESC NULLS LAST`,
      [eligibleCodes],
    )

    // ── Merge all sources; BFL name wins, dedup by (parent, child beian) ──────
    const realChildren: Record<string, Map<string, ChildRow>> = {}

    function addRows(rows: Array<{ parent_beian_hao: string; beian_hao: string; product_name: string }>) {
      for (const row of rows) {
        const key = (row.beian_hao ?? "").trim().toUpperCase()
        if (!key) continue
        const map = realChildren[row.parent_beian_hao] ??= new Map()
        if (!map.has(key)) {
          map.set(key, {
            beian_hao: row.beian_hao.trim().toUpperCase(),
            product_name: (row.product_name || row.beian_hao).trim(),
          })
        }
      }
    }

    // Add in priority order (first writer wins for names)
    addRows(bflRows)
    addRows(teamRows)
    addRows(emailCodeRows)

    // Source 4: name-based — compute beian from parent + letter
    for (const row of emailNameRows) {
      if (!row.letter || !row.parent_beian_hao) continue
      const beian = tieredBeianCode(row.parent_beian_hao, row.letter)
      const key = beian.toUpperCase()
      const map = realChildren[row.parent_beian_hao] ??= new Map()
      if (!map.has(key)) {
        map.set(key, {
          beian_hao: beian,
          product_name: (row.product_name || beian).trim(),
        })
      }
    }

    // ── Build result; synthesize A/B/C for parents with no real children ─────
    const data: Record<string, Array<ChildRow & {
      synthetic: boolean
      latest_nav_date: string | null
      share_class: "A" | "B" | "C" | null
    }>> = {}

    const pending: Array<ChildRow & { synthetic: boolean; parent: string }> = []
    for (const code of eligibleCodes) {
      const childMap = realChildren[code]
      if (childMap && childMap.size > 0) {
        for (const row of childMap.values()) pending.push({ ...row, synthetic: false, parent: code })
        continue
      }

      const parentName = parentNameMap[code]
      if (!parentName) continue
      for (const letter of SHARE_CLASS_LETTERS) {
        pending.push({
          beian_hao: tieredBeianCode(code, letter),
          product_name: tieredFullName(parentName, letter),
          synthetic: true,
          parent: code,
        })
      }
    }

    const navDates = await loadLatestNavDates(pending)

    for (const row of pending) {
      const list = data[row.parent] ??= []
      list.push({
        beian_hao: row.beian_hao,
        product_name: row.product_name,
        synthetic: row.synthetic,
        latest_nav_date: navDates.get(row.beian_hao.toUpperCase()) ?? null,
        share_class: shareClassLetterOf(row.beian_hao, row.product_name),
      })
    }

    for (const code of Object.keys(data)) {
      data[code].sort((a, b) => {
        const la = a.share_class ?? "Z"
        const lb = b.share_class ?? "Z"
        if (la !== lb) return la.localeCompare(lb)
        return a.product_name.localeCompare(b.product_name, "zh")
      })
    }

    return NextResponse.json({ data })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load share classes"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
