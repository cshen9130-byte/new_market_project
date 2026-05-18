/**
 * Shared product-code utilities for MOM analysis API routes.
 * Central place for ticker ↔ Chinese-name mappings and contract prefix extraction.
 */

/** Reverse map: Chinese display name → ticker code */
export const CHINESE_TO_TICKER: Record<string, string> = {
  // 谷物
  "玉米": "C", "淀粉": "CS", "强麦": "WH", "普麦": "PM",
  "粳米": "RR", "早籼稻": "RI", "粳稻": "JR", "晚籼稻": "LR",
  // 油脂油料
  "黄大豆1号": "A", "黄大豆2号": "B", "大豆1号": "A", "大豆2号": "B",
  "豆粕": "M", "豆油": "Y",
  "菜籽粕": "RM", "菜粕": "RM",
  "菜籽油": "OI", "菜油": "OI",
  "油菜籽": "RS", "花生": "PK", "棕榈油": "P",
  // 软商品
  "白糖": "SR", "棉花": "CF", "棉纱": "CY",
  // 林业
  "原木": "LG", "纸浆": "SP", "双胶纸": "OP",
  // 生鲜
  "苹果": "AP", "红枣": "CJ", "生猪": "LH", "鸡蛋": "JD",
  // 贵金属
  "黄金": "AU", "白银": "AG", "铂": "PT", "钯": "PD",
  // 有色
  "沪铜": "CU", "铜": "CU",
  "国际铜": "BC",
  "沪铝": "AL", "铝": "AL",
  "氧化铝": "AO",
  "铝合金": "AD",
  "沪锌": "ZN", "锌": "ZN",
  "沪铅": "PB", "铅": "PB",
  "沪镍": "NI", "镍": "NI",
  "沪锡": "SN", "锡": "SN",
  // 新能源
  "碳酸锂": "LC", "多晶硅": "PS", "工业硅": "SI",
  // 黑色
  "铁矿石": "I", "铁矿": "I",
  "硅铁": "SF", "锰硅": "SM",
  "螺纹钢": "RB", "螺纹": "RB",
  "热卷": "HC", "热轧卷板": "HC",
  "不锈钢": "SS", "线材": "WR",
  // 煤炭
  "焦煤": "JM", "煤炭": "J", "焦炭": "J", "动力煤": "ZC",
  // 建材
  "玻璃": "FG", "胶合板": "BB", "纤维板": "FB",
  // 油品
  "原油": "SC", "燃料油": "FU",
  "低硫燃料油": "LU", "低硫油": "LU",
  "液化石油气": "PG", "液化气": "PG",
  "沥青": "BU", "石油沥青": "BU",
  // 聚酯
  "PTA": "TA", "乙二醇": "EG", "短纤": "PF", "瓶片": "PR",
  // 烯烃
  "丙烯": "PL", "聚丙烯": "PP", "塑料": "L", "线型低密度聚乙烯": "L",
  // 芳烃
  "纯苯": "BZ", "对二甲苯": "PX", "苯乙烯": "EB",
  // 橡胶
  "天然橡胶": "RU", "橡胶": "RU",
  "丁二烯橡胶": "BR", "20号胶": "NR",
  // 盐化工
  "纯碱": "SA", "烧碱": "SH", "PVC": "V",
  // 煤化工
  "尿素": "UR", "甲醇": "MA",
  // 航运
  "航运指数": "EC",
  // 股指
  "上证50": "IH", "沪深300": "IF", "中证500": "IC", "中证1000": "IM",
  // 国债
  "2年期国债": "TS", "5年期国债": "TF", "10年期国债": "T", "30年期国债": "TL",
  "国债": "T",
}

/**
 * Extract the product ticker prefix from a contract string.
 * Handles:
 *  - Standard contract codes:  "RB2510" → "RB", "lc2607" → "LC"
 *  - Chinese product names:    "生猪" → "LH", "石油沥青" → "BU"
 *  - Chinese name + digits:    "多晶硅2606" → "PS"
 */
export function getPrefix(contract: string): string {
  if (!contract) return contract

  // 1. Leading ASCII letters → standard ticker
  const m = contract.match(/^[A-Za-z]+/)
  if (m) return m[0].toUpperCase()

  // 2. Exact Chinese name lookup
  if (CHINESE_TO_TICKER[contract]) return CHINESE_TO_TICKER[contract]

  // 3. Chinese name + trailing digits, e.g. "多晶硅2606"
  const stripped = contract.replace(/\d+$/, "").trim()
  if (stripped && CHINESE_TO_TICKER[stripped]) return CHINESE_TO_TICKER[stripped]

  // 4. Prefix match (longest first) in case of compound names
  let best = ""
  let bestTicker = contract
  for (const [cn, ticker] of Object.entries(CHINESE_TO_TICKER)) {
    if (contract.startsWith(cn) && cn.length > best.length) {
      best = cn
      bestTicker = ticker
    }
  }
  if (best) return bestTicker

  // 5. Fallback: return as-is (unknown product)
  return contract.toUpperCase()
}
