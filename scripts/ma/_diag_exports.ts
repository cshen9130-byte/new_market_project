import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

async function main() {
  ensureScriptDatabaseEnv()
  const { query } = await import("../../lib/db")
  const { loadPrivateFundLegacyNavRows } = await import("../../lib/server/fund-nav-series")
  // Actually find exports
  const mod = await import("../../lib/server/email-nav-query")
  console.log(Object.keys(mod).filter(k => /merge|final|repair|legacy|load/i.test(k)).join(", "))
}
main().catch(e=>{console.error(e);process.exit(1)})
