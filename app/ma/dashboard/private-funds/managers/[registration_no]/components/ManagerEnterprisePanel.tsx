"use client"

import { useEffect, useMemo, useState } from "react"
import { Inbox } from "lucide-react"

interface RegistrationInfo {
  full_name: string
  short_name: string
  legal_representative: string | null
  registration_no: string
  registration_date: string | null
  inception_date: string | null
  member_type: string | null
  business_reg_no: string | null
  unified_credit_code: string | null
  business_term: string | null
  business_scope: string | null
  registered_capital: string | null
  paid_in_capital: string | null
  actual_controller: string | null
  institution_type: string | null
  mgmt_scale: string | null
  enterprise_nature: string | null
  third_party_advisor: string | null
  operating_status: string | null
  office_address: string | null
  registered_address: string | null
}

interface ShareholderRow {
  name: string
  shareholder_type: string
  holding_ratio: string
  subscribed_amount: string
}

interface ExternalInvestmentRow {
  enterprise_name: string
  registered_capital: string
  registration_date: string
}

interface BranchRow {
  org_name: string
  related_name: string
}

interface AnnualReportRow {
  year: number
  employee_count: string
  pledge_or_equity_purchase: string
  equity_transfer: string
}

interface ChangeRecordRow {
  change_date: string
  change_type: string
  before_value: string
  after_value: string
}

interface EnterpriseData {
  registration: RegistrationInfo
  shareholders: ShareholderRow[]
  external_investments: ExternalInvestmentRow[]
  branches: BranchRow[]
  annual_reports: AnnualReportRow[]
  change_records: ChangeRecordRow[]
}

function fmt(value: string | null | undefined) {
  if (!value?.trim()) return "—"
  return value
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-4">
      <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-x-4 py-3 border-b border-zinc-50 last:border-b-0 min-h-[48px] items-start">
      <span className="text-sm text-zinc-500 whitespace-nowrap shrink-0">{label}</span>
      <span className="text-sm text-zinc-800 leading-relaxed break-words">{fmt(value)}</span>
    </div>
  )
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-14 text-center">
        <div className="flex flex-col items-center gap-2 text-zinc-400">
          <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
          <span className="text-sm">暂无数据</span>
        </div>
      </td>
    </tr>
  )
}

function TablePagination({
  total,
  page,
  pageSize,
  onPageChange,
}: {
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pages: (number | "…")[] = []
  const lo = Math.max(1, page - 1)
  const hi = Math.min(totalPages, page + 1)
  if (lo > 1) {
    pages.push(1)
    if (lo > 2) pages.push("…")
  }
  for (let i = lo; i <= hi; i++) pages.push(i)
  if (hi < totalPages) {
    if (hi < totalPages - 1) pages.push("…")
    pages.push(totalPages)
  }

  return (
    <div className="flex items-center justify-end gap-2 mt-3 text-xs text-zinc-600">
      <span>共 {total} 条</span>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="w-7 h-7 flex items-center justify-center rounded border hover:bg-zinc-50 disabled:opacity-30"
      >
        ‹
      </button>
      {pages.map((btn, idx) =>
        btn === "…" ? (
          <span key={`e-${idx}`} className="px-1 text-zinc-400">…</span>
        ) : (
          <button
            key={btn}
            type="button"
            onClick={() => onPageChange(btn)}
            className={[
              "min-w-[28px] h-7 px-2 flex items-center justify-center rounded border transition-colors",
              page === btn ? "bg-red-500 text-white border-red-500 font-medium" : "hover:bg-zinc-50 border-zinc-200",
            ].join(" ")}
          >
            {btn}
          </button>
        ),
      )}
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="w-7 h-7 flex items-center justify-center rounded border hover:bg-zinc-50 disabled:opacity-30"
      >
        ›
      </button>
    </div>
  )
}

function usePagedRows<T>(rows: T[], pageSize: number) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize],
  )
  return { paged, page: safePage, setPage, total: rows.length, pageSize }
}

export function ManagerEnterprisePanel({ registrationNo }: { registrationNo: string }) {
  const [data, setData] = useState<EnterpriseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/ma/api/private-fund-managers/${encodeURIComponent(registrationNo)}/enterprise`)
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败")
        return res.json() as Promise<EnterpriseData>
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
    return () => {
      cancelled = true
    }
  }, [registrationNo])

  const shareholders = usePagedRows(data?.shareholders ?? [], 5)
  const annualReports = usePagedRows(data?.annual_reports ?? [], 5)
  const changeRecords = usePagedRows(data?.change_records ?? [], 5)

  const thBase = "px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap bg-zinc-50/80"
  const tdBase = "px-3 py-2.5 text-sm text-zinc-700"

  if (loading) {
    return (
      <div className="space-y-4 w-full animate-pulse">
        <div className="h-80 rounded-lg bg-zinc-100" />
        <div className="h-40 rounded-lg bg-zinc-100" />
        <div className="h-40 rounded-lg bg-zinc-100" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-40 text-red-500 text-sm rounded-lg border border-zinc-100 bg-white w-full">
        加载失败：{error ?? "未知错误"}
      </div>
    )
  }

  const reg = data.registration

  return (
    <div className="space-y-4 w-full">
      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle>注册信息</SectionTitle>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 divide-y xl:divide-y-0 xl:divide-x divide-zinc-100">
          <div className="xl:pr-6">
            <InfoRow label="企业全称" value={reg.full_name} />
            <InfoRow label="企业简称" value={reg.short_name} />
            <InfoRow label="法定代表人" value={reg.legal_representative} />
            <InfoRow label="登记编号" value={reg.registration_no} />
            <InfoRow label="登记日期" value={reg.registration_date} />
            <InfoRow label="成立日期" value={reg.inception_date} />
            <InfoRow label="会员资格" value={reg.member_type} />
            <InfoRow label="工商注册号" value={reg.business_reg_no} />
            <InfoRow label="统一社会信用代码" value={reg.unified_credit_code} />
            <InfoRow label="营业期限" value={reg.business_term} />
            <InfoRow label="经营范围" value={reg.business_scope} />
          </div>
          <div className="xl:pl-6">
            <InfoRow label="注册资本" value={reg.registered_capital} />
            <InfoRow label="实缴资本" value={reg.paid_in_capital} />
            <InfoRow label="实际控制人" value={reg.actual_controller} />
            <InfoRow label="机构类型" value={reg.institution_type} />
            <InfoRow label="管理规模" value={reg.mgmt_scale} />
            <InfoRow label="企业性质" value={reg.enterprise_nature} />
            <InfoRow label="三方顾问" value={reg.third_party_advisor} />
            <InfoRow label="经营状态" value={reg.operating_status} />
            <InfoRow label="办公地址" value={reg.office_address} />
            <InfoRow label="注册地址" value={reg.registered_address} />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle>股东信息</SectionTitle>
        <div className="overflow-x-auto w-full">
          <table className="text-sm border-collapse w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-zinc-100">
                <th className={thBase}>股东名称</th>
                <th className={thBase}>股东类型</th>
                <th className={thBase}>持股比例</th>
                <th className={thBase}>认缴出资额</th>
              </tr>
            </thead>
            <tbody>
              {shareholders.paged.length === 0 ? (
                <EmptyRow colSpan={4} />
              ) : (
                shareholders.paged.map((row) => (
                  <tr key={row.name} className="border-b border-zinc-50 hover:bg-zinc-50/40">
                    <td className={tdBase}>{row.name}</td>
                    <td className={tdBase}>{row.shareholder_type}</td>
                    <td className={tdBase}>{row.holding_ratio}</td>
                    <td className={tdBase}>{row.subscribed_amount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {shareholders.total > shareholders.pageSize && (
          <TablePagination
            total={shareholders.total}
            page={shareholders.page}
            pageSize={shareholders.pageSize}
            onPageChange={shareholders.setPage}
          />
        )}
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle>对外投资</SectionTitle>
        <div className="overflow-x-auto w-full">
          <table className="text-sm border-collapse w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-zinc-100">
                <th className={thBase}>企业名称</th>
                <th className={thBase}>注册资本</th>
                <th className={thBase}>注册日期</th>
              </tr>
            </thead>
            <tbody>
              {data.external_investments.length === 0 ? (
                <EmptyRow colSpan={3} />
              ) : (
                data.external_investments.map((row) => (
                  <tr key={row.enterprise_name} className="border-b border-zinc-50 hover:bg-zinc-50/40">
                    <td className={tdBase}>{row.enterprise_name}</td>
                    <td className={tdBase}>{row.registered_capital}</td>
                    <td className={tdBase}>{row.registration_date}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle>分支机构</SectionTitle>
        <div className="overflow-x-auto w-full">
          <table className="text-sm border-collapse w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-zinc-100">
                <th className={thBase}>机构名称</th>
                <th className={thBase}>相关名称</th>
              </tr>
            </thead>
            <tbody>
              {data.branches.length === 0 ? (
                <EmptyRow colSpan={2} />
              ) : (
                data.branches.map((row) => (
                  <tr key={row.org_name} className="border-b border-zinc-50 hover:bg-zinc-50/40">
                    <td className={tdBase}>{row.org_name}</td>
                    <td className={tdBase}>{row.related_name}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle>年报信息</SectionTitle>
        <div className="overflow-x-auto w-full">
          <table className="text-sm border-collapse w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-zinc-100">
                <th className={thBase}>年度</th>
                <th className={thBase}>从业人数</th>
                <th className={thBase}>是否有投资信息或者购买其他公司股权</th>
                <th className={thBase}>是否有发生股权转让</th>
              </tr>
            </thead>
            <tbody>
              {annualReports.paged.length === 0 ? (
                <EmptyRow colSpan={4} />
              ) : (
                annualReports.paged.map((row) => (
                  <tr key={row.year} className="border-b border-zinc-50 hover:bg-zinc-50/40">
                    <td className={tdBase}>{row.year}</td>
                    <td className={tdBase}>{row.employee_count}</td>
                    <td className={tdBase}>{row.pledge_or_equity_purchase}</td>
                    <td className={tdBase}>{row.equity_transfer}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {annualReports.total > annualReports.pageSize && (
          <TablePagination
            total={annualReports.total}
            page={annualReports.page}
            pageSize={annualReports.pageSize}
            onPageChange={annualReports.setPage}
          />
        )}
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle>变更信息</SectionTitle>
        <div className="overflow-x-auto w-full">
          <table className="text-sm border-collapse w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-zinc-100">
                <th className={thBase}>变更日期</th>
                <th className={thBase}>变更类型</th>
                <th className={thBase}>变更前</th>
                <th className={thBase}>变更后</th>
              </tr>
            </thead>
            <tbody>
              {changeRecords.paged.length === 0 ? (
                <EmptyRow colSpan={4} />
              ) : (
                changeRecords.paged.map((row, idx) => (
                  <tr key={`${row.change_date}-${idx}`} className="border-b border-zinc-50 hover:bg-zinc-50/40">
                    <td className={`${tdBase} whitespace-nowrap tabular-nums`}>{row.change_date}</td>
                    <td className={tdBase}>{row.change_type}</td>
                    <td className={`${tdBase} max-w-[280px] break-words`}>{row.before_value}</td>
                    <td className={`${tdBase} max-w-[280px] break-words`}>{row.after_value}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {changeRecords.total > changeRecords.pageSize && (
          <TablePagination
            total={changeRecords.total}
            page={changeRecords.page}
            pageSize={changeRecords.pageSize}
            onPageChange={changeRecords.setPage}
          />
        )}
      </div>
    </div>
  )
}
