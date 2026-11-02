import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { sanitizeAccountDashboardPrefs } from "./account-dashboard"
import {
  canonicalizeShortcutCombo,
  formatShortcutCombo,
  normalizeAccountShortcuts,
  shortcutComboFromEvent,
} from "./account-shortcuts"

describe("account shortcuts", () => {
  it("gives a new account Ctrl+Alt+T for the trading page", () => {
    const prefs = sanitizeAccountDashboardPrefs({}, true)
    assert.equal(prefs.shortcuts.length, 1)
    assert.equal(prefs.shortcuts[0].combo, "ctrl+alt+t")
    assert.equal(prefs.shortcuts[0].href, "/ma/dashboard/realtime-quotes?view=pro")
    assert.equal(prefs.shortcuts[0].label, "专业交易")
    assert.equal(prefs.shortcuts[0].newTab, true)
    assert.equal(formatShortcutCombo(prefs.shortcuts[0].combo), "Ctrl + Alt + T")
  })

  it("moves the earlier realtime shortcuts onto the professional trading view", () => {
    for (const combo of ["ctrl+i", "ctrl+t", "ctrl+alt+t"]) {
      const shortcuts = normalizeAccountShortcuts([
        { id: "sc_realtime", combo, href: "/ma/dashboard/realtime-quotes", label: "实时行情", newTab: true },
      ])
      assert.equal(shortcuts[0].combo, "ctrl+alt+t")
      assert.equal(shortcuts[0].href, "/ma/dashboard/realtime-quotes?view=pro")
      assert.equal(shortcuts[0].label, "专业交易")
    }
  })

  it("keeps an explicit empty shortcut list", () => {
    const prefs = sanitizeAccountDashboardPrefs({ shortcuts: [] }, true)
    assert.deepEqual(prefs.shortcuts, [])
  })

  it("drops reserved, duplicate, and unsafe shortcuts", () => {
    const shortcuts = normalizeAccountShortcuts([
      { id: "a", combo: "Ctrl+Shift+K", href: "/ma/dashboard/stock-market", label: "  股票  ", newTab: false },
      { id: "b", combo: "ctrl+shift+k", href: "/ma/dashboard/macro-market", label: "宏观" },
      { id: "c", combo: "ctrl+w", href: "/ma/dashboard", label: "关闭" },
      { id: "d", combo: "i", href: "/ma/dashboard", label: "字母" },
      { id: "e", combo: "ctrl+m", href: "https://example.com", label: "外链" },
      { id: "f", combo: "alt+o", href: "/ma/dashboard/options-market", label: "期权" },
    ])
    assert.deepEqual(
      shortcuts.map((item) => ({ combo: item.combo, href: item.href, label: item.label, newTab: item.newTab })),
      [
        { combo: "ctrl+shift+k", href: "/ma/dashboard/stock-market", label: "股票", newTab: false },
        { combo: "alt+o", href: "/ma/dashboard/options-market", label: "期权", newTab: true },
      ],
    )
  })

  it("reads Ctrl+Alt+T from a keyboard event and ignores plain letters", () => {
    assert.equal(canonicalizeShortcutCombo("Ctrl+Alt+T"), "ctrl+alt+t")
    assert.equal(
      shortcutComboFromEvent({ key: "t", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, repeat: false, isComposing: false }),
      "ctrl+alt+t",
    )
    assert.equal(
      shortcutComboFromEvent({ key: "t", ctrlKey: false, metaKey: true, altKey: true, shiftKey: false, repeat: false, isComposing: false }),
      "ctrl+alt+t",
    )
    assert.equal(
      shortcutComboFromEvent({ key: "t", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false }),
      null,
    )
    assert.equal(
      shortcutComboFromEvent({ key: "w", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false }),
      null,
    )
  })
})
