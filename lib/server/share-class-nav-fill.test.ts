import assert from "node:assert/strict"
import test from "node:test"
import { fillMissingNavFromShareClassDonor, gapDatesFilledFromShareClassFamily, shareClassDonorExplainsGap } from "./share-class-nav-fill"

test("share-class gap chart keeps parent dates when overlapping unit NAV agrees", () => {
  const filled = gapDatesFilledFromShareClassFamily(
    "VS513A",
    ["2022-06-06", "2023-03-17"],
    [
      { price_date: "2022-06-06", nav: 1 },
      { price_date: "2023-03-17", nav: 1.0795 },
    ],
    [{
      code: "SVS513",
      points: [
        { price_date: "2022-06-06", nav: 1 },
        { price_date: "2022-06-07", nav: 1.01 },
        { price_date: "2023-03-17", nav: 1.0795 },
      ],
    }],
  )
  assert.deepEqual(filled.sort(), ["2022-06-06", "2022-06-07", "2023-03-17"])
})

test("share-class gap chart leaves a dividend class hole when overlap disagrees", () => {
  const filled = gapDatesFilledFromShareClassFamily(
    "VS513B",
    ["2022-06-06", "2023-03-17"],
    [
      { price_date: "2022-06-06", nav: 1 },
      { price_date: "2023-03-17", nav: 0.9 },
    ],
    [{
      code: "SVS513",
      points: [
        { price_date: "2022-06-06", nav: 1 },
        { price_date: "2022-06-07", nav: 1.01 },
        { price_date: "2023-03-17", nav: 1.0795 },
      ],
    }],
  )
  assert.deepEqual(filled.sort(), ["2022-06-06", "2023-03-17"])
})

test("a divergent parent does not explain a share-class hole", () => {
  assert.equal(shareClassDonorExplainsGap(
    "GM400B",
    "SGM400",
    [
      { price_date: "2024-01-12", nav: 1.4106 },
      { price_date: "2026-05-22", nav: 1.6489 },
    ],
    [
      { price_date: "2024-01-12", nav: 1.4123 },
      { price_date: "2026-05-22", nav: 1.6767 },
    ],
  ), false)
})

test("a matching parent can explain a share-class hole", () => {
  assert.equal(shareClassDonorExplainsGap(
    "VS513A",
    "SVS513",
    [{ price_date: "2022-06-06", nav: 1 }],
    [
      { price_date: "2022-06-06", nav: 1 },
      { price_date: "2022-06-07", nav: 1.01 },
    ],
  ), true)
})

test("share-class gap chart does not copy a C-class donor", () => {
  const filled = gapDatesFilledFromShareClassFamily(
    "VS513A",
    ["2022-06-06"],
    [{ price_date: "2022-06-06", nav: 1 }],
    [{
      code: "SVS513C",
      points: [
        { price_date: "2022-06-06", nav: 1 },
        { price_date: "2022-06-07", nav: 1.01 },
      ],
    }],
  )
  assert.deepEqual(filled, ["2022-06-06"])
})

test("A类 unit pasted onto a dividend parent keeps the parent 复权 gap", () => {
  const filled = fillMissingNavFromShareClassDonor(
    "SAAL90",
    "AAL90A",
    [
      { price_date: "2026-08-21", nav: "1.3615", cumulative_nav: "5.348789", cum_nav_withdrawal: "4.2901" },
      { price_date: "2026-08-28", nav: "1.3488", cumulative_nav: "5.298896", cum_nav_withdrawal: "4.2774" },
    ],
    [
      { price_date: "2026-08-21", nav: "1.3615", cumulative_nav: "1.3615", cum_nav_withdrawal: "1.3615" },
      { price_date: "2026-08-26", nav: "1.3492", cumulative_nav: "1.3492", cum_nav_withdrawal: "1.3492" },
      { price_date: "2026-08-28", nav: "1.3488", cumulative_nav: "1.3488", cum_nav_withdrawal: "1.3488" },
    ],
  )
  const inserted = filled.find((row) => row.price_date === "2026-08-26")
  assert.equal(inserted?.nav, "1.3492")
  assert.ok(Math.abs(Number(inserted?.cum_nav_withdrawal) - 4.2778) < 0.001)
  assert.ok(Math.abs(Number(inserted?.cumulative_nav) - 5.3005) < 0.001)
})

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

