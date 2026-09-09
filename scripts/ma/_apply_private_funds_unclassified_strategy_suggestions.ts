/**
 * Apply suggested 团队策略 from the 私募证券基金/未分类 CSV onto empty type6 rows.
 * Does not overwrite existing 团队策略.
 *
 *   npx tsx scripts/ma/_apply_private_funds_unclassified_strategy_suggestions.ts
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

async function main() {
  const csvPath = path.join(
    process.cwd(),
    "data",
    "private-funds-unclassified-securities-strategy-suggestions.csv",
  )
  const raw = parseCsv(fs.readFileSync(csvPath, "utf8")).slice(1)
  const byCode = new Map<string, { name: string; l1: string; l2: string | null; l3: string | null }>()
  for (const r of raw) {
    const code = (r[0] || "").trim()
    const name = (r[1] || "").trim()
    const l1 = (r[3] || "").trim()
    if (!code || !l1) continue
    byCode.set(code, {
      name: name || code,
      l1,
      l2: (r[4] || "").trim() || null,
      l3: (r[5] || "").trim() || null,
    })
  }
  const suggested = [...byCode.entries()].map(([code, v]) => ({ code, ...v }))
  console.log(`csv=${raw.length} with suggestion=${suggested.length}`)

  const { withTransaction } = await import("../../lib/db")
  const { invalidateTrackingPoolListCaches } = await import("../../lib/server/tracking-pool-membership")
  const { invalidateListResponseCache } = await import("../../lib/server/list-response-cache")
  const { invalidateDetailResponseMemoryCache } = await import("../../lib/server/fund-detail-response-memory-cache")

  const result = await withTransaction(async (txQuery) => {
    await txQuery("SET LOCAL statement_timeout = 0")
    await txQuery(`
      CREATE TEMP TABLE sug (
        beian_hao text PRIMARY KEY,
        product_name text NOT NULL,
        l1 text NOT NULL,
        l2 text,
        l3 text
      ) ON COMMIT DROP
    `)

    const chunk = 800
    for (let i = 0; i < suggested.length; i += chunk) {
      const part = suggested.slice(i, i + chunk)
      await txQuery(
        `INSERT INTO sug (beian_hao, product_name, l1, l2, l3)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])`,
        [
          part.map((x) => x.code),
          part.map((x) => x.name),
          part.map((x) => x.l1),
          part.map((x) => x.l2),
          part.map((x) => x.l3),
        ],
      )
    }

    const inserted = await txQuery<{ register_number: string }>(
      `INSERT INTO type6_ops_team_full (
         source_row_number, fund_name, fund_short_name, register_number,
         company_strategy_one, company_strategy_two, company_strategy_three,
         row_hash, source_file, imported_at, updated_at
       )
       SELECT
         (SELECT COALESCE(MAX(source_row_number), 0) FROM type6_ops_team_full)
           + ROW_NUMBER() OVER (ORDER BY s.beian_hao),
         s.product_name,
         s.product_name,
         s.beian_hao,
         s.l1,
         s.l2,
         s.l3,
         md5('csv_team_strategy_fill::' || s.beian_hao),
         'csv_team_strategy_fill',
         NOW(),
         NOW()
       FROM sug s
       WHERE NOT EXISTS (
         SELECT 1 FROM type6_ops_team_full t WHERE t.register_number = s.beian_hao
       )
       RETURNING register_number`,
    )

    const updated = await txQuery<{ register_number: string }>(
      `UPDATE type6_ops_team_full t
       SET company_strategy_one   = s.l1,
           company_strategy_two   = s.l2,
           company_strategy_three = s.l3,
           updated_at = NOW()
       FROM sug s
       WHERE t.register_number = s.beian_hao
         AND COALESCE(
               NULLIF(BTRIM(t.company_strategy_one), ''),
               NULLIF(BTRIM(t.company_strategy_two), ''),
               NULLIF(BTRIM(t.company_strategy_three), '')
             ) IS NULL
       RETURNING t.register_number`,
    )

    return {
      inserted: inserted.length,
      updated: updated.length,
      skippedHasTeam: Math.max(0, suggested.length - inserted.length - updated.length),
      wroteCodes: new Set([...inserted, ...updated].map((r) => r.register_number)),
    }
  })

  const { query } = await import("../../lib/db")
  const wrote = suggested.filter((s) => result.wroteCodes.has(s.code))
  const cacheChunk = 1000
  for (let i = 0; i < wrote.length; i += cacheChunk) {
    const part = wrote.slice(i, i + cacheChunk)
    const codes = part.map((x) => x.code)
    const l1s = part.map((x) => x.l1)
    const l2s = part.map((x) => x.l2)
    const l3s = part.map((x) => x.l3)
    const cacheSql = (table: string, extra = "") =>
      query(
        `UPDATE ${table} c
         SET company_strategy_l1 = v.l1,
             company_strategy_l2 = v.l2,
             company_strategy_l3 = v.l3
             ${extra}
             , refreshed_at = NOW()
         FROM (
           SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[])
             AS v(beian_hao, l1, l2, l3)
         ) v
         WHERE UPPER(BTRIM(c.beian_hao)) = UPPER(BTRIM(v.beian_hao))`,
        [codes, l1s, l2s, l3s],
      ).catch(() => undefined)
    await cacheSql(
      "ops_tracking_funds_list_cache",
      `, raw_strategy_json = CASE
          WHEN c.raw_strategy_json IS NULL THEN jsonb_build_object('company', jsonb_build_object(
            'strategy_one', v.l1, 'strategy_two', v.l2, 'strategy_three', v.l3
          ))
          ELSE jsonb_set(
            c.raw_strategy_json,
            '{company}',
            jsonb_build_object('strategy_one', v.l1, 'strategy_two', v.l2, 'strategy_three', v.l3),
            true
          )
        END`,
    )
    await cacheSql("ops_managed_products_list_cache")
    await cacheSql("ops_fof_overview_list_cache")
    await cacheSql("ops_investment_overview_product_cache")
    await cacheSql("ops_investment_overview_underlying_cache")
  }

  invalidateTrackingPoolListCaches([])
  invalidateListResponseCache()
  invalidateDetailResponseMemoryCache(suggested.map((s) => s.code))

  console.log(
    `done inserted=${result.inserted} updated=${result.updated} skippedHasTeam~=${result.skippedHasTeam}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
