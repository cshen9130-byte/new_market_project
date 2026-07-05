/**
 * One-off helper — same logic as nightly dd_materials_links step.
 * Prefer: npx tsx scripts/ma/dd_materials_link_etl.ts [--dry-run]
 */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "../../lib/server/load-project-env.ts"
import { syncDueDiligenceMaterialsLinks } from "../../lib/server/due-diligence-materials-sync.ts"

loadProjectEnvFiles()
configureEtlDbTimeout()

const dryRun = process.argv.includes("--dry-run")
const result = await syncDueDiligenceMaterialsLinks({ updatedBy: "fix_dd_materials_links", dryRun })

for (const change of result.changes) {
  console.log("fix:", {
    date: change.ddDate,
    company: change.fundCompany,
    from: change.fromPath,
    to: change.toPath,
    materials: change.ddMaterials,
  })
}

if (result.changedRows === 0) {
  console.log("No due diligence material links needed fixing.")
} else {
  console.log(
    `Updated ${result.changedRows} row(s)${dryRun ? " (dry run)" : ""}. ` +
      `linked=${result.linkedRows} cleared=${result.clearedRows}`,
  )
}

process.exit(0)
