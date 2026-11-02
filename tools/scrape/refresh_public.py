"""Expand the local public-page cache without reading an existing session.

The browser visits the public database normally. No cookies, credentials or
browser storage are exported. Page HTML is cached with the same URL hashes as
the independent crawler; its running process and JSON outputs are untouched.
The default covers combat equipment, stones and tomes. The large flight-model
catalog is available explicitly with ``--categories flight``.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

from .cache_write import publish_text
from .catalog import EQUIPMENT_SECTIONS, page_count, parse_list, parse_total

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://comeback.pw/db/146"
TARGETS = {
    "heavy_chest": "/armor/125/127",
    "magical_weapon": "/weapon/292/0",
    "ranged_weapon": "/weapon/13/0",
    "stones": "/stones/all",
    "jasper": "/jasper/all",
    **{f"armor_{key}": f"/armor/{key}/0" for key in EQUIPMENT_SECTIONS["armor"]},
    **{f"weapon_{key}": f"/weapon/{key}/0" for key in EQUIPMENT_SECTIONS["weapon"]},
    **{f"decoration_{key}": f"/decoration/{key}/0" for key in EQUIPMENT_SECTIONS["decoration"]},
    "ammunition": "/ammunition/all",
    **{f"tome_{level}": f"/bible/lvl_{level}" for level in range(1, 10)},
    "flight": "/fly/all",
}


def public_url(path: str) -> str:
    url = BASE + path
    parsed = urlsplit(url)
    if (not path.startswith("/") or any(part in {".", ".."} for part in parsed.path.split("/"))
            or parsed.scheme != "https" or parsed.netloc != "comeback.pw"
            or not parsed.path.startswith("/db/146/")):
        raise ValueError("Only public Comeback 1.4.6 database pages are supported")
    return url


def cache_path(pages: Path, url: str) -> Path:
    return pages / (hashlib.sha1(url.encode()).hexdigest() + ".html")


class BudgetExpired(Exception):
    pass


async def refresh(*, pages: Path, manifest: Path, categories: list[str], seconds: float,
                  workers: int = 4, gap: float = .5, lists_only: bool = False) -> dict:
    from playwright.async_api import async_playwright

    pages.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    deadline = start + max(0, seconds)
    counts: Counter = Counter()
    categories_data: dict = {}
    errors: list[dict] = []
    lock = asyncio.Lock()
    semaphore = asyncio.Semaphore(max(1, min(4, workers)))
    last_started = 0.0

    def save_progress() -> dict:
        result = {"source": BASE, "method": "normal_public_browser_no_session_export",
                  "elapsed_seconds": round(time.monotonic() - start, 1),
                  "budget_seconds": seconds, "lists_only": lists_only,
                  "counts": dict(counts), "categories": categories_data, "errors": errors}
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return result

    if time.monotonic() >= deadline:
        return save_progress()
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(locale="ru-RU")
        page = await context.new_page()
        try:
            counts["browser_visits"] += 1
            counts["live_requests"] += 1
            await page.goto(public_url("/item/33533"), wait_until="domcontentloaded", timeout=45000)
            await page.wait_for_selector("#content-block", timeout=30000)
            initial = await page.content()
            initial_cache = cache_path(pages, public_url("/item/33533"))
            if publish_text(initial_cache, initial):
                counts["downloaded_pages"] += 1

            async def get(url: str) -> str:
                nonlocal last_started
                target = cache_path(pages, url)
                if target.exists():
                    counts["cached_pages_used"] += 1
                    return target.read_text(encoding="utf-8")
                async with semaphore:
                    async with lock:
                        pause = max(0, last_started + gap - time.monotonic())
                        if time.monotonic() + pause >= deadline:
                            raise BudgetExpired
                        if pause:
                            await asyncio.sleep(pause)
                        last_started = time.monotonic()
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise BudgetExpired
                    counts["live_requests"] += 1
                    response = await context.request.get(url, timeout=min(30000, remaining * 1000))
                    if response.status != 200:
                        raise ValueError(f"HTTP {response.status}")
                    if not response.url.startswith(BASE + "/"):
                        raise ValueError("Unexpected public-page redirect")
                    html = await response.text()
                    if 'id="content-block"' not in html and "id='content-block'" not in html:
                        raise ValueError("Public database content unavailable; challenge or error page")
                    # Do not replace a page concurrently supplied by the crawler.
                    publish_text(target, html)
                    counts["downloaded_pages"] += 1
                    if counts["downloaded_pages"] % 50 == 0:
                        print(f"cached +{counts['downloaded_pages']} public pages", flush=True)
                        save_progress()
                    return html

            async def safe_get(url: str) -> str | None:
                try:
                    return await get(url)
                except BudgetExpired:
                    counts["budget_skipped"] += 1
                except Exception as error:  # noqa: BLE001
                    counts["failed_requests"] += 1
                    errors.append({"url": url, "reason": str(error).split("\n")[0][:200]})
                return None

            for category in categories:
                path = TARGETS[category]
                first = await safe_get(public_url(path))
                if not first:
                    if time.monotonic() >= deadline:
                        break
                    continue
                total = parse_total(first)
                count = page_count(total)
                rows = parse_list(first)
                for offset in range(2, count + 1, max(1, workers)):
                    batch = await asyncio.gather(*[
                        safe_get(public_url(f"{path}?page={number}"))
                        for number in range(offset, min(count + 1, offset + workers))
                    ])
                    for html in batch:
                        if html:
                            rows.extend(parse_list(html))
                    if time.monotonic() >= deadline:
                        break
                ids = list(dict.fromkeys(row.item_id for row in rows))
                categories_data[category] = {"url": public_url(path), "expected_rows": total,
                                             "listed_ids": ids, "listed_count": len(ids)}
                print(f"{category}: {len(ids)}/{total} listing records", flush=True)
                if not lists_only:
                    for offset in range(0, len(ids), max(1, workers)):
                        await asyncio.gather(*[
                            safe_get(public_url(f"/item/{item_id}"))
                            for item_id in ids[offset:offset + workers]
                        ])
                        if time.monotonic() >= deadline:
                            break
                have = sum(cache_path(pages, public_url(f"/item/{item_id}")).exists() for item_id in ids)
                categories_data[category]["cached_item_pages"] = have
                save_progress()
                if time.monotonic() >= deadline:
                    break
            return save_progress()
        finally:
            await browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pages", type=Path, default=ROOT / ".cache/pages")
    parser.add_argument("--manifest", type=Path, default=ROOT / ".cache/catalog-refresh-progress.json")
    parser.add_argument("--categories", default=",".join(key for key in TARGETS if key != "flight"))
    parser.add_argument("--seconds", type=float, default=1800)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--gap", type=float, default=.5)
    parser.add_argument("--lists-only", action="store_true")
    args = parser.parse_args()
    categories = args.categories.split(",")
    unknown = set(categories) - TARGETS.keys()
    if unknown:
        parser.error(f"Unknown categories: {', '.join(sorted(unknown))}")
    result = asyncio.run(refresh(pages=args.pages, manifest=args.manifest, categories=categories,
                                 seconds=args.seconds, workers=args.workers, gap=max(.4, args.gap),
                                 lists_only=args.lists_only))
    print(json.dumps({"counts": result["counts"], "elapsed_seconds": result["elapsed_seconds"]}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
