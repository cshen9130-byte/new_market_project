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
  extractShareClassFeeOverrides,
  extractTemporaryOpenFromText,
  fillMissingElementsFromKeywords,
  isWeakFeePay,
  isWeakFormula,
  isWeakRiskLevel,
  summarizeFeeManageDesc,
  summarizeFeePayDesc,
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
assert.equal(formatTemporaryOpen("0"), "否")
assert.equal(formatTemporaryOpen("0.0"), "否")
assert.equal(formatTemporaryOpen(1), "可临开")
assert.equal(formatTemporaryOpen("1"), "可临开")
assert.equal(formatTemporaryOpen(2), "不可临开")

assert.equal(extractRiskLevelFromText("适合风险承受能力为 C4 (或成长型) 及以上的合格投资者。"), null)
assert.equal(extractRiskLevelFromText("本基金风险等级为R3，适合稳健型投资者。"), "R3（中风险）")
assert.equal(
  extractRiskLevelFromText("本基金属于【R3】级基金产品，适合专业投资者及风险承受能力为【C3 及以上】型的普通合格投资者。"),
  "R3（中风险）",
)
assert.equal(
  extractRiskLevelFromText("（八）风险收益特征 本基金属于【R4】级基金产品，适合专业投资者。"),
  "R4（中高风险）",
)
assert.equal(
  extractRiskLevelFromText("本基金风险收益特征：经管理人评定，本基金风险等级为【R4】级私募投资基金产品，适合专业投资者及风险承受能力为【C4、C5】型的普通合格投资者。"),
  "R4（中高风险）",
)
assert.equal(extractRiskLevelFromText("期货是一种高风险的投资工具，实行保证金交易制度"), null)
assert.ok(extractLockPeriodFromText("本基金锁定期为【12】个月，锁定期内不得赎回。")?.includes("12"))

const snf018 = `
份额锁定期 不设置
基金投资者首次净申购金额应不低于 100 万元人民币。
赎回后持有的基金资产净值不得低于 100 万元人民币。
本基金的管理费率为年费率 1%。每日计提，按自然季度支付。
十一、私募基金的投资
（一）投资目标 本基金在控制风险的前提下，实现基金资产的稳健增长。
（二）投资范围 证券交易所交易的股票（包括但不限于新股申购、优先股）、现金、银行存款、国债、可转换债券、证券交易所及期货交易所交易的衍生品（包括但不限于期货、期权）、公募基金、场外衍生品（包括但不限于收益互换及场外期权）。
4、 基金的业绩报酬
(1)本基金业绩报酬计提基准为年化 6%。
(3)业绩报酬的计算：年化收益率（R）大于业绩报酬计提基准时，差额收益按【40%】比例进行计提。
R=（Tn - T0）/ T1 × 365 / T ×100%；
当 R - B >0 时，E=K×T1×（R - B）×T/365×【40%】；
3）业绩报酬的支付
`

assert.equal(extractRiskLevelFromText(snf018), "R4（中高风险）")
assert.equal(extractLockPeriodFromText(snf018), "不设置")
assert.ok(extractAddAmountFromText(snf018)?.includes("100万元"))
const snfFormula = extractFeePayFormulaFromText(snf018)
assert.ok(snfFormula && snfFormula.includes("40%"), snfFormula)
assert.ok(snfFormula && /E\s*=\s*K|R\s*=/.test(snfFormula), snfFormula)
assert.ok(snfFormula && snfFormula.length <= 220, snfFormula)
assert.equal(summarizeFeeManageDesc(snf018), "年管理费率1%，每日计提，按自然季度支付。")

const sbpv73 = `
基金的业绩报酬
(1)业绩报酬的计提基准日：投资者赎回日、分红权益登记日、基金清算日。本基金连续两次成功计提业绩报酬基准日的间隔不应短于 6 个月。
(2)业绩报酬的计算：对超过上次成功计提基准日基金份额累计净值部分按 35% 比例进行计提。
当 NAVn>NAVh 时，对收益提取 35%的业绩报酬，即 E=（NAVn-NAVh）×S×R。
其中：E 为应计提的业绩报酬；
-- 60 of 102 --
赢仕木盛 1 号私募证券投资基金私募基金合同
R= 35%，为业绩报酬提取比例；
`
const sbpvFormula = extractFeePayFormulaFromText(sbpv73)
assert.ok(sbpvFormula && sbpvFormula.includes("35%"), sbpvFormula)
assert.ok(sbpvFormula && /E\s*=/.test(sbpvFormula) && /NAVn/.test(sbpvFormula), sbpvFormula)
assert.ok(sbpvFormula && sbpvFormula.length <= 220, sbpvFormula)
assert.ok(!sbpvFormula.includes("计提基准日"), sbpvFormula)
assert.ok(!sbpvFormula.includes("of 102"), sbpvFormula)

const pfij = extractFeePayFormulaFromText("②业绩报酬提取的方法 单个基金份额持有人单笔投资基金份额业绩报酬计算公式如下： PFij＝Fij×(NAV1′－HWMij)×20%")
assert.ok(pfij && pfij.includes("PFij") && pfij.includes("20%"), pfij)
assert.ok(pfij && pfij.length <= 220, pfij)
const hwm = extractFeePayFormulaFromText("业绩报酬计算公式如下：A类：H＝F×(NAV1－HWM)×20%；其中H为本计提日该类第i个基金份额持有人第j笔投资的业绩报酬；F为基金份额。")
assert.ok(hwm && /H\s*=/.test(hwm) && hwm.includes("20%"), hwm)
assert.ok(hwm && !hwm.includes("其中H"), hwm)

assert.ok(
  summarizeFeeManageDesc("本基金 A 类份额不计提管理费 本基金 B 类份额按照以下规则计提管理费：基金管理费按前一日 B 类份额基金资产净值 1%的年费率计提。每日计提，按自然季度支付。")
    ?.includes("B类"),
)
assert.ok(
  extractAddAmountFromText("基金投资者首次净申购该类份额的金额不低于 100 万元（不含申购费用），已持有该类份额的基金委托人每次追加净申购该类份额的金额不设限制。")
    ?.includes("100万元"),
)

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
assert.equal(
  extractFeeAdminFromText("3、基金服务机构的服务费 基金服务费按前一日基金资产净值 0.025%的年费率计提。每日计提，按自然季度支付。"),
  "年基金服务费率0.025%，每日计提，按自然季度支付。",
)
assert.equal(
  extractFeeTrustFromText("（5）法律法规规定及基金合同约定的其他权利。 基金托管人按照本基金合同的约定及时、足额获得基金托管费用。"),
  null,
)
assert.equal(
  extractFeeTrustFromText("基金托管人及时获得基金托管费用。托管费按前一日基金资产净值5%的年费率计提。本基金的托管费按前一日基金资产净值0.02%的年费率计提。每日计提。"),
  "年托管费率0.02%，每日计提。",
)
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
assert.equal(
  extractRiskLevelFromText("投资范围 同本基金合同第十一部分“私募基金的投资”约定的投资目标、投资范围。 五、基金的存续期限"),
  null,
)
assert.equal(
  extractRiskLevelFromText("投资范围 详见本基金合同“十一、私募基金的投资”章节。 投资范围 （1）股票(A股)；（5）期货(商品期货、股指期货)；（6）期权。"),
  "R4（中高风险）",
)
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

const sxnManageDump = "当年天数 H 为每日应计提的管理费 E 为前一日的基金资产净值 R 为本基金的年管理费率 本基金的管理费自基金成立日起，每日计提，按季支付。" + "x".repeat(400)
assert.equal(
  summarizeFeeManageDesc(sxnManageDump, sxnManageDump, "1.00%"),
  "年管理费率1%，每日计提，按自然季度支付。",
)
const sxnFilled = fillMissingElementsFromKeywords(sxnManageDump, {
  fee_manage: sxnManageDump,
  fee_manage_rate: "1.00%",
  closed_period: "无",
})
assert.equal(sxnFilled.fee_manage, "年管理费率1%，每日计提，按自然季度支付。")
assert.equal(sxnFilled.closed_period, "不设置")
assert.ok((sxnFilled.fee_manage ?? "").length <= 90)

// ── extractShareClassFeeOverrides ──────────────────────────────────────────
const multiClassContract = `
第五条  基金份额

本基金设置A类和B类两类份额：

A类份额：年管理费率为1%，适用于2026年1月16日（不含）前参与的合格投资者。
B类份额：年管理费率为0%，适用于2026年1月16日（含）后参与的合格投资者。

管理费按前一日基金资产净值每日计提，按自然季度支付。

业绩报酬：
A份额：超额收益的30%，每满6个月计提一次。
B份额：收益率小于20%收取30%，超出部分收取60%。
`

const scOverrides = extractShareClassFeeOverrides(multiClassContract)
assert.ok(scOverrides.A, "should have A override")
assert.ok(scOverrides.B, "should have B override")
assert.equal(scOverrides.A?.fee_manage_rate, "1%")
assert.equal(scOverrides.B?.fee_manage_rate, "0%")
assert.ok(scOverrides.A?.fee_manage?.includes("1%"), scOverrides.A?.fee_manage)
assert.ok(scOverrides.B?.fee_manage?.includes("0%"), scOverrides.B?.fee_manage)
assert.ok((scOverrides.A?.fee_manage ?? "").length <= 90)

// No overrides when all classes have the same rate
const singleRateContract = `
A类份额：年管理费率为1%。
B类份额：年管理费率为1%。
`
const scSingle = extractShareClassFeeOverrides(singleRateContract)
assert.ok(!scSingle.A && !scSingle.B, "same rate should not generate overrides")

// No overrides when contract has only one class
const oneClassContract = `本基金年管理费率为1%，每日计提。`
const scOne = extractShareClassFeeOverrides(oneClassContract)
assert.ok(Object.keys(scOne).length === 0, "single-class contract should not generate overrides")

// 金时信星际风云一号：R>0% is the excess trigger, not 业绩基准0%。A 30% / B 20% / C 不收取。
const azh88 = `
4、业绩报酬
本基金对 C 类基金份额不收取业绩报酬。其他类别基金份额将按照如下约定计提业绩报酬。

（1）业绩报酬计提原则
当条件满足时，以赎回申请日、基金清算日或财产分配权益登记日为业绩报酬计提日，采用实际收益率方法计提。同一基金份额连续两次计提日间隔不得少于 6 个月，赎回、清算或合同另有约定除外。

（2）业绩报酬计提方法
基金份额累计净值。计提期间实际收益率 R 的计算公式为：
R = (A - B) / C × 100%
A 为本次业绩报酬计提日的基金份额累计净值；
B 为上次业绩报酬计提日（若无则为份额参与本基金之日）的基金份额累计净值；
C 为上次业绩报酬计提日（若无则为份额参与本基金之日）的基金份额净值。
计提基准日为赎回申请日、基金清算日或财产分配权益登记日。

A类基金份额：
若 R ≤ 0%，不计提业绩报酬。
若 R > 0%，基金管理人提取超过 0% 部分的 30% 作为业绩报酬。
实际收益率（R） 计提比例 业绩报酬（H）计算方法
R ≤ 0% 0 H = 0
0% < R 30% H = (R - 0%) × 30% × C × F

B类基金份额：
若 R ≤ 0%，不计提业绩报酬。
若 R > 0%，基金管理人提取超过 0% 部分的 20% 作为业绩报酬。
实际收益率（R） 计提比例 业绩报酬（H）计算方法
R ≤ 0% 0 H = 0
0% < R 20% H = (R - 0%) × 20% × C × F

F 为基准日投资者持有份额（清算或分配）或退出份额（赎回）。

（3）业绩报酬的支付
管理人或受托服务机构计算，管理人复核后通知托管人于 5 个工作日内支付。
`

assert.ok(isWeakFeePay("按业绩基准计提，业绩基准0%"))
assert.ok(isWeakFeePay("按超额计提，业绩基准0%；按超额计提，业绩基准6%，计提比例40%。"))
assert.ok(isWeakFormula("基准0%"))
assert.ok(isWeakFormula("基准0%；C类不收取；H=(R-6%)×30%×C×F"))

const azhPay = summarizeFeePayDesc(azh88)
assert.ok(azhPay && azhPay.includes("A类") && azhPay.includes("30%"), azhPay)
assert.ok(azhPay && azhPay.includes("B类") && azhPay.includes("20%"), azhPay)
assert.ok(azhPay && /C类不收取/.test(azhPay), azhPay)
assert.ok(azhPay && !azhPay.includes("业绩基准0%"), azhPay)

const azhFormula = extractFeePayFormulaFromText(azh88)
assert.ok(azhFormula && azhFormula.includes("30%"), azhFormula)
assert.ok(azhFormula && azhFormula.includes("20%"), azhFormula)
assert.ok(azhFormula && /C类不收取/.test(azhFormula), azhFormula)
assert.ok(azhFormula && /R\s*=/.test(azhFormula), azhFormula)
assert.ok(azhFormula && !azhFormula.includes("基准0%"), azhFormula)

const azhFilled = fillMissingElementsFromKeywords(azh88, {
  fee_pay: "按业绩基准计提，业绩基准0%",
  fee_pay_formula: "基准0%",
})
assert.ok(azhFilled.fee_pay?.includes("20%"), azhFilled.fee_pay)
assert.ok(azhFilled.fee_pay?.includes("30%"), azhFilled.fee_pay)
assert.ok(!azhFilled.fee_pay?.includes("业绩基准0%"), azhFilled.fee_pay)
assert.ok(azhFilled.fee_pay_formula?.includes("20%"), azhFilled.fee_pay_formula)
assert.ok(azhFilled.fee_pay_formula?.includes("30%"), azhFilled.fee_pay_formula)

const azhGlued = fillMissingElementsFromKeywords(azh88, {
  fee_pay: "按超额计提，业绩基准0%；按超额计提，业绩基准6%，计提比例40%。",
  fee_pay_formula: "基准0%；C类不收取；H=(R-6%)×30%×C×F",
})
assert.ok(azhGlued.fee_pay?.includes("A类") && azhGlued.fee_pay.includes("B类"), azhGlued.fee_pay)
assert.ok(azhGlued.fee_pay?.includes("C类"), azhGlued.fee_pay)
assert.ok(!azhGlued.fee_pay?.includes("业绩基准6%"), azhGlued.fee_pay)
assert.ok(azhGlued.fee_pay_formula?.includes("A类") && azhGlued.fee_pay_formula.includes("B类"), azhGlued.fee_pay_formula)
assert.ok(!azhGlued.fee_pay_formula?.includes("基准0%"), azhGlued.fee_pay_formula)

const azhSc = extractShareClassFeeOverrides(azh88)
assert.ok(azhSc.A?.fee_pay?.includes("30%"), azhSc.A?.fee_pay)
assert.ok(azhSc.B?.fee_pay?.includes("20%"), azhSc.B?.fee_pay)
assert.ok(azhSc.C?.fee_pay?.includes("不收取"), azhSc.C?.fee_pay)

console.log("fund-contract-element-keywords: ok")
