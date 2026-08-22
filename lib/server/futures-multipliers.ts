/**
 * Futures lot multipliers (yuan per 1 price unit per lot).
 * Copied from MOM PRODUCT_CONFIG so 单账户 ETL does not import analysis routes.
 * BZ/PL overridden to match 国投/监控中心 成交额 = 手数 × 成交价 × multiplier.
 */
const FUTURES_MULTIPLIERS: Record<string, number> = {
  C: 10, CS: 10, WH: 20, PM: 50, RR: 10, RI: 20, JR: 20, LR: 10,
  A: 10, B: 10, M: 10, Y: 10, RM: 10, OI: 10, RS: 10, PK: 10, P: 10,
  SR: 10, CF: 5, CY: 5, AP: 10, CJ: 5, LH: 16, JD: 5,
  LG: 20, SP: 10, OP: 5, BB: 500, FB: 500,
  AU: 1000, AG: 15, PT: 500, PD: 500,
  CU: 5, BC: 5, AL: 5, AO: 20, AD: 5, ZN: 5, PB: 5, NI: 1, SN: 1,
  LC: 1, PS: 3, SI: 5,
  I: 100, SF: 5, SM: 5, RB: 10, HC: 10, SS: 5, WR: 10,
  JM: 60, J: 100, ZC: 100, FG: 20,
  SC: 1000, FU: 10, LU: 10, PG: 20, BU: 10, EC: 50,
  TA: 5, EG: 10, PF: 5, PR: 5,
  PL: 20, // 丙烯 — 成交额/价/手 in CFMMC files is 20 (not 5)
  PP: 5, L: 5,
  BZ: 30, // 纯苯 — plan + CFMMC 成交额 (7566 * 1 * 30 = 226980)
  PX: 5, EB: 5,
  RU: 10, BR: 5, NR: 10,
  SA: 20, SH: 30, V: 5, UR: 20, MA: 10,
  IH: 300, IF: 300, IC: 200, IM: 200,
  TS: 20000, TF: 10000, T: 10000, TL: 10000,
}

export function getFuturesMultiplier(contract: string): number {
  const m = String(contract ?? "").match(/^[A-Za-z]+/)
  const prefix = (m ? m[0] : String(contract ?? "")).toUpperCase()
  return FUTURES_MULTIPLIERS[prefix] ?? 10
}
