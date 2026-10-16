/**
 * 私募基金 = every product we cannot positively place in 股权, 信托, or 资管.
 *
 * Sure 股权: 股权投资基金, 创业投资基金.
 * Sure 信托: 信托计划 (基金页「信托产品」).
 * Sure 资管: 券商资管, 期货资管, 公募专户, 保险资管, 银行理财, plus a row in the futures-product table.
 * A product name containing 股权, 信托, 资管, 有限合伙, 创业投资, or 资产管理 is also not 私募基金.
 * A blank 协会类型 with none of those words stays 私募基金.
 */

function sqlNameHas(nameExpr: string, word: string): string {
  return `COALESCE(${nameExpr}, '') LIKE '%${word}%'`
}

const EQUITY_FUND_TYPES = ["股权投资基金", "创业投资基金"] as const

const TRUST_FUND_TYPES = ["信托计划"] as const

const ASSET_FUND_TYPES = [
  "证券公司及其子公司的资产管理计划",
  "期货公司及其子公司的资产管理计划",
  "期货公司集合资管产品",
  "保险公司及其子公司的资产管理计划",
  "基金专户",
  "银行理财产品",
] as const

function sqlTypeIn(beianExpr: string, types: readonly string[], alias: string): string {
  const list = types.map((type) => `'${type.replace(/'/g, "''")}'`).join(", ")
  return `EXISTS (
    SELECT 1 FROM amac_private_funds ${alias}
    WHERE ${alias}.fund_no = ${beianExpr}
      AND BTRIM(${alias}.fund_type) IN (${list})
  )`
}

export function sqlEquityClass(beianExpr: string, nameExpr: string): string {
  return `(
    ${sqlTypeIn(beianExpr, EQUITY_FUND_TYPES, "_eq")}
    OR ${sqlNameHas(nameExpr, "股权")}
    OR ${sqlNameHas(nameExpr, "有限合伙")}
    OR ${sqlNameHas(nameExpr, "创业投资")}
  )`
}

export function sqlTrustClass(beianExpr: string, nameExpr: string): string {
  return `(${sqlTypeIn(beianExpr, TRUST_FUND_TYPES, "_tr")} OR ${sqlNameHas(nameExpr, "信托")})`
}

export function sqlAssetClass(beianExpr: string, nameExpr: string): string {
  return `(
    ${sqlTypeIn(beianExpr, ASSET_FUND_TYPES, "_as")}
    OR EXISTS (
      SELECT 1 FROM amac_futures_products _fut
      WHERE _fut.fund_no = ${beianExpr}
    )
    OR ${sqlNameHas(nameExpr, "资管")}
    OR ${sqlNameHas(nameExpr, "资产管理")}
  )`
}

/** True when the product is not 股权 / 信托 / 资管 by type, futures table, or name. */
export function sqlIsPrivateFund(beianExpr: string, nameExpr: string): string {
  return `NOT (${sqlEquityClass(beianExpr, nameExpr)} OR ${sqlTrustClass(beianExpr, nameExpr)} OR ${sqlAssetClass(beianExpr, nameExpr)})`
}

/** Exclusive label. Equity wins, then trust, then asset. */
export function sqlProductClassCase(beianExpr: string, nameExpr: string): string {
  return `CASE
    WHEN ${sqlEquityClass(beianExpr, nameExpr)} THEN 'equity'
    WHEN ${sqlTrustClass(beianExpr, nameExpr)} THEN 'trust'
    WHEN ${sqlAssetClass(beianExpr, nameExpr)} THEN 'asset'
    ELSE 'private'
  END`
}
