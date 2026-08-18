import assert from "node:assert/strict"
import {
  extractAddAmountFromText,
  extractClosedPeriodFromText,
  extractFeeAdminFromText,
  extractFeePayFormulaFromText,
  extractFeeRedeemFromText,
  extractFeeTrustFromText,
  extractLockPeriodFromText,
  extractRiskLevelFromText,
  extractTemporaryOpenFromText,
  fillMissingElementsFromKeywords,
  isWeakRiskLevel,
  summarizeFeeManageDesc,
} from "../../lib/server/fund-contract-element-keywords.ts"
import { formatTemporaryOpen } from "../../lib/ma/fund-elements-extra.ts"

const guqu = `
12、以扣减基金份额方式提取业绩报酬的风险（若有）
基金管理人可能以扣减基金份额的方式提取业绩报酬。

（二）一般风险
1、本金损失风险
本基金属于 R4 (中高风险) 投资品种，适合风险承受能力为 C4 (或成长型) 及以上的合格投资者。

第七节 基金的申购、赎回与转让
（一）基金申购和赎回的开放日
本基金不设置临时开放日。
（二）基金份额的锁定期
基金份额持有人持有基金份额自份额确认日起不满【6】个月的不得赎回。

（2）业绩报酬的计算公式
本基金业绩报酬的提取比例（X）为【20】%。单个投资者单笔基金份额的业绩报酬计算公式为：
Y = F × (P_i - P_0) × W
其中：Y 为本次提取的业绩报酬金额；F 为参与计提的份额；P_i 为本次计提日的基金份额累计净值；P_0 为该笔投资的高水位。
（3）业绩报酬的支付
管理人向托管人发送支付指令，托管人于5个工作日内支付。
`

assert.equal(extractRiskLevelFromText(guqu), "R4（中高风险）")
assert.equal(extractLockPeriodFromText(guqu), "份额确认日起不满6个月不得赎回")
const formula = extractFeePayFormulaFromText(guqu)
assert.ok(formula && formula.includes("Y = F"), formula)
assert.ok(formula && formula.includes("20%"), formula)
assert.ok(formula && formula.length <= 220, formula)
assert.ok(formula && !formula.includes("业绩报酬的支付"), formula)

const filled = fillMissingElementsFromKeywords(guqu, {
  risk_level: null,
  lock_period_desc: "无",
  fee_pay_formula: "20%",
  fee_manage: null,
  is_temporary_open: "0",
})
assert.equal(filled.risk_level, "R4（中高风险）")
assert.equal(filled.lock_period_desc, "份额确认日起不满6个月不得赎回")
assert.ok(filled.fee_pay_formula?.includes("Y = F"))
assert.equal(filled.is_temporary_open, "否")
assert.equal(extractTemporaryOpenFromText(guqu), "否")
assert.equal(formatTemporaryOpen(0), "否")
assert.equal(formatTemporaryOpen(1), "可临开")

assert.equal(extractRiskLevelFromText("适合风险承受能力为 C4 (或成长型) 及以上的合格投资者。"), null)
assert.equal(extractRiskLevelFromText("本基金风险等级为R3，适合稳健型投资者。"), "R3（中风险）")
assert.ok(extractLockPeriodFromText("本基金锁定期为【12】个月，锁定期内不得赎回。")?.includes("12"))

const snf018 = `
份额锁定期 不设置
基金投资者首次净申购金额应不低于 100 万元人民币。
赎回后持有的基金资产净值不得低于 100 万元人民币。
本基金的管理费率为年费率 1%。每日计提，按自然季度支付。
4、 基金的业绩报酬
(1)本基金业绩报酬计提基准为年化 6%。
(3)业绩报酬的计算：年化收益率（R）大于业绩报酬计提基准时，差额收益按【40%】比例进行计提。
R=（Tn - T0）/ T1 × 365 / T ×100%；
当 R - B >0 时，E=K×T1×（R - B）×T/365×【40%】；
3）业绩报酬的支付
`

assert.equal(extractLockPeriodFromText(snf018), "不设置")
assert.ok(extractAddAmountFromText(snf018)?.includes("100万元"))
const snfFormula = extractFeePayFormulaFromText(snf018)
assert.ok(snfFormula && snfFormula.includes("40%"), snfFormula)
assert.ok(snfFormula && /E\s*=\s*K|R\s*=/.test(snfFormula), snfFormula)
assert.ok(snfFormula && snfFormula.length <= 220, snfFormula)
assert.equal(summarizeFeeManageDesc(snf018), "年管理费率1%，每日计提，按自然季度支付。")

const sbbc18 = `
43、份额锁定期：针对每一基金份额设有限制赎回的期限。44、不可抗力：自然灾害。
(七)私募基金的风险等级
本基金风险等级为[R5]，适合风险承受能力[C5]的普通投资者。
2、赎回费用
本基金依据基金份额持有人所持有的每笔基金份额的时间收取赎回费，持有时间
小于 90 个自然日赎回费率为 0.5%，持有时间大于 90 个自然日（含）赎回费率为 0%。
2、托管费
本基金的托管费年费率为 0.015％。每日计提，按自然季度支付。
3、运营服务费
本基金的运营服务费年费率为 0.015%。每日计提，按自然季度支付。
1、管理费
本基金的管理费按基金资产净值的 1％年费率计提。每日计提，按自然季度支付。
（2）业绩报酬计提方法
若基金单位份额年化收益率 R 小于或等于 6%时，管理人不提取业绩报酬；若 R 大于 6%，管理人对全部正收益提取 40%。
A＝为本次业绩报酬基准日基金份额累计净值；
R = (A - B) / C × 365 / N ×100%
封闭期（如有）内可设置临时开放日。
`

assert.equal(extractRiskLevelFromText(sbbc18), "R5（高风险）")
assert.ok(extractLockPeriodFromText(sbbc18)?.includes("90"), extractLockPeriodFromText(sbbc18))
assert.ok(extractLockPeriodFromText(sbbc18) && extractLockPeriodFromText(sbbc18).length <= 80)
assert.equal(extractFeeRedeemFromText(sbbc18), "持有不足90天赎回费0.5%，满90天0%。")
assert.equal(extractFeeTrustFromText(sbbc18), "年托管费率0.015%，每日计提，按自然季度支付。")
assert.equal(extractFeeAdminFromText(sbbc18), "年运营服务费率0.015%，每日计提，按自然季度支付。")
assert.equal(extractClosedPeriodFromText(sbbc18), "不设置")
assert.equal(summarizeFeeManageDesc(sbbc18), "年管理费率1%，每日计提，按自然季度支付。")
const sbbcFormula = extractFeePayFormulaFromText(sbbc18)
assert.ok(sbbcFormula && sbbcFormula.includes("40%"), sbbcFormula)
assert.ok(sbbcFormula && !sbbcFormula.includes("托管费"), sbbcFormula)
assert.ok((sbbcFormula ?? "").length <= 220)

const sbbcFilled = fillMissingElementsFromKeywords(sbbc18, {
  lock_period_desc: "放日（如有），基金份额持有人...43、份额锁定期：针对每一基金份额设有限制赎回的期限...44、不可抗力",
  fee_manage: "代码：...5、银行账户...16、报告要求 " + "x".repeat(400),
  fee_pay_formula: "十六、私募基金的费用与税收（一）基金费用的种类 1、管理费；2、托管费； -- 74 of 95 --",
  fee_redeem: null,
  fee_trust: null,
  fee_admin_service: null,
  closed_period: null,
  risk_level: null,
})
assert.equal(sbbcFilled.risk_level, "R5（高风险）")
assert.ok((sbbcFilled.lock_period_desc ?? "").length <= 80)
assert.ok((sbbcFilled.fee_manage ?? "").length <= 90)
assert.ok(sbbcFilled.fee_redeem?.includes("0.5%"))
assert.ok(sbbcFilled.fee_trust?.includes("0.015%"))
assert.ok(sbbcFilled.fee_admin_service?.includes("0.015%"))
assert.equal(sbbcFilled.closed_period, "不设置")
assert.ok((sbbcFilled.fee_pay_formula ?? "").length <= 220)
assert.ok(!sbbcFilled.fee_pay_formula?.includes("费用的种类"))

const stw344 = `
反洗钱职责（包括客户身份识别、客户洗钱风险等级划分、可疑交易报告）。
管理人发起的强制赎回份额不受份额锁定期（如有）限制。《私募办法》第十三条列明的投资者不适用本项。
2、申购申请及确认（1）申购申请
因本基金持有流通受限证券、投资的产品封闭期（含限售期、锁定期）超过本基金存续期等原因导致本基金财产无法及时变现的。
（一）基金管理费
本基金的年管理费率为【1】%，计算方法如下：
-- 58 of 97 --
H＝E×年管理费率÷365
本基金的管理费自基金成立日起，每日计提，按季支付。
每周周五为开放日。
`
assert.equal(extractRiskLevelFromText(stw344), null)
assert.equal(extractLockPeriodFromText(stw344), "不设置")
assert.equal(extractClosedPeriodFromText(stw344), "不设置")
assert.equal(summarizeFeeManageDesc(stw344), "年管理费率1%，每日计提，按自然季度支付。")
const stwFilled = fillMissingElementsFromKeywords(stw344, {
  lock_period_desc: "情况。管理人需要对投资者持有的份额发起全部赎回的，管理人发起的强制赎回份额不受份额锁定期 (如有) 限制。《私募办法》第十三条列明的投资者不适用本项。 2、申购申请及确认 (1) 申购申请...",
  fee_manage: "可以在基金财产中列支的其他费用。二、费用计提方法、计提标准和支付方式 （一）基金管理费 本基金的年管理费率为【1】%，计算方法如下： -- 58 of 97 -- H＝E×年管理费率÷365 " + "x".repeat(200),
  closed_period: null,
  risk_level: "客户洗钱风险等级划分、可疑交易报告",
})
assert.equal(stwFilled.lock_period_desc, "不设置")
assert.equal(stwFilled.closed_period, "不设置")
assert.equal(stwFilled.fee_manage, "年管理费率1%，每日计提，按自然季度支付。")
assert.ok(isWeakRiskLevel(stwFilled.risk_level) || !stwFilled.risk_level)
assert.ok((stwFilled.lock_period_desc ?? "").length <= 80)
assert.ok((stwFilled.fee_manage ?? "").length <= 90)

console.log("fund-contract-element-keywords: ok")

