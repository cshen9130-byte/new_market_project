import { dedupeLegacyNavRowsByDate, mergeNavSeriesWithEmail } from "../../lib/server/email-nav-query.ts"

function assert(cond, message) {
  if (!cond) throw new Error(message)
  console.log("ok:", message)
}

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
  assert(d14 && Math.abs(parseFloat(d14.cumulative_nav) - 1.175580) < 0.0001, "SEM163 01-14 keeps 复权 1.175580")
  assert(d14 && Math.abs(parseFloat(d14.cum_nav_withdrawal) - 1.175) < 0.0001, "SEM163 01-14 keeps 累计 1.175")
}

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
  assert(d01 && Math.abs(parseFloat(d01.cumulative_nav) - 2.581480) < 0.0001, "S39917 03-01 keeps 复权 2.581480")
  assert(d03 && Math.abs(parseFloat(d03.cumulative_nav) - 2.697108) < 0.0001, "S39917 04-03 keeps 复权 2.697108")
  assert(d03 && Math.abs(parseFloat(d03.cum_nav_withdrawal) - 3.323700) < 0.0001, "S39917 04-03 keeps 累计 3.323700")
}

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
  assert(d17 && parseFloat(d17.cum_nav_withdrawal) - parseFloat(d17.nav) > 1.4, "SVL369 07-17 keeps 累计 gap")
  assert(d17 && parseFloat(d17.cumulative_nav) >= parseFloat(d17.cum_nav_withdrawal) - 0.001, "SVL369 07-17 复权 above 累计")
}

function testS29263StillKeepsCumReturnAdj() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2019-01-25", nav: "1.000000", cumulative_nav: "1.000163", cum_nav_withdrawal: "1.000000", price_change: "0", legacy_origin: "fof99" },
      { price_date: "2019-02-01", nav: "0.434600", cumulative_nav: "0.697714", cum_nav_withdrawal: "0.697600", price_change: "0", legacy_origin: "fof99" },
      { price_date: "2019-02-15", nav: "0.434600", cumulative_nav: "0.697714", cum_nav_withdrawal: "0.697600", price_change: "0", legacy_origin: "fof99" },
      { price_date: "2019-04-04", nav: "0.450700", cumulative_nav: "0.741060", cum_nav_withdrawal: "0.724600", price_change: "0", legacy_origin: "fof99" },
    ],
    [],
  )
  const feb1 = out.find((row) => row.price_date === "2019-02-01")
  assert(feb1 && Math.abs(parseFloat(feb1.cumulative_nav) - 0.697714) < 0.000001, "S29263 keeps 0.697714")
}

function testSem163JuneRecoveryDoesNotReopenGap() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2019-06-20", nav: "1.322000", cumulative_nav: "1.320175", cum_nav_withdrawal: "1.322000", price_change: "" },
      { price_date: "2019-06-21", nav: "1.032000", cumulative_nav: "1.323171", cum_nav_withdrawal: "1.325000", price_change: "" },
      { price_date: "2019-06-24", nav: "1.337000", cumulative_nav: "1.338556", cum_nav_withdrawal: "1.337000", price_change: "" },
      { price_date: "2019-06-25", nav: "1.333000", cumulative_nav: "1.334552", cum_nav_withdrawal: "1.333000", price_change: "" },
      { price_date: "2019-06-28", nav: "1.040000", cumulative_nav: "1.334552", cum_nav_withdrawal: "1.333000", price_change: "" },
    ],
    [],
  )
  const d24 = out.find((row) => row.price_date === "2019-06-24")
  const d28 = out.find((row) => row.price_date === "2019-06-28")
  assert(d24 && Math.abs(parseFloat(d24.cumulative_nav) - 1.338556) < 0.02, "SEM163 06-24 keeps published 复权")
  assert(d28 && Math.abs(parseFloat(d28.cumulative_nav) - 1.334552) < 0.02, "SEM163 06-28 keeps published 复权")
}

function testScy439WholeRowMoveIsNotFlattened() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2024-06-25", nav: "0.418000", cumulative_nav: "0.481836", cum_nav_withdrawal: "0.640000", price_change: "" },
      { price_date: "2024-06-26", nav: "0.454000", cumulative_nav: "0.523333", cum_nav_withdrawal: "0.676000", price_change: "" },
      { price_date: "2024-06-27", nav: "0.419000", cumulative_nav: "0.482988", cum_nav_withdrawal: "0.641000", price_change: "" },
    ],
    [],
  )
  const d26 = out.find((row) => row.price_date === "2024-06-26")
  assert(d26 && Math.abs(parseFloat(d26.nav) - 0.454) < 0.0001, "SCY439 06-26 keeps unit 0.454")
  assert(d26 && Math.abs(parseFloat(d26.cumulative_nav) - 0.523333) < 0.0001, "SCY439 06-26 keeps 复权 0.523333")
}

function testScb622ContinuousAdjIsNotLifted() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2020-04-09", nav: "1.325000", cumulative_nav: "1.754302", cum_nav_withdrawal: "1.777000", price_change: "" },
      { price_date: "2020-04-10", nav: "1.000000", cumulative_nav: "0.725553", cum_nav_withdrawal: "1.000000", price_change: "" },
      { price_date: "2020-04-13", nav: "1.016000", cumulative_nav: "1.300917", cum_nav_withdrawal: "1.793000", price_change: "" },
      { price_date: "2020-04-14", nav: "1.024000", cumulative_nav: "1.311160", cum_nav_withdrawal: "1.801000", price_change: "" },
    ],
    [],
  )
  const d13 = out.find((row) => row.price_date === "2020-04-13")
  const d14 = out.find((row) => row.price_date === "2020-04-14")
  assert(d13 && Math.abs(parseFloat(d13.cumulative_nav) - 1.300917) < 0.02, "SCB622 04-13 keeps 复权 1.300917")
  assert(d14 && Math.abs(parseFloat(d14.cumulative_nav) - 1.311160) < 0.0001, "SCB622 04-14 keeps 复权 1.311160")
}

function testSvl369NegativeAdjKeepsGap() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2023-08-11", nav: "0.969000", cumulative_nav: "2.492000", cum_nav_withdrawal: "2.492000", price_change: "" },
      { price_date: "2023-08-14", nav: "0.975000", cumulative_nav: "-1.409304", cum_nav_withdrawal: "0.975000", price_change: "" },
      { price_date: "2023-08-15", nav: "0.968000", cumulative_nav: "-1.399186", cum_nav_withdrawal: "0.968000", price_change: "" },
    ],
    [],
  )
  const d14 = out.find((row) => row.price_date === "2023-08-14")
  const d15 = out.find((row) => row.price_date === "2023-08-15")
  assert(d14 && parseFloat(d14.cum_nav_withdrawal) - parseFloat(d14.nav) > 1, "SVL369 08-14 keeps 累计 gap")
  assert(d15 && parseFloat(d15.cumulative_nav) > 2, "SVL369 08-15 复权 stays on the carried scale")
}

function testSln974NearUnitAdjIsNotSwapped() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2024-11-11", nav: "1.478600", cumulative_nav: "1.438824", cum_nav_withdrawal: "1.678600", price_change: "" },
      { price_date: "2024-11-12", nav: "1.447900", cumulative_nav: "1.480181", cum_nav_withdrawal: "1.721100", price_change: "" },
      { price_date: "2024-11-13", nav: "1.459700", cumulative_nav: "1.417412", cum_nav_withdrawal: "1.659700", price_change: "" },
      { price_date: "2024-11-14", nav: "1.443600", cumulative_nav: "1.401778", cum_nav_withdrawal: "1.643600", price_change: "" },
    ],
    [],
  )
  const d12 = out.find((row) => row.price_date === "2024-11-12")
  const d13 = out.find((row) => row.price_date === "2024-11-13")
  assert(d12 && Math.abs(parseFloat(d12.cumulative_nav) - 1.480181) < 0.02, "SLN974 11-12 keeps near-unit 复权")
  assert(d13 && parseFloat(d13.cumulative_nav) < 1.6, "SLN974 11-13 is not the swapped 1.93")
}

function testSln974Dec13KeepsContinuingAdj() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2024-12-11", nav: "1.260300", cumulative_nav: "1.460420", cum_nav_withdrawal: "1.707400", price_change: "" },
      { price_date: "2024-12-12", nav: "1.271100", cumulative_nav: "1.472935", cum_nav_withdrawal: "1.718200", price_change: "" },
      { price_date: "2024-12-13", nav: "1.251300", cumulative_nav: "1.534814", cum_nav_withdrawal: "1.771600", price_change: "" },
      { price_date: "2024-12-16", nav: "1.279200", cumulative_nav: "1.479250", cum_nav_withdrawal: "1.726300", price_change: "" },
    ],
    [],
  )
  const d13 = out.find((row) => row.price_date === "2024-12-13")
  assert(d13 && parseFloat(d13.cumulative_nav) < 1.6, "SLN974 12-13 does not chart 累计")
  assert(d13 && Math.abs(parseFloat(d13.cum_nav_withdrawal) - 1.7716) < 0.01, "SLN974 12-13 keeps 累计 1.7716")
}

function testSln974AdjWiggleKeepsCumulative() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2025-06-20", nav: "1.216300", cumulative_nav: "1.416958", cum_nav_withdrawal: "1.736600", price_change: "" },
      { price_date: "2025-06-27", nav: "1.217700", cumulative_nav: "1.418589", cum_nav_withdrawal: "1.738000", price_change: "" },
      { price_date: "2025-06-30", nav: "1.210200", cumulative_nav: "1.533106", cum_nav_withdrawal: "1.836300", price_change: "" },
      { price_date: "2025-07-04", nav: "1.225700", cumulative_nav: "1.418712", cum_nav_withdrawal: "1.746000", price_change: "" },
    ],
    [],
  )
  const d30 = out.find((row) => row.price_date === "2025-06-30")
  assert(d30 && Math.abs(parseFloat(d30.cumulative_nav) - 1.533106) < 0.02, "SLN974 06-30 keeps type6 复权")
  assert(d30 && Math.abs(parseFloat(d30.cum_nav_withdrawal) - 1.8363) < 0.01, "SLN974 06-30 keeps 累计")
}

function testSln974PrefersContinuingType6Adj() {
  const out = dedupeLegacyNavRowsByDate([
    { price_date: "2025-03-27", nav: "1.280300", cumulative_nav: "1.433054", cum_nav_withdrawal: "1.727400", price_change: "", pri: 3, legacy_origin: "platform" },
    { price_date: "2025-03-28", nav: "1.253800", cumulative_nav: "1.864057", cum_nav_withdrawal: "1.774100", price_change: "", pri: 0, legacy_origin: "fof99" },
    { price_date: "2025-03-28", nav: "1.253800", cumulative_nav: "1.485326", cum_nav_withdrawal: "1.774100", price_change: "", pri: 3, legacy_origin: "platform" },
  ])
  const d28 = out.find((row) => row.price_date === "2025-03-28")
  assert(d28 && Math.abs(parseFloat(d28.cumulative_nav) - 1.485326) < 0.0001, "SLN974 03-28 prefers Type6 复权")
}

function testSqx646StillFollowsType6() {
  const legacy = [
    ["2022-01-05", "1.180"],
    ["2022-01-06", "1.176"],
    ["2022-01-07", "1.155"],
    ["2022-01-10", "1.163"],
  ].map(([price_date, nav]) => ({
    price_date,
    nav,
    cumulative_nav: nav,
    cum_nav_withdrawal: nav,
    price_change: "",
  }))
  legacy[1].cumulative_nav = "1.179170"
  const email = [{
    price_date: "2022-01-07",
    nav: "1.083",
    cumulative_nav: "1.083",
    adjusted_nav: "1.083",
    source: "attachment_nav_table",
    subject: "资产净值公告_SQX646",
    attachment_filename: "资产净值公告_SQX646.xlsx",
  }]
  const out = mergeNavSeriesWithEmail(legacy, email)
  const jan7 = out.find((row) => row.price_date === "2022-01-07")
  const jan10 = out.find((row) => row.price_date === "2022-01-10")
  const expected = 1.179170 * (1.155 / 1.176)
  assert(jan7 && Math.abs(parseFloat(jan7.cumulative_nav) - expected) < 0.0001, "SQX646 01-07 复权 stays on Type6")
  assert(
    jan7 && jan10 && Math.abs(parseFloat(jan10.cumulative_nav) / parseFloat(jan7.cumulative_nav) - 1) < 0.02,
    "SQX646 01-10 does not bounce off Friday",
  )
}

function testSqx078SwapStillRestoresAdj() {
  const out = mergeNavSeriesWithEmail(
    [
      { price_date: "2026-05-15", nav: "1.088000", cumulative_nav: "2.790240", cum_nav_withdrawal: "2.251700", price_change: "" },
      { price_date: "2026-05-18", nav: "1.088900", cumulative_nav: "2.252600", cum_nav_withdrawal: "2.792500", price_change: "" },
      { price_date: "2026-05-25", nav: "1.105600", cumulative_nav: "2.269300", cum_nav_withdrawal: "2.835400", price_change: "" },
    ],
    [],
  )
  const d18 = out.find((row) => row.price_date === "2026-05-18")
  assert(d18 && Math.abs(parseFloat(d18.cumulative_nav) - 2.7925) < 0.001, "SQX078 05-18 swap still restores 复权")
  assert(d18 && Math.abs(parseFloat(d18.cum_nav_withdrawal) - 2.2526) < 0.001, "SQX078 05-18 swap still restores 累计")
}

testSem163UnitRecoveryDoesNotReopenGap()
testS39917UnitReturnAdjIsNotPremiumFilled()
testSvl369CollapsedTailKeepsRebaseGap()
testS29263StillKeepsCumReturnAdj()
testSem163JuneRecoveryDoesNotReopenGap()
testScy439WholeRowMoveIsNotFlattened()
testScb622ContinuousAdjIsNotLifted()
testSvl369NegativeAdjKeepsGap()
testSln974NearUnitAdjIsNotSwapped()
testSln974Dec13KeepsContinuingAdj()
testSln974AdjWiggleKeepsCumulative()
testSln974PrefersContinuingType6Adj()
testSqx646StillFollowsType6()
testSqx078SwapStillRestoresAdj()
console.log("new rule tests ok")

