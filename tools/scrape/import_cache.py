"""Recover a reproducible Comeback 1.4.6 catalog without opening a login session.

Run ``python -m tools.scrape.import_cache`` for an offline snapshot. Optional
``--download-icons`` fetches only bounded, public item icons, never database pages.
The live crawler's items.json/stones.json are read but never overwritten.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from .catalog import parse_list
from .parse import parse_item, parse_stone_effects
from .run import icon_filename

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://comeback.pw/db/146"
VERSION = "Comeback PW 1.4.6"
VERIFICATION = "unverified_for_comeback"
ITEM_ID = re.compile(r"/cats/146/\?item_id=(\d+)")
SLOTS = {
    "голова": "helmet", "головные уборы": "helmet", "головной убор": "helmet", "шлем": "helmet", "шлемы": "helmet",
    "ожерелье": "necklace", "накидка": "cape", "плащ": "cape", "верх": "chest",
    "наручи": "wrists", "пояс": "belt", "низ": "legs", "обувь": "boots", "кольцо": "ring",
    "боеприпасы": "ammo", "боеприпас": "ammo", "стрелы": "ammo", "книга": "tome",
    "небесный трактат": "tome", "полёт": "flight", "полет": "flight",
}
SECTIONS = {"Броня": "armor", "Оружие": "weapon", "Бижутерия": "decoration",
            "Магические камни": "stones", "Яшма": "jasper"}


def infer_slot(item: dict) -> str | None:
    """Only classify established item types; unknown equipment stays unassigned."""
    if item.get("section") == "weapon":
        return "weapon"
    for label in [item.get("type", ""), *item.get("breadcrumb", [])]:
        if slot := SLOTS.get(label.lower()):
            return slot
    return None


def merge_records(old: dict, new: dict) -> dict:
    """Keep useful prior detail when a cached page yields an empty/sparse field."""
    result = {str(key): value for key, value in old.items()}
    for key, value in new.items():
        key = str(key)
        if value is None or value == "" or value == [] or value == {}:
            continue
        previous = result.get(key)
        if isinstance(value, dict):
            result[key] = merge_records(previous if isinstance(previous, dict) else {}, value)
        elif key == "levels" and isinstance(value, list) and isinstance(previous, list) and len(value) == len(previous):
            result[key] = [fresh if fresh is not None else prior for prior, fresh in zip(previous, value, strict=True)]
        elif isinstance(value, list) and isinstance(previous, list) and len(value) < len(previous):
            continue
        else:
            result[key] = value
    return result


def _load(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def write_records(path: Path, records: list[dict]) -> None:
    """One complete record per line keeps generated catalog changes reviewable."""
    lines = (json.dumps(record, ensure_ascii=False, separators=(",", ":"))
             for record in sorted(records, key=lambda x: x["id"]))
    path.write_text("[\n" + ",\n".join(lines) + "\n]\n", encoding="utf-8")


def _public_icon(url: str) -> bool:
    parsed = urlsplit(url)
    return (parsed.scheme == "https" and parsed.netloc == "146.comeback.pw"
            and parsed.path.startswith("/img/ico_items/")
            and Path(parsed.path).suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp"})


def _download_icons(urls: set[str], icon_dir: Path, seconds: float, workers: int) -> dict:
    """Public image requests have a shared time budget and strict byte/type limits."""
    icon_dir.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + max(0, seconds)
    pending = sorted(url for url in urls if _public_icon(url) and not (icon_dir / icon_filename(url)).exists())

    def one(url: str) -> str:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return "budget_exhausted"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "PWCalc-local-icon-import/1.0"})
            with urllib.request.urlopen(req, timeout=min(6, remaining)) as response:
                if not _public_icon(response.url):
                    return "rejected_redirect"
                data = response.read(262145)
            valid = data.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF8"))
            valid = valid or (data.startswith(b"RIFF") and data[8:12] == b"WEBP")
            if not valid or len(data) > 262144:
                return "rejected_content"
            (icon_dir / icon_filename(url)).write_bytes(data)
            return "downloaded"
        except (OSError, ValueError):
            return "failed"

    with ThreadPoolExecutor(max_workers=max(1, min(workers, 8))) as pool:
        return dict(Counter(pool.map(one, pending)))


def import_cache(pages: Path, data_dir: Path, icon_dir: Path, *, download_icons: bool = False,
                 icon_seconds: float = 60, icon_workers: int = 6) -> dict:
    snapshot_at = datetime.now(UTC).isoformat()
    paths = sorted(pages.glob("*.html"))  # Fixed inventory while the independent crawler continues.
    items: dict[int, dict] = {}
    stones: dict[int, dict] = {}
    for filename, target in (("items.json", items), ("catalog_items.json", items),
                             ("stones.json", stones), ("catalog_stones.json", stones)):
        for record in _load(data_dir / filename):
            target[record["id"]] = merge_records(target.get(record["id"], {}), record)
    prior_count = len(items) + len(stones)
    cached_ids: set[int] = set()
    listing_ids: set[int] = set()
    skipped: Counter[str] = Counter()
    listing_pages = 0
    for path in paths:
        html = path.read_text(encoding="utf-8")
        match = ITEM_ID.search(html)
        if match is None:
            rows = parse_list(html)
            if rows:
                listing_pages += 1
                listing_ids.update(row.item_id for row in rows)
            else:
                skipped["not_an_equipment_item_or_list"] += 1
            continue
        item_id = int(match.group(1))
        url = f"{BASE}/item/{item_id}"
        if path.stem != hashlib.sha1(url.encode()).hexdigest():
            skipped["identity_cache_hash_mismatch"] += 1
            continue
        try:
            record = parse_item(html, item_id)
        except ValueError:
            skipped["invalid_item_page"] += 1
            continue
        section = next((SECTIONS[label] for label in record["breadcrumb"] if label in SECTIONS), None)
        if section is None:
            skipped["unsupported_item_section"] += 1
            continue
        record["section"] = section
        record["source"] = {"url": url, "cache_file": path.name, "version": VERSION,
                            "html_sha256": hashlib.sha256(html.encode()).hexdigest()}
        target = stones if section in {"stones", "jasper"} else items
        if target is stones:
            record["effects"] = parse_stone_effects(record["description"])
        target[item_id] = merge_records(target.get(item_id, {}), record)
        cached_ids.add(item_id)

    all_records = [*items.values(), *stones.values()]
    urls = set()
    for record in all_records:
        source = record.setdefault("source", {"url": f"{BASE}/item/{record['id']}", "version": VERSION,
                                               "origin": "prior_catalog"})
        icon = record.get("icon") or source.get("icon_url")
        if icon and icon.startswith("http"):
            source["icon_url"] = icon
            urls.add(icon)
        if slot := infer_slot(record):
            record["slot"] = slot
        if record["id"] in stones:
            record["effects"] = merge_records(record.get("effects", {}),
                                               parse_stone_effects(record.get("description", [])))
    downloads = _download_icons(urls, icon_dir, icon_seconds, icon_workers) if download_icons else {}
    for record in all_records:
        icon_url = record["source"].get("icon_url")
        filename = icon_filename(icon_url) if icon_url else record.get("icon")
        record["icon"] = filename if filename and (icon_dir / filename).is_file() else None

    labels: Counter[str] = Counter()
    for record in all_records:
        labels.update(record.get("specs_extra", {}).keys())
    unparsed = [record["id"] for record in stones.values()
                if not record.get("effects") or any(effect.get("value") is None
                                                    for effect in record["effects"].values())]
    coverage = {
        "items": len(items), "stones": len(stones), "cached_pages": len(paths),
        "cached_item_pages": len(cached_ids), "cached_listing_pages": listing_pages,
        "listed_item_ids": len(listing_ids), "listed_items_with_cached_pages": len(listing_ids & cached_ids),
        "prior_records": prior_count, "by_section": dict(Counter(x["section"] for x in all_records)),
        "by_slot": dict(Counter(x.get("slot", "unassigned") for x in items.values())),
        "icons_available": sum(bool(x["icon"]) for x in all_records),
        "icons_missing": sum(not x["icon"] for x in all_records),
        "complete": False,
    }
    meta = {
        "version": VERSION, "verification": VERIFICATION, "snapshot_at": snapshot_at,
        "source": {"database": BASE, "method": "offline_cache_union", "live_database_requests": 0},
        "coverage": coverage, "skipped_pages": dict(skipped), "icon_downloads": downloads,
        "limitations": {
            "catalog": "Snapshot of locally cached pages and prior catalogs; not the complete server database.",
            "engine_support": "not_assessed_by_importer",
            "unrecognized_spec_labels": dict(labels),
            "raw_addon_entries": sum(len(x.get("addons", {}).get(kind, []))
                                     for x in all_records for kind in ("options", "unique")),
            "stones_with_unparsed_effects": unparsed,
            "ambiguous_attack_speed_items": [x["id"] for x in items.values()
                                              if isinstance(x.get("stats", {}).get("atk_speed"), (int, float))
                                              and x["stats"]["atk_speed"] > 5],
        },
    }
    data_dir.mkdir(parents=True, exist_ok=True)
    for filename, records in (("catalog_items.json", items), ("catalog_stones.json", stones)):
        write_records(data_dir / filename, list(records.values()))
    (data_dir / "catalog_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return meta


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pages", type=Path, default=ROOT / ".cache" / "pages")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--icon-dir", type=Path, default=ROOT / "static" / "icons")
    parser.add_argument("--download-icons", action="store_true")
    parser.add_argument("--icon-seconds", type=float, default=60)
    parser.add_argument("--icon-workers", type=int, default=6)
    args = parser.parse_args()
    meta = import_cache(args.pages, args.data_dir, args.icon_dir, download_icons=args.download_icons,
                        icon_seconds=args.icon_seconds, icon_workers=args.icon_workers)
    print(json.dumps(meta["coverage"], ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
