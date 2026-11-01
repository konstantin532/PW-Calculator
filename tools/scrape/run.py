"""Запуск сборщика: python -m tools.scrape.run [--limit N] [--sections armor,weapon,...]

Шаги: списки разделов → страницы предметов → data/items.json, data/stones.json,
data/skill_books.json и иконки в static/icons/. Все страницы кэшируются в .cache/,
поэтому прерванный запуск можно просто повторить.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from collections import Counter
from pathlib import Path

from .catalog import EQUIPMENT_SECTIONS, LIST_SECTIONS, ListRow, page_count, parse_list, parse_total, section_url
from .fetch import Fetcher
from .parse import parse_item, parse_stone_effects
from .session import DB_PREFIX

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
ICON_DIR = ROOT / "static" / "icons"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def icon_filename(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16] + Path(url).suffix.lower()


def collect_rows(fetcher: Fetcher, section: str, sub: str, limit: int = 0) -> list[ListRow]:
    first = fetcher.get(section_url(section, sub))
    total = parse_total(first)
    pages = page_count(min(total, limit) if limit else total)
    log(f"  список {section}/{sub}: {total} записей, {pages} стр.")
    rows = parse_list(first)
    for html in fetcher.map(lambda p: fetcher.get(section_url(section, sub, p)), range(2, pages + 1)):
        rows.extend(parse_list(html))
    return rows[:limit] if limit else rows


def fetch_items(fetcher: Fetcher, rows: list[ListRow], section: str) -> list[dict]:
    done = 0

    def one(row: ListRow) -> dict | None:
        nonlocal done
        html = fetcher.get(f"{DB_PREFIX}/item/{row.item_id}")
        try:
            item = parse_item(html, row.item_id)
        except ValueError as exc:
            log(f"  пропуск {row.item_id}: {exc}")
            return None
        item["section"] = section
        item["list_kind"] = row.kind
        done += 1
        if done % 100 == 0:
            log(f"    {section}: {done}/{len(rows)}")
        return item

    return [it for it in fetcher.map(one, rows) if it]


def download_icons(fetcher: Fetcher, urls: set[str]) -> dict[str, str]:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    mapping = {url: icon_filename(url) for url in urls}
    todo = [(url, name) for url, name in mapping.items() if not (ICON_DIR / name).exists()]
    log(f"иконок: {len(urls)}, скачать: {len(todo)}")

    def one(pair: tuple[str, str]) -> None:
        url, name = pair
        req = urllib.request.Request(url, headers=fetcher.session.headers())
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                (ICON_DIR / name).write_bytes(resp.read())
        except Exception as exc:  # noqa: BLE001
            log(f"  иконка не скачалась {url}: {exc}")

    fetcher.map(one, todo)
    return mapping


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="взять не больше N предметов на подраздел (для пробы)")
    ap.add_argument("--sections", default=",".join([*EQUIPMENT_SECTIONS, *LIST_SECTIONS]))
    ap.add_argument("--no-icons", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args(argv)

    fetcher = Fetcher(workers=args.workers)
    items: dict[int, dict] = {}
    stones: dict[int, dict] = {}
    books: dict[int, dict] = {}
    unknown_labels: Counter[str] = Counter()

    for section in args.sections.split(","):
        subs = EQUIPMENT_SECTIONS.get(section) or [LIST_SECTIONS[section]]
        for sub in subs:
            rows = collect_rows(fetcher, section, sub, args.limit)
            for item in fetch_items(fetcher, rows, section):
                unknown_labels.update(item.pop("specs_extra").keys())
                if section == "skills":
                    books[item["id"]] = item
                elif section in ("stones", "jasper"):
                    item["effects"] = parse_stone_effects(item["description"])
                    stones[item["id"]] = item
                else:
                    items[item["id"]] = item
            log(f"  готово {section}/{sub}: {len(rows)} предметов")

    everything = [*items.values(), *stones.values(), *books.values()]
    if not args.no_icons:
        mapping = download_icons(fetcher, {d["icon"] for d in everything if d.get("icon")})
        for d in everything:
            if d.get("icon") in mapping:
                d["icon"] = mapping[d["icon"]]

    DATA_DIR.mkdir(exist_ok=True)
    for name, data in (("items", items), ("stones", stones), ("skill_books", books)):
        if data:
            (DATA_DIR / f"{name}.json").write_text(
                json.dumps(sorted(data.values(), key=lambda d: d["id"]), ensure_ascii=False, indent=1),
                encoding="utf-8",
            )
            log(f"{name}.json: {len(data)}")
    if unknown_labels:
        log("Неизвестные подписи характеристик (в данные не вошли):")
        for label, count in unknown_labels.most_common(40):
            log(f"  {count:5d}  {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
