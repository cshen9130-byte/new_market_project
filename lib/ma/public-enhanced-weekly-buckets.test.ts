import assert from "node:assert/strict"
import test from "node:test"
import { publicEnhancedBucket } from "./public-enhanced-weekly-buckets"

test("public enhanced buckets follow the benchmark, not the share class", () => {
  assert.equal(publicEnhancedBucket({
    benchmark: "沪深300指数",
    name: "易方达沪深300精选增强A",
    trackMethod: "增强指数型",
    typeL2: "指数型-股票",
  }), "300指增")
  assert.equal(publicEnhancedBucket({
    benchmark: "中证A500指数",
    name: "华安中证A500增强策略ETF",
    trackMethod: "增强指数型",
  }), "A500指增")
  assert.equal(publicEnhancedBucket({
    benchmark: "95%×中证500指数",
    name: "富国中证500指数增强A",
    trackMethod: "增强指数型",
  }), "500指增")
  assert.equal(publicEnhancedBucket({
    benchmark: "国证2000指数",
    name: "天弘国证2000指数增强A",
    trackMethod: "增强指数型",
  }), "国证2000指增")
  assert.equal(publicEnhancedBucket({
    benchmark: "上证科创板综合指数",
    name: "易方达上证科创板综合增强策略ETF",
    trackMethod: "增强指数型",
  }), "科创综指指增")
  assert.equal(publicEnhancedBucket({
    benchmark: "上证科创板50成份指数",
    name: "招商上证科创板50成份增强策略ETF",
    trackMethod: "增强指数型",
  }), "科创50指增")
  assert.equal(publicEnhancedBucket({
    benchmark: "创业板综合指数",
    name: "招商创业板综合增强策略ETF",
    trackMethod: "增强指数型",
  }), "创业板综指增")
  assert.equal(publicEnhancedBucket({
    benchmark: "中证小盘500指数",
    name: "鑫元鑫锐量化选股混合发起式C",
    trackMethod: "",
    typeL2: "混合型",
  }), null)
  assert.equal(publicEnhancedBucket({
    benchmark: "标普中国全债指数",
    name: "长盛全债指数增强债券A",
    trackMethod: "增强指数型",
    typeL2: "指数型-固收",
  }), null)
})
