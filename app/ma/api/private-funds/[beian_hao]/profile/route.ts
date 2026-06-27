import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { resolveRouteFundId } from "@/lib/server/fof-underlying-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Profile data: basicinfo_bfl_track + private_fund_info_bfl + private_fund_info

const TEMP_OPEN_MAP: Record<number, string> = {
  1: "可",
  2: "不可临开",
  3: "可临开回",
}

type PfiRow = {
  product_name: string | null
  manager: string | null
  inception_date: string | null
}

type BflRow = {
  product_name: string | null
  short_name: string | null
  fund_type: string | null
  custodian: string | null
  investment_advisor: string | null
  registration_date: string | null
  inception_date: string | null
}

type TrackRow = {
  fund_name: string | null
  fund_short_name: string | null
  register_number: string | null
  advisor: string | null
  inception_date: string | null
  puton_date: string | null
  mandator_name: string | null
  open_day: string | null
  is_temporary_open: number | null
  fee_purchase: string | null
  add_amount: string | null
  fee_redeem: string | null
  precautious_line: string | null
  closed_period: string | null
  stop_line: string | null
  fee_manage_rate: string | null
  fee_trust: string | null
  fee_manage: string | null
  fee_admin_service: string | null
  fee_pay: string | null
  updated_at: string | null
}

function fmtDate(value: string | null | undefined): string | null {
  if (!value) return null
  return value.slice(0, 10)
}

async function loadPfi(beian_hao: string): Promise<PfiRow[]> {
  try {
    return await query<PfiRow>(
      `SELECT product_name, manager, inception_date::text
       FROM private_fund_info
       WHERE beian_hao = $1
       LIMIT 1`,
      [beian_hao],
    )
  } catch {
    return []
  }
}

async function loadBfl(beian_hao: string): Promise<BflRow[]> {
  try {
    return await query<BflRow>(
      `SELECT product_name, short_name, fund_type, custodian, investment_advisor,
              registration_date::text, inception_date::text
       FROM private_fund_info_bfl
       WHERE beian_hao = $1
       LIMIT 1`,
      [beian_hao],
    )
  } catch {
    return []
  }
}

async function loadTrack(
  beian_hao: string,
  productName: string,
  shortName: string,
): Promise<TrackRow[]> {
  try {
    return await query<TrackRow>(
      `SELECT fund_name, fund_short_name, register_number,
              advisor, inception_date::text, puton_date::text,
              mandator_name, open_day, is_temporary_open,
              fee_purchase, add_amount, fee_redeem,
              precautious_line, closed_period, stop_line,
              fee_manage_rate::text, fee_trust, fee_manage,
              fee_admin_service, fee_pay,
              updated_at::text
       FROM basicinfo_bfl_track
       WHERE register_number = $1
          OR record_key = $1
          OR ($2 <> '' AND (fund_name = $2 OR fund_short_name = $2))
          OR ($3 <> '' AND (fund_name = $3 OR fund_short_name = $3))
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [beian_hao, productName, shortName],
    )
  } catch {
    return []
  }
}

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

    const [pfiRows, bflRows] = await Promise.all([
      loadPfi(beian_hao),
      loadBfl(beian_hao),
    ])

    const pfi = pfiRows[0]
    const bfl = bflRows[0]
    const productName = pfi?.product_name ?? bfl?.product_name ?? ""
    const shortName = bfl?.short_name ?? ""

    const trackRows = await loadTrack(beian_hao, productName, shortName)
    const track = trackRows[0]

    const inceptionDate =
      fmtDate(track?.inception_date) ??
      fmtDate(bfl?.inception_date) ??
      fmtDate(pfi?.inception_date)

    const putonDate =
      fmtDate(track?.puton_date) ??
      fmtDate(bfl?.registration_date)

    const feeManageRate =
      track?.fee_manage_rate != null
        ? `${(parseFloat(track.fee_manage_rate) * 100).toFixed(2)}%`
        : null

    const isTemporaryOpen =
      track?.is_temporary_open != null
        ? (TEMP_OPEN_MAP[track.is_temporary_open] ?? String(track.is_temporary_open))
        : null

    return NextResponse.json({
      fund_name:
        track?.fund_name ??
        bfl?.product_name ??
        pfi?.product_name ??
        null,
      fund_type: bfl?.fund_type ?? "私募证券投资基金",
      advisor: track?.advisor ?? bfl?.investment_advisor ?? null,
      fund_manager: pfi?.manager ?? null,
      register_number: track?.register_number ?? beian_hao,
      inception_date: inceptionDate,
      operation_date: null,
      custodian: track?.mandator_name ?? bfl?.custodian ?? null,
      puton_date: putonDate,
      open_day: track?.open_day ?? null,
      redeemable_status: isTemporaryOpen,
      fee_purchase: track?.fee_purchase ?? null,
      add_amount: track?.add_amount ?? null,
      fee_redeem: track?.fee_redeem ?? null,
      risk_level: null,
      precautious_line: track?.precautious_line ?? null,
      closed_period: track?.closed_period ?? null,
      stop_line: track?.stop_line ?? null,
      lock_period_desc: null,
      fee_manage_rate: feeManageRate,
      fee_trust: track?.fee_trust ?? null,
      fee_manage: track?.fee_manage ?? null,
      fee_admin_service: track?.fee_admin_service ?? null,
      fee_pay: track?.fee_pay ?? null,
      fee_pay_formula: null,
      updated_at: track?.updated_at ? fmtDate(track.updated_at) : null,
    })
  } catch (err) {
    console.error("[private-funds/profile]", err)
    return NextResponse.json({ error: "Failed to load fund profile" }, { status: 500 })
  }
}
