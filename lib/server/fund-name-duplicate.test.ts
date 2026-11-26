import assert from "node:assert/strict"
import test from "node:test"
import {
  sameFundNameDifferentFiling,
  sqlInPoolNameDuplicateCodes,
} from "./fund-name-duplicate"

test("same fund name with two unrelated 备案号 is a duplicate", () => {
  assert.equal(
    sameFundNameDifferentFiling(
      { beian: "SAGF75", name: "交睿宏观配置1号" },
      { beian: "CESX2W", name: "交睿宏观配置1号私募证券投资基金" },
    ),
    true,
  )
})

test("A类 and B类 are different funds even when the 备案号 is unrelated", () => {
  assert.equal(
    sameFundNameDifferentFiling(
      { beian: "SAXXA", name: "木莲安澜1号A类" },
      { beian: "CESX2W", name: "木莲安澜1号B类" },
    ),
    false,
  )
  assert.equal(
    sameFundNameDifferentFiling(
      { beian: "SAXXA", name: "木莲安澜1号A类" },
      { beian: "CESX2W", name: "木莲安澜1号A类份额" },
    ),
    true,
  )
})

test("leading S and the share-class parent are the same filing", () => {
  assert.equal(
    sameFundNameDifferentFiling(
      { beian: "SAGF75", name: "交睿宏观配置1号" },
      { beian: "AGF75", name: "交睿宏观配置1号" },
    ),
    false,
  )
  assert.equal(
    sameFundNameDifferentFiling(
      { beian: "SAGF75", name: "交睿宏观配置1号" },
      { beian: "SAGF75A", name: "交睿宏观配置1号A类" },
    ),
    false,
  )
})

test("估值表 subject path still matches the fund name", () => {
  assert.equal(
    sameFundNameDifferentFiling(
      { beian: "SAGF75", name: "场外_已上市_开放式_私募_成本.交睿宏观配置1号" },
      { beian: "CESX2W", name: "交睿宏观配置1号" },
    ),
    true,
  )
})

test("empty name is not a duplicate", () => {
  assert.equal(
    sameFundNameDifferentFiling(
      { beian: "SAGF75", name: "  " },
      { beian: "CESX2W", name: "" },
    ),
    false,
  )
})

test("duplicate SQL compares pool names and catalog names inside 跟踪池", () => {
  const sql = sqlInPoolNameDuplicateCodes()
  assert.match(sql, /FROM tracking_pool p/)
  assert.match(sql, /private_fund_info i2/)
  assert.match(sql, /o\.family_key <> k\.family_key/)
  assert.match(sql, /o\.share_class = k\.share_class/)
})
