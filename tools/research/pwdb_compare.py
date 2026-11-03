"""Compare selected client-whitelisted IDs with public PWDB item cards.

Network is opt-in. The anonymous bootstrap is the same empty POST performed
by PWDB's public SPA; its cookies remain only in memory. No account is used,
and no response headers, tokens or cookies are written to the cache/report.
This script never modifies runtime catalogues or the game client.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import UTC, datetime
from html import escape
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache" / "pwdatabase-ru"
TARGETS = (21418, 25718, 26389, 14970, 9345, 33533, 25154, 36218, 36221)
BASE = "https://pwdatabase.ru/api/v1"
CLIENT_HASH = "86c649d928c1707ea8100e5849fa4edad75cc372c2daba85e0bca0d6c6f0813a"
FIELDS = ("level", "require_level", "require_strength", "require_agility", "require_energy",
          "require_tili", "require_reputation", "character_combo_id", "defence_low", "defence_high",
          "damage_low", "damage_high", "damage_high_min", "damage_high_max", "magic_damage_low",
          "magic_damage_high", "magic_damage_high_min", "magic_damage_high_max", "armor_enhance_low",
          "armor_enhance_high", "hp_enhance_low", "hp_enhance_high", "mp_enhance_low", "mp_enhance_high")
NOTES = {
    21418: (
        'PWDB тоже теряет четыре свойства с нулевой вероятностью строки; его count3 не описывает '
        'фиксированный блок из пяти свойств.'
    ),
    25718: (
        'Все пять ID сохранены; названия D_rate02/Mdd_rate04 не расшифрованы. Клиентский тип доказывает '
        'физзащиту2% и магзащиту4%.'
    ),
    26389: (
        'Все три свойства совпали. Различается написание названия и маска классов; новые классы не '
        'переносить.'
    ),
    14970: (
        'Все три свойства совпали. Время активации и время пения здесь обозначают один channeling-бонус '
        '-6%.'
    ),
    9345: (
        'PWDB показывает сырой HP-реген20; первичный форматтер переводит clientparam20 в10/с. Нельзя '
        'смешивать единицы.'
    ),
    33533: (
        'Случайный набор4 и unique2849 совпали; A_E21/A_P12 остались внутренними именами. Маска доступных '
        'классов другая.'
    ),
    25154: (
        'PWDB уточняет ПЗ+2 для оружия/брони. Тот же клиентский ID связывает2309/2310 с доказанным '
        'типом60 defense_level.'
    ),
    36218: (
        'Современный требуемый уровень40 отличается от client47; rand851 остаётся нерасшифрованным именем '
        'камня. Не заменять его addon852.'
    ),
    36221: (
        'Современный требуемый уровень40 отличается от client47; rand888 остаётся нерасшифрованным именем '
        'камня. Не заменять его addon889.'
    ),
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def catalog():
    rows = read_json(ROOT / "data/catalog_items.json") + read_json(ROOT / "data/catalog_stones.json")
    return {row["id"]: row for row in rows}


def fetch_cards(whitelist: dict) -> None:
    if any(item_id not in whitelist for item_id in TARGETS):
        raise ValueError("Every requested ID must already exist in the 1.4.6 catalogue")
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    headers = {"User-Agent": "PW-Calculator public source comparison", "Accept": "application/json",
               "Origin": "https://pwdatabase.ru", "Referer": "https://pwdatabase.ru/"}
    bootstrap = Request(BASE + "/auth/frontend", data=b"", headers=headers, method="POST")
    with opener.open(bootstrap, timeout=30) as response:
        response.read(100_000)  # Deliberately neither printed nor persisted.
    CACHE.mkdir(parents=True, exist_ok=True)
    manifest = []
    for item_id in TARGETS:
        url = f"{BASE}/items/{item_id}"
        entry = {"item_id": item_id, "url": url, "fetched_at": datetime.now(UTC).isoformat()}
        try:
            with opener.open(Request(url, headers=headers), timeout=30) as response:
                raw = response.read(1_000_001)
                entry["status"] = response.status
            if len(raw) > 1_000_000 or json.loads(raw).get("id") != item_id:
                raise ValueError(f"Unexpected public item response for {item_id}")
            (CACHE / f"item-{item_id}.json").write_bytes(raw)
            entry.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        except HTTPError as error:
            entry["status"] = error.code
        manifest.append(entry)
    (CACHE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def compare(whitelist: dict) -> list[dict]:
    inputs = read_json(ROOT / ".cache/client-data/item-inputs.json")
    if inputs["source"]["sha256"] != CLIENT_HASH:
        raise ValueError("Client input digest is not the verified Comeback client")
    clients = {row["ID"]: row for row in inputs["items"]}
    profiles = {row["item_id"]: row for row in read_json(ROOT / "data/catalog_client_properties.json")["items"]}
    manifest = {row["item_id"]: row for row in read_json(CACHE / "manifest.json")}
    result = []
    for item_id in TARGETS:
        source = manifest[item_id]
        if item_id not in whitelist or source["status"] != 200:
            raise ValueError(f"Whitelisted public card unavailable: {item_id}")
        raw = (CACHE / f"item-{item_id}.json").read_bytes()
        if hashlib.sha256(raw).hexdigest() != source["sha256"]:
            raise ValueError(f"Cached card hash mismatch: {item_id}")
        modern = json.loads(raw)
        if modern["id"] != item_id:
            raise ValueError("Cached response ID mismatch")
        client = clients.get(item_id)
        differences = {}
        missing_ids = []
        if client:
            differences = {key: {"client": client[key], "pwdb": modern[key]}
                           for key in FIELDS if key in client and key in modern and client[key] != modern[key]}
            for index, defence in enumerate(modern.get("magic_defences", []), 1):
                for bound in ("low", "high"):
                    key = f"magic_defences_{index}_{bound}"
                    if key in client and defence[bound] != client[key]:
                        differences[key] = {"client": client[key], "pwdb": defence[bound]}
            missing_ids = sorted({row["id"] for row in client["addons"]}
                                 - {row["id"] for row in modern.get("addons", [])})
        fixed = profiles.get(item_id)
        result.append({"item_id": item_id, "name146": whitelist[item_id].get("name", ""),
                       "name_pwdb": modern["name"],
                       "client_fixed_props": client.get("fixed_props") if client else "stone_direct",
                       "client_block_count": fixed["addon_count"] if fixed else None,
                       "pwdb_visible_addon_count": len(modern.get("addons", [])),
                       "missing_client_addon_ids": missing_ids, "field_differences": differences,
                       "finding": NOTES[item_id], "pwdb_url": f"https://pwdatabase.ru/items/{item_id}",
                       "pwdb_api_url": source["url"], "pwdb_sha256": source["sha256"],
                       "comeback_url": whitelist[item_id]["source"]["url"],
                       "comeback_html_sha256": whitelist[item_id]["source"]["html_sha256"],
                       "client_sha256": CLIENT_HASH})
    return result


def write_report(rows: list[dict]) -> None:
    path = ROOT / "docs/pwdb-reference-comparison.csv"
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]))
        writer.writeheader()
        for row in rows:
            writer.writerow({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v
                             for k, v in row.items()})
    table = []
    for row in rows:
        different = json.dumps(row["field_differences"], ensure_ascii=False)
        table.append(f'<tr><td><a href="{row["pwdb_url"]}">{row["item_id"]}</a></td>'
                     f'<td>{escape(row["name146"])}</td><td>{escape(row["finding"])}</td>'
                     f'<td><code>{escape(different)}</code></td>'
                     f'<td><code>{row["pwdb_sha256"]}</code></td></tr>')
    template = (Path(__file__).with_name("pwdb_comparison_template.html")).read_text(encoding="utf-8")
    html = template.replace("{{table}}", "".join(table)).replace("{{client_hash}}", CLIENT_HASH)
    (ROOT / "docs/pwdb-reference-comparison.html").write_text(html, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="Opt in to public anonymous PWDB requests")
    args = parser.parse_args()
    whitelist = catalog()
    if args.fetch:
        fetch_cards(whitelist)
    rows = compare(whitelist)
    write_report(rows)
    print(json.dumps({"compared": len(rows), "missing_fixed_addons": {
        row["item_id"]: row["missing_client_addon_ids"] for row in rows if row["missing_client_addon_ids"]},
        "runtime_catalogues_modified": 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
