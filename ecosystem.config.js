module.exports = {
  apps: [
    {
      name: "new_market_project",
      cwd: ".",
      script: "pnpm",
      args: "start",
      interpreter: null,
      env: {
        // EmQuant credentials and options
        EMQ_USERNAME: process.env.EMQ_USERNAME || "",
        EMQ_PASSWORD: process.env.EMQ_PASSWORD || "",
        EMQ_OPTIONS_EXTRA: process.env.EMQ_OPTIONS_EXTRA || "LoginType=2",

        // Ensure Python uses the project venv on server
        PYTHON_EXE: process.env.PYTHON_EXE || "/root/new_market_project/.venv/bin/python3",

        // EmQuant native libs path
        LD_LIBRARY_PATH:
          process.env.LD_LIBRARY_PATH || "/root/new_market_project/EMQuantAPI_Python/EMQuantAPI_Python/python3/libs/linux/x64",

        // Next.js runtime settings can be added here as needed
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
        DASHSCOPE_EMBEDDING_MODEL: process.env.DASHSCOPE_EMBEDDING_MODEL || "text-embedding-v3",

        // DeepSeek settings for reasoning model (deepseek-reasoner)
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "",
        DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      },
    },
  ],
}
