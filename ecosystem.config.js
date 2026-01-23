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
          process.env.LD_LIBRARY_PATH || "/root/new_market_project/EMQuantAPI_Python/EMQuantAPI_Python/python3/libs",

        // Next.js runtime settings can be added here as needed
        NODE_ENV: process.env.NODE_ENV || "production",
      },
    },
  ],
}
