/**
 *   npx tsx --test lib/server/account-risk-account-overview.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { shapeAccountOverviewTable, type AccountOverviewRow } from "@/lib/server/account-risk-account-overview"

function row(patch: Partial<AccountOverviewRow> & Pick<AccountOverviewRow, "accountNo" | "equity" | "margin">): AccountOverviewRow {
  return {
    fundName: "甲",
    companyName: "银河期货",
    pm: "ZS",
    selectKey: patch.accountNo,
    tradeDate: "2026-11-16",
    totalPl: 0,
    holdingPl: 0,
    closedPl: 0,
    riskPct: null,
    unilateralRiskPct: null,
    commission: 0,
    nav: [1, 1.1],
    ...patch,
  }
}

describe("account overview table shape", () => {
  it("totals risk from summed margin and equity, not an average of ratios", () => {
    const shaped = shapeAccountOverviewTable([
      row({ accountNo: "1", equity: 100, margin: 20, riskPct: 20, unilateralRiskPct: 5, totalPl: 10, fundName: "甲", companyName: "银河期货" }),
      row({ accountNo: "2", equity: 300, margin: 30, riskPct: 10, unilateralRiskPct: 15, totalPl: -4, fundName: "乙", companyName: "国泰君安期货" }),
    ])
    assert.equal(shaped.total.equity, 400)
    assert.equal(shaped.total.margin, 50)
    assert.equal(shaped.total.risk_pct, 12.5)
    assert.equal(shaped.total.unilateral_risk_pct, 12.5)
    assert.equal(shaped.total.daily_pnl, 6)
    assert.equal(shaped.rows[0]?.nav_return_pct, 10)
    assert.equal(shaped.as_of, "2026-11-16")
  })

  it("filters by product, company, account, or PM", () => {
    const rows = [
      row({ accountNo: "85121150", equity: 10, margin: 1, fundName: "衡跃海泰1号", companyName: "银河期货", pm: "ZS" }),
      row({ accountNo: "8001305006", equity: 10, margin: 1, fundName: "其他", companyName: "国泰君安期货", pm: "LY" }),
    ]
    assert.equal(shapeAccountOverviewTable(rows, { q: "银河" }).rows.length, 1)
    assert.equal(shapeAccountOverviewTable(rows, { q: "85121150" }).rows[0]?.account, "85121150")
    assert.equal(shapeAccountOverviewTable(rows, { q: "LY" }).rows[0]?.pm, "LY")
  })

  it("groups by futures company", () => {
    const shaped = shapeAccountOverviewTable([
      row({ accountNo: "1", equity: 10, margin: 1, companyName: "银河期货" }),
      row({ accountNo: "2", equity: 30, margin: 3, companyName: "银河期货" }),
    ], { group: "company" })
    assert.equal(shaped.rows.length, 1)
    assert.equal(shaped.rows[0]?.company, "银河期货")
    assert.equal(shaped.rows[0]?.account, "2个账号")
    assert.equal(shaped.rows[0]?.equity, 40)
    assert.equal(shaped.rows[0]?.nav.length, 0)
  })
})
