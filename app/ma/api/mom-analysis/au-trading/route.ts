import { NextResponse } from "next/server"
import { readFileSync } from "fs"
import { join } from "path"
import { query, rawQuery } from "@/lib/db"

// ── Dynamic multiplier cache (loaded from data/contract_multipliers.json) ────
// Populated by scripts/ma/fetch_contract_multipliers.py
let _multiplierCache: Record<string, number> | null = null
function getMultiplierCache(): Record<string, number> {
  if (_multiplierCache) return _multiplierCache
  try {
    const raw = readFileSync(join(process.cwd(), "data", "contract_multipliers.json"), "utf-8")
    _multiplierCache = JSON.parse(raw) as Record<string, number>
  } catch {
    _multiplierCache = {}
  }
  return _multiplierCache
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Product config: NH benchmark code, exchange suffix, lot multiplier ──────
// Exchange codes match raw_futures_contracts_daily contract suffixes:
//   SHF=上期所  DCE=大商所  ZCE=郑商所  INE=上海国际能源  GFE=广州期货
// Multiplier = lot_size_in_primary_unit (yuan per 1 unit price move per lot)
const PRODUCT_CONFIG: Record<string, { nhCode: string | null; exchange: string; multiplier: number }> = {
  // ── Grains ─────────────────────────────────────────────────────────────────
  C:  { nhCode: "NHC.NH",   exchange: "DCE",  multiplier: 10   }, // 玉米
  CS: { nhCode: "NHCS.NH",  exchange: "DCE",  multiplier: 10   }, // 玉米淀粉
  WH: { nhCode: "NHWH.NH",  exchange: "ZCE",  multiplier: 20   }, // 强麦
  PM: { nhCode: null,        exchange: "ZCE",  multiplier: 50   }, // 普麦
  RR: { nhCode: "NHRR.NH",  exchange: "DCE",  multiplier: 10   }, // 粳米
  RI: { nhCode: "NHRI.NH",  exchange: "ZCE",  multiplier: 20   }, // 早籼稻
  JR: { nhCode: "NHJR.NH",  exchange: "ZCE",  multiplier: 20   }, // 粳稻
  LR: { nhCode: "NHLR.NH",  exchange: "ZCE",  multiplier: 10   }, // 晚籼稻
  // ── Oilseeds & fats ────────────────────────────────────────────────────────
  A:  { nhCode: "NHA.NH",   exchange: "DCE",  multiplier: 10   }, // 黄大豆1号
  B:  { nhCode: "NHB.NH",   exchange: "DCE",  multiplier: 10   }, // 黄大豆2号
  M:  { nhCode: "NHM.NH",   exchange: "DCE",  multiplier: 10   }, // 豆粕
  Y:  { nhCode: "NHY.NH",   exchange: "DCE",  multiplier: 10   }, // 豆油
  RM: { nhCode: "NHRM.NH",  exchange: "ZCE",  multiplier: 10   }, // 菜籽粕
  OI: { nhCode: "NHOI.NH",  exchange: "ZCE",  multiplier: 10   }, // 菜籽油
  RS: { nhCode: "NHRS.NH",  exchange: "ZCE",  multiplier: 10   }, // 油菜籽
  PK: { nhCode: "NHPK.NH",  exchange: "ZCE",  multiplier: 10   }, // 花生
  P:  { nhCode: "NHP.NH",   exchange: "DCE",  multiplier: 10   }, // 棕榈油
  // ── Soft commodities ───────────────────────────────────────────────────────
  SR: { nhCode: null,        exchange: "ZCE",  multiplier: 10   }, // 白糖
  CF: { nhCode: null,        exchange: "ZCE",  multiplier: 5    }, // 棉花
  CY: { nhCode: "NHCY.NH",  exchange: "ZCE",  multiplier: 5    }, // 棉纱
  AP: { nhCode: "NHAP.NH",  exchange: "ZCE",  multiplier: 10   }, // 苹果
  CJ: { nhCode: "NHCJ.NH",  exchange: "ZCE",  multiplier: 5    }, // 红枣
  LH: { nhCode: "NHLH.NH",  exchange: "DCE",  multiplier: 16   }, // 生猪 (16 tons/lot)
  JD: { nhCode: "NHJD.NH",  exchange: "DCE",  multiplier: 5    }, // 鸡蛋
  // ── Forestry / paper ───────────────────────────────────────────────────────
  LG: { nhCode: "NHLG.NH",  exchange: "DCE",  multiplier: 20   }, // 原木
  SP: { nhCode: "NHSP.NH",  exchange: "SHF",  multiplier: 10   }, // 纸浆
  OP: { nhCode: null,        exchange: "ZCE",  multiplier: 5    }, // 双胶纸
  BB: { nhCode: "NHBB.NH",  exchange: "DCE",  multiplier: 500  }, // 胶合板 (500张/lot)
  FB: { nhCode: "NHFB.NH",  exchange: "DCE",  multiplier: 500  }, // 纤维板 (500张/lot)
  // ── Precious metals ────────────────────────────────────────────────────────
  AU: { nhCode: "NHAU.NH",  exchange: "SHF",  multiplier: 1000 }, // 黄金 (1000g/lot, yuan/g)
  AG: { nhCode: "NHAG.NH",  exchange: "SHF",  multiplier: 15   }, // 白银 (15kg/lot, yuan/kg)
  PT: { nhCode: null,        exchange: "SHF",  multiplier: 500  }, // 铂 (500g/lot)
  PD: { nhCode: null,        exchange: "SHF",  multiplier: 500  }, // 钯 (500g/lot)
  // ── Base metals ────────────────────────────────────────────────────────────
  CU: { nhCode: "NHCU.NH",  exchange: "SHF",  multiplier: 5    }, // 沪铜
  BC: { nhCode: "NHBC.NH",  exchange: "INE",  multiplier: 5    }, // 国际铜
  AL: { nhCode: "NHAL.NH",  exchange: "SHF",  multiplier: 5    }, // 沪铝
  AO: { nhCode: "NHAO.NH",  exchange: "SHF",  multiplier: 20   }, // 氧化铝 (20 tons/lot)
  AD: { nhCode: null,        exchange: "SHF",  multiplier: 5    }, // 铝合金
  ZN: { nhCode: "NHZN.NH",  exchange: "SHF",  multiplier: 5    }, // 沪锌
  PB: { nhCode: "NHPB.NH",  exchange: "SHF",  multiplier: 5    }, // 沪铅
  NI: { nhCode: "NHNI.NH",  exchange: "SHF",  multiplier: 1    }, // 沪镍 (1 ton/lot)
  SN: { nhCode: "NHSN.NH",  exchange: "SHF",  multiplier: 1    }, // 沪锡 (1 ton/lot)
  LC: { nhCode: "NHLC.NH",  exchange: "GFE",  multiplier: 1    }, // 碳酸锂 (1 ton/lot)
  PS: { nhCode: null,        exchange: "GFE",  multiplier: 3    }, // 多晶硅
  SI: { nhCode: "NHSI.NH",  exchange: "GFE",  multiplier: 5    }, // 工业硅
  // ── Ferrous metals ─────────────────────────────────────────────────────────
  I:  { nhCode: "NHI.NH",   exchange: "DCE",  multiplier: 100  }, // 铁矿石 (100 tons/lot)
  SF: { nhCode: "NHSF.NH",  exchange: "ZCE",  multiplier: 5    }, // 硅铁
  SM: { nhCode: "NHSM.NH",  exchange: "ZCE",  multiplier: 5    }, // 锰硅
  RB: { nhCode: "NHRB.NH",  exchange: "SHF",  multiplier: 10   }, // 螺纹钢
  HC: { nhCode: null,        exchange: "SHF",  multiplier: 10   }, // 热卷
  SS: { nhCode: "NHSS.NH",  exchange: "SHF",  multiplier: 5    }, // 不锈钢
  WR: { nhCode: "NHWR.NH",  exchange: "SHF",  multiplier: 10   }, // 线材
  // ── Coal & coke ────────────────────────────────────────────────────────────
  JM: { nhCode: "NHJM.NH",  exchange: "DCE",  multiplier: 60   }, // 焦煤 (60 tons/lot)
  J:  { nhCode: null,        exchange: "DCE",  multiplier: 100  }, // 焦炭 (100 tons/lot)
  ZC: { nhCode: "NHZC.NH",  exchange: "ZCE",  multiplier: 100  }, // 动力煤 (100 tons/lot)
  // ── Building materials ─────────────────────────────────────────────────────
  FG: { nhCode: "NHFG.NH",  exchange: "ZCE",  multiplier: 20   }, // 玻璃 (20 tons/lot)
  // ── Energy ─────────────────────────────────────────────────────────────────
  SC: { nhCode: "NHSC.NH",  exchange: "INE",  multiplier: 1000 }, // 原油 (1000 bbl/lot)
  FU: { nhCode: null,        exchange: "SHF",  multiplier: 10   }, // 燃料油
  LU: { nhCode: "NHLU.NH",  exchange: "INE",  multiplier: 10   }, // 低硫燃料油
  PG: { nhCode: null,        exchange: "DCE",  multiplier: 20   }, // 液化石油气
  BU: { nhCode: "NHBU.NH",  exchange: "SHF",  multiplier: 10   }, // 沥青
  EC: { nhCode: null,        exchange: "SHF",  multiplier: 50   }, // 航运
  // ── Petrochemicals ─────────────────────────────────────────────────────────
  TA: { nhCode: "NHTA.NH",  exchange: "ZCE",  multiplier: 5    }, // PTA
  EG: { nhCode: "NHEG.NH",  exchange: "DCE",  multiplier: 10   }, // 乙二醇
  PF: { nhCode: "NHPF.NH",  exchange: "ZCE",  multiplier: 5    }, // 短纤
  PR: { nhCode: "NHPR.NH",  exchange: "ZCE",  multiplier: 5    }, // 瓶片
  PL: { nhCode: null,        exchange: "SHF",  multiplier: 5    }, // 丙烯
  PP: { nhCode: "NHPP.NH",  exchange: "DCE",  multiplier: 5    }, // 聚丙烯
  L:  { nhCode: "NHL.NH",   exchange: "DCE",  multiplier: 5    }, // 塑料
  BZ: { nhCode: null,        exchange: "SHF",  multiplier: 5    }, // 纯苯
  PX: { nhCode: "NHPX.NH",  exchange: "SHF",  multiplier: 5    }, // 对二甲苯
  EB: { nhCode: "NHEB.NH",  exchange: "DCE",  multiplier: 5    }, // 苯乙烯
  // ── Rubber ─────────────────────────────────────────────────────────────────
  RU: { nhCode: null,        exchange: "SHF",  multiplier: 10   }, // 天然橡胶
  BR: { nhCode: "NHBR.NH",  exchange: "INE",  multiplier: 5    }, // 丁二烯橡胶
  NR: { nhCode: "NHNR.NH",  exchange: "INE",  multiplier: 10   }, // 20号胶
  // ── Chemicals ──────────────────────────────────────────────────────────────
  SA: { nhCode: "NHSA.NH",  exchange: "ZCE",  multiplier: 20   }, // 纯碱
  SH: { nhCode: "NHSH.NH",  exchange: "ZCE",  multiplier: 30   }, // 烧碱
  V:  { nhCode: "NHV.NH",   exchange: "DCE",  multiplier: 5    }, // PVC
  UR: { nhCode: "NHUR.NH",  exchange: "ZCE",  multiplier: 20   }, // 尿素
  MA: { nhCode: "NHMA.NH",  exchange: "ZCE",  multiplier: 10   }, // 甲醇
}

// Normalise CTP-format contract to <PRODUCT><EXPIRY>.<EXCHANGE>
// e.g.  au2509  →  AU2509.SHF   |   AU2509.SHF  →  AU2509.SHF (pass-through)
function normalizeContract(raw: string, exchange: string): string {
  const upper = raw.toUpperCase().trim()
  return upper.includes(".") ? upper : `${upper}.${exchange}`
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function pickColumn(columns: Set<string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (columns.has(candidate)) return candidate
  }
  return null
}

function upperTrimExpr(columnName: string): string {
  return `UPPER(TRIM(${quoteIdent(columnName)}::text))`
}

function numericExpr(columnName: string): string {
  return `COALESCE(CAST(NULLIF(TRIM(COALESCE(${quoteIdent(columnName)}::text, '')), '') AS float8), 0)`
}

async function loadMomAccountingDailyPnl(from: string, to: string, account: string, product: string) {
  // Step 1: discover actual table names (handles case differences, schema prefix, etc.)
  const allTables = await query<{ schemaname: string; tablename: string }>(
    `SELECT schemaname, tablename FROM pg_tables
     WHERE tablename ILIKE '%mom%trade%' OR tablename ILIKE '%mom%position%'
        OR tablename ILIKE '%trade%detail%' OR tablename ILIKE '%position%detail%'
     ORDER BY tablename`
  )
  if (allTables.length === 0) {
    throw new Error(`No MOM tables found in database. Searched pg_tables for patterns: mom%trade%, mom%position%, trade%detail%, position%detail%`)
  }

  const findTable = (keywords: string[]): string | null => {
    const t = allTables.find((r) =>
      keywords.every((kw) => r.tablename.toLowerCase().includes(kw.toLowerCase()))
    )
    return t ? `${t.schemaname === "public" ? "" : `"${t.schemaname}".`}"${t.tablename}"` : null
  }

  const tradeTable = findTable(["trade"]) ?? findTable(["mom"])
  const positionTable = findTable(["position"])

  if (!tradeTable || !positionTable) {
    const names = allTables.map((r) => `${r.schemaname}.${r.tablename}`).join(", ")
    throw new Error(`Cannot identify trade/position tables. Found: ${names}`)
  }

  // Step 2: get column names via LIMIT 0
  const [tradeSchemaRes, positionSchemaRes] = await Promise.all([
    rawQuery(`SELECT * FROM ${tradeTable} LIMIT 0`),
    rawQuery(`SELECT * FROM ${positionTable} LIMIT 0`),
  ])

  const tradeCols = new Set(tradeSchemaRes.fields.map((f) => f.name))
  const positionCols = new Set(positionSchemaRes.fields.map((f) => f.name))

  const tradeDateCol = pickColumn(tradeCols, ["交易日期", "日期", "结算日期", "trade_date", "date"])
  const tradeAccountCol = pickColumn(tradeCols, ["账户", "期货账户", "账号", "客户号", "account"])
  const tradeProductCol = pickColumn(tradeCols, ["品种", "品种代码", "合约", "合约代码", "contract", "symbol"])
  const realizedPnlCol = pickColumn(tradeCols, ["平仓盈亏", "realized_pnl", "close_pnl"])

  const positionDateCol = pickColumn(positionCols, ["交易日期", "日期", "结算日期", "trade_date", "date"])
  const positionAccountCol = pickColumn(positionCols, ["账户", "期货账户", "账号", "客户号", "account"])
  const positionProductCol = pickColumn(positionCols, ["品种", "品种代码", "合约", "合约代码", "contract", "symbol"])
  const holdingPnlCol = pickColumn(positionCols, ["持仓盈亏", "holding_pnl", "position_pnl"])

  if (!tradeDateCol || !tradeAccountCol || !tradeProductCol || !realizedPnlCol) {
    const found = JSON.stringify([...tradeCols])
    throw new Error(`mom_trade_details_full cols=${found} missing=${[!tradeDateCol&&"date",!tradeAccountCol&&"acct",!tradeProductCol&&"prod",!realizedPnlCol&&"pnl"].filter(Boolean).join(",")}`)
  }
  if (!positionDateCol || !positionAccountCol || !positionProductCol || !holdingPnlCol) {
    const found = JSON.stringify([...positionCols])
    throw new Error(`mom_position_details_full cols=${found} missing=${[!positionDateCol&&"date",!positionAccountCol&&"acct",!positionProductCol&&"prod",!holdingPnlCol&&"pnl"].filter(Boolean).join(",")}`)
  }

  // Non-null assertions safe here — guards above throw if any are null
  const td = tradeDateCol!, ta = tradeAccountCol!, tp = tradeProductCol!, rp = realizedPnlCol!
  const pd = positionDateCol!, pa = positionAccountCol!, pp = positionProductCol!, hp = holdingPnlCol!

  const tradeProductExpr = ["品种代码", "合约", "合约代码", "contract", "symbol"].includes(tp)
    ? `${upperTrimExpr(tp)} ~ ('^' || $2 || '[0-9]')`
    : `${upperTrimExpr(tp)} = $2`
  const positionProductExpr = ["品种代码", "合约", "合约代码", "contract", "symbol"].includes(pp)
    ? `${upperTrimExpr(pp)} ~ ('^' || $2 || '[0-9]')`
    : `${upperTrimExpr(pp)} = $2`

  const [realizedRows, holdingRows] = await Promise.all([
    query<{ date: string; pnl: number }>(
      `SELECT (${quoteIdent(td)}::date)::text AS date,
              SUM(${numericExpr(rp)})         AS pnl
       FROM ${tradeTable}
       WHERE ${upperTrimExpr(ta)} ILIKE $1
         AND ${tradeProductExpr}
         AND ${quoteIdent(td)}::date BETWEEN $3::date AND $4::date
       GROUP BY 1
       ORDER BY 1`,
      [`%${account.toUpperCase()}%`, product, from, to],
    ),
    query<{ date: string; pnl: number }>(
      `SELECT (${quoteIdent(pd)}::date)::text AS date,
              SUM(${numericExpr(hp)})         AS pnl
       FROM ${positionTable}
       WHERE ${upperTrimExpr(pa)} ILIKE $1
         AND ${positionProductExpr}
         AND ${quoteIdent(pd)}::date BETWEEN $3::date AND $4::date
       GROUP BY 1
       ORDER BY 1`,
      [`%${account.toUpperCase()}%`, product, from, to],
    ),
  ])

  const pnlByDate = new Map<string, number>()
  for (const row of realizedRows) pnlByDate.set(row.date, (pnlByDate.get(row.date) || 0) + Number(row.pnl || 0))
  for (const row of holdingRows) pnlByDate.set(row.date, (pnlByDate.get(row.date) || 0) + Number(row.pnl || 0))

  let cumPnl = 0
  return [...pnlByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pnl]) => {
      cumPnl += pnl
      return { date, pnl: Math.round(pnl), cumPnl: Math.round(cumPnl) }
    })
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from    = searchParams.get("from")    || "2025-01-01"
    const to      = searchParams.get("to")      || new Date().toISOString().slice(0, 10)
    const account = searchParams.get("account") || "rx000"
    const method  = searchParams.get("method") === "mom" ? "mom" : "continuous"
    const bench   = searchParams.get("bench")   === "dominant" ? "dominant" : "nh"

    // Validate product against whitelist (prevents injection)
    const rawProduct = (searchParams.get("product") || "AU").toUpperCase().trim()
    const product = /^[A-Z]{1,4}$/.test(rawProduct) ? rawProduct : "AU"
    const config = PRODUCT_CONFIG[product] ?? { nhCode: null, exchange: "SHF", multiplier: 1 }
    const { nhCode, exchange } = config
    // Dynamic multiplier from OpenCTP cache overrides hard-coded value if available
    const cachedMultiplier = getMultiplierCache()[product]
    const MULTIPLIER = cachedMultiplier ?? config.multiplier

    // Fetch prices/trades from PRICE_FROM so positions opened before "from" are captured
    const PRICE_FROM = "2025-01-01"

    // Continuous contract code in raw_akshare_futures_daily for each product (fallback)
    const AKSHARE_CODE: Record<string, string> = {
      A:"A0.DCE",   AD:"AD0.SHF",  AG:"AG0.SHF",  AL:"AL0.SHF",  AO:"AO0.SHF",  AP:"AP0.CZC",
      AU:"AU0.SHF", B:"B0.DCE",    BB:"BB0.DCE",  BC:"BCM.INE",  BR:"BR0.SHF",  BU:"BU0.SHF",
      BZ:"BZ0.DCE", C:"C0.DCE",    CF:"CF0.CZC",  CJ:"CJ0.CZC",  CS:"CS0.DCE",  CU:"CU0.SHF",
      CY:"CY0.CZC", EB:"EB0.DCE",  EC:"ECM.INE",  EG:"EG0.DCE",  FB:"FB0.DCE",  FG:"FG0.CZC",
      FU:"FU0.SHF", HC:"HC0.SHF",  I:"I0.DCE",    IC:"IC0.CFE",  IF:"IF0.CFE",  IH:"IH0.CFE",
      IM:"IM0.CFE", J:"J0.DCE",    JD:"JD0.DCE",  JM:"JM0.DCE",  JR:"JR0.CZC",  L:"L0.DCE",
      LC:"LCM.GFE", LF:"LF0.DCE",  LG:"LG0.DCE",  LH:"LH0.DCE",  LR:"LR0.CZC",  LU:"LUM.INE",
      M:"M0.DCE",   MA:"MA0.CZC",  NI:"NI0.SHF",  NR:"NRM.INE",  OI:"OI0.CZC",  OP:"OP0.SHF",
      P:"P0.DCE",   PB:"PB0.SHF",  PD:"PDM.GFE",  PF:"PF0.CZC",  PG:"PG0.DCE",  PK:"PK0.CZC",
      PL:"PL0.CZC", PM:"PM0.CZC",  PP:"PP0.DCE",  PR:"PR0.CZC",  PS:"PSM.GFE",  PT:"PTM.GFE",
      PX:"PX0.CZC", RB:"RB0.SHF",  RI:"RI0.CZC",  RM:"RM0.CZC",  RR:"RR0.DCE",  RS:"RS0.CZC",
      RU:"RU0.SHF", SA:"SA0.CZC",  SC:"SCM.INE",  SF:"SF0.CZC",  SH:"SH0.CZC",  SI:"SIM.GFE",
      SM:"SM0.CZC", SN:"SN0.SHF",  SP:"SP0.SHF",  SR:"SR0.CZC",  SS:"SS0.SHF",  TA:"TA0.CZC",
      T:"T0.CFE",   TF:"TF0.CFE",  TL:"TL0.CFE",  TS:"TS0.CFE",  UR:"UR0.CZC",  V:"V0.DCE",
      VF:"VF0.DCE", WH:"WH0.CZC",  WR:"WR0.SHF",  Y:"Y0.DCE",   ZC:"ZC0.CZC",  ZN:"ZN0.SHF",
    }

    type BenchRow = { date: string; open: number; high: number; low: number; close: number; volume: number }

    // ── Fetch benchmark (with fallback for dominant) ───────────────────────────
    let benchmarkRows: BenchRow[] = []
    if (bench === "dominant") {
      // Primary: pick highest-OI contract per day from MOM-traded contracts
      benchmarkRows = await query<BenchRow>(
        `WITH ranked AS (
           SELECT trade_date::text AS date,
                  contract,
                  CAST(open  AS float8) AS open,
                  CAST(high  AS float8) AS high,
                  CAST(low   AS float8) AS low,
                  CAST(close AS float8) AS close,
                  CAST(COALESCE(hqoi,   0) AS float8) AS oi,
                  CAST(COALESCE(volume, 0) AS float8) AS volume,
                  ROW_NUMBER() OVER (
                    PARTITION BY trade_date
                    ORDER BY COALESCE(hqoi, 0) DESC, COALESCE(volume, 0) DESC
                  ) AS rn
           FROM raw_futures_contracts_daily
           WHERE UPPER(contract) ~ ('^' || $1 || '[0-9]')
             AND trade_date BETWEEN $2 AND $3
         )
         SELECT date, contract, open, high, low, close, volume
         FROM ranked WHERE rn = 1
         ORDER BY date`,
        [product, from, to],
      ).catch(() => [] as BenchRow[])

      // Fallback: use continuous contract from raw_akshare_futures_daily
      if (benchmarkRows.length === 0) {
        const akCode = AKSHARE_CODE[product]
        if (akCode) {
          benchmarkRows = await query<BenchRow>(
            `SELECT trade_date::text                    AS date,
                    CAST(open      AS float8)           AS open,
                    CAST(high      AS float8)           AS high,
                    CAST(low       AS float8)           AS low,
                    CAST(close     AS float8)           AS close,
                    CAST(COALESCE(volume, 0) AS float8) AS volume
             FROM raw_akshare_futures_daily
             WHERE code = $1
               AND trade_date BETWEEN $2 AND $3
             ORDER BY trade_date`,
            [akCode, from, to],
          ).catch(() => [] as BenchRow[])
        }
      }
    } else {
      // NH single-commodity index
      benchmarkRows = nhCode
        ? await query<BenchRow>(
            `SELECT trade_date::text                      AS date,
                    CAST(open  AS float8)                 AS open,
                    CAST(high  AS float8)                 AS high,
                    CAST(low   AS float8)                 AS low,
                    CAST(close AS float8)                 AS close,
                    CAST(COALESCE(volume, 0) AS float8)   AS volume
             FROM raw_nanhua_commodity_indices_daily
             WHERE code = $1
               AND trade_date BETWEEN $2 AND $3
             ORDER BY trade_date`,
            [nhCode, from, to],
          ).catch(() => [] as BenchRow[])
        : []
    }

    // ── Run trades + price queries in parallel ────────────────────────────────
    const [tradeRows, priceRows] = await Promise.all([
      // Use regex '^PRODUCT[0-9]' instead of LIKE 'PRODUCT%' so that single-letter
      // products (A=soybean, M=meal, C=corn, etc.) don't accidentally match
      // multi-letter products sharing the same prefix (AU, MA, CU, CF, CS, etc.)
      query<{ trade_date: string; contract: string; direction: string; action: string; price: number | null; lots: number | null }>(
        `SELECT "交易日期"::text                                            AS trade_date,
                UPPER(TRIM("合约"))                                        AS contract,
                TRIM("买/卖")                                              AS direction,
                TRIM("开/平")                                              AS action,
                CAST(NULLIF(TRIM(COALESCE("成交价",'')),'') AS float8)    AS price,
                ABS(CAST(NULLIF(TRIM(COALESCE("手数",'')),'') AS float8))  AS lots
         FROM mom_futures_trade_details
         WHERE "账户" ILIKE $1
           AND UPPER(TRIM("合约")) ~ ('^' || $2 || '[0-9]')
           AND "交易日期" BETWEEN $3 AND $4
         ORDER BY "交易日期", "合约"`,
        [`%${account}%`, product, PRICE_FROM, to],
      ),

      // 3. Daily OHLCV for all contracts of this product
      // Same regex to prevent prefix collision
      query<{ date: string; contract: string; close: number; preclose: number }>(
        `SELECT trade_date::text                                    AS date,
                contract,
                CAST(close                   AS float8)            AS close,
                CAST(COALESCE(preclose,close) AS float8)           AS preclose
         FROM raw_futures_contracts_daily
         WHERE UPPER(contract) ~ ('^' || $1 || '[0-9]')
           AND trade_date BETWEEN $2 AND $3
         ORDER BY trade_date, contract`,
        [product, PRICE_FROM, to],
      ),
    ])

    // ── Build price lookup:  "CONTRACT|DATE" → {close, preclose} ──────────────
    const priceMap = new Map<string, { close: number; preclose: number }>()
    for (const p of priceRows) {
      priceMap.set(`${p.contract}|${p.date}`, { close: p.close, preclose: p.preclose })
    }

    // ── Build per-date trade list (signed, with price) ────────────────────────
    // trades_by_date:  date → [{contract, sign, lots, price}]
    type TradeEntry = { contract: string; sign: number; lots: number; price: number }
    const tradesByDate = new Map<string, TradeEntry[]>()

    // Trade markers within the display range
    const tradeMarkers: {
      date: string; contract: string; direction: string; action: string
      price: number | null; lots: number | null
    }[] = []

    for (const t of tradeRows) {
      if (!t.lots || !t.trade_date || t.price === null) continue
      const contract = normalizeContract(t.contract, exchange)
      const sign = t.direction === "买" ? 1 : -1
      if (!tradesByDate.has(t.trade_date)) tradesByDate.set(t.trade_date, [])
      tradesByDate.get(t.trade_date)!.push({ contract, sign, lots: t.lots, price: t.price })

      if (t.trade_date >= from && t.trade_date <= to) {
        tradeMarkers.push({
          date: t.trade_date,
          contract,
          direction: t.direction,
          action: t.action || "",
          price: t.price,
          lots: t.lots,
        })
      }
    }

    const allTradingDates = [...new Set(priceRows.map(p => p.date))].sort()
    let dailyPnl: { date: string; pnl: number; cumPnl: number }[] = []

    if (method === "mom") {
      dailyPnl = await loadMomAccountingDailyPnl(from, to, account, product)
    } else {
      // ── Walk through all trading dates to compute MTM P&L ───────────────────
      // Correct continuous formula per day:
      //   dayPnl = Σ prevLots × (close − preclose)           ← carry: overnight hold
      //          + Σ tradeSign × tradeLots × (close − tradePrice)  ← fill-to-EOD for each trade
      const positions = new Map<string, number>() // contract → net lots (EOD of previous day)
      let cumPnl = 0

      for (const date of allTradingDates) {
        const todayTrades = tradesByDate.get(date) ?? []
        let dayPnl = 0

        for (const [contract, prevLots] of positions) {
          if (prevLots === 0) continue
          const p = priceMap.get(`${contract}|${date}`)
          if (!p) continue
          dayPnl += prevLots * (p.close - p.preclose) * MULTIPLIER
        }

        for (const t of todayTrades) {
          const p = priceMap.get(`${t.contract}|${date}`)
          if (!p) continue
          dayPnl += t.sign * t.lots * (p.close - t.price) * MULTIPLIER
        }

        for (const t of todayTrades) {
          positions.set(t.contract, (positions.get(t.contract) || 0) + t.sign * t.lots)
        }

        cumPnl += dayPnl
        if (date >= from) {
          dailyPnl.push({ date, pnl: Math.round(dayPnl), cumPnl: Math.round(cumPnl) })
        }
      }
    }

    // ── Snapshot intraday peak (max abs) net lots per day ─────────────────────
    // EOD lots are 0 for day-traders, so we show the peak long or short during the day.
    const positions3 = new Map<string, number>()
    const positionHistory: { date: string; totalLots: number }[] = []
    for (const date of allTradingDates) {
      const todayTrades = tradesByDate.get(date) ?? []
      // snapshot before trades = previous EOD
      const beforeLots = [...positions3.values()].reduce((s, v) => s + v, 0)
      // apply trades
      for (const t of todayTrades) {
        positions3.set(t.contract, (positions3.get(t.contract) || 0) + t.sign * t.lots)
      }
      const afterLots = [...positions3.values()].reduce((s, v) => s + v, 0)
      // use whichever is larger in abs (captures the peak holding during the day)
      const peakLots = Math.abs(beforeLots) >= Math.abs(afterLots) ? beforeLots : afterLots

      if (date >= from) {
        positionHistory.push({ date, totalLots: peakLots })
      }
    }

    return NextResponse.json({
      ok: true,
      method,
      bench,
      benchmark: benchmarkRows,
      dailyPnl,
      trades: tradeMarkers,
      positionHistory,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
