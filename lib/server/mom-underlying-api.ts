/**
 * Read-only MOM底层 table for the MOM data API.
 * Does not write public.mom_* or public.cfmmc_*.
 */
import { shapeMomUnderlyingTable, type MomUnderlyingKind } from "@/lib/ma/mom-underlying"
import { momDataErr, momDataOk, type MomDataEnvelope } from "@/lib/server/mom-data-api"
import { listMomUnderlyingProducts } from "@/lib/server/mom-underlying-list"

const NOTE =
  "与投资分析「MOM底层」同一张表。kind=compare 是对比账户，账号如 rx348，权益来自 MOM 客户权益。kind=account 是单账户资金账号，权益来自监控中心客户权益。latest_nav 是单位净值。price_change_pct 是百分点，-1.48 表示 -1.48%。equity 是元。compare_count 和 account_count 是全表数量，不受 q 影响。只读，不在这里修改关联。"

function kindOf(raw: string | undefined): MomUnderlyingKind | "all" | null {
  const text = (raw ?? "").trim().toLowerCase()
  if (!text || text === "all") return "all"
  if (text === "compare" || text === "mom") return "compare"
  if (text === "account" || text === "cfmmc" || text === "single") return "account"
  return null
}

export async function getMomUnderlying(
  record: Record<string, string | undefined>,
): Promise<MomDataEnvelope<unknown>> {
  const kind = kindOf(record.kind)
  if (!kind) return momDataErr(1, "kind must be all, compare, or account")
  try {
    const table = shapeMomUnderlyingTable(await listMomUnderlyingProducts(), { q: record.q, kind })
    return momDataOk({ ...table, kind, note: NOTE })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return momDataErr(3, msg)
  }
}
