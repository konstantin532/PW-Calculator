"""Export existing 1.4.6 stones from one bounded, hash-pinned client table."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import struct
from collections import Counter
from pathlib import Path

from tools.client.elements import bonus_inputs, read_elements
from tools.client.properties import CLIENT_SHA256, PRIMARY_SOURCES, TYPES, format_addon, load_type_map

STONE_START = 11557358
STONE_COUNT = 198
STONE_WIDTH = 436
STONE_END = STONE_START + STONE_COUNT * STONE_WIDTH
SCHEMA_URL = ("https://github.com/Wrechid/sELedit-/blob/2529c280f19912b0088f1db3bd6d268bf7fec802/"
              "sELedit/bin/Debug/configs/PW_1.4.6_v80.cfg")
SCHEMA_FACTS = {"table": "STONE_ESSENCE", "count_offset": STONE_START - 4,
                "start": STONE_START, "count": STONE_COUNT, "row_size": STONE_WIDTH, "end": STONE_END}

# Full client tooltip labels only. Ambiguous 'Атака'/'Защита' are deliberately
# absent; they can be resolved only through an independently typed addon ID.
FLAT_LABELS = {
    "физатака": ("phys_atk", "Физическая атака"),
    "физзащита": ("phys_def", "Физическая защита"),
    "магатака": ("mag_atk", "Магическая атака"),
    "mагатака": ("mag_atk", "Магическая атака"),
    "магзащита": ("mag_def", "Магическая защита"),
    "мэ": ("mp", "Мана"), "жс": ("hp", "Здоровье"),
    "меткость": ("accuracy", "Меткость"), "уклонение": ("evasion", "Уклонение"),
    "выносл": ("vit", "Телосложение"),
    "уронметал": ("weapon_damage_metal", "Урон от металла"),
    "зщметалла": ("def_metal", "Защита от металла"),
    "урондеревом": ("weapon_damage_wood", "Урон от дерева"),
    "урдеревом": ("weapon_damage_wood", "Урон от дерева"),
    "зщдерева": ("def_wood", "Защита от дерева"),
    "уронводой": ("weapon_damage_water", "Урон от воды"),
    "зщотводы": ("def_water", "Защита от воды"),
    "уроногнем": ("weapon_damage_fire", "Урон от огня"),
    "зщотогня": ("def_fire", "Защита от огня"),
    "уронземлей": ("weapon_damage_earth", "Урон от земли"),
    "зщземли": ("def_earth", "Защита от земли"),
}


def _wstring(data: bytes) -> str:
    text = data.decode("utf-16-le").split("\0", 1)[0]
    if any(ord(char) < 32 or ord(char) == 127 for char in text):
        raise ValueError("Control character in stone text")
    return text


def decode_stone_table(data: bytes, start: int, count: int,
                       addon_ids: set[int], subtype_ids: set[int]) -> list[dict]:
    """Decode only the stated table; validate its count, boundaries and links."""
    if (type(start) is not int or type(count) is not int or start < 4 or not 0 < count <= 1000
            or start + count * STONE_WIDTH > len(data) or struct.unpack_from("<I", data, start - 4)[0] != count):
        raise ValueError("Invalid bounded STONE_ESSENCE table")
    rows = []
    seen = set()
    for index in range(count):
        offset = start + index * STONE_WIDTH
        item_id, subtype = struct.unpack_from("<ii", data, offset)
        name = _wstring(data[offset + 8:offset + 72])
        if item_id <= 0 or item_id in seen or not name.strip() or subtype not in subtype_ids:
            raise ValueError("Invalid stone ID/name/subtype reference")
        seen.add(item_id)
        values = struct.unpack_from("<8i", data, offset + 328)
        level, color, price, shop_price, install, uninstall, damage, defence = values
        if damage not in addon_ids or defence not in addon_ids or not 0 < level <= 100:
            raise ValueError("Invalid stone addon reference/level")
        rows.append({"_offset": offset, "ID": item_id, "id_sub_type": subtype, "Name": name,
                     "level": level, "color": color, "price": price, "shop_price": shop_price,
                     "install_price": install, "uninstall_price": uninstall,
                     "id_addon_damage": damage, "id_addon_defence": defence,
                     "weapon_desc": _wstring(data[offset + 360:offset + 392]),
                     "armor_desc": _wstring(data[offset + 392:offset + 424])})
    return rows


def read_stone_inputs(path: Path) -> dict:
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != CLIENT_SHA256:
        raise ValueError("Only the verified Comeback client can supply stone corrections")
    inputs = bonus_inputs(read_elements(path))
    # The immediately preceding, independently validated STONE_SUB_TYPE list.
    if struct.unpack_from("<I", raw, 11556874)[0] != 7:
        raise ValueError("Changed STONE_SUB_TYPE boundary")
    subtype_ids = {struct.unpack_from("<i", raw, 11556878 + i * 68)[0] for i in range(7)}
    rows = decode_stone_table(raw, STONE_START, STONE_COUNT, {a["ID"] for a in inputs["addons"]}, subtype_ids)
    if struct.unpack_from("<I", raw, STONE_END)[0] != 9:
        raise ValueError("Changed following MONSTER_ADDON boundary")
    source = {**inputs["source"], "stone_schema_url": SCHEMA_URL,
              "stone_table_sha256": hashlib.sha256(raw[STONE_START:STONE_END]).hexdigest(),
              "property_sources": PRIMARY_SOURCES}
    return {"source": source, "table": SCHEMA_FACTS, "stones": rows, "addons": inputs["addons"]}


def _resolve(definition: dict, type_map: dict[int, int], description: str) -> dict:
    addon = format_addon(definition, type_map, client_hash=CLIENT_SHA256)
    if addon["known"] and addon["min"] == addon["max"]:
        return {"stat": TYPES[addon["type"]][1], "typed_stat": addon["stat"],
                "value": addon["min"], "percent": addon["percent"], "method": "primary_type_registry"}
    if addon["known"]:
        return {"stat": None, "typed_stat": None, "value": None, "percent": False,
                "method": "unresolved", "reason": "ranged_addon_requires_roll"}
    match = re.fullmatch(r"(.+?)\s*([+-]\s*\d+)\s*", description)
    if match:
        label = re.sub(r"[.\s]", "", match[1].lower().replace("ё", "е"))
        rule = FLAT_LABELS.get(label)
        value = int(match[2].replace(" ", ""))
        params = definition["num_params"]
        if (rule and definition["param1"] == value
                and (params == 1 or (params == 2 and definition["param2"] == value))):
            return {"stat": rule[1], "typed_stat": rule[0], "value": value, "percent": False,
                    "method": "client_tooltip_and_equal_scalar"}
    return {"stat": None, "typed_stat": None, "value": None, "percent": False,
            "method": "unresolved", "reason": "unknown_type_or_tooltip_parameter_mismatch"}


def build_stone_reference(inputs: dict, catalog: list[dict], type_map: dict[int, int]) -> dict:
    if inputs["source"].get("sha256") != CLIENT_SHA256:
        raise ValueError("Unverified source for stone reference")
    by_id = {row["ID"]: row for row in inputs["stones"]}
    definitions = {row["ID"]: row for row in inputs["addons"]}
    corrections = []
    coverage = Counter(catalog_stones=len(catalog), decoded_stones=len(by_id), unknown_effects=0)
    for record in sorted(catalog, key=lambda r: r["id"]):
        row = by_id.get(record["id"])
        if row is None:
            coverage["missing_client_id"] += 1
            continue
        if (" ".join(row["Name"].split()) != " ".join(record.get("name", "").split())
                or row["level"] != record.get("grade")):
            coverage["identity_mismatch"] += 1
            continue
        effects = {}
        proof = {}
        for target, field in (("weapon", "id_addon_damage"), ("armor", "id_addon_defence")):
            definition = definitions[row[field]]
            description = row[f"{target}_desc"]
            resolved = _resolve(definition, type_map, description)
            old = record.get("effects", {}).get(target, {})
            effects[target] = {**resolved, "raw": old.get("raw", description), "client_raw": description,
                               "client_addon_id": definition["ID"]}
            proof[target] = {"ID": definition["ID"], "Name": definition["Name"],
                             "num_params": definition["num_params"], "type": type_map.get(definition["ID"]),
                             "raw_params": [definition[f"param{i}"] for i in (1, 2, 3)]}
            coverage["effects"] += 1
            coverage[resolved["method"]] += 1
            coverage["unknown_effects"] += int(resolved["value"] is None)
        corrections.append({"item_id": record["id"], "name": record["name"], "grade": row["level"],
                            "effects": effects, "source": {"record_offset": row["_offset"],
                            "raw_fields": {k: row[k] for k in ("ID", "id_sub_type", "Name", "level",
                                          "id_addon_damage", "id_addon_defence", "weapon_desc", "armor_desc")},
                            "addon_definitions": proof, "old_effects": copy.deepcopy(record.get("effects", {})),
                            "comeback_url": record["source"]["url"],
                            "comeback_html_sha256": record["source"]["html_sha256"]}})
    coverage["matched_stones"] = len(corrections)
    return {"version": 1, "source": inputs["source"], "table": inputs["table"],
            "corrections": corrections, "coverage": dict(sorted(coverage.items()))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--elements", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, default=Path("data/catalog_stones.json"))
    parser.add_argument("--type-table", type=Path, default=Path(".cache/client-schema/addon_table-original.txt"))
    parser.add_argument("--output", type=Path, default=Path("data/catalog_client_stones.json"))
    args = parser.parse_args()
    inputs = read_stone_inputs(args.elements)
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    result = build_stone_reference(inputs, catalog, load_type_map(args.type_table))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["coverage"], sort_keys=True))


if __name__ == "__main__":
    main()
