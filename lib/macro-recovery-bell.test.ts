import assert from "node:assert/strict"
import test from "node:test"
import { MACRO_RECOVERY_CLUSTER, MACRO_RECOVERY_HREF, macroRecoveryMessage } from "./macro-recovery-bell"

test("only cluster 3, the recovery quadrant, raises a bell", () => {
  assert.equal(macroRecoveryMessage({ date: "2026-11-06", cluster: 0 }), null)
  assert.equal(macroRecoveryMessage({ date: "2026-11-06", cluster: 1 }), null)
  assert.equal(macroRecoveryMessage({ date: "2026-11-06", cluster: 2 }), null)
  assert.equal(macroRecoveryMessage({ date: "2026-11-06", cluster: null }), null)
  assert.equal(macroRecoveryMessage({ date: "", cluster: MACRO_RECOVERY_CLUSTER }), null)
})

test("a recovery day names the cluster and opens the PCA quadrant", () => {
  const message = macroRecoveryMessage({ date: "2026-11-06", cluster: MACRO_RECOVERY_CLUSTER })
  assert.equal(message?.title, "2026-11-06 宏观市场处于复苏期")
  assert.match(message?.body ?? "", /簇 3（复苏期）/)
  assert.equal(message?.href, MACRO_RECOVERY_HREF)
})
