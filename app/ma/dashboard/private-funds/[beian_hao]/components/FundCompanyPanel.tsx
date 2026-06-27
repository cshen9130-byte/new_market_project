"use client"

import { memo, useEffect, useState } from "react"
import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { FundCompanyProductList } from "./FundCompanyProductList"

interface CompanyData {
  manager_name: string | null
  legal_representative: string | null
  inception_date: string | null
  representative_product: { beian_hao: string; product_name: string } | null
  active_product_count: number | null
  mgmt_scale: string | null
  registration_no: string | null
}

function InfoCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-4 px-5 py-3.5 border-b border-zinc-100 last:border-b-0 min-h-[52px]">
      <span className="text-sm text-zinc-500 whitespace-nowrap">{label}</span>
      <div className="text-sm text-zinc-800">{children}</div>
    </div>
  )
}

function fmtCell(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-zinc-400">—</span>
  }
  return value
}

function amacManagerUrl(registrationNo: string) {
  return `https://gs.amac.org.cn/amac-infodisc/res/pof/manager/managerList.html?keyword=${encodeURIComponent(registrationNo)}`
}

export const FundCompanyPanel = memo(function FundCompanyPanel({
  beian_hao,
}: {
  beian_hao: string
}) {
  const [data, setData] = useState<CompanyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/company`)
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败")
        return res.json() as Promise<CompanyData>
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [beian_hao])

  if (loading) {
    return (
      <div className="min-h-[320px] flex items-center justify-center text-sm text-zinc-400">
        加载中…
      </div>
    )
  }

  if (error || !data?.manager_name) {
    return (
      <div className="min-h-[320px] flex items-center justify-center text-sm text-zinc-400">
        {error ?? "暂无基金公司信息"}
      </div>
    )
  }

  const productScale =
    data.active_product_count != null && data.mgmt_scale
      ? `${data.active_product_count}只 / ${data.mgmt_scale}`
      : data.active_product_count != null
        ? `${data.active_product_count}只`
        : data.mgmt_scale

  return (
    <div className="space-y-0">
      <div className="rounded-xl border border-zinc-100 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 bg-zinc-50/40">
          <h2 className="text-base font-semibold text-zinc-800">{data.manager_name}</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-100">
          <div className="bg-zinc-50/20">
            <InfoCell label="公司法人：">
              {fmtCell(data.legal_representative)}
            </InfoCell>
            <InfoCell label="成立日期：">
              {fmtCell(data.inception_date)}
            </InfoCell>
            <InfoCell label="代表产品：">
              {data.representative_product ? (
                <Link
                  href={`/ma/dashboard/private-funds/${encodeURIComponent(data.representative_product.beian_hao)}`}
                  className="text-blue-600 hover:underline"
                >
                  {data.representative_product.product_name}
                </Link>
              ) : (
                fmtCell(null)
              )}
            </InfoCell>
          </div>

          <div className="bg-zinc-50/20">
            <InfoCell label="管理产品/规模：">
              {fmtCell(productScale)}
            </InfoCell>
            <InfoCell label="登记编号：">
              {data.registration_no ? (
                <a
                  href={amacManagerUrl(data.registration_no)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  {data.registration_no}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
                </a>
              ) : (
                fmtCell(null)
              )}
            </InfoCell>
          </div>
        </div>
      </div>

      <FundCompanyProductList beian_hao={beian_hao} />
    </div>
  )
})
