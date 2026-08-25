/**
 * One-time backfill: create 团队笔记 from 尽调表格 rows that already have 尽调资料.
 *
 * For each row whose 尽调资料 is not 未上传:
 *   - skip if a 投资笔记 is already linked to that roadshow
 *   - if a *笔记 file exists in 尽调资料, import it as the note body
 *   - otherwise generate a note from the uploaded files + roadshow fields
 *
 * New notes are appended to the end of 团队笔记 with author `auto`.
 *
 * Usage:
 *   npx tsx scripts/ma/backfill_investment_notes_from_dd.ts --dry-run
 *   npx tsx scripts/ma/backfill_investment_notes_from_dd.ts
 *   npx tsx scripts/ma/backfill_investment_notes_from_dd.ts --limit=5
 *   npx tsx scripts/ma/backfill_investment_notes_from_dd.ts --sync-products --dry-run
 *   npx tsx scripts/ma/backfill_investment_notes_from_dd.ts --sync-products
 */

import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

function parseLimit(argv: string[]): number | undefined {
  const raw = argv.find((arg) => arg.startsWith("--limit="))
  if (!raw) return undefined
  const n = Number(raw.slice("--limit=".length))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function parseRowId(argv: string[]): string | undefined {
  const raw = argv.find((arg) => arg.startsWith("--row="))
  if (!raw) return undefined
  const id = raw.slice("--row=".length).trim()
  return id || undefined
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const syncProducts = process.argv.includes("--sync-products")
  const limit = parseLimit(process.argv)
  const rowId = parseRowId(process.argv)

  const {
    backfillInvestmentNotesFromDdMaterials,
    syncAutoNoteProductsFromLinkedRoadshows,
  } = await import("@/lib/server/investment-note-dd-backfill")

  try {
    if (syncProducts) {
      console.error(
        `[dd_note_backfill] syncing 关联产品 from linked roadshows${dryRun ? " (dry run)" : ""}…`,
      )
      const result = await syncAutoNoteProductsFromLinkedRoadshows({ dryRun })
      for (const item of result.items) {
        if (item.action === "skip-unchanged") continue
        const extra = item.productName
          ? ` ${item.productName}${item.recordNo ? ` (${item.recordNo})` : ""}`
          : ""
        console.error(
          `[dd_note_backfill] ${item.action.padEnd(16)} ${item.title} (${item.rowId})` + extra,
        )
      }
      console.error(
        `[dd_note_backfill] product sync done: scanned=${result.scanned} updated=${result.updated} ` +
          `noProduct=${result.skippedNoProduct} unchanged=${result.skippedUnchanged}` +
          (dryRun ? " dry-run" : ""),
      )
      console.log(JSON.stringify({ ok: true, ...result }))
      process.exit(0)
    }
    console.error(
      `[dd_note_backfill] scanning 尽调表格${dryRun ? " (dry run)" : ""}` +
        `${limit ? ` limit=${limit}` : ""}` +
        `${rowId ? ` row=${rowId}` : ""}…`,
    )
    const result = await backfillInvestmentNotesFromDdMaterials({ dryRun, limit, rowId })

    for (const item of result.items) {
      if (item.action === "skip-no-materials") continue
      if (item.action === "skip-missing-files" && dryRun) {
        console.error(
          `[dd_note_backfill] skip-missing-files ${item.label} (${item.rowId}) ${item.error || ""}`,
        )
        continue
      }
      const extra =
        item.action === "fail"
          ? ` ${item.error || ""}`
          : item.sourceFile
            ? ` file=${item.sourceFile}`
            : ""
      console.error(
        `[dd_note_backfill] ${item.action.padEnd(16)} ${item.label} (${item.rowId})` + extra,
      )
    }

    console.error(
      `[dd_note_backfill] done: scanned=${result.scanned} withMaterials=${result.withMaterials} ` +
        `skippedLinked=${result.skippedLinked} skippedEmpty=${result.skippedNoMaterials} ` +
        `created=${result.created} imported=${result.imported} generated=${result.generated} ` +
        `failed=${result.failed}` +
        (dryRun ? " dry-run" : ""),
    )

    console.log(
      JSON.stringify({
        ok: result.failed === 0,
        ...result,
        items: result.items.filter((item) => item.action !== "skip-no-materials"),
      }),
    )
    process.exit(result.failed > 0 && !dryRun ? 1 : 0)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[dd_note_backfill] fatal:", message)
    console.log(JSON.stringify({ ok: false, error: message }))
    process.exit(1)
  }
}

main()
