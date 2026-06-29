import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const {
    resolveFundBeianHao,
    resolveRouteFundId,
    lookupFundInfoFallback,
  } = await import("@/lib/server/fof-underlying-query")
  const { lookupManagedProductOverride, resolveManagedProductBeian } = await import(
    "@/lib/server/managed-product-beian",
  )

  for (const id of ["BAH99A", "荣熙恒盈2号A类", "SBAH99", "荣熙恒盈2号"]) {
    const route = await resolveRouteFundId(id)
    const resolved = await resolveFundBeianHao(id)
    const managed = lookupManagedProductOverride(id)
    const beian = resolveManagedProductBeian(id)
    const info = await lookupFundInfoFallback(id)
    console.log(id, {
      route,
      resolved,
      managed,
      beian,
      product_name: info?.product_name ?? null,
      info_beian: info?.beian_hao ?? null,
    })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
