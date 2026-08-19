require("dotenv").config()
const fs = require("fs")
const path = require("path")

function resolvePythonExe() {
  const candidates = [
    process.env.PYTHON_EXE,
    path.join(__dirname, ".venv/bin/python3"),
    path.join(__dirname, ".venv/bin/python"),
    "/root/new_market_project/.venv/bin/python3",
    "/root/new_market_project/.venv/bin/python",
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      // ignore
    }
  }
  return "python3"
}

const pythonExe = resolvePythonExe()

const sharedEnv = {
  // EmQuant credentials and options
  EMQ_USERNAME: process.env.EMQ_USERNAME || "",
  EMQ_PASSWORD: process.env.EMQ_PASSWORD || "",
  EMQ_OPTIONS_EXTRA: process.env.EMQ_OPTIONS_EXTRA || "LoginType=2",

  // Ensure Python uses the project venv on server
  PYTHON_EXE: pythonExe,

  // Chinese font for FOF weekly report charts (installed by setup-haitai-week-report.sh)
  FOF_REPORT_FONT_PATH:
    process.env.FOF_REPORT_FONT_PATH ||
    "/root/new_market_project/haitai_week_report/fonts/NotoSansSC-Regular.otf",

  // EmQuant native libs path
  LD_LIBRARY_PATH:
    process.env.LD_LIBRARY_PATH ||
    "/root/new_market_project/EMQuantAPI_Python/EMQuantAPI_Python/python3/libs/linux/x64",

  NODE_ENV: process.env.NODE_ENV || "production",

  // Tushare token for Python data fetchers
  TUSHARE_TOKEN: process.env.TUSHARE_TOKEN || "",

  // Ensure client uses same-origin Nginx alias for MOM report in production
  NEXT_PUBLIC_MOM_REPORT_URL: process.env.NEXT_PUBLIC_MOM_REPORT_URL || "/mom_report/report.html",

  // Shared external storage root for auth and future persistent data
  MARKET_DASHBOARD_STORAGE_DIR:
    process.env.MARKET_DASHBOARD_STORAGE_DIR || "/root/market_dashboard_storage",

  // AI knowledge base external storage and DashScope settings
  AI_KB_STORAGE_DIR:
    process.env.AI_KB_STORAGE_DIR || "/root/market_dashboard_storage/ai-knowledge-base",
  DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY || "",
  DASHSCOPE_BASE_URL:
    process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
  DASHSCOPE_CHAT_MODEL: process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus",
  DASHSCOPE_EMBEDDING_MODEL: "text-embedding-v4",
  DASHSCOPE_VISION_MODEL: process.env.DASHSCOPE_VISION_MODEL || "qwen-vl-plus",

  // DeepSeek API key for AI 助手 text chat
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "",

  // PostgreSQL connection string (set by setup_db.sh → .env)
  DATABASE_URL: process.env.DATABASE_URL || "",

  // SimNow CTP sidecar (services/ctp_market, bound to loopback)
  // 30011 = 仿真（交易时段）；盘后 sidecar 自动切到 40011 7x24
  CTP_MARKET_URL: process.env.CTP_MARKET_URL || "http://127.0.0.1:8000",
  CTP_PROFILE: process.env.CTP_PROFILE || "simnow",
  CTP_BROKER_ID: process.env.CTP_BROKER_ID || "9999",
  CTP_USER_ID: process.env.CTP_USER_ID || "",
  CTP_PASSWORD: process.env.CTP_PASSWORD || "",
  CTP_INSTRUMENTS:
    process.env.CTP_INSTRUMENTS ||
    "IM2609,IM2608,IF2609,IF2608,IH2609,IH2608,IC2609,IC2608",
  SIMNOW_MD_FRONT: process.env.SIMNOW_MD_FRONT || "tcp://182.254.243.31:30011",
  CHART_HOST: process.env.CHART_HOST || "127.0.0.1",
  CHART_PORT: process.env.CHART_PORT || "8000",
}

// Prefer clustering next binary directly — clustering `pnpm start` only forks the
// pnpm wrapper, not next-server. 2 instances fit a 4-vCPU box with headroom for
// Postgres + the background worker.
const webInstances = Math.max(1, parseInt(process.env.WEB_INSTANCES || "2", 10) || 2)

module.exports = {
  apps: [
    {
      name: "new_market_project",
      cwd: ".",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      interpreter: "node",
      instances: webInstances,
      exec_mode: webInstances > 1 ? "cluster" : "fork",
      // Each Next worker can grow under list traffic; restart before OOM on 8G host.
      max_memory_restart: process.env.WEB_MAX_MEMORY || "1400M",
      env: {
        ...sharedEnv,
        // Crons run in new_market_project_worker so next-server stays responsive.
        RUN_BACKGROUND_JOBS: "0",
        // Prefer web traffic for DB connections when the worker is busy.
        // Split across cluster workers (each opens its own pool).
        DB_POOL_MAX: process.env.DB_POOL_MAX_WEB || "8",
      },
    },
    {
      name: "new_market_project_worker",
      cwd: ".",
      script: "pnpm",
      args: "worker:start",
      interpreter: null,
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: process.env.WORKER_MAX_MEMORY || "1500M",
      env: {
        ...sharedEnv,
        RUN_BACKGROUND_JOBS: "1",
        // Cap worker DB fan-out so FOF/cache rebuilds cannot exhaust Postgres
        // and leave 在管产品 list waiting on "timeout exceeded when trying to connect".
        DB_POOL_MAX: process.env.DB_POOL_MAX_WORKER || "4",
        DB_STATEMENT_TIMEOUT: process.env.DB_STATEMENT_TIMEOUT_WORKER || "120000",
      },
    },
    {
      name: "ctp_market",
      cwd: path.join(__dirname, "services/ctp_market"),
      script: path.join(__dirname, "services/ctp_market/run.sh"),
      interpreter: "bash",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        ...sharedEnv,
        LANG: "C",
        LC_ALL: "C",
        LC_CTYPE: "C",
        PYTHONUNBUFFERED: "1",
      },
    },
  ],
}
