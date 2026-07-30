import { getServerStorageRoot } from "../../lib/server/storage"
import { findCustomFundByName, getCustomFundByCode } from "../../lib/server/custom-funds"
import { getCustomFundNavGenerationRule } from "../../lib/server/custom-fund-nav-rules"
import { listCustomFundNavRows } from "../../lib/server/custom-fund-nav"
import {
  resolveFofWeeklyProductNavRange,
  resolveProductBeianHao,
} from "../../lib/server/fof-weekly-report"
import { loadFundNavRange, resolveFundNames } from "../../lib/server/fund-nav-series"
import { existsSync, readdirSync } from "fs"
import path from "path"

async function main() {
  console.log("storageRoot", getServerStorageRoot())
  const cfDir = path.join(getServerStorageRoot(), "custom_funds")
  console.log("custom_funds exists", existsSync(cfDir))
  if (existsSync(cfDir)) {
    console.log("custom_funds entries", readdirSync(cfDir))
  }

  const name = "低波稳健FOF 1号"
  const custom = findCustomFundByName(name)
  console.log("customFund", custom)
  if (custom) {
    console.log("rule", getCustomFundNavGenerationRule(custom.product_code))
    const rows = listCustomFundNavRows(custom.product_code)
    console.log({
      count: rows.length,
      firstDesc: rows[0]?.nav_date,
      lastDesc: rows.at(-1)?.nav_date,
    })
  }

  try {
    const beian = await resolveProductBeianHao(name)
    console.log("resolvedBeian", beian)
    console.log("asCustom", getCustomFundByCode(beian))
  } catch (e) {
    console.log("resolveBeian error", e instanceof Error ? e.message : e)
  }

  try {
    console.log("range", await resolveFofWeeklyProductNavRange(name))
  } catch (e) {
    console.log("range error", e instanceof Error ? e.message : e)
  }

  try {
    const names = await resolveFundNames("SBPU97", "衡颐海泰1号")
    console.log("sbpu97 names", names)
    console.log("sbpu97 range", await loadFundNavRange("SBPU97", names.product_name, names.short_name))
  } catch (e) {
    console.log("sbpu97 error", e instanceof Error ? e.message : e)
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
