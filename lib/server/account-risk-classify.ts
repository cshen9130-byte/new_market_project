import { getPrefix } from "@/lib/server/prod-utils"

const STOCK_INDEX = new Set(["IH", "IF", "IC", "IM", "MO"])
const BOND = new Set(["TS", "TF", "T", "TL"])

export function getCategory(contract: string): "股指" | "国债" | "商品" {
  const prefix = getPrefix(contract)
  if (STOCK_INDEX.has(prefix)) return "股指"
  if (BOND.has(prefix)) return "国债"
  return "商品"
}

const SECTOR_MAP: Record<string, string> = {
  C: "农产", CS: "农产", WH: "农产", PM: "农产", RR: "农产", RI: "农产", JR: "农产", LR: "农产",
  A: "农产", B: "农产", M: "农产", Y: "农产", RM: "农产", OI: "农产", RS: "农产", PK: "农产", P: "农产",
  SR: "农产", CF: "农产", CY: "农产", LG: "农产", SP: "农产", OP: "农产",
  AP: "生鲜", CJ: "生鲜", LH: "生鲜", JD: "生鲜",
  AU: "贵金属", AG: "贵金属", PT: "贵金属", PD: "贵金属",
  CU: "有色", BC: "有色", AL: "有色", AO: "有色", AD: "有色", ZN: "有色", PB: "有色", NI: "有色", SN: "有色",
  LC: "新能源", PS: "新能源", SI: "新能源",
  I: "黑色", SF: "黑色", SM: "黑色", RB: "黑色", HC: "黑色", SS: "黑色", WR: "黑色",
  JM: "黑色", J: "黑色", ZC: "黑色", FG: "黑色", BB: "黑色", FB: "黑色",
  SC: "能源化工", FU: "能源化工", LU: "能源化工", PG: "能源化工", BU: "能源化工",
  TA: "能源化工", EG: "能源化工", PF: "能源化工", PR: "能源化工",
  PL: "能源化工", PP: "能源化工", L: "能源化工",
  BZ: "能源化工", PX: "能源化工", EB: "能源化工",
  RU: "能源化工", BR: "能源化工", NR: "能源化工",
  SA: "能源化工", SH: "能源化工", V: "能源化工",
  UR: "能源化工", MA: "能源化工",
  EC: "航运",
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}

const SUB_SECTOR_MAP: Record<string, string> = {
  C: "谷物", CS: "谷物", WH: "谷物", PM: "谷物", RR: "谷物", RI: "谷物", JR: "谷物", LR: "谷物",
  A: "油脂油料", B: "油脂油料", M: "油脂油料", Y: "油脂油料", RM: "油脂油料", OI: "油脂油料", RS: "油脂油料", PK: "油脂油料", P: "油脂油料",
  SR: "软商品", CF: "软商品", CY: "软商品",
  LG: "林业", SP: "林业", OP: "林业",
  AP: "生鲜", CJ: "生鲜", LH: "生鲜", JD: "生鲜",
  AU: "贵金属", AG: "贵金属", PT: "贵金属", PD: "贵金属",
  CU: "有色", BC: "有色", AL: "有色", AO: "有色", AD: "有色", ZN: "有色", PB: "有色", NI: "有色", SN: "有色",
  LC: "新能源", PS: "新能源", SI: "新能源",
  I: "原材", SF: "原材", SM: "原材",
  RB: "成材", HC: "成材", SS: "成材", WR: "成材",
  JM: "煤炭", J: "煤炭", ZC: "煤炭",
  FG: "建材", BB: "建材", FB: "建材",
  SC: "油品", FU: "油品", LU: "油品", PG: "油品", BU: "油品",
  TA: "聚酯", EG: "聚酯", PF: "聚酯", PR: "聚酯",
  PL: "烯烃", PP: "烯烃", L: "烯烃",
  BZ: "芳烃", PX: "芳烃", EB: "芳烃",
  RU: "橡胶", BR: "橡胶", NR: "橡胶",
  SA: "盐化工", SH: "盐化工", V: "盐化工",
  UR: "煤化工", MA: "煤化工",
  EC: "航运",
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}

export const SECTORS = ["农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运", "股指", "国债", "其他"] as const
export const SUB_SECTORS = ["谷物","油脂油料","软商品","林业","生鲜","贵金属","有色","新能源","原材","成材","煤炭","建材","油品","聚酯","烯烃","芳烃","橡胶","盐化工","煤化工","航运","股指","国债","其他"] as const
export const ALL_PRODS = [
  "C","CS","WH","PM","RR","RI","JR","LR",
  "A","B","M","Y","RM","OI","RS","PK","P",
  "SR","CF","CY","LG","SP","OP",
  "AP","CJ","LH","JD",
  "AU","AG","PT","PD",
  "CU","BC","AL","AO","AD","ZN","PB","NI","SN",
  "LC","PS","SI",
  "I","SF","SM","RB","HC","SS","WR",
  "JM","J","ZC","FG","BB","FB",
  "SC","FU","LU","PG","BU",
  "TA","EG","PF","PR","PL","PP","L",
  "BZ","PX","EB","RU","BR","NR",
  "SA","SH","V","UR","MA","EC",
  "IH","IF","IC","IM","MO",
  "TS","TF","T","TL",
]

export function getSector(contract: string): string {
  return SECTOR_MAP[getPrefix(contract)] ?? "其他"
}

export function getSubSector(contract: string): string {
  return SUB_SECTOR_MAP[getPrefix(contract)] ?? "其他"
}

export function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}
