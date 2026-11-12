import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
import { runCi011001RebuildEtl } from "@/lib/server/ci011001-rebuild-etl-job"

async function main() {
  loadProjectEnvFiles()
  const force = process.argv.includes("--force")
  const skipRebuild = process.argv.includes("--skip-rebuild")
  const result = await runCi011001RebuildEtl({ force, skipRebuild })
  console.log(JSON.stringify(result, null, 2))
  if (result.status === "error") process.exit(1)
}

void main()
