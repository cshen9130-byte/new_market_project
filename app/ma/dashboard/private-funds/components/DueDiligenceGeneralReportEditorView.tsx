"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Inbox, Plus, Trash2 } from "lucide-react"
import { Checkbox } from "@/components/ma/ui/checkbox"
import {
  dueDiligenceReportListUrl,
  getDueDiligenceReport,
  publishDueDiligenceReport,
  updateDueDiligenceReport,
} from "@/lib/ma/due-diligence-reports"
import {
  DateField,
  EditorFooter,
  FormField,
  inputClass,
  PersonTagField,
  RichTextEditor,
  SectionHeader,
  SelectField,
  UploadDropzone,
} from "./due-diligence-report-editor-parts"

const SECTION_NAV = [
  { id: "basic-info", label: "基本信息" },
  { id: "company-info", label: "公司信息" },
  { id: "shareholder-info", label: "股东信息" },
  { id: "team-info", label: "团队情况" },
  { id: "strategy-info", label: "投资策略" },
  { id: "process-info", label: "投资流程" },
  { id: "product-info", label: "产品情况" },
  { id: "risk-info", label: "风险控制" },
  { id: "qa-info", label: "问答补充" },
  { id: "attachment-info", label: "附件列表" },
  { id: "related-list", label: "关联列表" },
] as const

type TeamMember = { id: string; corePerson: string; position: string; resume: string }
type StrategyBlock = {
  id: string
  type: string
  intro: string
  fund: string
  benchmark: string
  showCurve: boolean
  showDrawdown: boolean
  showMonthly: boolean
}
type ProductBlock = { id: string; name: string; intro: string }

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function RepeatableBox({
  children,
  onAdd,
  addLabel,
}: {
  children: ReactNode
  onAdd: () => void
  addLabel: string
}) {
  return (
    <div className="space-y-4">
      {children}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-4 py-1.5 text-sm text-zinc-600 hover:border-red-300 hover:text-red-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {addLabel}
        </button>
      </div>
    </div>
  )
}

export function DueDiligenceGeneralReportEditorView({
  preview = false,
  reportId = null,
}: {
  preview?: boolean
  reportId?: string | null
}) {
  const existing = reportId ? getDueDiligenceReport(reportId) : null
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [reportName, setReportName] = useState(existing?.title ?? "")
  const [company, setCompany] = useState(existing?.company ?? "")
  const [ddPerson, setDdPerson] = useState(existing?.ddPerson ?? "")
  const [ddDate, setDdDate] = useState(existing?.ddDate ?? today)
  const [target, setTarget] = useState(existing?.target ?? "")
  const [position, setPosition] = useState(existing?.position ?? "")
  const [method, setMethod] = useState(existing?.method ?? "")
  const [recommender, setRecommender] = useState(existing?.recommender ?? "")
  const [summary, setSummary] = useState(existing?.detailContent ?? "")
  const [companyName, setCompanyName] = useState("")
  const [registerDate, setRegisterDate] = useState("")
  const [legalPerson, setLegalPerson] = useState("")
  const [paidCapital, setPaidCapital] = useState("")
  const [employeeCount, setEmployeeCount] = useState("")
  const [registerNo, setRegisterNo] = useState("")
  const [manageScale, setManageScale] = useState("")
  const [officeAddress, setOfficeAddress] = useState("")
  const [companyProfile, setCompanyProfile] = useState("")
  const [teamOverview, setTeamOverview] = useState("")
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([
    { id: newId(), corePerson: "", position: "", resume: "" },
  ])
  const [strategyOverview, setStrategyOverview] = useState("")
  const [strategyBlocks, setStrategyBlocks] = useState<StrategyBlock[]>([
    {
      id: newId(),
      type: "",
      intro: "",
      fund: "",
      benchmark: "",
      showCurve: true,
      showDrawdown: false,
      showMonthly: false,
    },
  ])
  const [processContent, setProcessContent] = useState("")
  const [productOverview, setProductOverview] = useState("")
  const [cooperationElements, setCooperationElements] = useState("")
  const [productBlocks, setProductBlocks] = useState<ProductBlock[]>([
    { id: newId(), name: "", intro: "" },
  ])
  const [riskContent, setRiskContent] = useState("")
  const [qaContent, setQaContent] = useState("")
  const [publishError, setPublishError] = useState("")

  function handlePublish() {
    if (!reportName.trim()) {
      setPublishError("请输入报告名称")
      return
    }
    if (!ddPerson.trim()) {
      setPublishError("请选择尽调人")
      return
    }
    const draft = {
      title: reportName.trim(),
      company: company.trim() || companyName.trim(),
      ddPerson: ddPerson.trim(),
      ddDate,
      target: target.trim(),
      position: position.trim(),
      method: method.trim(),
      recommender: recommender.trim(),
      detailContent: summary.trim() || companyProfile.trim(),
      templateId: "general" as const,
    }
    if (reportId) {
      updateDueDiligenceReport(reportId, { ...draft, published: true })
    } else {
      publishDueDiligenceReport(draft)
    }
    window.location.href = dueDiligenceReportListUrl()
  }

  return (
    <div className="flex flex-col min-h-full bg-zinc-50">
      <div className="border-b bg-white px-6 py-3 flex-shrink-0">
        <div className="text-sm text-zinc-500">
          模板：<span className="text-zinc-700">尽调报告通用模版</span>
          {preview && <span className="ml-2 text-orange-500">（预览模式）</span>}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-4xl space-y-8 pb-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 rounded-lg border border-zinc-200 bg-white p-5">
              <FormField label="报告名称：" required>
                <input
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  placeholder="如：火富牛首次尽调报告20210315"
                  className={inputClass}
                />
              </FormField>
              <FormField label="尽调公司：">
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="请输入关键字并选择管理人"
                  className={inputClass}
                />
              </FormField>
              <FormField label="尽调人：" required>
                <PersonTagField value={ddPerson} onChange={setDdPerson} />
              </FormField>
              <FormField label="尽调日期：" required>
                <DateField value={ddDate} onChange={setDdDate} />
              </FormField>
            </div>

            <section id="basic-info" className="rounded-lg border border-zinc-200 bg-white p-5">
              <SectionHeader title="基本信息" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                <FormField label="尽调对象：">
                  <input value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass} />
                </FormField>
                <FormField label="职位：">
                  <input value={position} onChange={(e) => setPosition(e.target.value)} className={inputClass} />
                </FormField>
                <FormField label="尽调方式：">
                  <input value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass} />
                </FormField>
                <FormField label="推荐机构：">
                  <input value={recommender} onChange={(e) => setRecommender(e.target.value)} className={inputClass} />
                </FormField>
              </div>
              <RichTextEditor label="尽调摘要" value={summary} onChange={setSummary} rows={5} />
            </section>

            <section id="company-info" className="rounded-lg border border-zinc-200 bg-white p-5">
              <SectionHeader title="公司信息" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                <FormField label="公司名称：">
                  <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputClass} />
                </FormField>
                <FormField label="注册时间：">
                  <DateField value={registerDate} onChange={setRegisterDate} />
                </FormField>
                <FormField label="公司法人：">
                  <input value={legalPerson} onChange={(e) => setLegalPerson(e.target.value)} className={inputClass} />
                </FormField>
                <FormField label="实缴注册资本：">
                  <input value={paidCapital} onChange={(e) => setPaidCapital(e.target.value)} className={inputClass} />
                </FormField>
                <FormField label="员工人数：">
                  <input value={employeeCount} onChange={(e) => setEmployeeCount(e.target.value)} className={inputClass} />
                </FormField>
                <FormField label="登记编号：">
                  <input value={registerNo} onChange={(e) => setRegisterNo(e.target.value)} className={inputClass} />
                </FormField>
                <FormField label="管理规模：">
                  <input value={manageScale} onChange={(e) => setManageScale(e.target.value)} className={inputClass} />
                </FormField>
                <FormField label="办公地址：">
                  <input value={officeAddress} onChange={(e) => setOfficeAddress(e.target.value)} className={inputClass} />
                </FormField>
              </div>
              <RichTextEditor label="公司简介" value={companyProfile} onChange={setCompanyProfile} rows={5} />
            </section>

            <section id="shareholder-info" className="rounded-lg border border-zinc-200 bg-white p-5">
              <SectionHeader title="股东信息" />
              <div className="overflow-hidden rounded-lg border border-zinc-200">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">股东名称</th>
                      <th className="px-3 py-2 text-left font-medium">股东类型</th>
                      <th className="px-3 py-2 text-left font-medium">持股比例</th>
                      <th className="px-3 py-2 text-left font-medium">认缴出资额</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} className="py-12">
                        <div className="flex flex-col items-center gap-2 text-zinc-400">
                          <Inbox className="h-8 w-8 opacity-40" />
                          <span className="text-sm">暂无数据</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section id="team-info" className="rounded-lg border border-zinc-200 bg-white p-5">
              <SectionHeader title="团队情况" />
              <div className="mb-5">
                <RichTextEditor label="团队概况" value={teamOverview} onChange={setTeamOverview} />
              </div>
              <RepeatableBox
                addLabel="加一组"
                onAdd={() =>
                  setTeamMembers((prev) => [...prev, { id: newId(), corePerson: "", position: "", resume: "" }])
                }
              >
                {teamMembers.map((member, index) => (
                  <div key={member.id} className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">第 {index + 1} 组</span>
                      {teamMembers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setTeamMembers((prev) => prev.filter((m) => m.id !== member.id))}
                          className="text-zinc-400 hover:text-red-500"
                          aria-label="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField label="核心人物：">
                        <input
                          value={member.corePerson}
                          onChange={(e) =>
                            setTeamMembers((prev) =>
                              prev.map((m) => (m.id === member.id ? { ...m, corePerson: e.target.value } : m)),
                            )
                          }
                          className={inputClass}
                        />
                      </FormField>
                      <FormField label="职务：">
                        <input
                          value={member.position}
                          onChange={(e) =>
                            setTeamMembers((prev) =>
                              prev.map((m) => (m.id === member.id ? { ...m, position: e.target.value } : m)),
                            )
                          }
                          className={inputClass}
                        />
                      </FormField>
                    </div>
                    <div>
                      <div className="mb-2 text-sm text-zinc-600">个人履历</div>
                      <textarea
                        value={member.resume}
                        onChange={(e) =>
                          setTeamMembers((prev) =>
                            prev.map((m) => (m.id === member.id ? { ...m, resume: e.target.value } : m)),
                          )
                        }
                        rows={4}
                        className="w-full rounded border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>
                ))}
              </RepeatableBox>
            </section>

            <section id="strategy-info" className="rounded-lg border border-zinc-200 bg-white p-5">
              <SectionHeader title="投资策略" />
              <div className="mb-5">
                <RichTextEditor label="策略概况" value={strategyOverview} onChange={setStrategyOverview} />
              </div>
              <RepeatableBox
                addLabel="增加"
                onAdd={() =>
                  setStrategyBlocks((prev) => [
                    ...prev,
                    {
                      id: newId(),
                      type: "",
                      intro: "",
                      fund: "",
                      benchmark: "",
                      showCurve: true,
                      showDrawdown: false,
                      showMonthly: false,
                    },
                  ])
                }
              >
                {strategyBlocks.map((block, index) => (
                  <div key={block.id} className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">策略 {index + 1}</span>
                      {strategyBlocks.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setStrategyBlocks((prev) => prev.filter((b) => b.id !== block.id))}
                          className="text-zinc-400 hover:text-red-500"
                          aria-label="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <FormField label="策略类型：">
                      <input
                        value={block.type}
                        onChange={(e) =>
                          setStrategyBlocks((prev) =>
                            prev.map((b) => (b.id === block.id ? { ...b, type: e.target.value } : b)),
                          )
                        }
                        className={inputClass}
                      />
                    </FormField>
                    <RichTextEditor
                      label="策略介绍"
                      value={block.intro}
                      onChange={(v) =>
                        setStrategyBlocks((prev) =>
                          prev.map((b) => (b.id === block.id ? { ...b, intro: v } : b)),
                        )
                      }
                      rows={4}
                    />
                    <div className="flex items-center gap-3">
                      <FormField label="展示基金：">
                        <input
                          value={block.fund}
                          onChange={(e) =>
                            setStrategyBlocks((prev) =>
                              prev.map((b) => (b.id === block.id ? { ...b, fund: e.target.value } : b)),
                            )
                          }
                          className={inputClass}
                        />
                      </FormField>
                      <button type="button" className="mt-5 rounded border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-white">
                        添加
                      </button>
                    </div>
                    <FormField label="基准指数：">
                      <SelectField
                        value={block.benchmark}
                        onChange={(v) =>
                          setStrategyBlocks((prev) =>
                            prev.map((b) => (b.id === block.id ? { ...b, benchmark: v } : b)),
                          )
                        }
                        placeholder="请选择基准指数"
                        options={["沪深300", "中证500", "上证指数", "创业板指"]}
                      />
                    </FormField>
                    <div className="flex flex-wrap gap-4 text-sm text-zinc-600">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={block.showCurve}
                          onCheckedChange={(v) =>
                            setStrategyBlocks((prev) =>
                              prev.map((b) => (b.id === block.id ? { ...b, showCurve: v === true } : b)),
                            )
                          }
                        />
                        收益曲线、指标
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={block.showDrawdown}
                          onCheckedChange={(v) =>
                            setStrategyBlocks((prev) =>
                              prev.map((b) => (b.id === block.id ? { ...b, showDrawdown: v === true } : b)),
                            )
                          }
                        />
                        动态回撤曲线
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={block.showMonthly}
                          onCheckedChange={(v) =>
                            setStrategyBlocks((prev) =>
                              prev.map((b) => (b.id === block.id ? { ...b, showMonthly: v === true } : b)),
                            )
                          }
                        />
                        月度收益
                      </label>
                    </div>
                  </div>
                ))}
              </RepeatableBox>
            </section>

            <section id="process-info" className="rounded-lg border border-zinc-200 bg-white p-5">
              <SectionHeader title="投资流程" />
              <RichTextEditor label="投资流程" value={processContent} onChange={setProcessContent} />
            </section>

            <section id="product-info" className="rounded-lg border border-zinc-200 bg-white p-5">
              <SectionHeader title="产品情况" />
              <div className="space-y-5 mb-5">
                <RichTextEditor label="产品概况" value={productOverview} onChange={setProductOverview} />
                <RichTextEditor label="合作要素" value={cooperationElements} onChange={setCooperationElements} />
              </div>
              <RepeatableBox
                addLabel="加一组"
                onAdd={() => setProductBlocks((prev) => [...prev, { id: newId(), name: "", intro: "" }])}
              >
                {productBlocks.map((block, index) => (
                  <div key={block.id} className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">产品 {index + 1}</span>
                      {productBlocks.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setProductBlocks((prev) => prev.filter((b) => b.id !== block.id))}
                          className="text-zinc-400 hover:text-red-500"
                          aria-label="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <FormField label="产品名称：">
                        <input
                          value={block.name}
                          onChange={(e) =>
                            setProductBlocks((prev) =>
                              prev.map((b) => (b.id === block.id ? { ...b, name: e.target.value } : b)),
                            )
                          }
                          className={inputClass}
                        />
                      </FormField>
                      <button type="button" className="mt-5 rounded border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-white">
                        删除
                      </button>
                    </div>
                    <RichTextEditor
                      label="产品介绍"
                      value={block.intro}
                      onChange={(v) =>
                        setProductBlocks((prev) =>
                          prev.map((b) => (b.id === block.id ? { ...b, intro: v } : b)),
                        )
                      }
                      rows={4}
                    />
                  </div>
                ))}
              </RepeatableBox>
            </section>

            <section id="risk-info" className="rounded-lg border border-zinc-200 bg-white p-5">
              <SectionHeader title="风险控制" />
              <RichTextEditor label="风险控制" value={riskContent} onChange={setRiskContent} />
            </section>

            <section id="qa-info" className="rounded-lg border border-zinc-200 bg-white p-5">
              <SectionHeader title="问答补充" />
              <RichTextEditor value={qaContent} onChange={setQaContent} />
            </section>

            <section id="attachment-info" className="rounded-lg border border-zinc-200 bg-white p-5">
              <SectionHeader title="附件列表" />
              <UploadDropzone />
            </section>

            <section id="related-list" className="rounded-lg border border-zinc-200 bg-white p-5">
              <SectionHeader title="关联列表" />
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:border-red-300 hover:text-red-600 transition-colors"
              >
                <Plus className="h-4 w-4" />
                添加关联
              </button>
            </section>
          </div>
        </div>

        <aside className="hidden lg:block w-36 shrink-0 border-l bg-white px-3 py-6">
          <nav className="sticky top-6 space-y-1">
            {SECTION_NAV.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block rounded px-2 py-1.5 text-xs text-zinc-500 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>
      </div>

      <EditorFooter publishError={publishError} onPublish={handlePublish} />
    </div>
  )
}
