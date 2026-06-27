import { loadManagedProductNavSeed, mergeManagedProductDetailNav } from "../../lib/server/managed-product-nav-seed.ts"
import { mergeNavSeriesWithEmail, isFofUnderlyingValuationEmailRow, selectEmailNavSeriesRows } from "../../lib/server/email-nav-query.ts"

function assert(name, ok) {
  if (!ok) throw new Error(name)
  console.log("ok:", name)
}

const ssgSeed = loadManagedProductNavSeed("SSG947")
assert("SSG947 seed loaded", ssgSeed.length > 0)
const ssgMerged = mergeNavSeriesWithEmail(ssgSeed, [])
const ssg622 = ssgMerged.find((r) => r.price_date === "2026-06-22")
assert("SSG947 0622 unit ~1.9983", Math.abs(parseFloat(ssg622.nav) - 1.9983) < 0.001)
assert("SSG947 0622 cum ~2.5632", Math.abs(parseFloat(ssg622.cum_nav_withdrawal) - 2.5632) < 0.001)
assert("SSG947 0622 adj ~2.5893", Math.abs(parseFloat(ssg622.cumulative_nav) - 2.5893) < 0.001)

const badEmailOverlay = [
  { price_date: "2026-06-23", nav: "1.9983", cumulative_nav: "1.9983", adjusted_nav: null },
  { price_date: "2026-06-24", nav: "1.9764", cumulative_nav: "1.9764", adjusted_nav: null },
]
const ssgDetail = mergeManagedProductDetailNav(ssgSeed, badEmailOverlay, [])
const ssg623 = ssgDetail.find((r) => r.price_date === "2026-06-23")
assert("SSG947 detail extends past seed", ssgDetail.length > ssgMerged.length)
assert("SSG947 0623 unit ~1.9983", Math.abs(parseFloat(ssg623.nav) - 1.9983) < 0.001)
assert("SSG947 0623 cum ~2.5632", Math.abs(parseFloat(ssg623.cum_nav_withdrawal) - 2.5632) < 0.001)
assert("SSG947 0623 adj >= cum", parseFloat(ssg623.cumulative_nav) >= parseFloat(ssg623.cum_nav_withdrawal) - 0.001)
assert("SSG947 no chart spike after email extend", ssgDetail.every((r) => parseFloat(r.cumulative_nav) < 5))

const custodyHistory = [
  {
    nav_date: "2026-06-22",
    nav: "1.9983",
    cumulative_nav: "2.5632",
    adjusted_nav: null,
    product_code: "SSG947",
    fund_name: "抱朴聚融祥和一号私募证券投资基金",
    attachment_filename: "SSG947_抱朴聚融祥和一号_资产估值表_20260622.xls",
    subject: "【基金估值表】SSG947_抱朴聚融祥和一号_资产估值表_20260622",
    source: "attachment_valuation_table",
  },
  {
    nav_date: "2026-06-23",
    nav: "1.9983",
    cumulative_nav: "1.9983",
    adjusted_nav: null,
    product_code: "SSG947",
    fund_name: "资产净值公告_SSG947_抱朴聚融祥和一号",
    attachment_filename: "资产净值公告_SSG947_20260623.xls",
    subject: "资产净值公告",
    source: "attachment_nav_table",
  },
]
const corrected = selectEmailNavSeriesRows(custodyHistory, "SSG947", ["抱朴聚融祥和一号"])
const corrected623 = corrected.find((r) => r.nav_date === "2026-06-23")
assert("SSG947 manage stream corrects cum-as-unit", Math.abs(parseFloat(corrected623.nav) - 1.557898) < 0.001)

const fofRow = {
  nav_date: "2026-05-29",
  nav: "1.99",
  cumulative_nav: "2.56",
  adjusted_nav: null,
  product_code: "SBHK26",
  fund_name: "抱朴聚融祥和一号私募证券投资基金",
  attachment_filename: "SBHK26_六妙星豪鑫6号私募证券投资基金_资产估值表_20260529_4级_抱朴聚融祥和一号私募证券投资基金.xls",
  subject: "【基金估值表】SBHK26_六妙星豪鑫6号私募证券投资基金_资产估值表_20260529_4级_抱朴聚融祥和一号私募证券投资基金",
  source: "attachment_valuation_table",
}
assert("FOF 4级 valuation rejected for SSG947", isFofUnderlyingValuationEmailRow(fofRow, "SSG947"))

console.log("SSG947 email fetch tests passed")
