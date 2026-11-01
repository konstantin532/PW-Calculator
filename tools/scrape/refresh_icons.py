"""Cache public 1.4.6 item images through a fresh, normal browser visit.

Only public icon URLs from cached item HTML/catalogs are read. No existing
browser session, credentials, cookies or storage are read or exported.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from collections import Counter
from html import unescape
from pathlib import Path

from .cache_write import publish_bytes
from .import_cache import _public_icon
from .run import icon_filename

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_SAMPLE = "https://146.comeback.pw/img/ico_items/MjXlk4Hms5XliZEuZGRz.jpg"
ICON_PATTERN = re.compile(r'<div class="box_content_header_wrapper">\s*<img[^>]+src=[\'"]([^\'"]+)')


def collect_urls(pages: Path, data_dir: Path) -> set[str]:
    urls = set()
    for path in pages.glob("*.html"):
        if match := ICON_PATTERN.search(path.read_text(encoding="utf-8")):
            urls.add(unescape(match.group(1)))
    for name in ("catalog_items.json", "catalog_stones.json"):
        path = data_dir / name
        if path.exists():
            for record in json.loads(path.read_text(encoding="utf-8")):
                if url := record.get("source", {}).get("icon_url"):
                    urls.add(url)
    return {url for url in urls if _public_icon(url)}


def valid_image(data: bytes) -> bool:
    return len(data) <= 262144 and (
        data.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF8"))
        or (data.startswith(b"RIFF") and data[8:12] == b"WEBP"))


async def refresh_icons(urls: set[str], icon_dir: Path, seconds: float = 300,
                        workers: int = 4, gap: float = .25) -> dict:
    from playwright.async_api import async_playwright

    icon_dir.mkdir(parents=True, exist_ok=True)
    pending = sorted(url for url in urls if _public_icon(url) and not (icon_dir / icon_filename(url)).exists())
    counts: Counter = Counter({"public_urls": len(urls), "pending": len(pending)})
    deadline = time.monotonic() + max(0, seconds)
    if not pending or time.monotonic() >= deadline:
        return dict(counts)
    lock = asyncio.Lock()
    semaphore = asyncio.Semaphore(max(1, min(4, workers)))
    last_started = 0.0
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        try:
            await page.goto(PUBLIC_SAMPLE, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_function("document.contentType.startsWith('image/')", timeout=30000)
            counts["normal_browser_visits"] += 1
            sample_response = await context.request.get(PUBLIC_SAMPLE, timeout=10000)
            sample_data = await sample_response.body()
            if valid_image(sample_data) and publish_bytes(icon_dir / icon_filename(PUBLIC_SAMPLE), sample_data):
                counts["downloaded"] += 1

            async def one(url: str) -> None:
                nonlocal last_started
                async with semaphore:
                    async with lock:
                        pause = max(0, last_started + max(.2, gap) - time.monotonic())
                        if time.monotonic() + pause >= deadline:
                            counts["budget_exhausted"] += 1
                            return
                        if pause:
                            await asyncio.sleep(pause)
                        last_started = time.monotonic()
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        counts["budget_exhausted"] += 1
                        return
                    try:
                        response = await context.request.get(url, timeout=min(10000, remaining * 1000))
                        # Some public image URLs return an ordinary interstitial
                        # unless navigated to first. Let the browser visit that
                        # public URL normally; do not inspect or replay its code,
                        # tokens or cookies.
                        if "text/html" in response.headers.get("content-type", ""):
                            visit = await context.new_page()
                            try:
                                remaining = deadline - time.monotonic()
                                if remaining <= 0:
                                    counts["budget_exhausted"] += 1
                                    return
                                await visit.goto(url, wait_until="domcontentloaded",
                                                 timeout=min(15000, remaining * 1000))
                                remaining = deadline - time.monotonic()
                                if remaining <= 0:
                                    counts["budget_exhausted"] += 1
                                    return
                                await visit.wait_for_function("document.contentType.startsWith('image/')",
                                                              timeout=min(15000, remaining * 1000))
                                counts["normal_browser_visits"] += 1
                                remaining = deadline - time.monotonic()
                                if remaining <= 0:
                                    counts["budget_exhausted"] += 1
                                    return
                                response = await context.request.get(url, timeout=min(10000, remaining * 1000))
                            finally:
                                await visit.close()
                        if response.status != 200 or not _public_icon(response.url):
                            counts["rejected_response"] += 1
                            return
                        size = response.headers.get("content-length", "")
                        if size.isdigit() and int(size) > 262144:
                            counts["rejected_content"] += 1
                            return
                        data = await response.body()
                        if not valid_image(data):
                            counts["rejected_content"] += 1
                            return
                        target = icon_dir / icon_filename(url)
                        publish_bytes(target, data)
                        counts["downloaded"] += 1
                    except Exception:  # noqa: BLE001
                        counts["failed"] += 1

            for offset in range(0, len(pending), 4):
                await asyncio.gather(*(one(url) for url in pending[offset:offset + 4]))
                if time.monotonic() >= deadline:
                    counts["budget_exhausted"] += len(pending) - offset - len(pending[offset:offset + 4])
                    break
            return dict(counts)
        finally:
            await browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pages", type=Path, default=ROOT / ".cache/pages")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--icon-dir", type=Path, default=ROOT / "static/icons")
    parser.add_argument("--seconds", type=float, default=300)
    args = parser.parse_args()
    result = asyncio.run(refresh_icons(collect_urls(args.pages, args.data_dir), args.icon_dir, args.seconds))
    print(json.dumps(result), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
