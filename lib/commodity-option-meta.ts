/** Shared commodity-option product metadata (mirrors scripts/ma/option_iv/commodity_config.py). */

export const COMMODITY_SECTOR_ORDER = ["农产品", "黑色", "有色", "能化"] as const
export type CommoditySector = (typeof COMMODITY_SECTOR_ORDER)[number]

export type CommodityProductMeta = {
  key: string
  short: string
  label: string
  sector: CommoditySector
  rank: number
}

export const COMMODITY_PRODUCTS: CommodityProductMeta[] = [
  // 农产品
  { key: "a", short: "豆一", label: "豆一期权", sector: "农产品", rank: 10 },
  { key: "b", short: "豆二", label: "豆二期权", sector: "农产品", rank: 20 },
  { key: "m", short: "豆粕", label: "豆粕期权", sector: "农产品", rank: 30 },
  { key: "y", short: "豆油", label: "豆油期权", sector: "农产品", rank: 40 },
  { key: "p", short: "棕榈油", label: "棕榈油期权", sector: "农产品", rank: 50 },
  { key: "c", short: "玉米", label: "玉米期权", sector: "农产品", rank: 60 },
  { key: "cs", short: "玉米淀粉", label: "玉米淀粉期权", sector: "农产品", rank: 70 },
  { key: "jd", short: "鸡蛋", label: "鸡蛋期权", sector: "农产品", rank: 80 },
  { key: "lh", short: "生猪", label: "生猪期权", sector: "农产品", rank: 90 },
  { key: "lg", short: "原木", label: "原木期权", sector: "农产品", rank: 100 },
  { key: "sr", short: "白糖", label: "白糖期权", sector: "农产品", rank: 110 },
  { key: "cf", short: "棉花", label: "棉花期权", sector: "农产品", rank: 120 },
  { key: "oi", short: "菜油", label: "菜籽油期权", sector: "农产品", rank: 130 },
  { key: "rm", short: "菜粕", label: "菜籽粕期权", sector: "农产品", rank: 140 },
  { key: "pk", short: "花生", label: "花生期权", sector: "农产品", rank: 150 },
  { key: "ap", short: "苹果", label: "苹果期权", sector: "农产品", rank: 160 },
  { key: "cj", short: "红枣", label: "红枣期权", sector: "农产品", rank: 170 },
  // 黑色
  { key: "i", short: "铁矿石", label: "铁矿石期权", sector: "黑色", rank: 200 },
  { key: "rb", short: "螺纹钢", label: "螺纹钢期权", sector: "黑色", rank: 210 },
  { key: "sf", short: "硅铁", label: "硅铁期权", sector: "黑色", rank: 220 },
  { key: "sm", short: "锰硅", label: "锰硅期权", sector: "黑色", rank: 230 },
  { key: "zc", short: "动力煤", label: "动力煤期权", sector: "黑色", rank: 240 },
  // 有色
  { key: "cu", short: "铜", label: "铜期权", sector: "有色", rank: 300 },
  { key: "al", short: "铝", label: "铝期权", sector: "有色", rank: 310 },
  { key: "zn", short: "锌", label: "锌期权", sector: "有色", rank: 320 },
  { key: "pb", short: "铅", label: "铅期权", sector: "有色", rank: 330 },
  { key: "ni", short: "镍", label: "镍期权", sector: "有色", rank: 340 },
  { key: "sn", short: "锡", label: "锡期权", sector: "有色", rank: 350 },
  { key: "ao", short: "氧化铝", label: "氧化铝期权", sector: "有色", rank: 360 },
  { key: "au", short: "黄金", label: "黄金期权", sector: "有色", rank: 370 },
  { key: "ag", short: "白银", label: "白银期权", sector: "有色", rank: 380 },
  // 能化
  { key: "sc", short: "原油", label: "原油期权", sector: "能化", rank: 400 },
  { key: "ru", short: "天胶", label: "天胶期权", sector: "能化", rank: 410 },
  { key: "br", short: "丁二烯橡胶", label: "丁二烯橡胶期权", sector: "能化", rank: 420 },
  { key: "nr", short: "20号胶", label: "20号胶期权", sector: "能化", rank: 430 },
  { key: "fu", short: "燃料油", label: "燃料油期权", sector: "能化", rank: 435 },
  { key: "l", short: "聚乙烯", label: "聚乙烯期权", sector: "能化", rank: 440 },
  { key: "v", short: "聚氯乙烯", label: "聚氯乙烯期权", sector: "能化", rank: 450 },
  { key: "pp", short: "聚丙烯", label: "聚丙烯期权", sector: "能化", rank: 460 },
  { key: "eg", short: "乙二醇", label: "乙二醇期权", sector: "能化", rank: 470 },
  { key: "eb", short: "苯乙烯", label: "苯乙烯期权", sector: "能化", rank: 480 },
  { key: "pg", short: "LPG", label: "液化石油气期权", sector: "能化", rank: 490 },
  { key: "ta", short: "PTA", label: "PTA期权", sector: "能化", rank: 500 },
  { key: "ma", short: "甲醇", label: "甲醇期权", sector: "能化", rank: 510 },
  { key: "fg", short: "玻璃", label: "玻璃期权", sector: "能化", rank: 520 },
  { key: "sa", short: "纯碱", label: "纯碱期权", sector: "能化", rank: 530 },
  { key: "sh", short: "烧碱", label: "烧碱期权", sector: "能化", rank: 540 },
  { key: "ur", short: "尿素", label: "尿素期权", sector: "能化", rank: 550 },
  { key: "pf", short: "短纤", label: "短纤期权", sector: "能化", rank: 560 },
  { key: "px", short: "对二甲苯", label: "对二甲苯期权", sector: "能化", rank: 570 },
  { key: "pr", short: "瓶片", label: "瓶片期权", sector: "能化", rank: 580 },
  { key: "si", short: "工业硅", label: "工业硅期权", sector: "能化", rank: 590 },
  { key: "lc", short: "碳酸锂", label: "碳酸锂期权", sector: "能化", rank: 600 },
  { key: "ps", short: "多晶硅", label: "多晶硅期权", sector: "能化", rank: 610 },
]

export const COMMODITY_KEY_TO_SECTOR: Record<string, CommoditySector> = Object.fromEntries(
  COMMODITY_PRODUCTS.map((p) => [p.key, p.sector]),
) as Record<string, CommoditySector>

export const COMMODITY_KEY_TO_SHORT: Record<string, string> = Object.fromEntries(
  COMMODITY_PRODUCTS.map((p) => [p.key, p.short]),
)

export const COMMODITY_KEY_TO_LABEL: Record<string, string> = Object.fromEntries(
  COMMODITY_PRODUCTS.map((p) => [p.key, p.label]),
)

export const COMMODITY_KEY_TO_RANK: Record<string, number> = Object.fromEntries(
  COMMODITY_PRODUCTS.map((p) => [p.key, p.rank]),
)

export function commodityShortName(key: string, fallback?: string): string {
  return COMMODITY_KEY_TO_SHORT[key] ?? fallback ?? key
}

export function commoditySectorForKey(key: string, fallback?: string): CommoditySector | string {
  return COMMODITY_KEY_TO_SECTOR[key] ?? fallback ?? "能化"
}
