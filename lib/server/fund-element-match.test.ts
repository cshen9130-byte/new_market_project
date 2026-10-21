import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  adoptMatchedRegisterNumber,
  discardDisagreedRegister,
  pickHighConfidenceFundMatch,
  type ExtractedFundElements,
  type FundMatchCandidate,
} from "./fund-contract-element-extract"
import { fundNameCore } from "./fund-picker-search"
import { mergeOfficialProductRow } from "./fund-name-match"

function elements(patch: Partial<ExtractedFundElements>): ExtractedFundElements {
  return {
    fund_name: null,
    register_number: null,
    advisor: null,
    fund_manager: null,
    inception_date: null,
    puton_date: null,
    custodian: null,
    open_day: null,
    is_temporary_open: null,
    fee_purchase: null,
    add_amount: null,
    fee_redeem: null,
    precautious_line: null,
    closed_period: null,
    stop_line: null,
    fee_manage_rate: null,
    fee_trust: null,
    fee_manage: null,
    fee_admin_service: null,
    fee_pay: null,
    risk_level: null,
    lock_period_desc: null,
    fee_pay_formula: null,
    ...patch,
  }
}

const zhixing: FundMatchCandidate[] = [
  { beian_hao: "SD7207", product_name: "知行投资基金", short_name: null },
  {
    beian_hao: "SS8256",
    product_name: "知行稳健1号",
    short_name: "知行稳健1号私募证券投资基金",
  },
  {
    beian_hao: "S8256C",
    product_name: "知行稳健1号私募证券投资基金C类",
    short_name: "知行稳健1号私募证券投资基金C类",
  },
]

describe("fund name core", () => {
  it("keeps the series number after stripping 私募投资基金", () => {
    assert.equal(fundNameCore("知行稳健1号私募投资基金"), "知行稳健1号")
    assert.equal(fundNameCore("知行投资基金"), "知行")
    assert.equal(fundNameCore("知行稳健1号私募证券投资基金"), "知行稳健1号")
  })
})

describe("renamed product keeps the current name", () => {
  const current = "图斯和贞二号私募证券投资基金"
  const former = "图斯鑫源森私募证券投资基金"
  const sw2824: FundMatchCandidate[] = [
    {
      beian_hao: "SW2824",
      product_name: current,
      short_name: null,
      former_names: [former],
    },
  ]

  it("treats a real AMAC rename as the current name and remembers the 曾用名", () => {
    const merged = mergeOfficialProductRow(
      { beian_hao: "SW2824", product_name: former, short_name: null },
      current,
    )
    assert.equal(merged.product_name, current)
    assert.equal(merged.short_name, null)
    assert.deepEqual(merged.former_names, [former])
  })

  it("does not treat a suffix-only difference as a rename", () => {
    const merged = mergeOfficialProductRow(
      { beian_hao: "SW2824", product_name: "图斯和贞二号", short_name: null },
      current,
    )
    assert.equal(merged.product_name, "图斯和贞二号")
    assert.equal(merged.former_names, undefined)
  })

  it("recognizes SW2824 when the contract uses the current name", () => {
    const extracted = elements({ fund_name: current, register_number: "SW2824" })
    assert.equal(discardDisagreedRegister(extracted, sw2824).register_number, "SW2824")
    assert.equal(pickHighConfidenceFundMatch(extracted, sw2824)?.product_name, current)
  })

  it("still matches SW2824 when the contract uses the former name", () => {
    const extracted = elements({ fund_name: former, register_number: "SW2824" })
    assert.equal(discardDisagreedRegister(extracted, sw2824).register_number, "SW2824")
    assert.equal(pickHighConfidenceFundMatch(extracted, sw2824)?.product_name, current)
  })
})

describe("知行稳健1号 vs 知行投资基金", () => {
  it("does not auto-match SD7207 when the extracted name is 知行稳健1号", () => {
    const extracted = elements({
      fund_name: "知行稳健1号私募投资基金",
      register_number: "SD7207",
    })
    const stripped = discardDisagreedRegister(extracted, zhixing)
    assert.equal(stripped.register_number, null)
    const picked = pickHighConfidenceFundMatch(stripped, zhixing)
    assert.equal(picked?.beian_hao, "SS8256")
    assert.equal(adoptMatchedRegisterNumber(stripped, picked).register_number, "SS8256")
  })
})