import assert from "node:assert/strict"
import test from "node:test"
import {
  PRODUCT_SOFT,
  allocateCuts,
  accountLayerNote,
  bisectScaleK,
  buildCapitalPath,
  buildConclusion,
  classifyBreach,
  collectBreaches,
  displayAccount,
  linearScaleK,
  parseWarningStop,
  personLabel,
  shapleyDriver,
  trailingStreak,
} from "./var-mcr-policy"

test("warning/stop text 96/95 is equity over net capital, not a drawdown of 96%", () => {
  assert.deepEqual(parseWarningStop("96/95"), { warnPct: 0.96, stopPct: 0.95 })
  assert.deepEqual(parseWarningStop("92 / 90"), { warnPct: 0.92, stopPct: 0.90 })
  assert.deepEqual(parseWarningStop(null), { warnPct: null, stopPct: null })
})

test("account codes display as RX335", () => {
  assert.equal(displayAccount("rx335"), "RX335")
  assert.equal(displayAccount("RX 335"), "RX335")
  assert.equal(personLabel("张三", "rx335"), "张三（RX335）")
  assert.equal(personLabel(null, "rx335"), "RX335（对照表中无姓名）")
})

test("RX000 always labels as 自营, not the roster nickname", () => {
  assert.equal(personLabel("BEN", "rx000"), "自营（RX000）")
  assert.equal(personLabel("BEN", "RX000"), "自营（RX000）")
  assert.equal(personLabel(null, "RX 000"), "自营（RX000）")
})

test("trailing streak counts only the current run through the as-of date", () => {
  assert.equal(trailingStreak([10, 31, 32, 29, 30.3], 30), 1)
  assert.equal(trailingStreak([40, 51, 52, 55], 50), 3)
  assert.equal(trailingStreak([59.3, 59.5], 50), 2)
  assert.equal(trailingStreak([], 30), 0)
})

test("a first-day product soft breach starts NNR next session and is not a formal cut", () => {
  const row = classifyBreach({
    kind: "product",
    name: "MA",
    sharePct: 30.31,
    softStreak: 1,
    hardStreak: 0,
    driver: "position",
    attrPos: 1,
    varPct: 1.5,
    capOk: true,
  })
  assert.equal(row.label, "MA（甲醇）")
  assert.equal(row.stance, "禁止新增")
  assert.equal(row.nnrStartsNextSession, true)
  assert.equal(row.nnrAlreadyInEffect, false)
  assert.equal(row.formalCut, false)
  assert.equal(row.illustrationOnly, true)
})

test("a sector already over the soft line for two sessions has NNR in effect today", () => {
  const row = classifyBreach({
    kind: "sector",
    name: "能源化工",
    sharePct: 59.5,
    softStreak: 2,
    hardStreak: 0,
    driver: "market",
    attrPos: -1,
    varPct: 3,
    capOk: true,
  })
  assert.equal(row.nnrAlreadyInEffect, true)
  assert.equal(row.stance, "禁止新增")
  assert.equal(row.formalCut, false)
})

test("formal hard cut needs 3 hard-line sessions plus position drive or a 2.07% budget, and freezes on a market day", () => {
  const cut = classifyBreach({
    kind: "product",
    name: "JD",
    sharePct: 66,
    softStreak: 5,
    hardStreak: 3,
    driver: "position",
    attrPos: 10,
    varPct: 1.5,
    capOk: true,
  })
  assert.equal(cut.formalCut, true)
  assert.equal(cut.stance, "建议减仓")
  const frozen = classifyBreach({
    kind: "product",
    name: "JD",
    sharePct: 66,
    softStreak: 5,
    hardStreak: 3,
    driver: "market",
    attrPos: 0,
    varPct: 3,
    capOk: true,
  })
  assert.equal(frozen.formalCut, false)
  assert.equal(frozen.frozenHard, true)
  assert.equal(frozen.stance, "禁止新增")
})

test("collectBreaches uses per-object streaks, not the book-level max", () => {
  const rows = collectBreaches({
    productSeries: {
      MA: [11, 26, 30.3],
      JD: [40, 20, 10],
    },
    sectorSeries: {
      能源化工: [43, 59.3, 59.5],
    },
    asOfIndex: 2,
    driver: "na",
    attrPos: null,
    varPct: 1,
    capOk: true,
  })
  assert.equal(rows.length, 2)
  const ma = rows.find((row) => row.name === "MA")
  const sec = rows.find((row) => row.name === "能源化工")
  assert.equal(ma?.softStreak, 1)
  assert.equal(sec?.softStreak, 2)
})

test("linear k and a bisection on an identity book both scale back to the soft line", () => {
  assert.ok(Math.abs(linearScaleK(60, 30) - 0.5) < 1e-12)
  assert.equal(linearScaleK(20, 30), 1)
  const products = [
    { prod: "MA", mv: 2, sigma: 1 },
    { prod: "LH", mv: 1, sigma: 1 },
  ]
  const corr = [[1, 0], [0, 1]]
  // identity corr: MA share is 80%. Scale MA only to get back to 30%.
  const result = bisectScaleK({ products, corr, kind: "product", name: "MA", targetPct: PRODUCT_SOFT })
  assert.ok(result.applied)
  assert.ok(Math.abs(result.achievedShare - 30) <= 0.3)
  assert.ok(result.k > 0 && result.k < 1)
})

test("cut amounts follow k and do not smear residual holders when one or two books dominate", () => {
  const holders = [
    holder("rx001", "甲", "MA", 8_000_000, 80),
    holder("rx002", "乙", "MA", 1_500_000, 15),
    holder("rx003", "丙", "MA", 200_000, 2),
    holder("rx004", "丁", "MA", 50_000, 1),
  ]
  const { included, residual, k } = allocateCuts({ k: 0.8, holders, products: ["MA"] })
  assert.equal(k, 0.8)
  const accounts = included.map((row) => row.account)
  assert.deepEqual(accounts, ["rx001", "rx002"])
  assert.ok(residual.some((row) => row.account === "rx003"))
  const a = included[0]
  assert.equal(a.currentMv, 8_000_000)
  assert.equal(a.targetMv, 6_400_000)
  assert.equal(a.cutAbsMv, 1_600_000)
  assert.equal(a.cutLots, 16)
  assert.equal(a.targetLots, 64)
  assert.equal(a.direction, "long")
})

test("a losing book held past its usual length is cut harder than a same-sized book opened today", () => {
  const stale = holder("rx001", "甲", "MA", 1_000_000, 100)
  stale.hold = {
    holdDays: 40,
    holdSince: "2026-10-01",
    holdCapped: false,
    holdMode: "direction",
    lotAgeDays: 40,
    oldestLotDate: "2026-10-01",
    typicalDays: 10,
    typicalN: 12,
    typicalScope: "product",
    productTypicalDays: 10,
    productTypicalN: 12,
    accountTypicalDays: 8,
    accountTypicalN: 40,
    floatPnl: -80_000,
  }
  const fresh = holder("rx002", "乙", "MA", 1_000_000, 100)
  fresh.hold = {
    holdDays: 0,
    holdSince: "2026-11-13",
    holdCapped: false,
    holdMode: "direction",
    lotAgeDays: 0,
    oldestLotDate: "2026-11-13",
    typicalDays: 10,
    typicalN: 12,
    typicalScope: "product",
    productTypicalDays: 10,
    productTypicalN: 12,
    accountTypicalDays: 8,
    accountTypicalN: 40,
    floatPnl: 20_000,
  }
  const { included } = allocateCuts({ k: 0.5, holders: [stale, fresh], products: ["MA"] })
  const staleCut = included.find((row) => row.account === "rx001")
  const freshCut = included.find((row) => row.account === "rx002")
  assert.ok(staleCut && freshCut)
  assert.equal(staleCut.careNote, "浮亏且持有长于惯用")
  assert.equal(freshCut.careNote, "当日开仓")
  assert.ok(staleCut.cutAbsMv > freshCut.cutAbsMv)
  assert.ok(staleCut.cutLots > freshCut.cutLots)
  // Same total yuan as cutting both books by half.
  assert.ok(Math.abs(staleCut.cutAbsMv + freshCut.cutAbsMv - 1_000_000) <= 1)
})

test("a profitable book held past its usual length is not leaned on harder", () => {
  const winner = holder("rx001", "甲", "MA", 1_000_000, 100)
  winner.hold = {
    holdDays: 40,
    holdSince: "2026-10-01",
    holdCapped: false,
    holdMode: "direction",
    lotAgeDays: 40,
    oldestLotDate: "2026-10-01",
    typicalDays: 10,
    typicalN: 12,
    typicalScope: "product",
    productTypicalDays: 10,
    productTypicalN: 12,
    accountTypicalDays: 8,
    accountTypicalN: 40,
    floatPnl: 80_000,
  }
  const ordinary = holder("rx002", "乙", "MA", 1_000_000, 100)
  const { included } = allocateCuts({ k: 0.5, holders: [winner, ordinary], products: ["MA"] })
  assert.equal(included[0].cutAbsMv, 500_000)
  assert.equal(included[1].cutAbsMv, 500_000)
  assert.equal(included[0].careNote, "")
})

test("a short book is cut by buying back lots, not by selling more", () => {
  const { included } = allocateCuts({
    k: 0.5,
    holders: [holder("rx009", "戊", "MA", -2_000_000, -40)],
    products: ["MA"],
  })
  assert.equal(included[0].direction, "short")
  assert.equal(included[0].cutLots, 20)
  assert.equal(included[0].targetLots, -20)
  assert.equal(included[0].targetMv, -1_000_000)
})

test("equity/capital hits ignore a withdrawal that only crosses the line because 提盈 left the book", () => {
  const path = buildCapitalPath(
    [
      { date: "2026-01-02", equity: 1_000_000, netFlow: 1_000_000 },
      { date: "2026-01-03", equity: 970_000, netFlow: 0 },
      { date: "2026-01-04", equity: 480_000, netFlow: -500_000 },
    ],
    0.96,
    0.95,
  )
  // 970/1000=97% still above 96%. Then a 50万提盈 leaves 48/50=96% at the warn line
  // only because money left; pre-flow ratio was 97%. Not a hit.
  const last = path[path.length - 1]
  assert.equal(last.warnHit, false)
  assert.equal(last.stopHit, false)
  assert.equal(last.isWithdrawal, true)

  const crossing = buildCapitalPath(
    [
      { date: "2026-01-02", equity: 1_000_000, netFlow: 1_000_000 },
      { date: "2026-01-03", equity: 940_000, netFlow: 0 },
    ],
    0.96,
    0.95,
  )
  const day = crossing[1]
  assert.equal(day.warnHit, true)
  assert.equal(day.stopHit, true)
  assert.equal(day.nearWarn, false)
  const note = accountLayerNote(day, true)
  assert.equal(note.action, "上报投资经理")
  assert.match(note.note, /上报投资经理/)
  assert.match(note.note, /首次触及止损不等于自动清仓/)
})

test("the 2pp band above an account's own 预警 line is near-warn, not a stop", () => {
  const path = buildCapitalPath(
    [
      { date: "2026-01-02", equity: 1_000_000, netFlow: 1_000_000 },
      { date: "2026-01-03", equity: 975_000, netFlow: 0 },
    ],
    0.96,
    0.95,
  )
  const day = path[1]
  assert.equal(day.nearWarn, true)
  assert.equal(day.warnHit, false)
  assert.equal(accountLayerNote(day, true).action, "限制该账户新增")
})

test("the 11-13 style conclusion names the soft breaches, NNR timing, and no formal cut", () => {
  const breaches = collectBreaches({
    productSeries: { MA: [26.85, 30.31] },
    sectorSeries: { 能源化工: [59.32, 59.47] },
    asOfIndex: 1,
    driver: "na",
    attrPos: null,
    varPct: 1.2,
    capOk: true,
  })
  const text = buildConclusion({
    date: "2026-11-13",
    breaches,
    varPct: 1.2,
    capOk: true,
    driver: "na",
  })
  assert.match(text, /2026-11-13/)
  assert.match(text, /甲醇） 30\.3%/)
  assert.match(text, /第 1 个交易日/)
  assert.match(text, /能源化工 59\.5%/)
  assert.match(text, /连续 2 个交易日/)
  assert.match(text, /次日起MA（甲醇）禁止加仓/)
  assert.match(text, /能源化工自上一交易日收盘后已禁止加仓/)
  assert.match(text, /不做正式硬砍/)
})

test("Shapley attributes a same-market position increase to the position driver", () => {
  const info = shapleyDriver(100, 140, 100, 140)
  assert.equal(info.driver, "position")
  assert.equal(info.attrPos, 40)
  assert.equal(info.attrMkt, 0)
})

function holder(account: string, name: string, prod: string, netMv: number, netLots: number) {
  return {
    account,
    accountDisp: displayAccount(account),
    traderName: name,
    displayName: personLabel(name, account),
    prod,
    prodLabel: prod,
    sector: "能源化工",
    netMv,
    grossMv: Math.abs(netMv),
    netLots,
    grossLots: Math.abs(netLots),
    shareOfObject: 0,
    shareOfAccount: 0,
    hold: null,
  }
}
