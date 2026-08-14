import { NextResponse } from "next/server"
import {
  loadFofContractCoverage,
  type FofContractCoverageFilter,
} from "@/lib/server/fof-contract-coverage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FILTERS = new Set<FofContractCoverageFilter>([
  "all",
  "missing_contract",
  "has_contract",
  "missing_beian",
  "missing_elements",
])

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const filterRaw = (searchParams.get("filter") || "all").trim() as FofContractCoverageFilter
    const filter = FILTERS.has(filterRaw) ? filterRaw : "all"
    const q = (searchParams.get("q") || "").trim()
    const holding = searchParams.get("holding") !== "0"
    const limit = parseInt(searchParams.get("limit") || "100", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)
    const data = await loadFofContractCoverage({
      filter,
      q,
      holdingOnly: holding,
      limit,
      offset,
    })
    return NextResponse.json({ ok: true, ...data })
  } catch (err) {
    console.error("[ops/fund-elements/fof-coverage GET]", err)
    return NextResponse.json({ error: "加载 FOF底层合同覆盖失败" }, { status: 500 })
  }
}
