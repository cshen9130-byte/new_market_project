export type User = {
  id: string
  name: string
  email: string
  role?: string
}

export type Pool = {
  pool_key: string
  label: string
}

export type TrackFund = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3?: string | null
  manager: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_1y: string | null
}

export type TrackingPage = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  data: TrackFund[]
}

export type SearchProduct = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_one: string | null
  has_nav: boolean | null
}

export type SearchManager = {
  registration_no: string
  manager_name: string
}

export type NavPoint = {
  price_date: string
  nav: string
  cumulative_nav: string
  cum_nav_withdrawal: string
  price_change: string
}

export type FundDetail = {
  partial?: boolean
  info: {
    beian_hao: string
    product_name: string
    short_name?: string | null
    strategy_l1: string | null
    strategy_l2: string | null
    strategy_l3: string | null
    manager: string
    manager_names?: string | null
    inception_date: string | null
    ret_1w: string | null
    ret_1m: string | null
    ret_1y: string | null
    sharpe_1y: string | null
  }
  nav_series: NavPoint[]
  metrics: {
    latest_nav: string | null
    latest_nav_date: string | null
    latest_cum_nav: string | null
    latest_cum_nav_reinvested: string | null
    ret_since_inception: string | null
    ann_ret: string | null
    ytd_ret: string | null
    max_drawdown: string | null
    sharpe_since_inception: string | null
  }
}
