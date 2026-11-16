/**
 *   npx tsx --test lib/ma/investment-review-shape.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  pickGroupHighlights,
  ratioToPct,
  shapeFofUnderlyingPage,
  shapeReviewProduct,
  shapeWeeklyStatus,
} from "@/lib/ma/investment-review-shape"
import type { WeeklyReviewDataStatus } from "@/lib/weekly-review-data-status"

describe("investment review units", () => {
  it("turns a stored return ratio into percentage points", () => {
    assert.equal(ratioToPct("-0.0036"), -0.36)
    assert.equal(ratioToPct(0.0061), 0.61)
    assert.equal(ratioToPct(null), null)
  })

  it("shapes a FOF底层 row the way the summary table shows it", () => {
    const shaped = shapeFofUnderlyingPage({
      total: 98,
      page: 1,
      pageSize: 50,
      totalPages: 2,
      totalMarketValue: "1000000.5",
      data: [{
        product_name: "卓盛润和1号",
        short_name: "卓盛润和1号",
        beian_hao: "SXK199",
        strategy_l1: "股票多头",
        latest_nav: "1.3650",
        latest_nav_date: "2026-11-13",
        latest_price_change: "0.0061",
        market_value: "8004678.34",
        open_day: "每周二",
        ret_1w: "-0.0036",
        sharpe_1y: "1.2",
        first_entry_date: "2026-11-16",
      }],
    })
    assert.equal(shaped.total, 98)
    assert.equal(shaped.total_market_value, 1000000.5)
    assert.equal(shaped.rows[0]?.price_change_pct, 0.61)
    assert.equal(shaped.rows[0]?.ret_1w_pct, -0.36)
    assert.equal(shaped.rows[0]?.latest_nav, 1.365)
    assert.equal(shaped.rows[0]?.open_day, "每周二")
    assert.equal(shaped.rows[0]?.market_value, 8004678.34)
  })

  it("uses excess for the week column of an excess group and keeps both series", () => {
    const product = shapeReviewProduct({
      beian_hao: "S1",
      name: "指增A",
      mode: "excess",
      ret: { ret_1w: 0.02, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null },
      excess: { ret_1w: 0.0081, ret_1m: 0.01, ret_3m: null, ret_6m: null, ret_1y: null },
      excess_dd_6m: -0.05,
      excess_dd_1y: null,
      sharpe_1y: null,
      calmar_1y: null,
    })
    assert.equal(product.week_pct, 0.81)
    assert.equal(product.ret_1w_pct, 2)
    assert.equal(product.excess_dd_6m_pct, -5)
  })

  it("keeps the median on the whole group when only highlights are returned", () => {
    const products = [1, 2, 3, 4, 5].map((n) => shapeReviewProduct({
      beian_hao: `S${n}`,
      name: `产品${n}`,
      mode: "absolute",
      ret: { ret_1w: n / 100, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null },
      excess: { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null },
      excess_dd_6m: null,
      excess_dd_1y: null,
      sharpe_1y: 1,
      calmar_1y: null,
    }))
    const picked = pickGroupHighlights(products, { top: 1, bottom: 1 })
    assert.equal(picked.count, 5)
    assert.equal(picked.median_week_pct, 3)
    assert.equal(picked.products[0]?.name, "产品5")
    assert.equal(picked.truncated, true)
    assert.equal(pickGroupHighlights(products, { q: "产品1" }).products[0]?.reg_code, "S1")
  })

  it("labels a ready week and the sources of the names still missing", () => {
    const report: WeeklyReviewDataStatus = {
      variant: "equity",
      weeks: [{ week_start: "2026-11-09", week_end: "2026-11-13" }],
      fund_count: 80,
      generated_at: "2026-11-16T08:00:00.000Z",
      categories: [{
        bucket: "500指增",
        mode: "excess",
        total: 80,
        weeks: [{
          week_start: "2026-11-09",
          week_end: "2026-11-13",
          missing: 7,
          by_source: { email: 1, manual: 0, fof99: 5, none: 1 },
        }],
        missing_funds: [],
      }],
    }
    const shaped = shapeWeeklyStatus(report)
    assert.equal(shaped.categories[0]?.mode_label, "超额收益 / 超额最大回撤")
    assert.equal(shaped.categories[0]?.weeks[0]?.ready, false)
    assert.match(shaped.categories[0]?.weeks[0]?.missing_sources ?? "", /邮箱抓取 1/)
    assert.match(shaped.categories[0]?.weeks[0]?.missing_sources ?? "", /fof99 5/)
  })
})
