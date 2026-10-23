import { mergeNavSeriesWithEmail } from "../../lib/server/email-nav-query.ts"

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

testSem163UnitRecoveryDoesNotReopenGap()
testS39917UnitReturnAdjIsNotPremiumFilled()
testSvl369CollapsedTailKeepsRebaseGap()
testS29263StillKeepsCumReturnAdj()
console.log("new rule tests ok")

