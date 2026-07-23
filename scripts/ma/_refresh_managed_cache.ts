import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()

async function main() {
  const { refreshManagedProductsListCache } = await import(
    "@/lib/server/managed-products-list-cache-pg"
  )
  const rows = await refreshManagedProductsListCache()
  console.log(JSON.stringify({ ok: true, rows }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
