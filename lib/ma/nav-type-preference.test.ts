/**
 *   npx tsx --test lib/ma/nav-type-preference.test.ts
 */
import assert from "node:assert/strict"
import { beforeEach, describe, it } from "node:test"
import {
  CALC_SETTINGS_KEY,
  DEFAULT_NAV_TYPE,
  FUND_NAV_TYPE_PREF_KEY,
  isFundNavType,
  readPreferredNavType,
  writePreferredNavType,
} from "./nav-type-preference"

function installLocalStorage() {
  const store = new Map<string, string>()
  const localStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
    removeItem(key: string) {
      store.delete(key)
    },
  }
  Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true })
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true })
}

describe("nav-type-preference", () => {
  beforeEach(() => {
    installLocalStorage()
  })

  it("defaults to 复权净值 when nothing is saved", () => {
    assert.equal(readPreferredNavType(), DEFAULT_NAV_TYPE)
    assert.equal(DEFAULT_NAV_TYPE, "复权净值")
  })

  it("keeps a saved page-level 单位净值 choice", () => {
    window.localStorage.setItem(FUND_NAV_TYPE_PREF_KEY, "单位净值")
    assert.equal(readPreferredNavType(), "单位净值")
  })

  it("falls back to 计算设置 navType when the page key is missing", () => {
    window.localStorage.setItem(CALC_SETTINGS_KEY, JSON.stringify({ navType: "单位净值" }))
    assert.equal(readPreferredNavType(), "单位净值")
  })

  it("prefers the page key over 计算设置", () => {
    window.localStorage.setItem(CALC_SETTINGS_KEY, JSON.stringify({ navType: "单位净值" }))
    window.localStorage.setItem(FUND_NAV_TYPE_PREF_KEY, "复权净值")
    assert.equal(readPreferredNavType(), "复权净值")
  })

  it("ignores invalid stored values", () => {
    window.localStorage.setItem(FUND_NAV_TYPE_PREF_KEY, "foo")
    window.localStorage.setItem(CALC_SETTINGS_KEY, JSON.stringify({ navType: "bar" }))
    assert.equal(readPreferredNavType(), DEFAULT_NAV_TYPE)
    assert.equal(isFundNavType("foo"), false)
  })

  it("persists a dropdown change and syncs 计算设置 when that object exists", () => {
    window.localStorage.setItem(CALC_SETTINGS_KEY, JSON.stringify({ navType: "复权净值", riskFreeRate: "2.00" }))
    writePreferredNavType("单位净值")
    assert.equal(window.localStorage.getItem(FUND_NAV_TYPE_PREF_KEY), "单位净值")
    const settings = JSON.parse(window.localStorage.getItem(CALC_SETTINGS_KEY) ?? "{}")
    assert.equal(settings.navType, "单位净值")
    assert.equal(settings.riskFreeRate, "2.00")
  })

  it("does not invent 计算设置 when writing 累计净值", () => {
    writePreferredNavType("累计净值")
    assert.equal(window.localStorage.getItem(FUND_NAV_TYPE_PREF_KEY), "累计净值")
    assert.equal(window.localStorage.getItem(CALC_SETTINGS_KEY), null)
  })
})
