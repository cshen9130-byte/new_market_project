import { publicQuery } from "@/lib/db"
import { FUND_DATA_PUBLIC_HTTPS_ORIGIN } from "@/lib/ma/fund-data-public"
import type { SavedFundCompare, SavedFundCompareFund } from "@/lib/ma-fund-compare-storage"

const ID_RE = /^cmp-\d{10,16}$/

export function fundComparePageUrl(id: string): string {
  return `${FUND_DATA_PUBLIC_HTTPS_ORIGIN}/ma/dashboard/private-funds/fund-compare/${id}`
}

export function buildSavedFundCompare(
  funds: SavedFundCompareFund[],
  now = Date.now(),
): SavedFundCompare {
  const first = funds[0]?.product_name.replace(/私募证券投资基金$/, "").replace(/证券投资基金$/, "") || "基金对比"
  const name = funds.length <= 1 ? first : `${first}等${funds.length}只`
  const iso = new Date(now).toISOString()
  return {
    id: `cmp-${now}`,
    name,
    scope: "team",
    funds,
    createdAt: iso,
    updatedAt: iso,
  }
}

function isSaved(value: unknown): value is SavedFundCompare {
  if (!value || typeof value !== "object") return false
  const row = value as SavedFundCompare
  return ID_RE.test(row.id)
    && row.scope === "team"
    && typeof row.name === "string"
    && Array.isArray(row.funds)
    && row.funds.every((fund) => fund && typeof fund.beian_hao === "string" && typeof fund.product_name === "string")
}

async function ensureTable(): Promise<void> {
  await publicQuery(
    `CREATE TABLE IF NOT EXISTS public.fund_compare_link (
       id text PRIMARY KEY,
       payload jsonb NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
  )
}

export async function saveFundCompareLink(compare: SavedFundCompare): Promise<string> {
  if (!ID_RE.test(compare.id)) throw new Error("无效的对比编号")
  await ensureTable()
  await publicQuery(
    `INSERT INTO public.fund_compare_link (id, payload)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
    [compare.id, JSON.stringify(compare)],
  )
  return fundComparePageUrl(compare.id)
}

export async function loadFundCompareLink(id: string): Promise<SavedFundCompare | null> {
  if (!ID_RE.test(id)) return null
  await ensureTable()
  const res = await publicQuery(
    `SELECT payload FROM public.fund_compare_link WHERE id = $1`,
    [id],
  )
  const payload = res.rows[0]?.payload
  const value = typeof payload === "string" ? JSON.parse(payload) : payload
  return isSaved(value) ? value : null
}
