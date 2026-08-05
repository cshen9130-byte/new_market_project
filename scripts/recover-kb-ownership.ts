/**
 * Recover knowledge-base ownership records from backups / notes meta / name prefixes.
 *
 * Usage (on server):
 *   npx tsx scripts/recover-kb-ownership.ts --dry-run
 *   npx tsx scripts/recover-kb-ownership.ts
 *   npx tsx scripts/recover-kb-ownership.ts --no-name-prefix
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

async function main() {
  const args = new Set(process.argv.slice(2))
  const dryRun = args.has("--dry-run")
  const useNamePrefix = !args.has("--no-name-prefix")

  const { recoverKnowledgeBaseOwnership } = await import("@/lib/server/knowledge-base-ownership-recover")
  const {
    getKnowledgeBaseOwnershipFilePath,
    getKnowledgeBaseOwnershipStorageDir,
  } = await import("@/lib/server/knowledge-base")

  console.log("Ownership file:", getKnowledgeBaseOwnershipFilePath())
  console.log("Metadata dir :", getKnowledgeBaseOwnershipStorageDir())
  console.log("Mode         :", dryRun ? "dry-run" : "write")
  console.log("Name prefix  :", useNamePrefix ? "on" : "off")

  const report = await recoverKnowledgeBaseOwnership({ dryRun, useNamePrefix })
  console.log(JSON.stringify(report, null, 2))

  if (dryRun) {
    console.log("\nDry run only — re-run without --dry-run to write recovered records.")
  } else {
    console.log(`\nRecovered ownership: ${report.beforeCount} → ${report.afterCount} (+${report.addedCount})`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
