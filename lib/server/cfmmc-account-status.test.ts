/**
 *   npx tsx --test lib/server/cfmmc-account-status.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { isCfmmcWrongPasswordError, resolveCfmmcAccountStatus } from "./cfmmc-account-status"

test("lockout copy from the monitor center counts as a wrong password", () => {
  assert.equal(
    isCfmmcWrongPasswordError("密码错误次数过多，请50分钟后再试。Entered wrong password 3 times, please try again after 50 minutes."),
    true,
  )
  assert.equal(isCfmmcWrongPasswordError("Entered wrong password 3 times"), true)
  assert.equal(isCfmmcWrongPasswordError("错误尝试超过 3 次"), true)
})

test("captcha failures stay eligible for the daily fetch", () => {
  assert.equal(isCfmmcWrongPasswordError("验证码错误"), false)
  assert.equal(isCfmmcWrongPasswordError("未拿到 2026-10-22 结算日报"), false)
  assert.equal(isCfmmcWrongPasswordError(null), false)
})

test("a missing status pauses only when the last error is a bad password", () => {
  assert.equal(resolveCfmmcAccountStatus(undefined, "密码错误次数过多"), "paused")
  assert.equal(resolveCfmmcAccountStatus(undefined, null), "active")
  assert.equal(resolveCfmmcAccountStatus("active", "密码错误次数过多"), "active")
  assert.equal(resolveCfmmcAccountStatus("paused", null), "paused")
})
