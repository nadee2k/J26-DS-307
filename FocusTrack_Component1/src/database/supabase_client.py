from typing import Any

from src.config import PAGE_SIZE, SUPABASE_ANON_KEY, SUPABASE_URL


def get_client():
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError(
            "Set SUPABASE_URL and SUPABASE_ANON_KEY in FocusTrack_Component1/.env"
        )
    from supabase import create_client

    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


def fetch_all_rows(table: str, page_size: int = PAGE_SIZE) -> list[dict[str, Any]]:
    client = get_client()
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        end = start + page_size - 1
        response = client.table(table).select("*").range(start, end).execute()
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return rows
