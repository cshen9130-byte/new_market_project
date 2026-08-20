#!/usr/bin/env bash
# =============================================================
# setup_db.sh — One-time PostgreSQL setup for market dashboard
#
# Run on the Linux server (Ubuntu/Debian) as root or a sudo user:
#   sudo bash scripts/db/setup_db.sh
#
# What it does:
#   1. Optionally installs PostgreSQL if not present
#   2. Creates the database user and database
#   3. Applies schema.sql
#   4. Installs psycopg2-binary into the Python env used by the project
#   5. Sets up daily cron jobs:
#      - 01:00 AM run nightly_etl.py
#      - 07:30 PM run mom_data_etl.py
#   6. Prints the DATABASE_URL to add to .env
#
# Customise the four variables below before running.
# =============================================================

set -e

# ---- Configuration  --------------------------------------------------
DB_NAME="${DB_NAME:-market_data}"
DB_USER="${DB_USER:-market_user}"
DB_PASS="${DB_PASS:-CHANGE_ME_STRONG_PASSWORD}"
DB_PORT="${DB_PORT:-5432}"

# Absolute path to this project on the server
PROJECT_ROOT="${PROJECT_ROOT:-/root/new_market_project}"

# Prefer project venv (has joblib/sklearn for PCA predict steps)
if [[ -z "${PYTHON_EXE:-}" ]]; then
  if [[ -x "$PROJECT_ROOT/.venv/bin/python3" ]]; then
    PYTHON_EXE="$PROJECT_ROOT/.venv/bin/python3"
  elif [[ -x "$PROJECT_ROOT/.venv/bin/python" ]]; then
    PYTHON_EXE="$PROJECT_ROOT/.venv/bin/python"
  else
    PYTHON_EXE="python3"
  fi
fi

# Cron job time (hour minute in server local time)
CRON_HOUR="${CRON_HOUR:-1}"
CRON_MIN="${CRON_MIN:-0}"

# MOM data ETL cron time (hour minute in server local time)
MOM_CRON_HOUR="${MOM_CRON_HOUR:-19}"
MOM_CRON_MIN="${MOM_CRON_MIN:-30}"

# Log file for nightly ETL
ETL_LOG="${ETL_LOG:-/var/log/market_etl.log}"
# Log file for MOM data ETL
MOM_ETL_LOG="${MOM_ETL_LOG:-/var/log/mom_data_etl.log}"
# -----------------------------------------------------------------------

SCHEMA_FILE="$PROJECT_ROOT/scripts/db/schema.sql"
ETL_SCRIPT="$PROJECT_ROOT/scripts/ma/nightly_etl.py"
MOM_ETL_SCRIPT="$PROJECT_ROOT/scripts/ma/mom_data_etl.py"

# ---- 1. Install PostgreSQL if missing ---------------------------------
if ! command -v psql &>/dev/null; then
  echo "[setup_db] PostgreSQL not found. Installing …"
  apt-get update -qq
  apt-get install -y postgresql postgresql-contrib
  systemctl enable postgresql
  systemctl start postgresql
  echo "[setup_db] PostgreSQL installed and started."
else
  echo "[setup_db] PostgreSQL already installed ($(psql --version | head -1))."
fi

# ---- 2. Create DB user -------------------------------------------------
echo "[setup_db] Creating database user: $DB_USER"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  && echo "[setup_db]   User $DB_USER already exists, skipping." \
  || sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"

# ---- 3. Create database ------------------------------------------------
echo "[setup_db] Creating database: $DB_NAME"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  && echo "[setup_db]   Database $DB_NAME already exists, skipping." \
  || sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

# ---- 4. Apply schema ---------------------------------------------------
echo "[setup_db] Applying schema from $SCHEMA_FILE …"
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$SCHEMA_FILE"
echo "[setup_db] Schema applied."

# Grant privileges so the app user can create future tables if schema is re-run
sudo -u postgres psql -d "$DB_NAME" \
  -c "GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO $DB_USER;" \
  -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;" \
  -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO $DB_USER;" \
  -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;"

# ---- 5. Install Python deps into project Python env ----------------------
echo "[setup_db] Installing Python deps for nightly ETL …"
REQ_FILE="$PROJECT_ROOT/scripts/ma/requirements.txt"
if [[ -f "$REQ_FILE" ]]; then
  $PYTHON_EXE -m pip install --quiet -r "$REQ_FILE"
else
  $PYTHON_EXE -m pip install --quiet psycopg2-binary joblib scikit-learn pandas numpy
fi
echo "[setup_db]   Python deps installed via $PYTHON_EXE."

# Persist PYTHON_EXE so nightly_etl child scripts use the same interpreter
ENV_FILE="$PROJECT_ROOT/.env"
if grep -q "^PYTHON_EXE=" "$ENV_FILE" 2>/dev/null; then
  echo "[setup_db] PYTHON_EXE already in $ENV_FILE, skipping."
else
  echo "" >> "$ENV_FILE"
  echo "PYTHON_EXE=$PYTHON_EXE" >> "$ENV_FILE"
  echo "[setup_db] PYTHON_EXE written to $ENV_FILE."
fi

# ---- 6. Add DATABASE_URL to the project .env if not already present ---
DB_URL="postgresql://$DB_USER:$DB_PASS@localhost:$DB_PORT/$DB_NAME"
if grep -q "DATABASE_URL" "$ENV_FILE" 2>/dev/null; then
  echo "[setup_db] DATABASE_URL already in $ENV_FILE, skipping."
else
  echo "" >> "$ENV_FILE"
  echo "# PostgreSQL connection (nightly ETL pipeline)" >> "$ENV_FILE"
  echo "DATABASE_URL=$DB_URL" >> "$ENV_FILE"
  echo "[setup_db] DATABASE_URL written to $ENV_FILE."
fi

# ---- 7. Create ETL log file -------------------------------------------
touch "$ETL_LOG"
chmod 644 "$ETL_LOG"
echo "[setup_db] Log file: $ETL_LOG"

touch "$MOM_ETL_LOG"
chmod 644 "$MOM_ETL_LOG"
echo "[setup_db] Log file: $MOM_ETL_LOG"

# ---- 8. Set up cron job -----------------------------------------------
# Launchers resolve python themselves (venv if present, else python3) and
# always source Choice/EmQuant env. Do not pin cron at .venv/bin/python3 —
# a missing venv previously froze 期货/期权 charts for days.
NIGHTLY_LAUNCHER="$PROJECT_ROOT/scripts/ma/run_nightly_etl.sh"
MOM_LAUNCHER="$PROJECT_ROOT/scripts/ma/run_mom_data_etl.sh"
FUTURES_LOG="${FUTURES_ETL_LOG:-/var/log/market_futures_etl.log}"
chmod +x "$NIGHTLY_LAUNCHER" "$MOM_LAUNCHER" 2>/dev/null || true
touch "$FUTURES_LOG"
chmod 644 "$FUTURES_LOG"

# Invoke via /bin/bash so a missing execute bit (git 100644 after Windows
# deploy) cannot silently kill the 01:00 job with "Permission denied".
CRON_CMD="$CRON_MIN $CRON_HOUR * * * /bin/bash $NIGHTLY_LAUNCHER >> $ETL_LOG 2>&1"
MOM_CRON_CMD="$MOM_CRON_MIN $MOM_CRON_HOUR * * * /bin/bash $MOM_LAUNCHER >> $MOM_ETL_LOG 2>&1"
FUTURES_CRON_CMD="15 3 * * * /bin/bash $NIGHTLY_LAUNCHER --group futures >> $FUTURES_LOG 2>&1"
AMAC_LOG="${AMAC_ETL_LOG:-/var/log/market_amac_etl.log}"
touch "$AMAC_LOG"
chmod 644 "$AMAC_LOG"
AMAC_CRON_CMD="45 4 * * * /bin/bash $NIGHTLY_LAUNCHER --group amac >> $AMAC_LOG 2>&1"

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" \
  | grep -vF "run_nightly_etl.sh" \
  | grep -vF "run_mom_data_etl.sh" \
  | grep -vF "scripts/ma/nightly_etl.py" \
  | grep -vF "scripts/ma/mom_data_etl.py" \
  || true)"
{
  printf '%s\n' "$FILTERED"
  printf '%s\n' "$CRON_CMD"
  printf '%s\n' "$FUTURES_CRON_CMD"
  printf '%s\n' "$AMAC_CRON_CMD"
  printf '%s\n' "$MOM_CRON_CMD"
} | crontab -
echo "[setup_db] Cron job set: $CRON_CMD"
echo "[setup_db] Futures/options cron job set: $FUTURES_CRON_CMD"
echo "[setup_db] AMAC fund-list cron job set: $AMAC_CRON_CMD"
echo "[setup_db] MOM cron job set: $MOM_CRON_CMD"

# ---- Summary -----------------------------------------------------------
echo ""
echo "============================================================="
echo " Setup complete."
echo "============================================================="
echo ""
echo " Database : $DB_NAME"
echo " User     : $DB_USER"
echo " Port     : $DB_PORT"
echo " Cron     : daily at ${CRON_HOUR}:$(printf '%02d' $CRON_MIN) -> /bin/bash $NIGHTLY_LAUNCHER"
echo " Cron     : daily at 03:15 -> /bin/bash $NIGHTLY_LAUNCHER --group futures"
echo " Cron     : daily at 04:45 -> /bin/bash $NIGHTLY_LAUNCHER --group amac"
echo " Cron     : daily at ${MOM_CRON_HOUR}:$(printf '%02d' $MOM_CRON_MIN) -> /bin/bash $MOM_LAUNCHER"
echo " Log      : $ETL_LOG"
echo " Log      : $FUTURES_LOG"
echo " Log      : $MOM_ETL_LOG"
echo ""
echo " Make sure these are set in $PROJECT_ROOT/.env (or .env.local):"
echo ""
echo "   DATABASE_URL=$DB_URL"
echo ""
echo " You can run the ETL manually to test or force an initial load:"
echo "   cd $PROJECT_ROOT && $PYTHON_EXE $ETL_SCRIPT"
echo "   cd $PROJECT_ROOT && $PYTHON_EXE $MOM_ETL_SCRIPT"
echo ""
echo " To watch the nightly log:"
echo "   tail -f $ETL_LOG"
echo "   tail -f $MOM_ETL_LOG"
echo "============================================================="
