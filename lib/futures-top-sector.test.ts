import assert from "node:assert/strict"
import test from "node:test"
import { FUTURES_TOP_SECTOR_HREF, futuresTopSectorMessage, topSector } from "./futures-top-sector"

const previous = {
  date: "2026-11-05",
  sectors: [
    { sector: "能源化工", amount: 80_000_000_000 },
    { sector: "黑色", amount: 20_000_000_000 },
  ],
}

test("the same leading sector stays quiet, including a tie broken by name", () => {
  assert.equal(futuresTopSectorMessage({
    today: {
      date: "2026-11-06",
      sectors: [
        { sector: "黑色", amount: 100 },
        { sector: "能源化工", amount: 900 },
      ],
    },
    previous,
  }), null)
  assert.equal(topSector({
    date: "2026-11-06",
    sectors: [
      { sector: "有色", amount: 10 },
      { sector: "黑色", amount: 10 },
    ],
  })?.sector, "有色")
})

test("a new leading sector names both days and opens the turnover map", () => {
  const message = futuresTopSectorMessage({
    today: {
      date: "2026-11-06",
      sectors: [
        { sector: "贵金属", amount: 50_000_000_000 },
        { sector: "能源化工", amount: 40_000_000_000 },
      ],
    },
    previous,
  })
  assert.equal(message?.title, "2026-11-06 成交额最大板块换成贵金属")
  assert.match(message?.body ?? "", /是贵金属（500\.00亿）/)
  assert.match(message?.body ?? "", /2026-11-05 是能源化工（800\.00亿）/)
  assert.equal(message?.href, FUTURES_TOP_SECTOR_HREF)
})
