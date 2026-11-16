/**
 *   npx tsx --test lib/ma/mom-underlying.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { shapeMomUnderlyingTable, type MomUnderlyingRow } from "@/lib/ma/mom-underlying"

function row(patch: Partial<MomUnderlyingRow> & Pick<MomUnderlyingRow, "kind" | "product_name" | "account">): MomUnderlyingRow {
  return {
    id: `${patch.kind}:${patch.account}`,
    link_source: "saved",
    beian_hao: "SJK934",
    account_note: null,
    note: null,
    strategy: "量化",
    latest_nav: "2.6577",
    latest_nav_date: "2026-11-03",
    latest_price_change: "-0.0148",
    equity: "29303954.00",
    equity_date: "2026-11-13",
    updated_by: null,
    updated_at: null,
    ...patch,
  }
}

describe("MOM底层 table shape", () => {
  const rows = [
    row({ kind: "compare", product_name: "艾方CTA一号", account: "rx348", beian_hao: "SJK934" }),
    row({
      kind: "account",
      product_name: "单账户产品",
      account: "807636",
      beian_hao: "SZZ001",
      latest_nav: null,
      latest_price_change: null,
      equity: "1000.5",
      strategy: null,
    }),
  ]

  it("turns the stored return ratio into percentage points", () => {
    const shaped = shapeMomUnderlyingTable(rows)
    assert.equal(shaped.rows[0]?.price_change_pct, -1.48)
    assert.equal(shaped.rows[0]?.latest_nav, 2.6577)
    assert.equal(shaped.rows[0]?.equity, 29303954)
    assert.equal(shaped.rows[0]?.kind_label, "对比账户")
    assert.equal(shaped.compare_count, 1)
    assert.equal(shaped.account_count, 1)
  })

  it("filters by kind without changing the full-table counts", () => {
    const shaped = shapeMomUnderlyingTable(rows, { kind: "account", q: "807636" })
    assert.equal(shaped.total, 1)
    assert.equal(shaped.rows[0]?.account, "807636")
    assert.equal(shaped.rows[0]?.price_change_pct, null)
    assert.equal(shaped.compare_count, 1)
    assert.equal(shaped.account_count, 1)
  })

  it("matches product name, code, or account", () => {
    assert.equal(shapeMomUnderlyingTable(rows, { q: "艾方" }).total, 1)
    assert.equal(shapeMomUnderlyingTable(rows, { q: "szz001" }).rows[0]?.reg_code, "SZZ001")
  })
})
