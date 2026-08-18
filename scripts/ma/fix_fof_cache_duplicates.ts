import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { removeFofUnderlyingSummaryAliases } = await import(
    "@/lib/server/fof-underlying-auto-add-pg"
  )
  const n = await removeFofUnderlyingSummaryAliases()
  console.log(`Removed ${n} FOF底层 alias duplicate(s).`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
