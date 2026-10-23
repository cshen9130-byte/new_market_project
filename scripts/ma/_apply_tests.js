const fs = require("fs")

// share-class test
{
  const path = "D:/coding/market_website/lib/server/share-class-nav-fill.test.ts"
  let t = fs.readFileSync(path, "utf8")
  if (!t.includes("multi-day A类 hole on a dividend parent")) {
    const extra = `

test("multi-day A类 hole on a dividend parent keeps the gap on every filled day", () => {
  const filled = fillMissingNavFromShareClassDonor(
    "SLC571",
    "LC571B",
    [
      { price_date: "2025-06-20", nav: "1.361000", cumulative_nav: "2.038982", cum_nav_withdrawal: "1.795700" },
      { price_date: "2025-06-27", nav: "1.359500", cumulative_nav: "2.036734", cum_nav_withdrawal: "1.794200" },
    ],
    [
      { price_date: "2025-06-20", nav: "1.361000", cumulative_nav: "1.361000", cum_nav_withdrawal: "1.361000" },
      { price_date: "2025-06-23", nav: "1.359600", cumulative_nav: "1.359600", cum_nav_withdrawal: "1.359600" },
      { price_date: "2025-06-24", nav: "1.356900", cumulative_nav: "1.356900", cum_nav_withdrawal: "1.356900" },
      { price_date: "2025-06-25", nav: "1.357000", cumulative_nav: "1.357000", cum_nav_withdrawal: "1.357000" },
      { price_date: "2025-06-26", nav: "1.356900", cumulative_nav: "1.356900", cum_nav_withdrawal: "1.356900" },
      { price_date: "2025-06-27", nav: "1.359500", cumulative_nav: "1.359500", cum_nav_withdrawal: "1.359500" },
    ],
  )
  for (const day of ["2025-06-23", "2025-06-24", "2025-06-25", "2025-06-26"]) {
    const row = filled.find((item) => item.price_date === day)
    assert.ok(row, day)
    assert.ok(Number(row.cum_nav_withdrawal) - Number(row.nav) > 0.4, day + " keeps 累计 gap")
    assert.ok(Number(row.cumulative_nav) > Number(row.cum_nav_withdrawal), day + " keeps 复权 above 累计")
  }
})

test("B类 unit-only tail after parent history keeps the parent 复权 gap", () => {
  const filled = fillMissingNavFromShareClassDonor(
    "LC571B",
    "SLC571",
    [
      { price_date: "2024-06-26", nav: "1.118600", cumulative_nav: "1.118600", cum_nav_withdrawal: "1.118600" },
      { price_date: "2024-06-27", nav: "1.120600", cumulative_nav: "1.120600", cum_nav_withdrawal: "1.120600" },
    ],
    [
      { price_date: "2024-06-25", nav: "1.118600", cumulative_nav: "1.675830", cum_nav_withdrawal: "1.553300" },
      { price_date: "2024-06-26", nav: "1.118600", cumulative_nav: "1.675830", cum_nav_withdrawal: "1.553300" },
      { price_date: "2024-06-27", nav: "1.120600", cumulative_nav: "1.678826", cum_nav_withdrawal: "1.555300" },
    ],
  )
  const d25 = filled.find((row) => row.price_date === "2024-06-25")
  const d26 = filled.find((row) => row.price_date === "2024-06-26")
  const d27 = filled.find((row) => row.price_date === "2024-06-27")
  assert.ok(d25 && Number(d25.cumulative_nav) > 1.6)
  assert.ok(d26 && Number(d26.cum_nav_withdrawal) - Number(d26.nav) > 0.4, "06-26 keeps gap")
  assert.ok(d27 && Number(d27.cum_nav_withdrawal) - Number(d27.nav) > 0.4, "06-27 keeps gap")
  assert.ok(Math.abs(Number(d27.cumulative_nav) / Number(d26.cumulative_nav) - 1.1206 / 1.1186) < 0.001)
})
`
    t = t.trimEnd() + extra.replace(/\n/g, "\r\n") + "\r\n"
    fs.writeFileSync(path, t)
    console.log("share-class tests added")
  } else console.log("share-class tests exist")
}

// rechain tests for SEM163 / S39917 / S29263 regression
{
  const path = "D:/coding/market_website/scripts/test-nav-rechain.mjs"
  let t = fs.readFileSync(path, "utf8")
  if (!t.includes("testSem163UnitRecoveryDoesNotReopenGap")) {
    const extra = `

// SEM163 君信荣耀一号: after ex-div unit 1.075 with cum 1.175, the next day's
// unit recovers to 1.175 while 累计/复权 stay flat. That is not a stale freeze.
function testSem163UnitRecoveryDoesNotReopenGap() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2019-01-10", nav: "1.172000", cumulative_nav: "1.172579", cum_nav_withdrawal: "1.172000", price_change: "", legacy_origin: "platform" },
      { price_date: "2019-01-11", nav: "1.075000", cumulative_nav: "1.175580", cum_nav_withdrawal: "1.175000", price_change: "", legacy_origin: "platform" },
      { price_date: "2019-01-14", nav: "1.175000", cumulative_nav: "1.175580", cum_nav_withdrawal: "1.175000", price_change: "", legacy_origin: "platform" },
      { price_date: "2019-01-15", nav: "1.175000", cumulative_nav: "1.175580", cum_nav_withdrawal: "1.175000", price_change: "", legacy_origin: "platform" },
    ],
    [],
  )
  const d14 = out.find((row) => row.price_date === "2019-01-14")
  assert("SEM163 01-14 keeps 复权 1.175580", d14 && Math.abs(parseFloat(d14.cumulative_nav) - 1.175580) < 0.0001)
  assert("SEM163 01-14 keeps 累计 1.175", d14 && Math.abs(parseFloat(d14.cum_nav_withdrawal) - 1.175) < 0.0001)
}
testSem163UnitRecoveryDoesNotReopenGap()

// S39917: 复权 tracks 单位 return while 累计 sits above on a dividend gap.
// adj < cum is intentional — do not paint a later adj/cum premium onto it.
function testS39917UnitReturnAdjIsNotPremiumFilled() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2024-02-23", nav: "0.596500", cumulative_nav: "2.453558", cum_nav_withdrawal: "3.264500", price_change: "", legacy_origin: "fof99" },
      { price_date: "2024-03-01", nav: "0.627200", cumulative_nav: "2.581480", cum_nav_withdrawal: "3.295600", price_change: "", legacy_origin: "fof99" },
      { price_date: "2024-03-08", nav: "0.658100", cumulative_nav: "2.708661", cum_nav_withdrawal: "3.326500", price_change: "", legacy_origin: "fof99" },
      { price_date: "2024-04-03", nav: "0.655300", cumulative_nav: "2.697108", cum_nav_withdrawal: "3.323700", price_change: "", legacy_origin: "fof99" },
    ],
    [],
  )
  const d01 = out.find((row) => row.price_date === "2024-03-01")
  const d03 = out.find((row) => row.price_date === "2024-04-03")
  assert("S39917 03-01 keeps 复权 2.581480", d01 && Math.abs(parseFloat(d01.cumulative_nav) - 2.581480) < 0.0001)
  assert("S39917 04-03 keeps 复权 2.697108", d03 && Math.abs(parseFloat(d03.cumulative_nav) - 2.697108) < 0.0001)
  assert("S39917 04-03 keeps 累计 3.323700", d03 && Math.abs(parseFloat(d03.cum_nav_withdrawal) - 3.323700) < 0.0001)
}
testS39917UnitReturnAdjIsNotPremiumFilled()

// SVL369: after a unit rebase that kept 累计, a later unit-only Type6 row must
// inherit the gap instead of collapsing the chart back to ~1.0.
function testSvl369CollapsedTailKeepsRebaseGap() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2023-07-13", nav: "1.000000", cumulative_nav: "2.523000", cum_nav_withdrawal: "2.523000", price_change: "", legacy_origin: "fof99" },
      { price_date: "2023-07-14", nav: "0.999000", cumulative_nav: "2.520477", cum_nav_withdrawal: "2.522000", price_change: "", legacy_origin: "fof99" },
      { price_date: "2023-07-17", nav: "0.996000", cumulative_nav: "0.996000", cum_nav_withdrawal: "0.996000", price_change: "", legacy_origin: "platform" },
      { price_date: "2023-07-18", nav: "0.996000", cumulative_nav: "0.996000", cum_nav_withdrawal: "0.996000", price_change: "", legacy_origin: "platform" },
    ],
    [],
  )
  const d17 = out.find((row) => row.price_date === "2023-07-17")
  assert("SVL369 07-17 keeps 累计 gap", d17 && parseFloat(d17.cum_nav_withdrawal) - parseFloat(d17.nav) > 1.4)
  assert("SVL369 07-17 复权 above 累计", d17 && parseFloat(d17.cumulative_nav) >= parseFloat(d17.cum_nav_withdrawal) - 0.001)
}
testSvl369CollapsedTailKeepsRebaseGap()
`
    // append before end - find last test call area
    t = t.trimEnd() + extra.replace(/\n/g, "\r\n") + "\r\n"
    fs.writeFileSync(path, t)
    console.log("rechain tests added")
  } else console.log("rechain tests exist")
}
