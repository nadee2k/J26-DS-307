import time
from collections.abc import Callable
from typing import Any

from src.config import PAGE_SIZE, SUPABASE_ANON_KEY, SUPABASE_URL

MAX_ATTEMPTS = 5
BACKOFF_SECONDS = 1.5


def _is_retryable(exc: BaseException) -> bool:
    """Transient network faults (dropped TLS, resets, timeouts) are worth retrying."""
    if isinstance(exc, (ConnectionError, TimeoutError, OSError)):
        return True
    try:
        import httpx
    except ImportError:  # pragma: no cover - supabase always ships httpx
        return False
    return isinstance(exc, httpx.HTTPError)


def _with_retries[T](fn: Callable[[], T], attempts: int = MAX_ATTEMPTS) -> T:
    last: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:
            last = exc
            if attempt == attempts or not _is_retryable(exc):
                raise
            time.sleep(BACKOFF_SECONDS * attempt)
    raise last  # pragma: no cover - the loop always returns or raises


def get_client():
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError(
            "Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) "
            "in FocusTrack_Component1/.env"
        )
    from supabase import create_client

    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


def fetch_all_rows(table: str, page_size: int = PAGE_SIZE) -> list[dict[str, Any]]:
    client = get_client()
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        end = start + page_size - 1
        response = _with_retries(
            lambda: client.table(table).select("*").range(start, end).execute()
        )
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return rows
