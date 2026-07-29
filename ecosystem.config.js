require("dotenv").config()

const sharedEnv = {
  // EmQuant credentials and options
  EMQ_USERNAME: process.env.EMQ_USERNAME || "",
  EMQ_PASSWORD: process.env.EMQ_PASSWORD || "",
  EMQ_OPTIONS_EXTRA: process.env.EMQ_OPTIONS_EXTRA || "LoginType=2",

  // Ensure Python uses the project venv on server
  PYTHON_EXE: process.env.PYTHON_EXE || "/root/new_market_project/.venv/bin/python3",

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
  ],
}
