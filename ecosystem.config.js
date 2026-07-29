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

module.exports = {
  apps: [
    {
      name: "new_market_project",
      cwd: ".",
      script: "pnpm",
      args: "start",
      interpreter: null,
      env: {
        ...sharedEnv,
        // Crons run in new_market_project_worker so next-server stays responsive.
        RUN_BACKGROUND_JOBS: "0",
        // Prefer web traffic for DB connections when the worker is busy.
        DB_POOL_MAX: process.env.DB_POOL_MAX_WEB || "12",
      },
    },
    {
      name: "new_market_project_worker",
      cwd: ".",
      script: "pnpm",
      args: "worker:start",
      interpreter: null,
      // Keep worker below interactive next-server on the shared 2-vCPU host.
      max_memory_restart: "900M",
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
