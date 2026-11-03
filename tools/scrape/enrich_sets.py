"""Recover numeric equipment sets from hash-verified local Comeback 146 pages.

Run ``python -m tools.scrape.enrich_sets`` offline. Only catalog_sets.json is
published; catalog_items.json, stones and the live crawler remain untouched.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
from pathlib import Path

from bs4 import BeautifulSoup, SoupStrainer

from .parse import parse_set_bonus, validate_set_bonus

ROOT = Path(__file__).resolve().parents[2]


def _source(record: dict) -> dict:
    item_id = record.get("id")
    source = record.get("source", {})
    if type(item_id) is not int or item_id <= 0 or not isinstance(source, dict):
        raise ValueError("комплект: неверные данные предмета-источника")
    if source.get("url") != f"https://comeback.pw/db/146/item/{item_id}":
        raise ValueError(f"предмет {item_id}: ожидается точный источник Comeback 146")
    cache = source.get("cache_file")
    if (not isinstance(cache, str) or not cache or Path(cache).name != cache
            or "/" in cache or "\\" in cache or not cache.endswith(".html")):
        raise ValueError(f"предмет {item_id}: недопустимый путь кеша")
    digest = source.get("html_sha256")
    if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
        raise ValueError(f"предмет {item_id}: отсутствует SHA-256 источника")
    return {"item_id": item_id, "url": source["url"], "cache_file": cache, "html_sha256": digest}


def build_set_catalog(items: list[dict], cache_dir: Path) -> dict:
    """Verify every input source, then merge agreeing tables by member IDs."""
    catalog = {}
    seen = set()
    cache_dir = cache_dir.resolve()
    for item in sorted(items, key=lambda record: record["id"]):
        source = _source(item)
        item_id = source["item_id"]
        if item_id in seen:
            raise ValueError(f"предмет {item_id}: повторный ID источника")
        seen.add(item_id)
        path = (cache_dir / source["cache_file"]).resolve()
        if not path.is_relative_to(cache_dir):
            raise ValueError(f"предмет {item_id}: путь вне кеша")
        try:
            raw = path.read_bytes()
        except OSError as error:
            raise ValueError(f"предмет {item_id}: недоступен проверяемый кеш") from error
        if hashlib.sha256(raw).hexdigest() != source["html_sha256"]:
            raise ValueError(f"предмет {item_id}: SHA-256 кеша не совпадает с каталогом")
        if not item.get("set") and b'suits-tab-pane' not in raw:
            continue
        soup = BeautifulSoup(raw, "lxml", parse_only=SoupStrainer(id="suits-tab-pane"))
        pane = soup.select_one("#suits-tab-pane")
        if pane is None:
            raise ValueError(f"предмет {item_id}: комплект без исходной таблицы")
        try:
            descriptor = parse_set_bonus(pane, item_id)
        except ValueError as error:
            raise ValueError(f"предмет {item_id}: {error}") from error
        identity = descriptor["id"]
        if identity not in catalog:
            catalog[identity] = {**descriptor, "sources": []}
        elif {key: catalog[identity][key] for key in descriptor} != descriptor:
            raise ValueError(f"комплект {identity}: противоречивые таблицы у предмета {item_id}")
        catalog[identity]["sources"].append(source)
    result = {"version": 1, "sets": [catalog[key] for key in sorted(catalog)]}
    # Check overlaps and provenance before publishing any bytes.
    set_bonus_index(result, items)
    return result


def set_bonus_index(catalog: dict, items: list[dict]) -> dict[int, dict]:
    """Validate sidecar provenance against the loaded snapshot, never stale data."""
    if not isinstance(catalog, dict) or type(catalog.get("version")) is not int or catalog["version"] != 1:
        raise ValueError("комплект: неподдержанная версия справочника")
    if not isinstance(catalog.get("sets"), list):
        raise ValueError("комплект: отсутствует список справочника")
    records = {item["id"]: item for item in items}
    index, identities = {}, set()
    for entry in catalog["sets"]:
        descriptor = validate_set_bonus(entry)
        identity = descriptor["id"]
        if identity in identities:
            raise ValueError(f"комплект {identity}: повторная запись справочника")
        identities.add(identity)
        sources = entry.get("sources")
        if not isinstance(sources, list) or not sources:
            raise ValueError(f"комплект {identity}: отсутствуют проверенные источники")
        source_ids = set()
        for source in sources:
            if not isinstance(source, dict) or source.get("item_id") not in descriptor["members"]:
                raise ValueError(f"комплект {identity}: неверный источник")
            item_id = source["item_id"]
            if item_id in source_ids or item_id not in records or _source(records[item_id]) != source:
                raise ValueError(f"комплект {identity}: источник не совпадает с текущим снимком")
            source_ids.add(item_id)
        for member in descriptor["members"]:
            if member in index and index[member] != descriptor:
                raise ValueError(f"предмет {member}: противоречивое членство в комплектах")
            index[member] = descriptor
    return index


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--items", type=Path, default=ROOT / "data/catalog_items.json")
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache/pages")
    parser.add_argument("--output", type=Path, default=ROOT / "data/catalog_sets.json")
    args = parser.parse_args()
    items = json.loads(args.items.read_text(encoding="utf-8"))
    result = build_set_catalog(items, args.cache)
    payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Readers see the complete generated snapshot. Re-running is byte-stable.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent,
                                     prefix=".catalog-sets-", suffix=".tmp", delete=False) as temporary:
        temporary.write(payload)
        staged = Path(temporary.name)
    try:
        staged.replace(args.output)
    finally:
        staged.unlink(missing_ok=True)
    print(json.dumps({"verified_items": len(items), "sets": len(result["sets"]),
                      "source_tables": sum(len(entry["sources"]) for entry in result["sets"]),
                      "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
