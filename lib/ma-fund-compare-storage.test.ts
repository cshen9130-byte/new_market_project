import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import {
  adoptOpenedFundCompare,
  compareIdFromPathname,
  fundCompareHref,
  readCompareDraft,
  resolveOpenedFundCompare,
  saveFundCompare,
  type SavedFundCompare,
} from "./ma-fund-compare-storage.ts"

function sampleCompare(id = "cmp-1793347836397"): SavedFundCompare {
  return {
    id,
    name: "荣熙恒盈1号A类等19只",
    scope: "team",
    funds: [
      {
        beian_hao: "SCU622",
        product_name: "荣熙恒盈1号A类",
        manager: null,
        fund_type: "私募",
        nav_start_date: null,
        latest_nav_date: "2026-10-28",
        inception_date: null,
        ret_ann_since_inception: null,
      },
      {
        beian_hao: "SBRM35",
        product_name: "稳和稳健债基A类",
        manager: null,
        fund_type: "私募",
        nav_start_date: null,
        latest_nav_date: "2026-10-28",
        inception_date: null,
        ret_ann_since_inception: null,
      },
    ],
    createdAt: "2026-10-30T08:10:36.397Z",
    updatedAt: "2026-10-30T08:10:36.397Z",
  }
}

function installStorage(options?: { quota?: boolean }) {
  const store = new Map<string, string>()
  let blocked = options?.quota === true
  const localStorage = {
    get length() {
      return store.size
    },
    key(index: number) {
      return [...store.keys()][index] ?? null
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key: string, value: string) {
      if (blocked && key === "ma_fund_compares" && value.length > 20) {
        const error = new Error("quota")
        error.name = "QuotaExceededError"
        throw error
      }
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    },
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent() {} },
  })
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  })
  return store
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe("fund compare open handoff", { concurrency: false }, () => {
  it("reads the cmp id from the detail pathname", () => {
    assert.equal(
      compareIdFromPathname("/ma/dashboard/private-funds/fund-compare/cmp-1793347836397"),
      "cmp-1793347836397",
    )
  })

  it("round-trips a drawer group through the URL hash", () => {
    const compare = sampleCompare()
    const href = fundCompareHref(compare)
    const hash = href.slice(href.indexOf("#"))
    assert.deepEqual(readCompareDraft(hash), compare)
  })

  it("opens the group from the hash when localStorage never received the write", () => {
    installStorage({ quota: true })
    const compare = sampleCompare()
    assert.equal(saveFundCompare(compare), false)
    const href = fundCompareHref(compare)
    const opened = adoptOpenedFundCompare({
      paramId: "",
      pathname: "/ma/dashboard/private-funds/fund-compare/cmp-1793347836397",
      hash: href.slice(href.indexOf("#")),
    })
    assert.equal(opened.id, compare.id)
    assert.equal(opened.compare?.funds.length, 2)
    assert.equal(opened.compare?.funds[0].product_name, "荣熙恒盈1号A类")
    assert.equal(opened.persisted, false)
  })

  it("uses the pathname when useParams has not produced a string id", () => {
    installStorage()
    const compare = sampleCompare()
    assert.equal(saveFundCompare(compare), true)
    const opened = resolveOpenedFundCompare({
      paramId: undefined,
      pathname: "/ma/dashboard/private-funds/fund-compare/cmp-1793347836397",
      hash: "",
    })
    assert.equal(opened.compare?.id, compare.id)
  })

  it("ignores a hash draft for a different group id", () => {
    installStorage()
    const href = fundCompareHref(sampleCompare("cmp-other"))
    const opened = resolveOpenedFundCompare({
      paramId: "cmp-1793347836397",
      pathname: "/ma/dashboard/private-funds/fund-compare/cmp-1793347836397",
      hash: href.slice(href.indexOf("#")),
    })
    assert.equal(opened.compare, null)
  })

  it("drops older groups when the stored list no longer fits", () => {
    const store = installStorage()
    const big = sampleCompare("cmp-old")
    big.funds = Array.from({ length: 30 }, (_, index) => ({
      ...big.funds[0],
      beian_hao: `S${index}`,
      product_name: "旧对比".repeat(80),
    }))
    store.set("ma_fund_compares", JSON.stringify([big]))
    const created = sampleCompare("cmp-new")
    const originalSet = localStorage.setItem.bind(localStorage)
    localStorage.setItem = (key: string, value: string) => {
      if (key === "ma_fund_compares" && value.includes("cmp-old")) {
        const error = new Error("quota")
        error.name = "QuotaExceededError"
        throw error
      }
      originalSet(key, value)
    }
    assert.equal(saveFundCompare(created), true)
    const raw = localStorage.getItem("ma_fund_compares") ?? ""
    assert.equal(raw.includes("cmp-new"), true)
    assert.equal(raw.includes("cmp-old"), false)
  })
})
