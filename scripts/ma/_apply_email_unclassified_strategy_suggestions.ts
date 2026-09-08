/**
 * Apply suggested 团队策略 from the unclassified CSV onto empty type6 rows.
 *   npx tsx scripts/ma/_apply_email_unclassified_strategy_suggestions.ts
 */
import fs from "fs"
import path from "path"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ""
  let inQ = false
  const src = text.replace(/^\uFEFF/, "")
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '"') {
      if (inQ && src[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQ = !inQ
      }
    } else if (c === "," && !inQ) {
      row.push(cur)
      cur = ""
    } else if ((c === "\n" || c === "\r") && !inQ) {
      if (c === "\r" && src[i + 1] === "\n") i++
      row.push(cur)
      if (row.some((x) => x.length)) rows.push(row)
      row = []
      cur = ""
    } else {
      cur += c
    }
  }
  if (cur.length || row.length) {
    row.push(cur)
    if (row.some((x) => x.length)) rows.push(row)
  }
  return rows
}

function shareClassFromName(name: string): string {
  const m = name.match(/([ABC])类/u)
  return m ? m[1].toUpperCase() : ""
}

function codeVariants(code: string, name = ""): string[] {
  const c = code.trim().toUpperCase()
  if (!c) return []
  const out = new Set<string>([c])
  const noShare = c.replace(/[ABC]$/u, "")
  if (noShare && noShare !== c) {
    out.add(noShare)
    if (!noShare.startsWith("S") && noShare.length >= 5) out.add(`S${noShare}`)
  }
  if (!c.startsWith("S") && /^[A-Z]/.test(c) && c.length >= 5) out.add(`S${c}`)
  if (c.startsWith("S") && c.length >= 6) out.add(c.slice(1))
  const cls = shareClassFromName(name)
  if (cls) {
    for (const x of [...out]) {
      if (!x.endsWith(cls)) out.add(`${x}${cls}`)
    }
  }
  return [...out]
}

function nameVariants(name: string): string[] {
  const n = name.trim()
  const out = new Set<string>([n])
  const stripped = n
    .replace(/[（(][ABC]类份额[)）]?$/u, "")
    .replace(/[ABC]类(份额)?$/u, "")
    .trim()
  if (stripped) out.add(stripped)
  const noFund = stripped
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金|集合资产管理计划)$/u, "")
    .trim()
  if (noFund) {
    out.add(noFund)
    out.add(`${noFund}私募证券投资基金`)
  }
  return [...out].filter((s) => s.length >= 2)
}

async function main() {
  const csvPath = path.join(process.cwd(), "data", "email-ops-unclassified-strategy-suggestions.csv")
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8")).slice(1)
  const suggested = rows.filter((r) => (r[3] || "").trim())
  console.log(`csv=${rows.length} with suggestion=${suggested.length}`)

  const { query } = await import("../../lib/db")
  const { addFundToTrackingPool } = await import("../../lib/server/tracking-pool-membership")
  const { syncCompanyStrategyCaches } = await import("../../lib/server/company-strategy-sync")
  const { invalidateTeamDataListCaches } = await import("../../lib/server/team-data-query-pg")
  const { invalidateListResponseCache } = await import("../../lib/server/list-response-cache")

  type Existing = {
    register_number: string
    fund_name: string | null
    l1: string | null
    l2: string | null
    l3: string | null
  }

  const cacheUpdates: Array<{
    beian_hao: string
    strategy_l1: string | null
    strategy_l2: string | null
    strategy_l3: string | null
    product_name: string | null
  }> = []

  let updated = 0
  let inserted = 0
  let skippedHasTeam = 0
  let failed = 0

  for (const r of suggested) {
    const code = (r[0] || "").trim()
    const name = (r[1] || "").trim()
    const l1 = (r[3] || "").trim() || null
    const l2 = (r[4] || "").trim() || null
    const l3 = (r[5] || "").trim() || null
    if (!l1) continue

    const names = nameVariants(name)
    let resolvedCode = code
    if (!resolvedCode && names.length) {
      const amac = await query<{ beian_hao: string }>(
        `SELECT beian_hao
           FROM private_fund_info
          WHERE product_name = ANY($1::text[])
             OR product_name ILIKE $2
          ORDER BY CASE WHEN product_name = ANY($1::text[]) THEN 0 ELSE 1 END
          LIMIT 1`,
        [names, `%${name}%`],
      )
      if (amac[0]?.beian_hao) resolvedCode = amac[0].beian_hao.trim()
    }
    const codes = codeVariants(resolvedCode, name)

    let existing: Existing[] = []
    if (codes.length) {
      existing = await query<Existing>(
        `SELECT register_number,
                COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) AS fund_name,
                NULLIF(BTRIM(company_strategy_one), '') AS l1,
                NULLIF(BTRIM(company_strategy_two), '') AS l2,
                NULLIF(BTRIM(company_strategy_three), '') AS l3
           FROM type6_ops_team_full
          WHERE register_number = ANY($1::text[])`,
        [codes],
      )
    }
    if (!existing.length && names.length) {
      existing = await query<Existing>(
        `SELECT register_number,
                COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) AS fund_name,
                NULLIF(BTRIM(company_strategy_one), '') AS l1,
                NULLIF(BTRIM(company_strategy_two), '') AS l2,
                NULLIF(BTRIM(company_strategy_three), '') AS l3
           FROM type6_ops_team_full
          WHERE fund_short_name = ANY($1::text[])
             OR fund_name = ANY($1::text[])
          LIMIT 8`,
        [names],
      )
    }

    const emptyRows = existing.filter((x) => !x.l1 && !x.l2 && !x.l3)
    const filledRows = existing.filter((x) => x.l1 || x.l2 || x.l3)
    const writeCode = code || resolvedCode
    const cls = shareClassFromName(name)
    const shareWriteCode =
      writeCode && cls && !writeCode.toUpperCase().endsWith(cls) ? `${writeCode}${cls}` : ""
    const neededCodes = [writeCode, shareWriteCode].filter(Boolean)
    const displayMissing = neededCodes.some(
      (c) => !existing.some((x) => x.register_number.toUpperCase() === c.toUpperCase()),
    )

    if (filledRows.length && !emptyRows.length && !displayMissing) {
      skippedHasTeam++
      console.log(`skip has-team ${code} ${name} @ ${filledRows.map((x) => x.register_number).join(",")}`)
      continue
    }

    const targets = new Set<string>()
    for (const row of emptyRows) targets.add(row.register_number)
    if (writeCode) targets.add(writeCode)
    if (shareWriteCode) targets.add(shareWriteCode)
    if (!targets.size && existing[0]?.register_number) targets.add(existing[0].register_number)

    if (!targets.size) {
      failed++
      console.log(`fail no-target ${code} ${name}`)
      continue
    }

    for (const target of targets) {
      const already = existing.find((x) => x.register_number === target)
      if (already && (already.l1 || already.l2 || already.l3)) continue

      if (!already) {
        try {
          const created = await addFundToTrackingPool("bfl_ops", target, name || target)
          if (created.created) inserted++
        } catch (e) {
          console.log(`insert-fail ${target} ${(e as Error).message}`)
        }
      }

      const wrote = await query<{ register_number: string }>(
        `UPDATE type6_ops_team_full
         SET company_strategy_one   = $2,
             company_strategy_two   = $3,
             company_strategy_three = $4,
             updated_at = NOW()
         WHERE register_number = $1
           AND COALESCE(
                 NULLIF(BTRIM(company_strategy_one), ''),
                 NULLIF(BTRIM(company_strategy_two), ''),
                 NULLIF(BTRIM(company_strategy_three), '')
               ) IS NULL
         RETURNING register_number`,
        [target, l1, l2, l3],
      )
      if (wrote.length) {
        updated++
        cacheUpdates.push({
          beian_hao: target,
          strategy_l1: l1,
          strategy_l2: l2,
          strategy_l3: l3,
          product_name: name,
        })
        console.log(`write ${target}  ${name}  →  ${[l1, l2, l3].filter(Boolean).join(" / ")}`)
      }
    }
  }

  const chunk = 40
  for (let i = 0; i < cacheUpdates.length; i += chunk) {
    await syncCompanyStrategyCaches(cacheUpdates.slice(i, i + chunk))
  }
  invalidateTeamDataListCaches()
  invalidateListResponseCache("ops-team-data")
  invalidateListResponseCache()

  console.log(`done updated=${updated} inserted=${inserted} skippedHasTeam=${skippedHasTeam} failed=${failed} cache=${cacheUpdates.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
