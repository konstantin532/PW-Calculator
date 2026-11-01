"""Fetch a small missing-slot sample, using the existing local session privately.

This command never renews authentication, never enumerates the database, and
never overwrites the independent crawler's JSON files. Default limits: three
list pages, 15 items per slot, 90 seconds for database requests, 8 s per request.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import threading
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

from .catalog import parse_list, section_url
from .fetch import Fetcher
from .import_cache import ROOT, import_cache
from .session import BASE, DB_PREFIX, is_challenge, load_session

TARGETS = {"weapon": ("weapon", "1"), "cape": ("armor", "369"), "wrists": ("armor", "346")}


def supplement_cache(pages: Path, *, limit: int = 15, seconds: float = 90) -> dict:
    limit = max(0, min(limit, 15))
    session = load_session()
    if session is None:
        raise RuntimeError("An existing local Comeback session is required; no authentication was opened.")
    fetcher = Fetcher(session=session, workers=6)
    deadline = time.monotonic() + max(0, seconds)
    counters: Counter[str] = Counter()
    lock = threading.Lock()

    def count(key: str) -> None:
        with lock:
            counters[key] += 1

    def get(path: str) -> str | None:
        url = BASE + path
        cached = pages / (hashlib.sha1(url.encode()).hexdigest() + ".html")
        if cached.exists():
            count("cached_pages_used")
            return cached.read_text(encoding="utf-8")
        if time.monotonic() >= deadline:
            count("budget_exhausted")
            return None
        fetcher._throttle()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            count("budget_exhausted")
            return None
        try:
            count("live_requests")
            request = urllib.request.Request(url, headers=session.headers())
            with urllib.request.urlopen(request, timeout=min(8, remaining)) as response:
                html = response.read(2_000_001)
            if len(html) > 2_000_000:
                count("oversize_pages")
                return None
            text = html.decode("utf-8", "replace")
            if is_challenge(text) or 'id="content-block"' not in text:
                count("challenge_or_invalid_pages")
                return None
            cached.write_text(text, encoding="utf-8")
            count("pages_downloaded")
            return text
        except OSError:
            count("network_failures")
            return None

    rows_by_slot = {}
    list_urls = []
    for slot, (section, sub) in TARGETS.items():
        path = section_url(section, sub)
        list_urls.append(BASE + path)
        html = get(path)
        rows_by_slot[slot] = parse_list(html)[:limit] if html else []
    ids = sorted({row.item_id for rows in rows_by_slot.values() for row in rows})
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda item_id: get(f"{DB_PREFIX}/item/{item_id}"), ids))
    return {"at": datetime.now(UTC).isoformat(), "budget_seconds": seconds,
            "max_items_per_slot": limit, "list_urls": list_urls,
            "listed_by_slot": {slot: len(rows) for slot, rows in rows_by_slot.items()},
            "requested_item_ids": ids, "counts": dict(counters)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=15)
    parser.add_argument("--seconds", type=float, default=90)
    parser.add_argument("--download-icons", action="store_true")
    args = parser.parse_args()
    result = supplement_cache(ROOT / ".cache" / "pages", limit=args.limit, seconds=args.seconds)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    meta = import_cache(ROOT / ".cache" / "pages", ROOT / "data", ROOT / "static" / "icons",
                        download_icons=args.download_icons)
    meta["source"]["method"] = "offline_cache_union_with_bounded_supplement"
    meta["source"]["live_database_requests"] = result["counts"].get("live_requests", 0)
    meta["supplement"] = result
    (ROOT / "data" / "catalog_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
                                                       encoding="utf-8")
    print(json.dumps(meta["coverage"], ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
