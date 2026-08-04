'use client';

import Link from 'next/link';
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import * as echarts from 'echarts';

// 定义新的数据接口
interface ValuationPosition {
  // 基础标识
  code?: string;              // 原始科目代码，如 '3102I201PS2606'
  symbol: string;           // 合约代码，如 'IC2606', 'AU2604'
  name: string;             // 品种名称，如 '中证500股指期货', '黄金期货'
  exchange: string;         // 交易所：'CFFEX', 'SHFE', 'DCE', 'CZCE', 'INE', 'GFEX'
  direction: 'long' | 'short'; // 多空方向
  asset_class?: string;     // 资产类别，优先使用后端返回的分类
  // 持仓规模
  volume: number;           // 手数
  unit_cost: number;        // 开仓均价
  current_price: number;    // 最新价
  
  // 名义金额（绝对值，用于计算占比）
  notional_value: number;   // 名义市值 = 手数 × 合约乘数 × 最新价
  
  // 盈亏
  unrealized_pnl: number;   // 浮动盈亏（多头: 市值-成本，空头: 成本-市值）
  
  // 风险指标（可选）
  margin_usage?: number;    // 保证金占用
  weight?: number;          // 占净资产比例
  row_kind?: string;         // 后端标准化行类型
  is_leaf?: boolean;         // 是否叶子明细
  include_in_detail?: boolean;   // 是否进入明细展示
  include_in_analysis?: boolean; // 是否进入概览/分析
}

// 定义后端返回的汇总信息接口
interface ValuationSummary {
  fund_name: string;
  valuation_date: string;
  nav: number;              // 基金净资产
  total_asset: number;
  total_liability: number;
}

// 定义分析结果接口
interface AnalysisResult {
  total_value: number;       // 总名义市值
  total_contract_count: number;
  netting_value: number;
  total_margin: number;      // 总保证金
  leverage: number;          // 杠杆倍数
  net_exposure: number;      // 净敞口
  long_short_ratio: number;  // 多空比例
  long_value: number;        // 多头市值
  short_value: number;       // 空头市值
  concentration_ratio: number; // 集中度
  asset_class_distribution: { [key: string]: number }; // 资产类别分布
  category_distribution: { [key: string]: number };    // 大类分布（总）
  industry_distribution: { [key: string]: number };   // 细分板块分布（分）
  exchange_distribution: { [key: string]: number };   // 交易所分布
  top_holdings: Array<{
    symbol: string;
    name: string;
    notional_value: number;
    weight: number;
  }>; // 前十大持仓
  
  // ✅ 新增风险指标
  max_single_position: number; // 最大单一品种集中度（%）
  max_industry_concentration: number; // 最大行业集中度（%）
  net_long_exposure: number; // 净多头敞口（%）
  net_short_exposure: number; // 净空头敞口（%）
  option_ratio: number; // 期权占比（%）
  bond_future_ratio: number; // 国债期货占比（%）
  strategy_tags: string[]; // 策略标签
  
  strategy_analysis: {
    core_strategy: string;
    risk_appetite: string;
    market_view: string;
    strategy_details: string[];
    dv01?: number; // 利率敏感度（仅国债期货）
  };
}

// 品种中文名映射表（简洁专业名称）
const PRODUCT_NAME_MAP: Record<string, string> = {
  // 农产 - 谷物
  C: '玉米', CS: '淀粉', WH: '强麦', PM: '普麦', RR: '粳米', RI: '早籼稻', JR: '粳稻', LR: '晚籼稻',
  // 农产 - 油脂油料
  A: '豆一', B: '豆二', M: '豆粕', Y: '豆油', RM: '菜粕', OI: '菜油', RS: '菜籽', PK: '花生', P: '棕榈油',
  // 农产 - 软商品
  SR: '白糖', CF: '棉花', CY: '棉纱',
  // 农产 - 林业
  LG: '原木', SP: '纸浆', OP: '双胶纸',
  // 生鲜
  AP: '苹果', CJ: '红枣', LH: '生猪', JD: '鸡蛋',
  // 贵金属
  AU: '黄金', AG: '白银', PT: '铂金', PD: '钯金',
  // 有色
  CU: '沪铜', BC: '国际铜', AL: '沪铝', AO: '氧化铝', AD: '铝合金', ZN: '沪锌', PB: '沪铅', NI: '沪镍', SN: '沪锡',
  // 新能源
  LC: '碳酸锂', PS: '多晶硅', SI: '工业硅',
  // 黑色 - 原材
  I: '铁矿', SF: '硅铁', SM: '锰硅',
  // 黑色 - 成材
  RB: '螺纹钢', HC: '热卷', SS: '不锈钢', WR: '线材',
  // 黑色 - 煤炭
  JM: '焦煤', J: '焦炭', ZC: '动力煤',
  // 黑色 - 建材
  FG: '玻璃', BB: '胶合板', FB: '纤维板',
  // 能源化工 - 油品
  SC: '原油', FU: '燃料油', LU: '低硫燃油', PG: '液化气', BU: '沥青',
  // 能源化工 - 聚酯
  TA: 'PTA', EG: '乙二醇', PF: '短纤', PR: '瓶片',
  // 能源化工 - 烯烃
  PL: '丙烯', PP: '聚丙烯', L: '塑料',
  // 能源化工 - 芳烃
  BZ: '纯苯', PX: 'PX', EB: '苯乙烯',
  // 能源化工 - 橡胶
  RU: '天然橡胶', BR: '丁苯橡胶', NR: '20号胶',
  // 能源化工 - 盐化工
  SA: '纯碱', SH: '烧碱', V: 'PVC',
  // 能源化工 - 煤化工
  UR: '尿素', MA: '甲醇',
  // 航运
  EC: '航运指数',
  // 金融 - 股指
  IH: '上证50', IF: '沪深300', IC: '中证500', IM: '中证1000',
  // 金融 - 国债
  TS: '2年国债', TF: '5年国债', T: '10年国债', TL: '30年国债',
};

// 期货品种-细分板块映射字典
const FUTURE_INDUSTRY_MAP: Record<string, string> = {
  // 农产品板块
  'C': '农产品', 'CS': '农产品', 'WH': '农产品', 'PM': '农产品', 'RR': '农产品', 'RI': '农产品', 'JR': '农产品', 'LR': '农产品',
  'A': '农产品', 'B': '农产品', 'M': '农产品', 'Y': '农产品', 'RM': '农产品', 'OI': '农产品', 'RS': '农产品', 'PK': '农产品', 'P': '农产品',
  'SR': '农产品', 'CF': '农产品', 'CY': '农产品',
  'SP': '农产品', 'OP': '农产品',
  'AP': '农产品', 'CJ': '农产品', 'LH': '农产品', 'JD': '农产品',
  
  // 有色金属板块
  'CU': '有色金属', 'BC': '有色金属', 'AL': '有色金属', 'AO': '有色金属', 'AD': '有色金属', 'ZN': '有色金属', 'PB': '有色金属', 'NI': '有色金属', 'SN': '有色金属',
  
  // 贵金属板块
  'AU': '贵金属', 'AG': '贵金属', 'PT': '贵金属', 'PD': '贵金属',
  
  // 黑色金属板块
  'I': '黑色金属', 'SF': '黑色金属', 'SM': '黑色金属',
  'RB': '黑色金属', 'HC': '黑色金属', 'SS': '黑色金属', 'WR': '黑色金属',
  'JM': '黑色金属', 'J': '黑色金属', 'ZC': '黑色金属',
  'FG': '黑色金属', 'BB': '黑色金属', 'FB': '黑色金属',
  
  // 能源化工板块
  'SC': '能源化工', 'FU': '能源化工', 'LU': '能源化工', 'PG': '能源化工', 'BU': '能源化工',
  'TA': '能源化工', 'EG': '能源化工', 'PF': '能源化工', 'PR': '能源化工',
  'PP': '能源化工', 'L': '能源化工', 'V': '能源化工',
  'BZ': '能源化工', 'PX': '能源化工', 'EB': '能源化工',
  'RU': '能源化工', 'BR': '能源化工', 'NR': '能源化工',
  'SA': '能源化工', 'SH': '能源化工', 'UR': '能源化工', 'MA': '能源化工',
  
  // 新能源板块
  'LC': '新能源', 'PS': '新能源', 'SI': '新能源',
  
  // 股指期货板块
  'IH': '股指期货', 'IF': '股指期货', 'IC': '股指期货', 'IM': '股指期货',
  
  // 国债期货板块
  'TS': '国债期货', 'TF': '国债期货', 'T': '国债期货', 'TL': '国债期货',
};

// 细分板块 -> 大类映射（总分结构）
const SECTOR_TO_CATEGORY_MAP: Record<string, string> = {
  // 商品期货大类
  '农产品': '商品期货',
  '有色金属': '商品期货',
  '贵金属': '商品期货',
  '黑色金属': '商品期货',
  '能源化工': '商品期货',
  '新能源': '商品期货',
  
  // 金融期货大类
  '股指期货': '金融期货',
  '国债期货': '金融期货',
  
  // 股票大类
  '银行': '股票',
  '房地产': '股票',
  '食品饮料': '股票',
  '医药生物': '股票',
  '电子': '股票',
  '计算机': '股票',
  '非银金融': '股票',
  '电力设备': '股票',
  '家用电器': '股票',
  '汽车': '股票',
  '化工': '股票',
  '钢铁': '股票',
  '机械设备': '股票',
  '上海A股': '股票',
  '深圳A股': '股票',
  
  // 其他大类
  '债券': '债券',
  '货币基金': '现金管理',
  '基金': '基金',
  'ETF': '基金',
};

// 股票行业映射字典（基于股票代码前三位映射到行业）
const STOCK_INDUSTRY_MAP: Record<string, string> = {
  // 银行
  '600000': '银行', '601398': '银行', '601939': '银行', '601988': '银行', '601328': '银行',
  '601166': '银行', '601169': '银行', '601818': '银行', '600036': '银行', '600016': '银行',
  '000001': '银行', '000002': '银行', '002142': '银行', '002807': '银行', '002966': '银行',
  
  // 房地产
  '600048': '房地产', '600383': '房地产', '600004': '房地产', '600266': '房地产', '600606': '房地产',
  '000002': '房地产', '000006': '房地产', '000042': '房地产', '000402': '房地产', '000671': '房地产',
  
  // 食品饮料
  '600519': '食品饮料', '600809': '食品饮料', '600779': '食品饮料', '600690': '食品饮料', '600597': '食品饮料',
  '000858': '食品饮料', '000568': '食品饮料', '000596': '食品饮料', '000799': '食品饮料', '000869': '食品饮料',
  
  // 医药生物
  '600276': '医药生物', '600535': '医药生物', '600196': '医药生物', '600812': '医药生物', '600216': '医药生物',
  '000538': '医药生物', '000661': '医药生物', '002001': '医药生物', '002007': '医药生物', '002020': '医药生物',
  
  // 电子
  '600584': '电子', '600171': '电子', '600588': '电子', '600360': '电子', '600745': '电子',
  '000021': '电子', '000063': '电子', '002036': '电子', '002045': '电子', '002079': '电子',
  
  // 计算机
  '600588': '计算机', '600536': '计算机', '600728': '计算机', '600797': '计算机', '600845': '计算机',
  '000977': '计算机', '000997': '计算机', '002065': '计算机', '002090': '计算机', '002152': '计算机',
  
  // 非银金融
  '600030': '非银金融', '600837': '非银金融', '601318': '非银金融', '601336': '非银金融', '601601': '非银金融',
  '000728': '非银金融', '000783': '非银金融', '002142': '非银金融', '002500': '非银金融', '002673': '非银金融',
  
  // 电力设备
  '600089': '电力设备', '600151': '电力设备', '600580': '电力设备', '600875': '电力设备', '600885': '电力设备',
  '000040': '电力设备', '000533': '电力设备', '000651': '电力设备', '000922': '电力设备', '002080': '电力设备',
  
  // 家用电器
  '600690': '家用电器', '600839': '家用电器', '600983': '家用电器', '603366': '家用电器',
  '000333': '家用电器', '000527': '家用电器', '000651': '家用电器', '000870': '家用电器',
  
  // 汽车
  '600104': '汽车', '600600': '汽车', '600741': '汽车', '601238': '汽车',
  '000550': '汽车', '000559': '汽车', '000572': '汽车', '000625': '汽车',
  
  // 化工
  '600028': '化工', '600309': '化工', '600352': '化工', '600589': '化工', '600618': '化工',
  '000698': '化工', '000703': '化工', '000737': '化工', '000755': '化工', '000822': '化工',
  
  // 钢铁
  '600005': '钢铁', '600019': '钢铁', '600808': '钢铁', '601005': '钢铁',
  '000708': '钢铁', '000717': '钢铁', '000761': '钢铁', '000825': '钢铁',
  
  // 机械设备
  '600031': '机械设备', '600815': '机械设备', '601106': '机械设备', '601666': '机械设备',
  '000528': '机械设备', '000680': '机械设备', '000778': '机械设备', '000816': '机械设备',
  
  // 有色金属
  '600362': '有色金属', '600392': '有色金属', '600456': '有色金属', '600497': '有色金属',
  '000603': '有色金属', '000630': '有色金属', '000751': '有色金属', '000758': '有色金属',
};

// 品种中文名映射（返回简洁专业名称）
const symbolToProductName = (symbol: string, name?: string): string => {
  const code = symbol.toUpperCase().replace(/\d+$/, ''); // 去掉合约月份数字
  
  // 期权处理
  if (name?.includes('期权')) {
    const match = name.match(/(\S+期权)/);
    if (match) {
      // 简化期权名称，如"沪深300股指期权" -> "沪深300期权"
      const optionName = match[1];
      return optionName.replace('股指', '').replace('期货', '');
    }
    return '期权';
  }
  
  // 优先使用映射表
  if (PRODUCT_NAME_MAP[code]) {
    return PRODUCT_NAME_MAP[code];
  }
  
  // 股票代码简化（保留前6位）
  if (/^\d{6,}$/.test(code)) {
    return code.slice(0, 6) + '股';
  }
  
  // ETF简化
  if (name?.includes('ETF')) {
    const etfMatch = name.match(/(.+?)[指数]?ETF/);
    if (etfMatch) {
      return etfMatch[1] + 'ETF';
    }
    return 'ETF';
  }
  
  // 兜底：使用原始名称的前10个字符
  const shortName = name ? name.slice(0, 10) : symbol.slice(0, 10);
  return shortName + (name && name.length > 10 ? '...' : '');
};

// 简短中文名映射：用于图表 X 轴
const getShortChineseName = (symbol: string, name: string): string => {
  const code = symbol.toUpperCase().replace(/\d+$/, ''); // 去掉合约月份
  
  // 股指期货 → 指数简称
  const indexMap: Record<string, string> = {
    IH: '上证50',
    IF: '沪深300',
    IC: '中证500',
    IM: '中证1000',
  };
  if (indexMap[code]) return indexMap[code];

  // 国债期货 → 年限简称
  const bondMap: Record<string, string> = {
    T: '10年国债',
    TF: '5年国债',
    TS: '2年国债',
    TL: '30年国债',
  };
  if (bondMap[code]) return bondMap[code];

  // 商品期货 → 直接使用 PRODUCT_NAME_MAP 中的两三个字
  if (PRODUCT_NAME_MAP[code]) return PRODUCT_NAME_MAP[code];

  // 兜底：用 symbol 或 name 本身
  return name || symbol;
};

export default function ValuationTool() {
  const [file, setFile] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<React.ReactNode | null>(null);
  const [portfolioData, setPortfolioData] = useState<ValuationPosition[]>([]);
  const [holdingDetailData, setHoldingDetailData] = useState<ValuationPosition[]>([]);
  const [summaryData, setSummaryData] = useState<ValuationSummary | null>(null);
  const [allRawData, setAllRawData] = useState<any[]>([]);
  const [holdingSearch, setHoldingSearch] = useState('');
  
  const assetClassChartRef = useRef<HTMLDivElement>(null);
  const sectorChartRef = useRef<HTMLDivElement>(null);
  const exchangeChartRef = useRef<HTMLDivElement>(null);
  const topHoldingsChartRef = useRef<HTMLDivElement>(null);
  const longShortChartRef = useRef<HTMLDivElement>(null);
  
  const charts = useRef<{ [key: string]: echarts.ECharts | null }>({
    assetClass: null,
    sector: null,
    exchange: null,
    topHoldings: null,
    longShort: null
  });

  /** 将数字部分加粗变色，返回JSX */
  const highlightNumbers = (text: string): React.ReactNode => {
    const parts = text.split(/(\d+(?:\.\d+)?%|\d+(?:\.\d+)?[x倍]|[¥￥]?\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g);
    return parts.map((part, i) => {
      if (/^\d+(?:\.\d+)?%$/.test(part) || /^\d+(?:\.\d+)?[x倍]$/.test(part) || /^[¥￥]?\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test(part)) {
        return <span key={i} className="font-semibold text-indigo-700">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  /**
   * 将AI返回的结构化文本解析为JSX
   * 支持格式：小标题行以"xxx："开头，内容行以"- "开头
   */
  const parseAIAnalysis = (text: string) => {
    if (!text) return null;

    const lines = text.split('\n').filter(line => line.trim().length > 0);

    const sections: { title: string; items: string[] }[] = [];
    let currentTitle = '';
    let currentItems: string[] = [];

    lines.forEach(line => {
      const trimmed = line.trim();
      if (/^[^：:-]+[：:]$/.test(trimmed) && !trimmed.startsWith('-')) {
        if (currentTitle || currentItems.length) {
          sections.push({ title: currentTitle, items: [...currentItems] });
          currentItems = [];
        }
        currentTitle = trimmed.slice(0, -1);
      } else if (trimmed.startsWith('-')) {
        currentItems.push(trimmed.replace(/^-\s*/, ''));
      } else if (currentTitle) {
        currentItems.push(trimmed);
      }
    });
    if (currentTitle || currentItems.length) {
      sections.push({ title: currentTitle, items: [...currentItems] });
    }

    return (
      <div className="space-y-4">
        {sections.map((section, idx) => (
          <div key={idx} className="bg-white rounded-lg border border-gray-100 shadow-sm p-4">
            {section.title && (
              <h4 className="text-base font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                {section.title}
              </h4>
            )}
            <ul className="space-y-1.5 pl-4">
              {section.items.map((item, i) => (
                <li key={i} className="text-sm text-gray-700 leading-relaxed">
                  {highlightNumbers(item)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  };

  // 行业映射工具 - 优化版
  const getIndustry = (symbol: string, name: string): string => {
    const code = symbol.replace(/\..+$/, '').toUpperCase();
    const productCode = code.replace(/\d+$/, ''); // 去掉合约月份数字
    const nameUpper = name.toUpperCase();
    
    // ETF细分
    if (nameUpper.includes('ETF')) {
      if (/50ETF|300ETF|500ETF|1000ETF|综指ETF/.test(nameUpper)) return '宽基指数ETF';
      if (/证券|券商/.test(nameUpper)) return '证券行业ETF';
      if (/军工|国防/.test(nameUpper)) return '国防军工ETF';
      if (/科技|半导体|芯片/.test(nameUpper)) return '科技ETF';
      if (/新能源|光伏|锂电/.test(nameUpper)) return '新能源ETF';
      if (/消费|白酒/.test(nameUpper)) return '消费ETF';
      if (/医药|医疗/.test(nameUpper)) return '医药ETF';
      if (/银行/.test(nameUpper)) return '银行ETF';
      if (/地产|房地产/.test(nameUpper)) return '地产ETF';
      if (/红利/.test(nameUpper)) return '红利ETF';
      return '行业/主题ETF';
    }
    
    // 期货品种 - 优先使用期货行业映射字典
    if (FUTURE_INDUSTRY_MAP[productCode]) {
      return FUTURE_INDUSTRY_MAP[productCode];
    }
    
    // 股票 - 先尝试精确匹配股票代码
    if (STOCK_INDUSTRY_MAP[code]) {
      return STOCK_INDUSTRY_MAP[code];
    }
    
    // 股票 - 尝试通过名称关键字匹配行业
    if (/^60[0123]\d{3}$/.test(code) || /^68[89]\d{3}$/.test(code) || 
        /^00[0123]\d{3}$/.test(code) || /^30\d{4}$/.test(code)) {
      
      if (/银行/.test(nameUpper)) return '银行';
      if (/医药|医疗/.test(nameUpper)) return '医药生物';
      if (/芯片|半导体|电子/.test(nameUpper)) return '电子';
      if (/软件|科技/.test(nameUpper)) return '计算机';
      if (/白酒|食品|饮料/.test(nameUpper)) return '食品饮料';
      if (/证券|券商/.test(nameUpper)) return '非银金融';
      if (/保险/.test(nameUpper)) return '非银金融';
      if (/地产|房地产/.test(nameUpper)) return '房地产';
      if (/新能源|光伏|锂电/.test(nameUpper)) return '电力设备';
      if (/机械|制造/.test(nameUpper)) return '机械设备';
      if (/化工/.test(nameUpper)) return '化工';
      if (/有色/.test(nameUpper)) return '有色金属';
      if (/钢铁/.test(nameUpper)) return '钢铁';
      if (/家电/.test(nameUpper)) return '家用电器';
      if (/汽车/.test(nameUpper)) return '汽车';
      
      return /^60/.test(code) ? '上海A股' : '深圳A股';
    }
    
    // 债券
    if (/^\d{6,}$/.test(code) && !/^[A-Z]/.test(code)) {
      return '债券';
    }
    
    // 兜底：对于期货，尝试通过品种代码前缀匹配行业
    const futureFallbackMatch = Object.entries(FUTURE_INDUSTRY_MAP).find(([key]) => 
      productCode.includes(key) || key.includes(productCode)
    );
    if (futureFallbackMatch) {
      return futureFallbackMatch[1];
    }
    
    // 最终兜底返回名称或未分类
    return name || '未分类';
  };

  // 计算投资组合分析数据
  // ✅ 修改4：接收外部传入的保证金值
  const analyzePortfolio = (data: ValuationPosition[], nav: number, externalMargin: number = 0) => {
    let totalValue = 0;
    // 使用外部传入的保证金值，如果没有则累加持仓的 margin_usage
    let totalMargin = externalMargin > 0 ? externalMargin : 0;
    let totalContractCount = 0;
    let longValue = 0;
    let shortValue = 0;
    let nettingLongValue = 0;
    let nettingShortValue = 0;
    const assetClassDistribution: { [key: string]: number } = {};
    const industryDistribution: { [key: string]: number } = {};  // 细分板块分布
    const categoryDistribution: { [key: string]: number } = {};   // 大类分布（总）
    const exchangeDistribution: { [key: string]: number } = {};

    data.forEach(item => {
      // 使用 notional_value 作为名义市值
      const value = item.notional_value || 0;
      totalValue += value;
      // 如果没有外部传入的保证金，则累加持仓的 margin_usage
      if (externalMargin <= 0) {
        totalMargin += item.margin_usage || 0;
      }
      
      if (item.direction === 'long') {
        longValue += value;
      } else if (item.direction === 'short') {
        shortValue += value;
      }

      // ✅ 二、增强资产类别推断（覆盖国债、股指、商品、期权、货币）
      let assetClass = item.asset_class || '';
      if (!assetClass) {
        const sym = (item.symbol || item.code || '').toString().toUpperCase();
        if (/^(IF|IH|IC|IM)\d+$/.test(sym)) {
          assetClass = '股指期货';
        } else if (/^(T|TF|TS|TL)\d+$/.test(sym)) {
          assetClass = '国债期货';
        } else if (sym.includes('CFX')) {
          assetClass = '股指/国债期货';
        } else if (sym.endsWith('SQ') || sym.endsWith('DCE') || sym.endsWith('CZC') || sym.endsWith('GEX') || sym.endsWith('SC')) {
          assetClass = '商品期货';
        } else if ((item.name || '').includes('期权') || (item.code || '').includes('DD') || (item.code || '').includes('DE') || (item.code || '').includes('DF') || (item.code || '').includes('DG')) {
          assetClass = '期权';
        } else if (item.code.startsWith('1105')) {
          assetClass = '货币基金';
        } else {
          assetClass = '其他';
        }
      }

      const contractText = `${item.symbol || ''} ${item.name || ''}`;
      const hasContractCodeForCount = /[A-Za-z]{1,4}\d{2,5}/.test(contractText);
      if (hasContractCodeForCount && assetClass !== '货币基金') {
        totalContractCount += Math.abs(item.volume || 0);
      }

      if (item.direction === 'long') {
        nettingLongValue += value;
      } else if (item.direction === 'short') {
        nettingShortValue += value;
      }

      assetClassDistribution[assetClass] = (assetClassDistribution[assetClass] || 0) + value;

      // 交易所分布
      const exchange = item.exchange || '未知';
      exchangeDistribution[exchange] = (exchangeDistribution[exchange] || 0) + value;
      
      // 行业分布（细分板块）
      const industry = getIndustry(item.symbol || '', item.name || '');
      industryDistribution[industry] = (industryDistribution[industry] || 0) + value;
      
      // 大类分布（总分结构）
      const category = SECTOR_TO_CATEGORY_MAP[industry] || '其他';
      categoryDistribution[category] = (categoryDistribution[category] || 0) + value;
    });

    // 计算杠杆（总名义市值 / 净资产）
    const leverage = nav > 0 ? totalValue / nav : 0;

    const portfolioTotalAssets = totalValue;
    const signedNettingValue = nettingLongValue - nettingShortValue;

    // 净敞口按投资组合总资产口径计算：(多头 - 空头) / (多头 + 空头)
    const netExposure = portfolioTotalAssets > 0 ? signedNettingValue / portfolioTotalAssets * 100 : 0;

    // 计算多空比例
    const longShortRatio = shortValue > 0 ? longValue / shortValue : Infinity;

    // 计算前十大持仓（按品种汇总后排序）
    // 首先过滤掉不包含具体合约代码的汇总行
    const validPositions = data.filter(item => {
      const symbol = item.symbol || '';
      const name = item.name || '';
      // 必须包含合约代码（字母+数字模式，如 IC2512、AL2601）
      const hasContractCode = /[A-Za-z]{2,}\d{2,}/.test(symbol) || /[A-Za-z]{2,}\d{2,}/.test(name);
      // 排除包含"初始合约价值"等汇总关键词的行
      const isSummaryRow = /初始合约价值|汇总|合计|总计|冲销|冲抵|估值增值/.test(name);
      return hasContractCode && !isSummaryRow;
    });
    
    // console.log('过滤汇总行后有效持仓数:', validPositions.length);
    
    // 按品种代码汇总（去掉月份，如 IC2512 -> IC）
    const holdingsByProduct: { [key: string]: { totalValue: number; items: typeof data } } = {};
    
    validPositions.forEach(item => {
      // 提取品种代码（去掉合约月份）
      const rawSymbol = item.symbol || '';
      const productCode = rawSymbol.replace(/\d+$/, '').toUpperCase() || '未知';
      
      if (!holdingsByProduct[productCode]) {
        holdingsByProduct[productCode] = { totalValue: 0, items: [] };
      }
      holdingsByProduct[productCode].totalValue += item.notional_value || 0;
      holdingsByProduct[productCode].items.push(item);
    });
    
    // 转换为数组并按市值排序，取前10
    const topHoldings = Object.entries(holdingsByProduct)
      .map(([productCode, data]) => {
        const weight = nav > 0 ? (data.totalValue / nav) * 100 : 0;
        // 获取品种中文名
        let displayName = productCode;
        if (PRODUCT_NAME_MAP[productCode]) {
          displayName = PRODUCT_NAME_MAP[productCode];
        } else if (data.items.length > 0) {
          displayName = getShortChineseName(data.items[0].symbol, data.items[0].name);
        }
        
        return {
          symbol: productCode,
          name: displayName,
          notional_value: data.totalValue,
          weight,
          items: data.items
        };
      })
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, 10);

    // 计算集中度（前十大持仓占比）
    const concentrationRatio = topHoldings.reduce((sum, item) => sum + item.weight, 0);

    // ✅ 新增风险指标计算
    // 最大单一品种集中度
    const maxSinglePosition = topHoldings.length > 0 ? topHoldings[0].weight : 0;
    
    // 最大行业集中度
    const industryWeights = Object.values(industryDistribution).map(v => nav > 0 ? (v / nav) * 100 : 0);
    const maxIndustryConcentration = industryWeights.length > 0 ? Math.max(...industryWeights) : 0;
    
    // 净多头/空头敞口（占净资产百分比）
    const netLongExposure = nav > 0 ? (longValue / nav) * 100 : 0;
    const netShortExposure = nav > 0 ? (shortValue / nav) * 100 : 0;
    
    // 期权占比
    const optionValue = assetClassDistribution['期权'] || 0;
    const optionRatio = totalValue > 0 ? (optionValue / totalValue) * 100 : 0;
    
    // 国债期货占比
    const bondFutureValue = assetClassDistribution['国债期货'] || 0;
    const bondFutureRatio = totalValue > 0 ? (bondFutureValue / totalValue) * 100 : 0;

    // ✅ 策略分析研究（增强版）
    const analyzeStrategy = () => {
      let coreStrategy = '未知策略';
      let riskAppetite = '中等风险';
      let marketView = '中性';
      const strategyTags: string[] = [];
      
      // 基于杠杆水平判断风险偏好
      if (leverage > 2.5) {
        riskAppetite = '激进';
        strategyTags.push('高杠杆');
      } else if (leverage > 1.5) {
        riskAppetite = '适中';
        strategyTags.push('中等杠杆');
      } else if (leverage < 1) {
        riskAppetite = '保守';
        strategyTags.push('低杠杆');
      } else {
        riskAppetite = '适中';
      }
      
      // 基于净敞口判断市场观点
      if (netExposure > 50) {
        marketView = '强烈看多';
        strategyTags.push('看多');
      } else if (netExposure > 20) {
        marketView = '温和看多';
        strategyTags.push('偏多');
      } else if (netExposure < -50) {
        marketView = '强烈看空';
        strategyTags.push('看空');
      } else if (netExposure < -20) {
        marketView = '温和看空';
        strategyTags.push('偏空');
      } else {
        marketView = '中性';
        strategyTags.push('市场中性');
      }
      
      // ✅ 基于资产类别组合细化策略分类
      const futuresValue = assetClassDistribution['期货'] || 
                          assetClassDistribution['股指期货'] || 
                          assetClassDistribution['国债期货'] || 
                          assetClassDistribution['商品期货'] || 
                          assetClassDistribution['股指/国债期货'] || 0;
      const futuresRatio = totalValue > 0 ? (futuresValue / totalValue) * 100 : 0;
      
      // 判断策略类型
      if (futuresRatio > 80 && Math.abs(longShortRatio - 1) < 0.3) {
        coreStrategy = '统计套利/CTA策略';
        strategyTags.push('套利', 'CTA');
      } else if (optionRatio > 30) {
        coreStrategy = '波动率交易/期权策略';
        strategyTags.push('期权', '波动率');
      } else if (bondFutureRatio > 40 && leverage < 1.5) {
        coreStrategy = '固收+对冲策略';
        strategyTags.push('固收+', '利率');
      } else if (maxIndustryConcentration > 50) {
        coreStrategy = '行业主题策略';
        strategyTags.push('行业集中');
      } else if (leverage > 2 && Math.abs(netExposure) > 50) {
        coreStrategy = '趋势跟随策略';
        strategyTags.push('趋势');
      } else if (leverage > 1.5 && Math.abs(netExposure) < 20) {
        coreStrategy = '市场中性套利';
        strategyTags.push('中性', '套利');
      } else if (leverage < 1.2 && Math.abs(netExposure) > 30) {
        coreStrategy = '方向性策略';
        strategyTags.push('方向性');
      } else if (leverage < 1 && Math.abs(netExposure) < 10) {
        coreStrategy = '稳健配置策略';
        strategyTags.push('稳健');
      }
      
      // ✅ 策略详情（逻辑式描述）
      const strategyDetails: string[] = [];
      const descriptions: string[] = [];
      
      if (futuresRatio > 80) {
        descriptions.push('以期货投资为主');
      }
      if (optionRatio > 30) {
        descriptions.push('期权占比较高');
      }
      if (bondFutureRatio > 40) {
        descriptions.push('重仓国债期货');
      }
      
      // 多头分布描述
      const longPositions = data.filter(item => item.direction === 'long');
      const longClasses: { [key: string]: number } = {};
      longPositions.forEach(item => {
        const ac = item.asset_class || getIndustry(item.symbol || '', item.name || '');
        longClasses[ac] = (longClasses[ac] || 0) + (item.notional_value || 0);
      });
      const topLongClass = Object.entries(longClasses).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (topLongClass && longValue > 0) {
        descriptions.push(`多头集中在${topLongClass}`);
      }
      
      // 空头分布描述
      const shortPositions = data.filter(item => item.direction === 'short');
      const shortClasses: { [key: string]: number } = {};
      shortPositions.forEach(item => {
        const ac = item.asset_class || getIndustry(item.symbol || '', item.name || '');
        shortClasses[ac] = (shortClasses[ac] || 0) + (item.notional_value || 0);
      });
      const topShortClass = Object.entries(shortClasses).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (topShortClass && shortValue > 0) {
        descriptions.push(`空头集中在${topShortClass}`);
      }
      
      // 集中度描述
      if (maxSinglePosition > 20) {
        descriptions.push(`前三大品种占比${concentrationRatio.toFixed(1)}%`);
      }
      
      // 组合策略描述
      if (descriptions.length > 0) {
        strategyDetails.push(`基金当前采用${coreStrategy}，杠杆${leverage.toFixed(1)}x，净敞口${netExposure.toFixed(1)}%。${descriptions.join('，')}。`);
      } else {
        strategyDetails.push(`基金当前采用${coreStrategy}，杠杆${leverage.toFixed(1)}x，净敞口${netExposure.toFixed(1)}%。`);
      }
      
      // 风险提示
      if (leverage > 2.5) {
        strategyDetails.push(`⚠️ 高杠杆操作，市场波动可能带来较大净值波动`);
      }
      if (maxSinglePosition > 30) {
        strategyDetails.push(`⚠️ 单一品种集中度较高(${maxSinglePosition.toFixed(1)}%)，需关注该品种风险`);
      }
      if (optionRatio > 50) {
        strategyDetails.push(`⚠️ 期权持仓占比较高，需关注波动率变化风险`);
      }
      
      // ✅ 计算 DV01（国债期货利率敏感度）
      let dv01: number | undefined;
      if (bondFutureValue > 0) {
        const bondFuturesCount = data.filter(item => 
          item.asset_class === '国债期货' || /^(T|TF|TS|TL)\d+$/.test((item.symbol || '').toUpperCase())
        ).length;
        dv01 = bondFuturesCount * 50;
      }
      
      return {
        core_strategy: coreStrategy,
        risk_appetite: riskAppetite,
        market_view: marketView,
        strategy_details: strategyDetails,
        dv01,
        strategy_tags: strategyTags
      };
    };
    
    const strategyAnalysis = analyzeStrategy();

    return {
      total_value: totalValue,
      netting_value: Math.abs(signedNettingValue),
      total_margin: totalMargin,
      total_contract_count: totalContractCount,
      leverage,
      net_exposure: netExposure,
      long_short_ratio: longShortRatio,
      long_value: longValue,
      short_value: shortValue,
      concentration_ratio: concentrationRatio,
      
      // ✅ 新增风险指标
      max_single_position: maxSinglePosition,
      max_industry_concentration: maxIndustryConcentration,
      net_long_exposure: netLongExposure,
      net_short_exposure: netShortExposure,
      option_ratio: optionRatio,
      bond_future_ratio: bondFutureRatio,
      strategy_tags: strategyAnalysis.strategy_tags,
      asset_class_distribution: assetClassDistribution,
      category_distribution: categoryDistribution,      // 大类分布（总）
      industry_distribution: industryDistribution,      // 细分板块分布（分）
      exchange_distribution: exchangeDistribution,
      top_holdings: topHoldings,
      strategy_analysis: strategyAnalysis
    };
  };

  // 初始化图表
  const initCharts = (analysis: AnalysisResult) => {
    // console.log('开始初始化图表:', analysis);
    
    // 资产类别分布 —— 改为柱状图
    if (assetClassChartRef.current) {
      try {
        if (charts.current.assetClass) charts.current.assetClass.dispose();
        charts.current.assetClass = echarts.init(assetClassChartRef.current);
        const assetClassData = Object.entries(analysis.asset_class_distribution || {})
          .map(([name, value]) => ({ name, value }))
          .filter(item => item.value > 0)
          .sort((a, b) => b.value - a.value);

        const option = {
          title: { text: '资产类别分布', left: 'center' },
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
          xAxis: {
            type: 'category',
            data: assetClassData.map(item => item.name),
            axisLabel: { rotate: 15 }
          },
          yAxis: { type: 'value', name: '名义市值 (元)' },
          series: [{
            type: 'bar',
            data: assetClassData.map(item => item.value),
            itemStyle: { color: '#3b82f6' }
          }]
        };
        charts.current.assetClass.setOption(option);
      } catch (error) {
        console.error('资产类别分布图表失败:', error);
      }
    }

    // 行业板块分布柱状图（总分结构）
    if (sectorChartRef.current) {
      // console.log('初始化行业板块分布图表');
      try {
        if (charts.current.sector) {
          charts.current.sector.dispose();
        }
        charts.current.sector = echarts.init(sectorChartRef.current);
        
        // 行业板块分布（只显示行业类别字典中的板块，过滤合约和多空头）
        const industryData = Object.entries(analysis.industry_distribution || {})
          .map(([name, value]) => ({
            name,
            value,
            category: SECTOR_TO_CATEGORY_MAP[name] || '其他'
          }))
          .filter(item => {
            // 1. 过滤掉具体合约（包含合约代码如 AL2601、IC2512 的条目）
            if (/[A-Za-z]{1,4}\d{2,4}/.test(item.name)) return false;
            
            // 2. 过滤掉包含多空头字样的条目
            if (/多头|空头|long|short/i.test(item.name)) return false;
            
            // 3. 只保留行业类别字典中定义的板块
            return SECTOR_TO_CATEGORY_MAP[item.name] !== undefined;
          })
          .filter(item => item.value > 0)
          .sort((a, b) => b.value - a.value);

        // 颜色映射（按大类分组）
        const categoryColors: Record<string, string> = {
          '商品期货': '#3b82f6',
          '金融期货': '#8b5cf6',
          '股票': '#10b981',
          '债券': '#f59e0b',
          '基金': '#ec4899',
          '现金管理': '#06b6d4',
          '其他': '#6b7280'
        };
        
        const industryOption = {
          title: {
            text: '行业板块分布',
            left: 'center',
            textStyle: {
              fontSize: 16,
              fontWeight: 600
            }
          },
          tooltip: {
            trigger: 'axis',
            axisPointer: {
              type: 'shadow'
            },
            formatter: (params: any) => {
              const item = params[0];
              const industry = industryData.find(d => d.name === item.name);
              const category = industry?.category || '其他';
              return `<div style="font-weight: 600;">${item.name}</div>
                      <div style="color: #6b7280;">大类: ${category}</div>
                      <div style="color: #3b82f6; font-weight: 600;">市值: ${(item.value / 10000).toFixed(2)} 万</div>`;
            }
          },
          grid: {
            left: '3%',
            right: '4%',
            bottom: '15%',
            top: '15%',
            containLabel: true
          },
          xAxis: {
            type: 'category',
            data: industryData.map(item => item.name),
            axisLabel: {
              rotate: 20,
              fontSize: 11,
              interval: 0
            }
          },
          yAxis: {
            type: 'value',
            name: '名义市值',
            axisLabel: {
              formatter: (value: number) => value >= 10000 ? `${(value / 10000).toFixed(0)}万` : value
            }
          },
          series: [{
            data: industryData.map(item => ({
              value: item.value,
              itemStyle: {
                color: categoryColors[item.category] || '#6b7280',
                borderRadius: [4, 4, 0, 0]
              }
            })),
            type: 'bar',
            barWidth: '50%',
            label: {
              show: true,
              position: 'top',
              formatter: (params: any) => {
                const val = params.value;
                return val >= 10000 ? `${(val / 10000).toFixed(1)}万` : val.toFixed(0);
              },
              fontSize: 10,
              color: '#6b7280'
            }
          }],
          // 添加图例说明大类颜色
          legend: {
            data: Object.keys(categoryColors),
            bottom: 0,
            itemWidth: 12,
            itemHeight: 12,
            textStyle: {
              fontSize: 10
            }
          }
        };
        charts.current.sector.setOption(industryOption);
        // console.log('板块分布图表初始化完成');
      } catch (error) {
        console.error('板块分布图表初始化失败:', error);
      }
    }

    // 交易所合约分布饼图
    if (exchangeChartRef.current) {
      // console.log('初始化交易所合约分布图表');
      try {
        if (charts.current.exchange) {
          charts.current.exchange.dispose();
        }
        charts.current.exchange = echarts.init(exchangeChartRef.current);
        
        // 使用交易所分布数据
        const exchangeData = Object.entries(analysis.exchange_distribution || {})
          .map(([name, value]) => ({ name, value }))
          .filter(item => item.value > 0)
          .sort((a, b) => b.value - a.value);

        // 交易所代码到中文名称的映射
        const exchangeNameMap: Record<string, string> = {
          'SHFE': '上海期货交易所',
          'DCE': '大连商品交易所',
          'CZCE': '郑州商品交易所',
          'CFFEX': '中国金融期货交易所',
          'INE': '上海国际能源交易中心',
          'GFEX': '广州期货交易所',
          '未知': '未知交易所'
        };
        
        // 交易所颜色映射（使用中文名称）
        const exchangeColors: Record<string, string> = {
          '上海期货交易所': '#e53935',     // 上期所 - 红色
          '大连商品交易所': '#1e88e5',      // 大商所 - 蓝色
          '郑州商品交易所': '#43a047',     // 郑商所 - 绿色
          '中国金融期货交易所': '#fb8c00',    // 中金所 - 橙色
          '上海国际能源交易中心': '#8e24aa',      // 上能源 - 紫色
          '广州期货交易所': '#00acc1',     // 广期所 - 青色
          '未知交易所': '#757575'      // 未知 - 灰色
        };
        
        // 转换为中文名称
        const exchangeDataWithCN = exchangeData.map(item => ({
          name: exchangeNameMap[item.name] || item.name,
          value: item.value
        }));
        
        const exchangeOption = {
          title: {
            text: '交易所合约分布',
            left: 'center',
            textStyle: {
              fontSize: 16,
              fontWeight: 600
            }
          },
          tooltip: {
            trigger: 'item',
            formatter: (params: any) => {
              const value = params.value;
              const percent = params.percent;
              return `<div style="font-weight: 600;">${params.name}</div>
                      <div style="color: #3b82f6; font-weight: 600;">市值: ${(value / 10000).toFixed(2)} 万</div>
                      <div style="color: #6b7280;">占比: ${percent.toFixed(1)}%</div>`;
            }
          },
          legend: {
            orient: 'horizontal',
            bottom: 0,
            itemWidth: 12,
            itemHeight: 12,
            textStyle: {
              fontSize: 11
            }
          },
          series: [{
            name: '交易所分布',
            type: 'pie',
            radius: ['40%', '70%'],
            center: ['50%', '45%'],
            avoidLabelOverlap: true,
            itemStyle: {
              borderRadius: 8,
              borderColor: '#fff',
              borderWidth: 2
            },
            label: {
              show: true,
              formatter: (params: any) => {
                return `${params.name}\n${params.percent.toFixed(1)}%`;
              },
              fontSize: 10
            },
            emphasis: {
              label: {
                show: true,
                fontSize: 14,
                fontWeight: 'bold'
              },
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.5)'
              }
            },
            labelLine: {
              show: true,
              length: 12,
              length2: 8
            },
            data: exchangeDataWithCN.map(item => ({
              value: item.value,
              name: item.name,
              itemStyle: {
                color: exchangeColors[item.name] || '#757575'
              }
            }))
          }]
        };
        charts.current.exchange.setOption(exchangeOption);
        // console.log('交易所分布图表初始化完成');
      } catch (error) {
        console.error('交易所分布图表初始化失败:', error);
      }
    }

    // 前十大持仓柱状图（优化版）
    if (topHoldingsChartRef.current) {
      // console.log('初始化前十大持仓图表');
      try {
        if (charts.current.topHoldings) {
          charts.current.topHoldings.dispose();
        }
        charts.current.topHoldings = echarts.init(topHoldingsChartRef.current);
        
        const topHoldings = analysis.top_holdings || [];
        // console.log('原始topHoldings数据:', topHoldings.slice(0, 3));
        
        // 直接使用后端已经汇总好的数据，按权重排序取前10
        const mergedArray = topHoldings
          .map(item => ({
            name: item.name,
            weight: item.weight,
            items: item.items || []
          }))
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 10);
        
        // console.log('前十大持仓数据:', mergedArray);
        
        // 生成渐变色数组
        const gradientColors = [
          { main: '#3b82f6', light: '#60a5fa' },
          { main: '#8b5cf6', light: '#a78bfa' },
          { main: '#10b981', light: '#34d399' },
          { main: '#f59e0b', light: '#fbbf24' },
          { main: '#ec4899', light: '#f472b6' },
          { main: '#06b6d4', light: '#22d3ee' },
          { main: '#6366f1', light: '#818cf8' },
          { main: '#f97316', light: '#fb923c' },
          { main: '#14b8a6', light: '#2dd4bf' },
          { main: '#a855f7', light: '#c084fc' },
        ];
        
        const topHoldingsOption = {
          title: {
            text: '前十大持仓',
            left: 'center',
            textStyle: {
              fontSize: 16,
              fontWeight: 600,
              color: '#1f2937'
            }
          },
          tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderColor: '#e5e7eb',
            borderWidth: 1,
            padding: [12, 16],
            textStyle: {
              color: '#374151',
              fontSize: 13
            },
            formatter: (params: any) => {
              const name = params[0].name;
              const weight = params[0].value;
              const item = mergedArray.find(g => g.name === name);
              let detail = '';
              if (item && item.items.length > 0) {
                detail = '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">';
                detail += '<div style="font-weight: 500; color: #6b7280; font-size: 12px; margin-bottom: 4px;">持仓明细</div>';
                item.items.slice(0, 3).forEach((it: any) => {
                  detail += `<div style="font-size: 12px; color: #4b5563; margin: 2px 0;">• ${it.symbol}: ${it.weight.toFixed(2)}%</div>`;
                });
                if (item.items.length > 3) {
                  detail += `<div style="font-size: 12px; color: #9ca3af; margin-top: 2px;">• 等${item.items.length}个合约</div>`;
                }
                detail += '</div>';
              }
              return `<div style="font-weight: 600; font-size: 14px;">${name}</div>
                      <div style="color: #6b7280; margin-top: 4px;">占净资产: <span style="font-weight: 600; color: #3b82f6;">${weight.toFixed(2)}%</span></div>${detail}`;
            }
          },
          grid: {
            left: '3%',
            right: '8%',
            bottom: '18%',
            top: '15%',
            containLabel: true
          },
          xAxis: {
            type: 'category',
            data: mergedArray.map(item => item.name),
            axisLabel: {
              rotate: 35,
              fontSize: 11,
              color: '#6b7280',
              margin: 12
            },
            axisLine: {
              lineStyle: {
                color: '#e5e7eb'
              }
            },
            axisTick: {
              show: false
            }
          },
          yAxis: {
            type: 'value',
            name: '占净资产 (%)',
            nameTextStyle: {
              color: '#9ca3af',
              fontSize: 11,
              padding: [0, 0, 10, 0]
            },
            axisLabel: {
              color: '#9ca3af',
              fontSize: 11,
              formatter: (value: number) => `${value}%`
            },
            splitLine: {
              lineStyle: {
                color: '#f3f4f6',
                type: 'dashed'
              }
            },
            axisLine: {
              show: false
            },
            axisTick: {
              show: false
            }
          },
          series: [{
            name: '持仓占比',
            type: 'bar',
            data: mergedArray.map((item, index) => ({
              value: item.weight,
              itemStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: gradientColors[index % gradientColors.length].main },
                    { offset: 1, color: gradientColors[index % gradientColors.length].light }
                  ]
                },
                borderRadius: [6, 6, 0, 0],
                shadowColor: 'rgba(59, 130, 246, 0.1)',
                shadowBlur: 8,
                shadowOffsetY: 2
              }
            })),
            barWidth: '55%',
            emphasis: {
              itemStyle: {
                shadowBlur: 12,
                shadowOffsetX: 0,
                shadowColor: 'rgba(59, 130, 246, 0.25)'
              }
            },
            label: {
              show: true,
              position: 'top',
              formatter: (params: any) => `${params.value.toFixed(1)}%`,
              fontSize: 11,
              fontWeight: 500,
              color: '#374151',
              distance: 6
            },
            animationDuration: 1200,
            animationEasing: 'elasticOut'
          }]
        };
        charts.current.topHoldings.setOption(topHoldingsOption);
        // console.log('前十大持仓图表初始化完成');
      } catch (error) {
        console.error('前十大持仓图表初始化失败:', error);
      }
    }

    // 多空分布饼图
    if (longShortChartRef.current) {
      // console.log('初始化多空分布图表');
      try {
        if (charts.current.longShort) {
          charts.current.longShort.dispose();
        }
        charts.current.longShort = echarts.init(longShortChartRef.current);
        
        // 使用analysis中的long_value和short_value字段
        const longValue = analysis.long_value || 0;
        const shortValue = analysis.short_value || 0;
        
        // console.log('多空分布数据:', { longValue, shortValue });
        
        const longShortOption = {
          title: {
            text: '多空分布',
            left: 'center'
          },
          tooltip: {
            trigger: 'item',
            formatter: '{b}: {c} ({d}%)'
          },
          legend: {
            orient: 'vertical',
            left: 'left'
          },
          series: [{
            name: '多空分布',
            type: 'pie',
            radius: '60%',
            data: [
              { name: '多头', value: longValue },
              { name: '空头', value: shortValue }
            ],
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.5)'
              }
            }
          }]
        };
        charts.current.longShort.setOption(longShortOption);
        // console.log('多空分布图表初始化完成');
      } catch (error) {
        console.error('多空分布图表初始化失败:', error);
      }
    }
    
    // console.log('图表初始化完成');
  };

  // 响应式调整
  useEffect(() => {
    const handleResize = () => {
      Object.values(charts.current).forEach(chart => {
        chart?.resize();
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      Object.values(charts.current).forEach(chart => {
        chart?.dispose();
      });
    };
  }, []);

  // ✅ 五、图表初始化防抖与窗口 resize
  useEffect(() => {
    if (!analysisResult) return;

    const timer = setTimeout(() => {
      // 如果可能，确保图表容器有宽度
      if (assetClassChartRef.current?.clientWidth) {
        initCharts(analysisResult);
      } else {
        // 若容器仍不可见，再延时重试
        const retry = setTimeout(() => initCharts(analysisResult), 200);
        return () => clearTimeout(retry);
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [analysisResult]);


  // 处理文件上传
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  // 处理文件拖拽
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  // 分析文件
  const analyzeFile = async () => {
    if (!file) return;

    setIsLoading(true);
    
    try {
      // 构建FormData并上传文件
      const formData = new FormData();
      formData.append('file', file);
      
      // 调用后端API
      const response = await fetch('/ma/api/tools/valuation/analyze', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('API调用失败');
      }
      
      const data = await response.json();
      
      setAllRawData(data.portfolio_data || []);
      
      // 分析上传的数据
      // console.log('=== 后端返回数据概览 ===');
      // console.log('portfolio_data长度:', data.portfolio_data?.length);
      // console.log('summary数据:', data.summary);
      
      // 映射数据到新的接口
      const rawPortfolioData = data.portfolio_data || [];

      // 详细调试：打印前5条数据的完整结构
      // console.log('\n=== 原始数据前5条完整结构 ===');
      rawPortfolioData.slice(0, 5).forEach((item, index) => {
        // console.log(`\n第${index+1}条:`);
        // console.log('所有键名:', Object.keys(item));
        // console.log('完整对象:', item);
      });
      
      // 调试：查找所有可能包含数值的字段
      if (rawPortfolioData.length > 0) {
        // console.log('\n=== 数值字段分析 ===');
        const firstItem = rawPortfolioData[0];
        const numericFields: string[] = [];
        const stringFields: string[] = [];
        
        for (const key of Object.keys(firstItem)) {
          const val = firstItem[key];
          if (!isNaN(Number(val)) && isFinite(Number(val))) {
            numericFields.push(key);
          } else {
            stringFields.push(key);
          }
        }
        
        // console.log('数值类型字段:', numericFields);
        // console.log('字符串类型字段:', stringFields);
        
        // 检查市值相关字段
        // console.log('\n=== 市值字段检查 ===');
        const mvFields = ['market_value', 'notional_value', 'mv', 'marketValue', 'notionalValue', 'value', 'amount', 'cost', 'market_price', 'position'];
        mvFields.forEach(field => {
          const sampleValue = rawPortfolioData[0]?.[field];
          // console.log(`${field}: ${sampleValue} (类型: ${typeof sampleValue})`);
        });
      }

      // 查找衍生品数据（3102开头）
      const derivativeItems = rawPortfolioData.filter((item: any) => 
        String(item.code).startsWith('3102')
      );
      // console.log(`\n=== 衍生品数据（3102开头）共${derivativeItems.length}条 ===`);
      if (derivativeItems.length > 0) {
        // console.log('第一条衍生品:', derivativeItems[0]);
        // console.log('衍生品键名:', Object.keys(derivativeItems[0]));
      }
      
      // 查看所有包含字母+数字的代码（可能是合约代码）
      const itemsWithContract = rawPortfolioData.filter(item => {
        const code = String(item.code || '');
        return /[A-Za-z]{2,}\d{2,}/.test(code);
      });
      // console.log(`\n=== 包含合约代码的行共${itemsWithContract.length}条 ===`);
      itemsWithContract.forEach(item => {
        // console.log(`${item.code} | ${item.name} | 市值: ${item.market_value || item.notional_value}`);
      });

      // 查找货币基金（1105开头）
      const moneyFundItems = rawPortfolioData.filter((item: any) => 
        String(item.code).startsWith('1105')
      );
      // console.log(`\n=== 货币基金数据（1105开头）共${moneyFundItems.length}条 ===`);
      if (moneyFundItems.length > 0) {
        // console.log('第一条货币基金:', moneyFundItems[0]);
      }
      
      // ✅ 统一字段候选数组 - 必须在使用前定义（扩展包含中文和拼音字段名）
      const FIELD_CANDIDATES = {
        volume: ['position', 'volume', 'quantity', 'current_amount', 'amount', 'qty', 'hold_quantity', 'size', 
                 'hold_volume', 'current_qty', 'pos', 'quantity_long', 'quantity_short', 'volume_long', 'volume_short',
                 'position_qty', 'hold_qty', 'contracts', 'number', 'vol', 'position_amount', 'holding',
                 'contract_qty', 'open_interest', 'open_positions', 'trade_qty', 'position_size',
                 'shares', 'units', 'amount_held', 'holdings',
                 // 中文字段（重点添加表格中常见的字段名）
                 '数量', '持仓数量', '持仓量', '手数', '合约数', '持有数量', '数量/手', '持仓手数', '持有手数',
                 'position_qty', 'holding_qty', 'open_qty', 'trade_qty', 'order_qty'],
        marketValue: ['notional_value', 'market_value', 'mv', 'value', 'amount', 'marketValue', 'notionalValue',
                      'marketval', 'notional', 'total_value', 'position_value', 'nominal_value',
                      'market_value_amount', 'position_market_value', 'holding_value',
                      'current_market_value', 'fair_value', 'marked_to_market', 'asset_value',
                      // 中文字段
                      '市值', '名义市值', '市场价值', '持仓市值', '公允价值', '持仓价值', '名义金额', '估值'],
        unitCost: ['unit_cost', 'avg_cost', 'cost_price', 'unit_price', 'avg_price', 
                   'cost', 'cost_basis', 'open_price', 'entry_price', 'average_cost',
                   'opening_price', 'avg_open_price', 'cost_per_unit', 'purchase_price',
                   'basis_cost', 'acquisition_cost', 'cost_average', 'entry_cost',
                   // 中文字段（重点添加表格中常见的字段名）
                   '成本', '单位成本', '开仓均价', '平均成本', '持仓成本', '买入均价', '成交均价', 
                   '持仓均价', '持仓成本价', '开仓成本', '持仓单价'],
        price: ['price', 'current_price', 'market_price', 'settle', 'last_price', 
                'mark_price', 'fair_price', 'close_price', 'settlement_price',
                'current_price_market', 'market_rate', 'last_traded_price', 'spot_price',
                'settlement_price_current', 'mark_to_market_price', 'current_market_price',
                // 中文字段（重点添加表格中常见的字段名）
                '价格', '最新价', '市价', '收盘价', '结算价', '当前价', '现价', 
                '最新成交价', '持仓价', '估值价'],
        pnl: ['unrealized_pnl', 'net_value_change', 'valuation_change', 'pnl', 
              'profit_loss', 'unrealized_profit', 'float_pnl', 'gain_loss',
              'valuation_gain_loss', 'unrealized_gain', 'unrealized_loss',
              // 中文字段
              '盈亏', '浮动盈亏', '估值增值', '未实现盈亏', '持仓盈亏'],
        margin: ['margin_usage', 'margin', 'margin_amount', 'margin_balance', 
                 'margin_occupied', 'used_margin', 'initial_margin', 'maintenance_margin',
                 'margin_deposit', 'margin_bond', 'margin_cash', 'required_margin',
                 // 中文字段
                 '保证金', '保证金占用', '保证金余额', '初始保证金', '维持保证金'],
      };

      // ✅ 智能字段提取函数 - 支持精确匹配、大小写不敏感匹配、以及反推
      const getFieldValue = (item: any, fieldType: keyof typeof FIELD_CANDIDATES): number => {
        const candidates = FIELD_CANDIDATES[fieldType];
        const itemKeys = Object.keys(item);
        
        // 1. 精确匹配
        for (const key of candidates) {
          if (item[key] !== undefined && item[key] !== null) {
            const val = Number(item[key]);
            if (!isNaN(val) && isFinite(val)) return val;
          }
        }
        
        // 2. 忽略大小写匹配
        for (const candidate of candidates) {
          const matchedKey = itemKeys.find(key => key.toLowerCase() === candidate.toLowerCase());
          if (matchedKey !== undefined) {
            const val = Number(item[matchedKey]);
            if (!isNaN(val) && isFinite(val)) return val;
          }
        }
        
        // 3. 模糊匹配（包含匹配）
        for (const candidate of candidates) {
          const matchedKey = itemKeys.find(key => 
            key.toLowerCase().includes(candidate.toLowerCase()) || 
            candidate.toLowerCase().includes(key.toLowerCase())
          );
          if (matchedKey !== undefined) {
            const val = Number(item[matchedKey]);
            if (!isNaN(val) && isFinite(val)) return val;
          }
        }
        
        // 4. 针对 unitCost 和 price：尝试用市值/数量反推
        if (fieldType === 'unitCost' || fieldType === 'price') {
          const mv = getFieldValue(item, 'marketValue');
          const vol = getFieldValue(item, 'volume');
          if (vol > 0 && mv !== 0) {
            return Math.abs(mv / vol);
          }
        }
        
        return 0;
      };
      
      // ✅ 三、提取真实净资产（NAV）和保证金（Margin）
      // 提取净资产——扩展匹配模式，支持多种净值行名称
      let nav = 0;
      
      // 扩展净值行匹配模式
      const navRow = rawPortfolioData.find(item => {
        const n = (item.name || '').replace(/\s/g, '');
        return /^(基金)?资产净值$|^净资产$|^基金净值$|^资产总值$/.test(n);
      });
      
      if (navRow) {
        // 使用统一字段提取函数获取净值，支持更多字段名
        nav = getFieldValue(navRow, 'marketValue') || Number(navRow.cost || navRow.market_value || navRow.value || 0);
        // console.log(`从汇总行提取净资产: ${nav}`);
        // console.log(`净值行详细信息: name=${navRow.name}, 可用字段:`, Object.keys(navRow).filter(k => ['market_value', 'notional_value', 'cost', 'value', 'amount'].includes(k)));
      }
      
      // 兜底：如果没有明确的净值行，再用最后总结行
      if (!nav) {
        const lastRows = rawPortfolioData.slice(-15);
        for (const row of lastRows) {
          const n = (row.name || '').replace(/\s/g, '');
          if (/资产净值|净资产|基金净值|资产总值/.test(n)) {
            nav = getFieldValue(row, 'marketValue') || Number(row.cost || row.market_value || 0);
            // console.log(`从末尾行提取净资产: name=${row.name}, value=${nav}`);
            break;
          }
        }
      }
      
      // 如果还是0，使用data.summary.nav
      if (!nav && data.summary?.nav) {
        nav = data.summary.nav;
        // console.log(`使用summary.nav: ${nav}`);
      }
      
      // 兜底：使用总资产-总负债
      if (!nav && data.summary?.total_asset && data.summary?.total_liability) {
        nav = data.summary.total_asset - data.summary.total_liability;
        // console.log(`使用总资产-总负债计算净资产: ${data.summary.total_asset} - ${data.summary.total_liability} = ${nav}`);
      }
      
      // 兜底：使用持仓总名义市值
      if (!nav) {
        const totalNotional = rawPortfolioData.reduce((sum: number, item: any) => {
          return sum + Math.abs(getFieldValue(item, 'marketValue'));
        }, 0);
        
        if (totalNotional > 0) {
          nav = totalNotional;
          console.warn(`⚠️ 未获取到净资产，使用持仓总名义市值近似: ${nav}`);
        }
      }
      
      // console.log(`最终净资产值: ${nav}`);
      
      const getMarginAmount = (item: any): number => {
        const marginVal = getFieldValue(item, 'margin');
        const costVal = Number(item.cost) || 0;
        const marketVal = getFieldValue(item, 'marketValue');
        const amountVal = Number(item.amount) || 0;
        const val = [marginVal, costVal, marketVal, amountVal].find(v => v > 0 && v < 1e12) || 0;
        return Math.abs(val);
      };

      const normalizeMarginCode = (value: unknown): string => {
        return (value || '').toString().trim().replace(/\s+/g, '').replace(/\./g, '');
      };

      const isMarginRow = (item: any): boolean => {
        const code = normalizeMarginCode(item.code);
        const name = (item.name || '').toString();
        const nameMatch = /存出保证金|期货保证金|期权保证金|保证金占用|保证金余额|交易保证金|初始保证金|维持保证金/i.test(name);
        const excludeMatch = /应计利息|应计|合计|小计|总计|估值增值|冲抵|冲销/i.test(name);
        const codeMatch = code.startsWith('1031') || code.startsWith('3103');
        return (codeMatch || nameMatch) && !excludeMatch && getMarginAmount(item) > 0;
      };

      const marginRows = rawPortfolioData.filter(isMarginRow);
      const exactTotalMarginRows = marginRows.filter((item: any) => {
        const code = normalizeMarginCode(item.code);
        return code === '1031' || code === '3103';
      });

      let tableTotalMargin = exactTotalMarginRows.reduce((sum: number, item: any) => {
        return sum + getMarginAmount(item);
      }, 0);

      if (tableTotalMargin <= 0) {
        const marginCodes = marginRows.map((item: any) => normalizeMarginCode(item.code));
        const leafMarginRows = marginRows.filter((item: any) => {
          const code = normalizeMarginCode(item.code);
          return !marginCodes.some((other: string) => other !== code && other.startsWith(code));
        });

        tableTotalMargin = leafMarginRows.reduce((sum: number, item: any) => {
          return sum + getMarginAmount(item);
        }, 0);
      }

      // console.log('从保证金行提取的总保证金:', tableTotalMargin);
      
      // ✅ 一、重构过滤逻辑：只保留真实持仓行
      // 判断是否包含合约代码（不锚定末尾，因为代码可能是 31020301T2606 形式）
      const hasContractCode = (code: string): boolean => {
        // 合约代码模式：至少2位字母+至少2位数字（如T2606、IC2606、AG2604、AG2601C11500）
        const contractPattern = /[A-Za-z]{2,}\d{2,}/;
        return contractPattern.test(code);
      };

      // 提取合约代码（从科目代码中）
      const extractContractCode = (code: string): string => {
        // 匹配合约代码模式（字母+数字）
        const match = code.match(/[A-Za-z]{2,}\d{2,}/);
        return match ? match[0] : '';
      };

      // 宽松的过滤逻辑：只排除冲销和估值增值行
      const isValidPosition = (item: any) => {
        const code = (item.code || '').toString().trim();
        const name = (item.name || '').toString();

        // 必须有科目代码
        if (!code || code.length < 4) {
          // console.log(`排除：无科目代码 - name=${name}`);
          return false;
        }

        // 只处理交易性风险持仓；现金、保证金、清算款等只进入明细，不进入概览分析
        if (!code.startsWith('1001') && !code.startsWith('1101') && !code.startsWith('1102') && !code.startsWith('1108') && !code.startsWith('3102')) {
          // console.log(`排除：非风险资产科目 - code=${code}, name=${name}`);
          return false;
        }

        // 对于衍生品(3102)：根据科目代码末尾两位判断
        if (code.startsWith('3102')) {
          const lastTwo = code.slice(-2);
          // 02-冲销，99-估值增值 → 排除
          if (lastTwo === '02' || lastTwo === '99') {
            // console.log(`排除：冲销或估值增值行 - code=${code}, name=${name}`);
            return false;
          }
          // 排除包含冲抵/冲销/估值增值/应计利息的行（作为补充过滤）
          if (/冲抵|冲销|估值增值|应计利息/.test(name)) {
            // console.log(`排除：会计处理行 - code=${code}, name=${name}`);
            return false;
          }
          // 保留"初始合约价值"行（真实持仓）
        }

        // 检查市值（允许0，不强制>0）
        const mv = getFieldValue(item, 'marketValue');
        if (mv < 0) {
          // console.log(`排除：市值为负 - code=${code}, name=${name}, mv=${mv}`);
          return false;
        }

        // 数量检查放宽：允许0或空值（后续会兜底处理）
        if (code.startsWith('3102')) {
          const volume = getFieldValue(item, 'volume');
          if (volume < 0) {
            // console.log(`排除：数量为负 - code=${code}, name=${name}, volume=${volume}`);
            return false;
          }
        }
        
        return true;
      };

      const normalizeDetailCode = (value: unknown): string => {
        return (value || '').toString().trim().replace(/\s+/g, '').replace(/\./g, '');
      };

      const isSummaryMetricRow = (item: any): boolean => {
        const code = normalizeDetailCode(item.code);
        const name = (item.name || '').toString().replace(/\s/g, '');
        if (!code || code.length < 4) return true;
        if (/单位净值|净值.*增长率|已实现收益|可分配利润|累计派现|现金类占净值比/.test(code + name)) return true;
        if (/合计|小计|总计|基金资产净值|资产净值|资产类合计|负债类合计/.test(name)) return true;
        if (/冲抵|冲销|估值增值|应计利息/.test(name)) return true;
        return false;
      };

      const isDisplayableDetailRow = (item: any): boolean => {
        if (isSummaryMetricRow(item)) return false;
        const code = normalizeDetailCode(item.code);
        const name = (item.name || '').toString();
        if (code.startsWith('3102') && /初始合约价值/.test(name) && !/[A-Za-z]{1,4}\d{2,5}/.test(`${code}${name}`)) return false;

        const mv = Math.abs(getFieldValue(item, 'marketValue'));
        const cost = Math.abs(Number(item.cost || item.signed_cost || 0));
        const volume = Math.abs(getFieldValue(item, 'volume'));
        return mv > 0 || cost > 0 || volume > 0;
      };

      const detailCandidateRows = rawPortfolioData.filter(isDisplayableDetailRow);
      const detailCodes = detailCandidateRows.map((item: any) => normalizeDetailCode(item.code));
      const hasBackendRowTags = rawPortfolioData.some((item: any) => typeof item.include_in_detail === 'boolean' || typeof item.include_in_analysis === 'boolean');
      const detailLeafRows = hasBackendRowTags ? rawPortfolioData.filter((item: any) => item.include_in_detail === true) : detailCandidateRows.filter((item: any) => {
        const code = normalizeDetailCode(item.code);
        const hasContract = /[A-Za-z]{1,4}\d{2,5}/.test(`${code}${item.name || ''}`);
        if (hasContract) return true;
        return !detailCodes.some((other: string) => other !== code && other.startsWith(code));
      });
      
      // 调试：先检查原始数据
      // console.log('=== 原始数据详细分析 ===');
      // console.log('总条数:', rawPortfolioData.length);
      
      // 打印所有3102开头的行
      const all3102 = rawPortfolioData.filter(d => String(d.code).startsWith('3102'));
      // console.log(`\n所有3102开头的行(${all3102.length}条):`);
      all3102.forEach(item => {
        const hasContract = /[A-Z]{2,}\d{2,}/.test(String(item.code));
        // console.log(`${item.code} | ${item.name} | position=${item.position} | market_value=${item.market_value} | 有合约代码: ${hasContract}`);
      });
      
      const filteredData = hasBackendRowTags
        ? rawPortfolioData.filter((item: any) => item.include_in_analysis === true)
        : rawPortfolioData.filter(isValidPosition);
      
      // ✅ 如果严格过滤结果为空，尝试宽松模式
      let finalFilteredData = filteredData;
      if (filteredData.length === 0 && rawPortfolioData.length > 0) {
        console.warn('\n⚠️ 严格过滤结果为空，尝试宽松模式...');
        
        // 宽松模式：只检查基本条件
        const relaxedFilter = (item: any) => {
          const code = (item.code || '').toString().trim();
          const name = (item.name || '').toString();
          
          // 必须有科目代码
          if (!code || code.length < 4) return false;
          
          // 只处理交易性风险持仓
          if (!code.startsWith('1001') && !code.startsWith('1101') && !code.startsWith('1102') && !code.startsWith('1108') && !code.startsWith('3102')) {
            return false;
          }
          
          // 对于衍生品(3102)：根据科目代码末尾两位判断
          if (code.startsWith('3102')) {
            const lastTwo = code.slice(-2);
            // 02-冲销，99-估值增值 → 排除
            if (lastTwo === '02' || lastTwo === '99') {
              return false;
            }
          }
          
          // 排除明显的会计处理行（保留"初始合约价值"行）
          if (/冲抵|冲销|估值增值|应计利息|合计|小计|总计/.test(name)) {
            return false;
          }
          if (/初始合约价值/.test(name) && !/[A-Za-z]{1,4}\d{2,5}/.test(name)) {
            return false;
          }
          
          // 宽松的市值检查：允许0，但不允许负数
          const mv = getFieldValue(item, 'marketValue');
          if (mv < 0) return false;
          
          // 宽松的数量检查：允许0，但不允许负数
          const volume = getFieldValue(item, 'volume');
          if (volume < 0) return false;
          
          return true;
        };
        
        finalFilteredData = rawPortfolioData.filter(relaxedFilter);
        // console.log(`宽松模式过滤后数量: ${finalFilteredData.length}`);
        if (finalFilteredData.length > 0) {
          // console.log('宽松模式生效，使用宽松过滤结果');
        }
      }

      if (!hasBackendRowTags) {
        const analysisCodes = finalFilteredData.map((item: any) => normalizeDetailCode(item.code));
        finalFilteredData = finalFilteredData.filter((item: any) => {
          const code = normalizeDetailCode(item.code);
          const hasContract = code.startsWith('3102') && /[A-Za-z]{1,4}\d{2,5}/.test(`${code}${item.name || ''}`);
          if (hasContract) return true;
          return !analysisCodes.some((other: string) => other !== code && other.startsWith(code));
        });
      }
      
      // ✅ 调试验证：打印过滤后前几条数据
      // console.log('\n=== 过滤后持仓示例 ===');
      
      // ✅ 增强调试日志
      // console.log('\n=== 过滤前原始数据概览 ===');
      // console.log('总条数:', rawPortfolioData.length);
      // console.log('所有可用字段:', rawPortfolioData.length > 0 ? Object.keys(rawPortfolioData[0]) : []);
      
      // 统计各科目类型数量
      const stats = {
        total: rawPortfolioData.length,
        '3102衍生品': rawPortfolioData.filter(d => String(d.code).startsWith('3102')).length,
        '1001股票': rawPortfolioData.filter(d => String(d.code).startsWith('1001')).length,
        '1101债券': rawPortfolioData.filter(d => String(d.code).startsWith('1101')).length,
        '1105基金': rawPortfolioData.filter(d => String(d.code).startsWith('1105')).length,
      };
      // console.log('各科目类型统计:', stats);
      
      // 打印3102开头的数据详细信息（复用之前定义的 all3102）
      // console.log('\n=== 3102衍生品详细信息 ===');
      all3102.forEach(item => {
        const mv = getFieldValue(item, 'marketValue');
        const vol = getFieldValue(item, 'volume');
      });
      
      // console.log('\n=== 过滤后的真实持仓 ===');
      // console.log('真实持仓数量:', filteredData.length);
      filteredData.forEach(item => {
        // console.log(`  ${item.code} | ${item.name} | marketValue=${getFieldValue(item, 'marketValue')} | volume=${getFieldValue(item, 'volume')}`);
      });
      
      // 调试：分析过滤失败的原因
      if (filteredData.length === 0 && all3102.length > 0) {
        console.warn('\n⚠️ 过滤后数据为空，但存在衍生品数据！分析原因：');
        all3102.forEach(item => {
          const mv = getFieldValue(item, 'marketValue');
          const vol = getFieldValue(item, 'volume');
          const reasons: string[] = [];
          if (mv <= 0) reasons.push('市值<=0');
          if (vol <= 0) reasons.push('数量<=0');
          if (/冲抵|冲销|估值增值|应计利息|初始合约价值/.test(item.name)) reasons.push('名称匹配排除模式');
          // console.log(`  ${item.code} | ${item.name} | 排除原因: ${reasons.length > 0 ? reasons.join(', ') : '未知'}`);
        });
      }

      // console.log('过滤后持仓数据数量:', filteredData.length);

      // 详细分析衍生品数据的数值字段
      if (derivativeItems.length > 0) {
        // console.log('\n=== 衍生品数值字段分析 ===');
        const firstDerivative = derivativeItems[0];
        const allKeys = Object.keys(firstDerivative);
        
        // 找出所有可能包含数值的字段
        const numericKeys = allKeys.filter(key => {
          const val = firstDerivative[key];
          return !isNaN(Number(val)) && isFinite(Number(val));
        });
        
        // console.log('数值字段列表:', numericKeys);
        
        // 打印每个数值字段的样本值
        // console.log('数值字段样本值:');
        numericKeys.forEach(key => {
          // console.log(`  ${key}: ${firstDerivative[key]}`);
        });
        
        // 检查常见字段是否存在
        const expectedFields = ['volume', 'quantity', 'unit_cost', 'avg_cost', 'price', 'current_price', 'market_value', 'notional_value'];
        // console.log('\n期望字段存在情况:');
        expectedFields.forEach(field => {
          const found = allKeys.some(k => k.toLowerCase().includes(field.toLowerCase()));
          // console.log(`  ${field}: ${found ? '✓ 存在' : '✗ 缺失'}`);
        });
      }

      // 调试输出：排查衍生品丢失问题
      // console.log('\n=== 全部原始数据前10项 ===', rawPortfolioData.slice(0, 10));
      // console.log('=== 第一个3102开头的行 ===', rawPortfolioData.find((d: any) => String(d.code).startsWith('3102')));
      
      // 智能推断交易所的函数
      const inferExchange = (symbol: string, code: string): string => {
        // 首先检查后端是否返回了exchange字段
        if (code && code.startsWith('3102')) {
          // 根据科目代码的第5-6位推断交易所
          const exchangeCode = code.substring(4, 6);
          switch (exchangeCode) {
            case '03':
            case '04':
              return 'CFFEX'; // 中金所
            case '05':
            case '06':
              return 'SHFE'; // 上期所
            case '07':
            case '08':
              return 'DCE'; // 大商所
            case '31':
            case '32':
              return 'CZCE'; // 郑商所
            case 'F1':
              return 'INE'; // 上能源
            case 'K1':
              return 'GFEX'; // 广期所
            default:
              break;
          }
        }
        
        // 根据symbol的后缀推断交易所
        const symbolUpper = symbol.toUpperCase();
        if (symbolUpper.endsWith('CFX')) {
          return 'CFFEX';
        } else if (symbolUpper.endsWith('SQ')) {
          return 'SHFE';
        } else if (symbolUpper.endsWith('DCE')) {
          return 'DCE';
        } else if (symbolUpper.endsWith('CZC')) {
          return 'CZCE';
        } else if (symbolUpper.endsWith('GEX')) {
          return 'GFEX';
        } else if (symbolUpper.endsWith('SC')) {
          return 'INE';
        }
        
        // 默认为未知
        return '未知';
      };
      
      // 修正期权多空方向的函数
      const correctOptionDirection = (code: string, direction: string): 'long' | 'short' => {
        if (code && code.startsWith('3102')) {
          // 期权代码前缀：3102DD/3102DF → long, 3102DE/3102DG → short
          const optionPrefix = code.substring(4, 6);
          if (optionPrefix === 'DD' || optionPrefix === 'DF') {
            return 'long';
          } else if (optionPrefix === 'DE' || optionPrefix === 'DG') {
            return 'short';
          }
        }
        return (direction === 'short' ? 'short' : 'long') as 'long' | 'short';
      };
      
      // ✅ 修改2：修复资产类别推断逻辑（支持股票、ETF、债券等）
      const inferAssetClass = (symbol: string, name: string, code?: string): string => {
        const sym = symbol.toUpperCase();
        // 优先根据科目代码判断（最准确）
        if (code) {
          if (code.startsWith('1001')) return '股票';
          if (code.startsWith('1002')) {
            if (name.includes('ETF')) return 'ETF';
            if (name.includes('LOF')) return 'LOF基金';
            if (name.includes('QDII')) return 'QDII基金';
            return '基金';
          }
          if (code.startsWith('1101')) return '债券';
          if (code.startsWith('1105')) return '货币基金';
          if (code.startsWith('3102')) {
            // 期权代码：3102DD/DF 买方，3102DE/DG 卖方
            if (name.includes('期权') || /3102[DEFG]/.test(code)) return '期权';
            return '期货';
          }
        }
        
        // 根据合约代码判断期货类型
        if (/^(IF|IH|IC|IM)\d+$/.test(sym)) {
          return '股指期货';
        } else if (/^(T|TF|TS|TL)\d+$/.test(sym)) {
          return '国债期货';
        } else if (sym.endsWith('CFX')) {
          return '股指/国债期货';
        } else if (sym.endsWith('SQ') || sym.endsWith('DCE') || sym.endsWith('CZC') || sym.endsWith('GEX') || sym.endsWith('SC')) {
          return '商品期货';
        } else if (name.includes('货币') || sym.includes('OTC')) {
          return '货币基金';
        } else {
          return '其他';
        }
      };
      
      // ✅ 四、重构 enrichPortfolioItem：根据科目代码精准判断资产类别和方向
      const enrichPortfolioItem = (item: any, defaultNav: number = 1): ValuationPosition => {
        const code = (item.code || '').toString().trim();
        const name = item.name || '';

        // 提取合约代码：仅衍生品行提取，避免现金/保证金账户号被误识别为合约
        let symbol = '';
        
        if (code.startsWith('3102')) {
          const codeMatch = code.match(/[A-Za-z]{1,4}\d{2,5}/);
          if (codeMatch) {
            symbol = codeMatch[0];
          } else {
            const nameMatch = name.match(/([A-Za-z]{1,4}\d{2,5})/);
            if (nameMatch) {
              symbol = nameMatch[0];
            } else {
              const productMatch = name.match(/([\u4e00-\u9fa5]{2,3})(\d{4})/);
              if (productMatch) {
                const productName = productMatch[1];
                const month = productMatch[2];
                const reverseMap = Object.entries(PRODUCT_NAME_MAP).find(([, v]) => v === productName);
                if (reverseMap) {
                  symbol = reverseMap[0] + month;
                }
              }
            }
          }
        } else {
          symbol = code;
        }
        
        // 最终兜底：如果还是没有提取到合约代码，使用简短名称
        if (!symbol) {
          symbol = getShortChineseName(code, name);
        }
        
        // ----- 根据科目代码前缀确定资产类别、方向、交易所 -----
        let assetClass = '其他';
        let direction: 'long' | 'short' = 'long';
        let exchange = '未知';

        if (code.startsWith('1001')) {
          assetClass = '股票';
          direction = 'long';
          exchange = code.includes('SH') ? '上交所' : code.includes('SZ') ? '深交所' : '股票';
        } else if (code.startsWith('1002')) {
          assetClass = '银行存款';
          direction = 'long';
          exchange = '现金账户';
        } else if (code.startsWith('1021')) {
          assetClass = '清算备付金';
          direction = 'long';
          exchange = '清算账户';
        } else if (code.startsWith('1031')) {
          assetClass = '保证金';
          direction = 'long';
          exchange = '保证金账户';
        } else if (code.startsWith('1202')) {
          assetClass = '买入返售证券';
          direction = 'long';
          exchange = '场外';
        } else if (code.startsWith('1203') || code.startsWith('1207')) {
          assetClass = '应收款项';
          direction = 'long';
          exchange = '应收';
        } else if (code.startsWith('1101')) {
          assetClass = '债券';
          direction = 'long';
        } else if (code.startsWith('1102')) {
          assetClass = '股票/基金';
          direction = 'long';
        } else if (code.startsWith('1108')) {
          assetClass = '私募基金';
          direction = 'long';
          exchange = '场外';
        } else if (code.startsWith('1105')) {
          if (name.includes('货币')) assetClass = '货币基金';
          else assetClass = '基金';
          direction = 'long';
        } else if (code.startsWith('3003')) {
          assetClass = '证券清算款';
          direction = 'long';
          exchange = '清算账户';
        } else if (/^22/.test(code)) {
          assetClass = '负债/应付款项';
          direction = 'short';
          exchange = '负债';
        } else if (code.startsWith('3102')) {
          const sub = code.substring(4, 6);
          // 中金所
          if (['03','04'].includes(sub)) {
            const sym = symbol.toUpperCase();
            if (/^(IF|IH|IC|IM)/.test(sym)) assetClass = '股指期货';
            else if (/^(T|TF|TS|TL)/.test(sym)) assetClass = '国债期货';
            exchange = 'CFFEX';
            direction = sub === '03' ? 'long' : (sub === '04' ? 'short' : 'long');
          }
          // 上期所
          else if (sub === '05') { assetClass = '商品期货'; exchange = 'SHFE'; direction = 'long'; }
          else if (sub === '06') { assetClass = '商品期货'; exchange = 'SHFE'; direction = 'short'; }
          // 大商所
          else if (sub === '41') { assetClass = '商品期货'; exchange = 'DCE'; direction = 'long'; }
          else if (sub === '42') { assetClass = '商品期货'; exchange = 'DCE'; direction = 'short'; }
          // 郑商所
          else if (sub === '31') { assetClass = '商品期货'; exchange = 'CZCE'; direction = 'long'; }
          else if (sub === '32') { assetClass = '商品期货'; exchange = 'CZCE'; direction = 'short'; }
          // 上能源
          else if (sub === 'F1') { assetClass = '商品期货'; exchange = 'INE'; direction = 'long'; }
          else if (sub === 'F2') { assetClass = '商品期货'; exchange = 'INE'; direction = 'short'; }
          // 广期所
          else if (sub === 'K1') { assetClass = '商品期货'; exchange = 'GFEX'; direction = 'long'; }
          else if (sub === 'K2') { assetClass = '商品期货'; exchange = 'GFEX'; direction = 'short'; }
          // 期权
          else if (sub === 'DD') { assetClass = '期权'; exchange = 'SHFE'; direction = 'long'; }
          else if (sub === 'DE') { assetClass = '期权'; exchange = 'SHFE'; direction = 'short'; }
          else if (sub === 'DF') { assetClass = '期权'; exchange = 'SHFE'; direction = 'long'; }
          else if (sub === 'DG') { assetClass = '期权'; exchange = 'SHFE'; direction = 'short'; }
          // ✅ 兜底：根据合约代码推断交易所
          else {
            const sym = symbol.toUpperCase();
            // 大商所品种
            if (/^(I|J|JM|J|ZC|MA|UR|LU|EG|EB|PP|PE|PVC|V|PG|BC|SS)/.test(sym)) {
              assetClass = '商品期货';
              exchange = 'DCE';
              direction = code.includes('06') || code.includes('08') || code.includes('42') || code.includes('32') ? 'short' : 'long';
            } 
            // 上期所品种
            else if (/^(CU|AL|ZN|PB|NI|SN|AU|AG|PT|PD|HC|RB|WR|SS|FU|SC|LU|BC|AO|AD|LC|SI)/.test(sym)) {
              assetClass = '商品期货';
              exchange = 'SHFE';
              direction = code.includes('06') || code.includes('08') || code.includes('42') || code.includes('32') ? 'short' : 'long';
            }
            // 郑商所品种
            else if (/^(SR|CF|CY|TA|EG|PF|MA|SA|FG|RM|OI|Y|M|A|B|C|CS|WH|PM|RI|JR|LR|AP|CJ|PK)/.test(sym)) {
              assetClass = '商品期货';
              exchange = 'CZCE';
              direction = code.includes('06') || code.includes('08') || code.includes('42') || code.includes('32') ? 'short' : 'long';
            }
            // 上能源品种
            else if (/^(SC|FU|LU|PG|EB|EG)/.test(sym)) {
              assetClass = '商品期货';
              exchange = 'INE';
              direction = code.includes('06') || code.includes('08') || code.includes('42') || code.includes('32') ? 'short' : 'long';
            }
            else {
              assetClass = '商品期货';
              exchange = '未知';
              direction = 'long';
            }
          }
        }

        // ✅ 数值提取逻辑：优先使用后端返回的字段
        // 手数 = 后端返回的 position 字段
        if (item.asset_class) assetClass = item.asset_class;
        if (item.exchange) exchange = item.exchange;
        if (item.direction === 'long' || item.direction === 'short') direction = item.direction;

        let volume = Math.abs(item.position || 0);
        
        // 如果后端没有返回，尝试从其他字段获取
        if (volume <= 0) {
          volume = Math.abs(getFieldValue(item, 'volume'));
        }
        
        // 非合约类明细允许数量为空，避免现金/保证金行被显示成 1 手。
        if (volume <= 0) volume = 0;
        
        // 单位成本 = 后端返回的 unit_cost 字段（开仓均价）
        let finalUnitCost = Math.abs(item.unit_cost || 0);
        
        // 如果后端没有返回，尝试从其他字段获取
        if (finalUnitCost <= 0) {
          finalUnitCost = Math.abs(getFieldValue(item, 'unitCost'));
        }
        
        // 最新价 = 后端返回的 current_price 字段
        let finalPrice = Math.abs(item.current_price || 0);
        
        // 如果后端没有返回，尝试从其他字段获取
        if (finalPrice <= 0) {
          finalPrice = Math.abs(getFieldValue(item, 'price'));
        }
        
        const marketValueCandidates = [
          item.signed_market_value,
          item.market_value,
          item.notional_value,
          item.marketValue,
          item.notionalValue,
        ];
        const rawMarketValue = marketValueCandidates
          .map((value) => typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, '')))
          .find((value) => Number.isFinite(value) && Math.abs(value) > 0);

        // 名义市值优先取估值表中的市值/本币市值字段，避免误用数量、成本或市值占比。
        const notionalValue = Math.abs(rawMarketValue || getFieldValue(item, 'marketValue'));
        
        // 盈亏和保证金
        const pnl = getFieldValue(item, 'pnl');
        const margin = getFieldValue(item, 'margin');
        
        // ✅ 兜底推算：如果单位成本为0，用市值/手数推算
        if (finalUnitCost <= 0 && volume > 0 && notionalValue > 0) {
          finalUnitCost = notionalValue / volume;
        }
        
        // ✅ 兜底推算：如果最新价为0，用市值/手数推算
        if (finalPrice <= 0 && volume > 0 && notionalValue > 0) {
          finalPrice = notionalValue / volume;
        }
        
        // 优化品种名称显示：品种代码 + 中文名称
        const productCode = symbol.replace(/\d+$/, '').toUpperCase();
        const chineseName = PRODUCT_NAME_MAP[productCode] || '';
        const displayName = chineseName ? `${symbol} ${chineseName}` : (name || symbol);
        
        return {
          code: code,
          symbol: symbol,
          name: displayName,
          exchange: exchange,
          asset_class: assetClass,
          direction: direction,
          volume: Number(volume.toFixed(4)),
          unit_cost: Number(finalUnitCost.toFixed(4)),
          current_price: Number(finalPrice.toFixed(4)),
          notional_value: notionalValue,
          unrealized_pnl: pnl,
          margin_usage: margin,
          weight: defaultNav > 0 ? (notionalValue / defaultNav) * 100 : 0,
          row_kind: item.row_kind,
          is_leaf: item.is_leaf,
          include_in_detail: item.include_in_detail,
          include_in_analysis: item.include_in_analysis
        };
      };
      
      const mappedPortfolioData: ValuationPosition[] = finalFilteredData.map((item: any) => {
        return enrichPortfolioItem(item, 1);
      });
      const mappedHoldingDetailData: ValuationPosition[] = detailLeafRows.map((item: any) => {
        return enrichPortfolioItem(item, 1);
      });

      // 调试输出：查看原始字段
      // console.log('=== 原始衍生品第一项完整字段 ===');
      const firstDerivative = finalFilteredData.length ? finalFilteredData[0] : null;
      if (firstDerivative) {
        // console.log('所有键名:', Object.keys(firstDerivative));
        // console.log('完整对象:', firstDerivative);
      }
      // console.log('=== 映射后第一条 ===');
      // console.log(mappedPortfolioData[0]);

      // ✅ 保证金兜底：如果从表格中未提取到保证金，尝试从持仓数据中累加
      if (tableTotalMargin <= 0 && mappedPortfolioData.length > 0) {
        tableTotalMargin = mappedPortfolioData.reduce((sum, item) => {
          return sum + (item.margin_usage || 0);
        }, 0);
        // console.log('表格中未提取到保证金，使用持仓数据累加:', tableTotalMargin);
      }

      // ✅ 修改3：确保净资产（nav）准确
      // 基于已知的 nav 计算每条持仓的 weight（占净资产百分比）—如果后端尚未返回nav，将在后续填充
      let detectedNav = data.summary?.nav || 0;
      let navWarning = false;
      
      // console.log('=== 净资产获取过程 ===');
      // console.log('data.summary?.nav:', data.summary?.nav);
      
      if (!detectedNav && data.summary_data && data.summary_data.netAssetValue) {
        detectedNav = data.summary_data.netAssetValue;
        // console.log('从 data.summary_data.netAssetValue 获取:', detectedNav);
      }
      
      if (!detectedNav) {
        // 兜底：使用持仓总名义市值（虽然不是精确净资产，但用于避免除以0导致的可视化空白）
        const totalNotional = mappedPortfolioData.reduce((s, it) => s + (it.notional_value || 0), 0);
        // console.log('持仓总名义市值:', totalNotional);
        if (totalNotional > 0) {
          detectedNav = totalNotional;
          navWarning = true; // 标记使用了兜底值
          // console.log('使用持仓总市值作为兜底净资产:', detectedNav);
        }
      }

      // console.log('最终净资产值:', detectedNav);
      
      if (detectedNav && detectedNav > 0) {
        mappedPortfolioData.forEach(it => {
          it.weight = (it.notional_value / detectedNav) * 100;
        });
        mappedHoldingDetailData.forEach(it => {
          it.weight = (it.notional_value / detectedNav) * 100;
        });
      }
      
      // ✅ 如果使用了兜底值，显示警告
      if (navWarning) {
        console.warn('⚠️ 未获取到净资产，使用总名义市值近似，比例仅供参考');
      }
      
      // 提取汇总数据
      nav = detectedNav;
      
      // 如果nav仍为0或undefined，使用总名义市值作为兜底，不强制返回
      if (!nav || nav === 0) {
        const totalNotional = rawPortfolioData.reduce((sum: number, item: any) => {
          return sum + Math.abs(getFieldValue(item, 'marketValue'));
        }, 0);
        
        if (totalNotional > 0) {
          nav = totalNotional;
          console.warn('⚠️ 未获取到净资产，使用总名义市值作为兜底');
        } else {
          console.error('未能从估值表中提取净资产，且无持仓数据');
          setAnalysisResult(null);
          alert('未能从估值表中提取净资产，请检查文件格式');
          setIsLoading(false);
          return;
        }
      }
      
      const summary: ValuationSummary = {
        fund_name: data.summary?.fund_name || '未知基金',
        valuation_date: data.summary?.valuation_date || new Date().toISOString().split('T')[0],
        nav: nav,
        total_asset: data.summary?.total_asset || 0,
        total_liability: data.summary?.total_liability || 0
      };
      
      // console.log('映射后的持仓数据:', mappedPortfolioData.slice(0, 3));
      // console.log('汇总数据:', summary);
      // console.log('总保证金:', tableTotalMargin);
      
      // 分析数据
      const analysis = analyzePortfolio(mappedPortfolioData, summary.nav);
      analysis.total_margin = tableTotalMargin;
      // console.log('分析结果详细结构:', analysis);
      
      setPortfolioData(mappedPortfolioData);
      setHoldingDetailData(mappedHoldingDetailData);
      setSummaryData(summary);
      setAnalysisResult(analysis);
      setHoldingSearch('');
      // console.log('分析结果设置完成');
      // 图表将在 analysisResult 更新后的 useEffect 中初始化
    } catch (error) {
      console.error('分析文件失败:', error);
      console.error('错误详情:', error instanceof Error ? error.stack : error);
      // 添加用户可见的错误提示
      alert('分析文件失败，请检查控制台获取详细错误信息');
    } finally {
      setIsLoading(false);
    }
  };

  // 生成AI分析
  const generateAIAnalysis = async () => {
    if (!allRawData || allRawData.length === 0 || !summaryData) return;

    setIsGeneratingAI(true);

    const header = '科目代码 | 科目名称 | 数量 | 单位成本 | 成本 | 市价 | 市值 | 估值增值';
    const rowsText = allRawData.map(item => {
      const code = (item.code || '').padEnd(14);
      const name = (item.name || '').padEnd(30);
      const vol = (item.volume ?? '').toString().padStart(8);
      const unitCost = (item.unit_cost != null ? item.unit_cost.toFixed(2) : '').padStart(10);
      const cost = (item.cost != null ? item.cost.toFixed(2) : '').padStart(12);
      const price = (item.price != null ? item.price.toFixed(2) : '').padStart(10);
      const marketVal = (item.market_value != null ? item.market_value.toFixed(2) : '').padStart(14);
      const valuationChange = (item.net_value_change ?? '').toString().padStart(10);
      return `${code} | ${name} | ${vol} | ${unitCost} | ${cost} | ${price} | ${marketVal} | ${valuationChange}`;
    }).join('\n');

    const prompt = `以下是一个私募基金估值表的全部科目数据，请基于这些原始记录，分析该基金的深层策略逻辑、市场观点及风险特征。要求：
1. 分为"核心策略判断"、"市场观点与风险偏好"、"持仓特征与Alpha来源"、"总结与风险提示"四部分。
2. 每部分用"- "列出要点，总字数500字以内，语言简洁。
3. 直接从表中信息推断，不要使用外部知识。

基金净资产：${summaryData.nav.toFixed(2)} 元

估值表：
${header}
${rowsText}`;

    try {
      const response = await fetch('/ma/api/tools/valuation/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || '请求失败');
      }

      const data = await response.json();
      const aiText = data.ai_analysis || data.choices?.[0]?.message?.content?.trim();

      if (aiText) {
        setAiAnalysis(parseAIAnalysis(aiText));
      } else {
        throw new Error('AI返回内容为空');
      }
    } catch (error: any) {
      console.error('AI分析失败:', error);
      setAiAnalysis('AI分析生成失败：' + (error.message || '未知错误'));
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // 下载分析报告
  const downloadReport = () => {
    // 模拟下载功能
    alert('分析报告下载功能开发中...');
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 space-y-4">
        <Link
          href="/ma/dashboard/tools"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          返回小工具
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">估值表分析工具</h1>
            <p className="text-gray-600 mt-2">精准捕捉估值表的隐含信息，判断最深层的策略逻辑</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={downloadReport}
              className="bg-gray-800 text-white px-4 py-2 rounded-md hover:bg-gray-700 transition-all flex items-center"
            >
              <i className="fa fa-download mr-2"></i> 下载分析报告
            </button>
          </div>
        </div>
      </div>

      {/* 文件上传区域 */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. 上传估值表</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">上传文件</h3>
            <div 
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-all cursor-pointer"
            >
              <input 
                type="file" 
                className="hidden" 
                accept=".xlsx,.xls,.csv,.tsv" 
                onChange={handleFileChange}
                id="fileInput"
              />
              <i className="fa fa-cloud-upload text-4xl text-gray-400 mb-4"></i>
              <p className="text-gray-600 mb-2">拖拽文件到此处，或点击选择文件</p>
              <p className="text-sm text-gray-500">支持 xlsx · xls · csv · tsv 格式</p>
              <button 
                onClick={() => document.getElementById('fileInput')?.click()}
                className="mt-4 bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-all"
              >
                选择文件
              </button>
              {file && (
                <div className="mt-4">
                  <p className="text-sm text-gray-600">已选择文件：<span className="font-medium">{file.name}</span></p>
                  <button 
                    onClick={analyzeFile}
                    disabled={isLoading}
                    className="mt-2 bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 transition-all"
                  >
                    {isLoading ? '分析中...' : '开始分析'}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">支持格式</h3>
            <div className="bg-gray-50 p-4 rounded-lg">
              <ul className="list-disc pl-6 space-y-2">
                <li>Excel 文件：.xlsx, .xls, .xlsm, .xlsb</li>
                <li>CSV 文件：.csv</li>
                <li>TSV 文件：.tsv</li>
              </ul>
              <p className="mt-4 text-sm text-gray-600">
                上传文件只在分析请求中进入内存，不会落盘保存；清空或离开页面后不会留下原始上传文件。
              </p>
            </div>
          </div>
        </div>
      </div>

      {analysisResult && summaryData && (
        <>
          {/* 投资组合概览 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">投资组合概览</h2>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">基金净资产</div>
                <div className="text-2xl font-bold">{(summaryData.nav / 10000).toFixed(2)} 万</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">总名义市值（交易持仓）</div>
                <div className="text-xl font-bold sm:text-2xl">{(analysisResult.total_value / 10000).toFixed(2)} 万</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">杠杆倍数</div>
                <div className="text-xl font-bold sm:text-2xl">{analysisResult.leverage.toFixed(2)}x</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">净敞口（占总名义）</div>
                <div className="text-xl font-bold sm:text-2xl">{analysisResult.net_exposure.toFixed(2)}%</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">轧差</div>
                <div className="text-xl font-bold sm:text-2xl">{(analysisResult.netting_value / 10000).toFixed(2)} 万</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">多空比例</div>
                <div className="text-xl font-bold sm:text-2xl">
                  {Number.isFinite(analysisResult.long_short_ratio) ? `${analysisResult.long_short_ratio.toFixed(2)}:1` : '仅多头'}
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">集中度</div>
                <div className="text-2xl font-bold">{analysisResult.concentration_ratio.toFixed(2)}%</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">总保证金</div>
                <div className="text-2xl font-bold">{(analysisResult.total_margin / 10000).toFixed(2)} 万</div>
              </div>
            </div>
            <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-amber-900">
                轧差校验明细：多头 {(analysisResult.long_value / 10000).toFixed(2)} 万，
                空头 {(analysisResult.short_value / 10000).toFixed(2)} 万，
                净额 {((analysisResult.long_value - analysisResult.short_value) / 10000).toFixed(2)} 万
              </summary>
              <div className="mt-3 max-h-72 overflow-auto rounded border border-amber-100 bg-white">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">代码</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">名称</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">方向</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">数量</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">名义市值</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...portfolioData]
                      .sort((a, b) => (b.notional_value || 0) - (a.notional_value || 0))
                      .map((item, index) => (
                        <tr key={`${item.code || item.symbol}-${index}`}>
                          <td className="px-3 py-2 font-mono text-gray-700">{item.code || item.symbol}</td>
                          <td className="px-3 py-2 text-gray-700">{item.name}</td>
                          <td className="px-3 py-2">
                            <span className={item.direction === 'long' ? 'text-green-700' : 'text-red-700'}>
                              {item.direction === 'long' ? '多头' : '空头'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{item.volume.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{item.notional_value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>

          {/* 策略分析研究 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">策略分析研究</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">核心策略</div>
                <div className="text-2xl font-bold">{analysisResult.strategy_analysis.core_strategy}</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">风险偏好</div>
                <div className="text-2xl font-bold">{analysisResult.strategy_analysis.risk_appetite}</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">市场观点</div>
                <div className="text-2xl font-bold">{analysisResult.strategy_analysis.market_view}</div>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-3">策略详情</h3>
              <ul className="list-disc pl-6 space-y-2">
                {analysisResult.strategy_analysis.strategy_details.map((detail: string, index: number) => (
                  <li key={index}>{detail}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* AI策略分析 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">AI策略分析</h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-gray-900">深度策略分析</h3>
                <button 
                  onClick={generateAIAnalysis}
                  disabled={isGeneratingAI}
                  className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 transition-all flex items-center"
                >
                  {isGeneratingAI ? '分析中...' : '生成AI分析'}
                  <i className="fa fa-robot ml-2"></i>
                </button>
              </div>
              
              {isGeneratingAI && (
                <div className="bg-gray-50 p-8 rounded-lg border text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                  <p className="text-gray-600">正在生成AI分析...</p>
                </div>
              )}
              
              {!isGeneratingAI && aiAnalysis && (
                <div className="bg-gray-50 rounded-lg border p-6">
                  {aiAnalysis}
                </div>
              )}
              
              {!isGeneratingAI && !aiAnalysis && (
                <div className="bg-gray-50 p-8 rounded-lg border text-center">
                  <i className="fa fa-lightbulb-o text-4xl text-gray-400 mb-4"></i>
                  <p className="text-gray-600">点击"生成AI分析"按钮，获取深度策略分析</p>
                  <p className="text-sm text-gray-500 mt-2">AI将基于投资组合数据，挖掘深度信息并进行策略分析</p>
                </div>
              )}
            </div>
          </div>

          {/* 持仓分析 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">持仓分析</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">总合约数量</div>
                <div className="text-2xl font-bold">{analysisResult.total_contract_count.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">多头名义市值</div>
                <div className="text-2xl font-bold">{(analysisResult.long_value / 10000).toFixed(2)} 万</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-gray-500">空头名义市值</div>
                <div className="text-2xl font-bold">{(analysisResult.short_value / 10000).toFixed(2)} 万</div>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">资产类别分布</h3>
                <div ref={assetClassChartRef} style={{ height: '400px' }}></div>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">行业板块分布</h3>
                <div ref={sectorChartRef} style={{ height: '400px' }}></div>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">交易所合约分布</h3>
                <div ref={exchangeChartRef} style={{ height: '400px' }}></div>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">前十大持仓</h3>
                <div ref={topHoldingsChartRef} style={{ height: '400px' }}></div>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">多空分布</h3>
                <div ref={longShortChartRef} style={{ height: '400px' }}></div>
              </div>
            </div>
          </div>

          {/* 持仓明细 */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">持仓明细</h2>
                <p className="mt-1 text-sm text-gray-500">
                  共 {(holdingDetailData.length > 0 ? holdingDetailData : portfolioData).length} 条明细
                </p>
              </div>
              <input
                type="search"
                value={holdingSearch}
                onChange={(event) => setHoldingSearch(event.target.value)}
                placeholder="搜索合约/名称，如 PS2606 或 多晶硅"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-80"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">品种代码</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">品种名称</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">交易所</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">资产类别</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">多空</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">数量/手</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">开仓均价</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">最新价</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名义市值</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">浮动盈亏</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">保证金占用</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">市值占比</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {(() => {
                    const detailRows = holdingDetailData.length > 0 ? holdingDetailData : portfolioData;
                    const searchText = holdingSearch.trim().toLowerCase();
                    const filteredRows = searchText
                      ? detailRows.filter(item =>
                          [
                            item.code,
                            item.symbol,
                            item.name,
                            item.exchange,
                            item.asset_class,
                            item.direction === 'long' ? '多头' : '空头'
                          ].some(value => String(value || '').toLowerCase().includes(searchText))
                        )
                      : detailRows;
                    
                    // 按持仓比例排序，搜索后只展示匹配的明细行
                    const groupedRows = [...filteredRows].sort((a, b) => {
                      const aWeight = Math.abs(a.weight || 0);
                      const bWeight = Math.abs(b.weight || 0);
                      if (aWeight !== bWeight) return bWeight - aWeight;
                      return (b.notional_value || 0) - (a.notional_value || 0);
                    });
                    
                    return (
                      <>
                        {holdingSearch.trim() && (
                          <tr>
                            <td colSpan={12} className="bg-blue-50 px-6 py-3 text-sm text-blue-700">
                              当前显示 {groupedRows.length} 条匹配持仓
                            </td>
                          </tr>
                        )}
                        {groupedRows.map((item, index) => (
                          <tr key={index}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.symbol}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.exchange || '-'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                {item.asset_class || '其他'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.direction === 'long' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                {item.direction === 'long' ? '多头' : '空头'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.volume.toFixed(2)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.unit_cost.toFixed(2)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.current_price.toFixed(2)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{(item.notional_value / 10000).toFixed(2)} 万</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <span className={item.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                                {item.unrealized_pnl.toFixed(2)}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{(item.margin_usage / 10000).toFixed(2)} 万</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{item.weight.toFixed(2)}%</td>
                          </tr>
                        ))}
                        {groupedRows.length === 0 && (
                          <tr>
                            <td colSpan={12} className="px-6 py-8 text-center text-sm text-gray-500">
                              未找到匹配的持仓
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
