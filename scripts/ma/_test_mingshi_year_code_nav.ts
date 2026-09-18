/**
 * Scoped checks for 鸣石广胜 /2026 year-code isolation.
 * Does not run the full NAV rechain suite (SBBC18 and other already-fixed funds).
 */
import { emailRowMatchesFund } from "../../lib/server/email-nav-query.ts"
import { canonicalizeFundRouteId } from "../../lib/server/managed-product-beian.ts"
import { applyEmailProductCodeOverride } from "../../lib/server/email-nav-extract.ts"

function assert(name, ok) {
  if (!ok) throw new Error(name)
  console.log("ok:", name)
}

assert(
  "year route /2026 is rejected; C2026 still remaps to SBDU00",
  canonicalizeFundRouteId("2026") == null
    && canonicalizeFundRouteId("C2026") === "SBDU00"
    && canonicalizeFundRouteId("SBNJ90") === "SBNJ90"
    && canonicalizeFundRouteId("SND951") === "SND951"
    && canonicalizeFundRouteId("SBAH99") === "SBAH99",
)
assert(
  "C2026 extract remap unchanged",
  applyEmailProductCodeOverride("C2026", "桫罗稳鸿", "桫罗稳鸿私募证券投资基金2026-07-30") === "SBDU00",
)
assert(
  "鸣石广鸣 2.5552 does not attach to 鸣石广胜 SBNJ90",
  emailRowMatchesFund(
    {
      product_code: "2026",
      fund_name: "鸣石广鸣中证1000指数增强1号",
      nav_date: "2026-09-16",
      nav: "2.555200",
      cumulative_nav: "3.091300",
      adjusted_nav: null,
      source: "body_table",
      subject: "2026年09月16日净值",
      attachment_filename: null,
    },
    "SBNJ90",
    ["鸣石广胜中证A500指数增强1号量化"],
  ) === false,
)
assert(
  "鸣石广胜 year-code email still matches SBNJ90 by name",
  emailRowMatchesFund(
    {
      product_code: "2026",
      fund_name: "鸣石广胜中证A500指数增强1号量化",
      nav_date: "2026-09-17",
      nav: "0.863100",
      cumulative_nav: "1.399200",
      adjusted_nav: null,
      source: "body_table",
      subject: "2026年09月17日净值",
      attachment_filename: null,
    },
    "SBNJ90",
    ["鸣石广胜中证A500指数增强1号量化"],
  ) === true,
)
assert(
  "草本致远 / SND951 year-code match is unchanged",
  emailRowMatchesFund(
    {
      product_code: "2026",
      fund_name: "草本致远1号",
      nav_date: "2026-09-16",
      nav: "1.044000",
      cumulative_nav: "3.474000",
      adjusted_nav: null,
      source: "body_table",
      subject: "2026年09月16日净值",
      attachment_filename: null,
    },
    "SND951",
    ["草本致远1号"],
  ) === true,
)
assert(
  "year product_code still does not attach 鸣石 NAV to 草本致远 /2026",
  emailRowMatchesFund(
    {
      product_code: "2026",
      fund_name: "鸣石广鸣中证1000指数增强1号",
      nav_date: "2026-09-16",
      nav: "2.555200",
      cumulative_nav: "3.091300",
      adjusted_nav: null,
      source: "body_table",
      subject: "2026年09月16日净值",
      attachment_filename: null,
    },
    "2026",
    ["草本致远1号"],
  ) === false,
)

console.log("mingshi year-code scoped checks passed")
