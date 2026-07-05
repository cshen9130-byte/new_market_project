/**
 * Nightly due diligence materials auto-link ETL.
 *
 * Matches 尽调表格 rows to folders under 「内部尽调资料」 in the AI knowledge base,
 * updates ddMaterials / ddMaterialsKbPath, and clears stale wrong links.
 *
 * Usage (via nightly_etl.py):
 *   npx tsx scripts/ma/dd_materials_link_etl.ts
 *
 * Run directly:
 *   npx tsx scripts/ma/dd_materials_link_etl.ts [--dry-run]
 */

import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"
import { syncDueDiligenceMaterialsLinks } from "@/lib/server/due-diligence-materials-sync"

loadProjectEnvFiles()
configureEtlDbTimeout()

async function main() {
  const dryRun = process.argv.includes("--dry-run")

  try {
    console.error(
      `[dd_materials_link_etl] syncing due diligence material links${dryRun ? " (dry run)" : ""}…`,
    )
    const result = await syncDueDiligenceMaterialsLinks({
      updatedBy: "nightly_etl",
      dryRun,
    })

    for (const change of result.changes) {
      console.error(
        `[dd_materials_link_etl] ${change.fundCompany || change.rowId} (${change.ddDate}): ` +
          `${change.fromPath || "(empty)"} -> ${change.toPath || "(empty)"}`,
      )
    }

    console.error(
      `[dd_materials_link_etl] done: folders=${result.kbFolderCount} ` +
        `changed=${result.changedRows} linked=${result.linkedRows} cleared=${result.clearedRows}` +
        (result.saved ? " saved" : dryRun ? " dry-run" : ""),
    )

    console.log(
      JSON.stringify({
        ok: true,
        dryRun,
        totalRows: result.totalRows,
        changedRows: result.changedRows,
        linkedRows: result.linkedRows,
        clearedRows: result.clearedRows,
        kbFolderCount: result.kbFolderCount,
        saved: result.saved,
        changes: result.changes.slice(0, 50),
      }),
    )
    process.exit(0)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[dd_materials_link_etl] fatal:", message)
    console.log(
      JSON.stringify({
        ok: false,
        error: message,
        totalRows: 0,
        changedRows: 0,
        linkedRows: 0,
        clearedRows: 0,
        kbFolderCount: 0,
        saved: false,
      }),
    )
    process.exit(1)
  }
}

main()
