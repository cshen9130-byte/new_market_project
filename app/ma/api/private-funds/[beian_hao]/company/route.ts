import { NextResponse } from "next/server"
import { resolveRouteFundId } from "@/lib/server/fof-underlying-query"
import {
  fmtIsoDate,
  lookupManagerList,
  lookupRepresentativeProduct,
  resolveManagerAndProduct,
} from "@/lib/server/fund-company-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao: rawId } = await params
    const beian_hao = await resolveRouteFundId(rawId)
    if (!beian_hao) {
      return NextResponse.json({ error: "Missing beian_hao" }, { status: 400 })
    }

    const { manager, productName } = await resolveManagerAndProduct(beian_hao)
    const mgr = await lookupManagerList(manager, productName)

    if (!mgr) {
      return NextResponse.json({
        manager_name: manager || null,
        legal_representative: null,
        inception_date: null,
        representative_product: null,
        active_product_count: null,
        mgmt_scale: null,
        registration_no: null,
      })
    }

    const representative_product = await lookupRepresentativeProduct(mgr.manager_name)

    return NextResponse.json({
      manager_name: mgr.manager_name,
      legal_representative: null,
      inception_date: fmtIsoDate(mgr.inception_date),
      representative_product,
      active_product_count: mgr.active_product_count,
      mgmt_scale: mgr.mgmt_scale,
      registration_no: mgr.registration_no,
    })
  } catch (err) {
    console.error("[private-funds/company]", err)
    return NextResponse.json({ error: "Failed to load fund company" }, { status: 500 })
  }
}
