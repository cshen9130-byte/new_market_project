/**
 * One valuation-step P&L for a FOF underlying holding.
 *
 * 区间投资收益 = 剩余持仓市值变动 + Σ申赎已实现盈亏
 *
 * Between two valuation snapshots, mark the current position to each 申赎
 * confirm NAV, then:
 *   赎回: 已实现 = 赎回份额 × (确认净值 − 上一标记净值) + (确认金额 − 赎回市值)
 *         剩余份额继续盯市
 *   申购: 申购时不产生已实现盈亏，新份额从确认净值开始盯市
 *
 * This is not Δ市值 ± 申赎净流入. 申赎金额本身不是盈亏；卖掉的那部分在确认净值
 * 上相对上一估值日已经赚到/亏掉的部分，才计入已实现。
 */

export type AttributionFlowKind = "subscribe" | "redeem" | "dividend"

export type AttributionFlowEvent = {
  date: string
  kind: AttributionFlowKind
  shares: number
  amount: number
  nav: number | null
}

export type HoldingStepPosition = {
  qty: number
  mv: number
  price: number | null
}

export type HoldingStepPnl = {
  pnl: number
  mtmPnl: number
  realizedPnl: number
  cashFlow: number
}

const MAX_DAILY_RETURN = 0.5
const MIN_ABS_FLOW = 100

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n)
}

function unitPrice(pos: HoldingStepPosition | undefined): number | null {
  if (!pos) return null
  if (finite(pos.price) && pos.price > 0) return pos.price
  if (pos.qty > 0 && Math.abs(pos.mv) > 0) {
    const implied = Math.abs(pos.mv) / pos.qty
    if (implied > 0.05 && implied < 500) return implied
  }
  return null
}

function eventNav(
  ev: AttributionFlowEvent,
  marked: number | null,
  endPrice: number | null,
): number | null {
  if (finite(ev.nav) && ev.nav > 0) return ev.nav
  if (ev.shares > 0 && ev.amount > 0) {
    const implied = ev.amount / ev.shares
    if (implied > 0.05 && implied < 500) return implied
  }
  if (finite(marked) && marked > 0) return marked
  if (finite(endPrice) && endPrice > 0) return endPrice
  return null
}

function eventShares(ev: AttributionFlowEvent, nav: number | null): number {
  if (ev.shares > 0) return ev.shares
  if (finite(nav) && nav > 0 && ev.amount > 0) return ev.amount / nav
  return 0
}

function markToMarketPnl(
  prev: HoldingStepPosition | undefined,
  curr: HoldingStepPosition | undefined,
): number {
  const qty = prev?.qty ?? 0
  const p0 = unitPrice(prev)
  const p1 = unitPrice(curr)
  if (qty > 0 && p0 != null && p1 != null && p0 > 0) {
    const ret = (p1 - p0) / p0
    if (Math.abs(ret) <= MAX_DAILY_RETURN) return qty * (p1 - p0)
  }
  return (curr?.mv ?? 0) - (prev?.mv ?? 0)
}

/**
 * When 台账 has no row, infer a single 申赎 from 份额变动 × 期末净值
 * (the 市值 of the lot, not Δ成本).
 */
export function inferFlowEventsFromQty(
  prev: HoldingStepPosition | undefined,
  curr: HoldingStepPosition | undefined,
): AttributionFlowEvent[] {
  const q0 = prev?.qty ?? 0
  const q1 = curr?.qty ?? 0
  const dQty = q1 - q0
  if (Math.abs(dQty) < 1e-8) return []
  const nav = unitPrice(curr) ?? unitPrice(prev)
  const amount = finite(nav) && nav > 0 ? Math.abs(dQty) * nav : 0
  if (amount < MIN_ABS_FLOW) return []
  if (dQty < 0) {
    return [{ date: "", kind: "redeem", shares: -dQty, amount, nav: nav && nav > 0 ? nav : null }]
  }
  return [{ date: "", kind: "subscribe", shares: dQty, amount, nav: nav && nav > 0 ? nav : null }]
}

export function computeHoldingStepPnl(
  prev: HoldingStepPosition | undefined,
  curr: HoldingStepPosition | undefined,
  events: AttributionFlowEvent[],
): HoldingStepPnl {
  if (events.length === 0) {
    const mtm = markToMarketPnl(prev, curr)
    return { pnl: mtm, mtmPnl: mtm, realizedPnl: 0, cashFlow: 0 }
  }

  let qty = prev?.qty ?? 0
  let price = unitPrice(prev)
  let mtmPnl = 0
  let realizedPnl = 0
  let cashFlow = 0
  const endPrice = unitPrice(curr)
  const endMv = curr?.mv ?? 0

  for (const ev of events) {
    const nav = eventNav(ev, price, endPrice)

    if (ev.kind === "dividend") {
      if (qty > 0 && price != null && nav != null) {
        mtmPnl += qty * (nav - price)
        price = nav
      }
      realizedPnl += ev.amount
      cashFlow -= ev.amount
      continue
    }

    if (ev.kind === "redeem") {
      let sh = eventShares(ev, nav)
      if (sh > qty && qty > 0) sh = qty
      if (qty > 0 && price != null && nav != null && sh > 0) {
        const soldPnl = sh * (nav - price)
        const remainQty = Math.max(0, qty - sh)
        mtmPnl += remainQty * (nav - price)
        const markedSold = sh * nav
        realizedPnl += soldPnl + (ev.amount - markedSold)
        price = nav
        qty = remainQty
      } else if (sh > 0 && qty > 0) {
        const carryingMv = price != null ? qty * price : (prev?.mv ?? 0)
        const carrying = carryingMv * (sh / qty)
        realizedPnl += ev.amount - carrying
        qty = Math.max(0, qty - sh)
      }
      cashFlow -= ev.amount
      continue
    }

    if (qty > 0 && price != null && nav != null) {
      mtmPnl += qty * (nav - price)
      price = nav
    }
    const sh = eventShares(ev, nav)
    qty += sh
    if (nav != null && nav > 0) price = nav
    cashFlow += ev.amount
  }

  if (qty > 0 && price != null && endPrice != null) {
    mtmPnl += qty * (endPrice - price)
  } else {
    const carrying = qty > 0 && price != null ? qty * price : 0
    mtmPnl += endMv - carrying
  }

  const pnl = mtmPnl + realizedPnl
  return {
    pnl: Number.isFinite(pnl) ? pnl : 0,
    mtmPnl: Number.isFinite(mtmPnl) ? mtmPnl : 0,
    realizedPnl: Number.isFinite(realizedPnl) ? realizedPnl : 0,
    cashFlow: Number.isFinite(cashFlow) ? cashFlow : 0,
  }
}
