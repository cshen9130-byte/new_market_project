"""Session-level advisory locks so overlapping AMAC nightly jobs do not deadlock."""

from __future__ import annotations

import time

# Session-level keys (survive COMMIT). Keep stable across deploys.
AMAC_LIST_LOCK_KEY = 88274601
AMAC_EXTRA_LOCK_KEY = 88274602


def acquire_advisory_lock(conn, key: int) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_lock(%s)", (key,))


def release_advisory_lock(conn, key: int) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_unlock(%s)", (key,))


def execute_values_retry(cur, sql: str, rows: list, *, page_size: int = 1000, attempts: int = 5) -> None:
    """Retry execute_values after DeadlockDetected (concurrent AMAC crons)."""
    from psycopg2 import errors as pg_errors
    from psycopg2.extras import execute_values

    delay = 0.4
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            execute_values(cur, sql, rows, page_size=page_size)
            return
        except pg_errors.DeadlockDetected as exc:
            last_exc = exc
            cur.connection.rollback()
            if attempt >= attempts:
                break
            print(f"  deadlock on upsert, retry {attempt}/{attempts} after {delay:.1f}s")
            time.sleep(delay)
            delay *= 2
    raise last_exc  # type: ignore[misc]
