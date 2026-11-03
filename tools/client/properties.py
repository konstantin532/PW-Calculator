"""Read-only, typed equipment property export for the pinned Comeback client.

The sELedit ID/type table and formatter determine units. Names are never used
as prefixes to guess a property. Unrecognised definitions remain visible raw
    with a null statistic; they never become a made-up numeric bonus.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import struct
from collections import Counter
from pathlib import Path
from urllib.request import Request, urlopen

CLIENT_SHA256 = "86c649d928c1707ea8100e5849fa4edad75cc372c2daba85e0bca0d6c6f0813a"
TYPE_TABLE_SHA256 = "4b455a96c44cf1ab55d207510a1c6ff3b2d9f77152684a84a30ced0c2c2159dd"
TYPE_TABLE_GIT_BLOB = "b8e611ea84c56ef9d1133954f6f9e2176a661460"
TYPE_TABLE_RAW_URL = "https://raw.githubusercontent.com/Wrechid/sELedit-/2529c280f19912b0088f1db3bd6d268bf7fec802/sELedit/bin/Debug/resources/data/addon_table.txt"
PRIMARY_BASE = "https://github.com/Wrechid/sELedit-/blob/2529c280f19912b0088f1db3bd6d268bf7fec802/"
PRIMARY_SOURCES = {
    "type_table": PRIMARY_BASE + "sELedit/bin/Debug/resources/data/addon_table.txt",
    "type_table_git_blob": TYPE_TABLE_GIT_BLOB,
    "formatter": PRIMARY_BASE + "sELedit/COMMON/GetProps/EQUIPMENT_ADDON.cs",
    "formatter_git_blob": "6404401b980b1583d787348c43d335c3e43d8faa",
    "fixed_armor": PRIMARY_BASE + "sELedit/COMMON/GetProps/ARMOR_ESSENCE.cs#L173-L207",
    "fixed_generation": "https://github.com/huzeming/176source/blob/c0992a29c0848de4de139a8958ceb11edcf2d38b/cgame/gs/item/itemdataman.cpp#L171-L203",
}

# Facts translated from the primary formatter, not the internal A_... names.
# (stat, Russian label, encoding, whether the second parameter is a roll bound)
TYPES = {
    0: ("phys_atk", "Физическая атака", "integer", True),
    1: ("phys_atk", "Макс. физ. атака", "integer", True),
    2: ("phys_atk_percent", "Физическая атака", "percent", True),
    3: ("mag_atk", "Магическая атака", "integer", True),
    4: ("mag_atk", "Макс. маг. атака", "integer", True),
    5: ("mag_atk_percent", "Магическая атака", "percent", True),
    9: ("attack_interval", "Интервал атаки", "negative_float", False),
    10: ("range", "Дальность", "float", False),
    11: ("cast_time", "Время пения", "negative_percent", False),
    12: ("phys_def", "Физическая защита", "integer", True),
    13: ("phys_def_percent", "Физическая защита", "percent", True),
    14: ("mag_def", "Магическая защита", "integer", True),
    35: ("hp", "Здоровье", "integer", True),
    36: ("mp", "Мана", "integer", True),
    37: ("hp_percent", "Здоровье", "percent", False),
    38: ("mp_percent", "Мана", "percent", False),
    39: ("hp_regen", "Скор. восст. HP", "half_integer", False),
    40: ("mp_regen", "Скор. восст. MP", "half_integer", False),
    41: ("str", "Сила", "integer", True),
    42: ("dex", "Ловкость", "integer", True),
    43: ("int", "Интеллект", "integer", True),
    44: ("vit", "Телосложение", "integer", True),
    45: ("crit", "Крит", "percent", False),
    46: ("accuracy", "Меткость", "integer", False),
    47: ("accuracy_percent", "Меткость", "percent", False),
    48: ("speed", "Скорость движения", "float", False),
    49: ("speed_percent", "Скорость движения", "percent", False),
    50: ("evasion", "Уклонение", "integer", False),
    51: ("evasion_percent", "Уклонение", "percent", False),
    52: ("durability", "Прочность", "integer", False),
    53: ("durability_percent", "Прочность", "percent", False),
    54: ("damage_reduction_phys", "Уменьшение физ. урона", "percent", False),
    56: ("requirement_reduction", "Требования", "negative_percent", False),
    58: ("experience_percent", "Опыт", "percent", False),
    59: ("attack_level", "Показатель атаки", "integer", False),
    60: ("defense_level", "Показатель защиты", "integer", False),
    61: ("mag_def_percent", "Магическая защита", "percent", False),
    63: ("spirit", "Сила духа", "integer", False),
    69: ("damage_reduction_mag", "Уменьшение урона от стихий", "percent", False),
    70: ("attack_level", "Показатель атаки", "integer", True),
    71: ("defense_level", "Показатель защиты", "integer", True),
    72: ("crit", "Крит", "percent", True),
    73: ("hp", "Здоровье", "integer", True),
    74: ("mp", "Мана", "integer", True),
    75: ("accuracy_percent", "Меткость", "percent", True),
    76: ("phys_def", "Физическая защита", "integer", True),
    77: ("mag_def", "Магическая защита", "integer", True),
    78: ("damage_reduction_phys", "Уменьшение физ. урона", "percent", True),
    79: ("damage_reduction_mag", "Уменьшение урона от стихий", "percent", True),
    80: ("cast_time", "Время пения", "negative_percent", True),
    81: ("range", "Дальность", "float", True),
    82: ("mp_regen", "Скор. восст. MP", "half_integer", True),
    83: ("phys_def_percent", "Физическая защита", "percent", True),
    84: ("mag_def_percent", "Магическая защита", "percent", True),
    85: ("hp_regen", "Скор. восст. HP", "half_integer", True),
    86: ("evasion", "Уклонение", "integer", True),
    87: ("phys_atk", "Макс. физ. атака", "integer", True),
    88: ("mag_atk", "Макс. маг. атака", "integer", True),
    90: ("monster_slayer", "Урон монстрам", "integer", False),
    91: ("monster_guard", "Защита от монстров", "integer", False),
    93: ("hp", "Здоровье", "integer", False),
    94: ("hp", "Здоровье", "integer", True),
    95: ("str", "Сила", "integer", False),
    96: ("dex", "Ловкость", "integer", False),
    97: ("int", "Интеллект", "integer", False),
    98: ("vit", "Телосложение", "integer", False),
    99: ("mp", "Мана", "integer", False),
    100: ("phys_atk", "Физическая атака", "integer", False),
    101: ("phys_atk", "Макс. физ. атака", "integer", False),
    102: ("mag_atk", "Магическая атака", "integer", False),
    103: ("mag_atk", "Макс. маг. атака", "integer", False),
    104: ("phys_def", "Физическая защита", "integer", True),
    105: ("hp", "Здоровье", "integer", True),
    106: ("str", "Сила", "integer", True),
    107: ("dex", "Ловкость", "integer", True),
    108: ("int", "Интеллект", "integer", True),
    109: ("accuracy", "Меткость", "integer", True),
    110: ("crit", "Крит", "percent", False),
    111: ("attack_level", "Показатель атаки", "integer", False),
    112: ("defense_level", "Показатель защиты", "integer", False),
    113: ("cast_time", "Время пения", "negative_percent", False),
    114: ("mag_def", "Магическая защита", "integer", False),
}
for index, (element, label) in enumerate([
    ("metal", "металла"), ("wood", "дерева"), ("water", "воды"),
    ("fire", "огня"), ("earth", "земли"),
]):
    TYPES[15 + index * 2] = (f"def_{element}", f"Защита от {label}", "integer", True)
    TYPES[16 + index * 2] = (f"def_{element}_percent", f"Защита от {label}", "percent", True)
    TYPES[64 + index] = (f"damage_reduction_{element}", f"Уменьшение урона от {label}", "percent", False)

# Explicit Comeback additions, tied to the entire client digest and exact name
# and parameter signature. They do not establish a generic prefix convention.
CLIENT_ALIASES = {
    6000: ("Интеллект +12", (12, 12, 0), 43),
    6001: ("Ловкость +12", (12, 12, 0), 42),
    6002: ("Сила +12", (12, 12, 0), 41),
    6003: ("Телослож. +12", (12, 12, 0), 44),
    6004: ("Интеллект +19", (19, 19, 0), 43),
    6005: ("Ловкость +19", (19, 19, 0), 42),
    6006: ("Сила +19", (19, 19, 0), 41),
    6007: ("Телослож. +19", (19, 19, 0), 44),
    6008: ("Уменьшение урона от стихий +2%", (1017370378, 0, 0), 69),
    6009: ("Уменьшение урона от стихий +5%", (1028443341, 0, 0), 69),
    6010: ("Показатель атаки +05", (5, 0, 0), 59),
    6011: ("Показатель атаки +25", (25, 0, 0), 59),
}


def load_type_map(path: Path) -> dict[int, int]:
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != TYPE_TABLE_SHA256:
        raise ValueError("Unverified primary addon type table")
    return {int(match[1]): int(match[2]) for line in raw.decode("utf-16").splitlines()
            if (match := re.fullmatch(r"(\d+)\s+(\d+)\s*", line))}


def fetch_type_table(path: Path) -> None:
    """Explicit opt-in only; verify the primary author's immutable git blob."""
    request = Request(TYPE_TABLE_RAW_URL, headers={"User-Agent": "PW-Calculator source verification"})
    with urlopen(request, timeout=30) as response:
        raw = response.read(100_001)
    blob = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
    if len(raw) > 100_000 or blob != TYPE_TABLE_GIT_BLOB or hashlib.sha256(raw).hexdigest() != TYPE_TABLE_SHA256:
        raise ValueError("Unverified primary addon type table download")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)


def _number(value: int, encoding: str) -> int | float:
    if "float" in encoding or "percent" in encoding:
        result = struct.unpack("<f", struct.pack("<i", value))[0]
        if "percent" in encoding:
            result *= 100
        result = round(result, 6)
        if "percent" in encoding and abs(result - round(result)) <= 0.00001:
            result = round(result)
        if "negative" in encoding:
            result = -result
    else:
        result = int(value / 2) if encoding == "half_integer" else value
    if not math.isfinite(result) or abs(result) > 1e9:
        raise ValueError("Invalid typed property value")
    return int(result) if result == int(result) else result


def _text(label: str, minimum: float, maximum: float, percent: bool, unit: str) -> str:
    def decimal(value):
        return format(value, ".6f").rstrip("0").rstrip(".")

    first = ("+" if minimum >= 0 else "") + decimal(minimum)
    last = f"~{decimal(maximum)}" if maximum != minimum else ""
    return f"{label} {first}{last}{'%' if percent else unit}"


def format_addon(definition: dict, type_map: dict[int, int], *, client_hash: str = "") -> dict:
    addon_id = definition["ID"]
    params = [definition[f"param{i}"] for i in (1, 2, 3)]
    kind = type_map.get(addon_id)
    alias = CLIENT_ALIASES.get(addon_id)
    alias_verified = bool(alias and client_hash == CLIENT_SHA256
                          and definition["Name"] == alias[0] and tuple(params) == alias[1])
    if kind is None and alias_verified:
        kind = alias[2]
    result = {"addon_id": addon_id, "type": kind, "raw_name": definition["Name"],
              "raw_params": params, "num_params": definition["num_params"], "known": False,
              "stat": None, "min": None, "max": None, "percent": None}
    rule = TYPES.get(kind)
    if rule is None:
        result.update(text=f"Неизвестное свойство клиента ID{addon_id} ({definition['Name']})",
                      reason="skill_proc" if kind == 55 else "unidentified" if kind == 57 else "unknown_type")
        return result
    stat, label, encoding, ranged = rule
    try:
        values = [_number(params[0], encoding)]
        if ranged and definition["num_params"] > 1:
            values.append(_number(params[1], encoding))
    except (ValueError, OverflowError, struct.error):
        result.update(text=f"Неописанное свойство #{addon_id}", reason="invalid_value")
        return result
    minimum, maximum = min(values), max(values)
    percent = "percent" in encoding
    unit = " сек." if stat == "attack_interval" else ""
    result.update(known=True, stat=stat, min=minimum, max=maximum, percent=percent,
                  text=_text(label, minimum, maximum, percent, unit))
    if kind in {1, 4, 87, 88, 101, 103}:
        result["attack_bound"] = "max"
    if alias_verified:
        result["client_alias"] = True
    return result


def build_client_properties(inputs: dict, catalog: list[dict], type_map: dict[int, int],
                            *, include_random: bool = False) -> dict:
    source = inputs["source"]
    definitions = {row["ID"]: row for row in inputs["addons"]}
    items_by_id = {row["ID"]: row for row in inputs["items"]}
    coverage = Counter(catalog_items=len(catalog))
    output = []
    for catalog_item in sorted(catalog, key=lambda row: row["id"]):
        row = items_by_id.get(catalog_item["id"])
        if row is None:
            coverage["outside_parsed_equipment_tables"] += 1
            continue
        if not row["Name"].strip():
            coverage["reserved_empty_names"] += 1
            continue
        if " ".join(row["Name"].split()) != " ".join(catalog_item.get("name", "").split()):
            coverage["name_mismatch"] += 1
            continue
        fixed = row["fixed_props"] != 0
        probabilities = row["addon_count_probabilities"]
        source_max = max((int(k) for k, v in probabilities.items() if v > 0), default=0)
        addons = []
        for group, kind in [("addons", "options"), ("rands", "rands"), ("uniques", "unique")]:
            for choice in row[group]:
                addon = format_addon(definitions[choice["id"]], type_map,
                                     client_hash=source.get("sha256", ""))
                addons.append({**addon, "kind": kind, "probability": choice["probability"],
                               "chance": round(choice["probability"] * 100, 6)})
        fixed_slots = [addon for addon in addons if addon["kind"] == "options"]
        complete = all(addon["known"] for addon in fixed_slots)
        required = fixed and probabilities.get("0", 0) == 0
        count = len(fixed_slots) if fixed and source_max > 0 else source_max
        profile = {"item_id": row["ID"], "name": row["Name"].strip(), "table": row["table"],
                   "offset": row["offset"], "fixed_props": row["fixed_props"], "fixed": fixed,
                   "source_required": required, "guaranteed": required,
                   "complete": complete, "raw_count_probabilities": probabilities,
                   "addon_count": count, "addons": addons}
        if fixed and probabilities.get("0", 0) == 1:
            profile["non_generating_addons"] = profile["addons"]
            profile["addons"] = []
        if fixed or include_random:
            output.append(profile)
        coverage["items"] += 1
        coverage["fixed_items" if fixed else "random_items"] += 1
        if fixed:
            coverage["fixed_complete" if complete else "fixed_unknown"] += 1
            coverage["fixed_count_expanded"] += int(source_max > 0 and len(fixed_slots) > source_max)
            coverage["fixed_optional"] += int(not required)
            active = [a for a in profile["addons"] if a["kind"] == "options"]
            coverage["fixed_active_properties"] += len(active)
            coverage["fixed_active_typed_properties"] += sum(a["known"] for a in active)
            coverage["fixed_active_unknown_properties"] += sum(not a["known"] for a in active)
            coverage["fixed_active_unknown_items"] += int(any(not a["known"] for a in active))
            coverage["fixed_active_skill_proc_properties"] += sum(a.get("reason") == "skill_proc" for a in active)
            coverage["fixed_active_other_unknown_properties"] += sum(
                not a["known"] and a.get("reason") != "skill_proc" for a in active)
        coverage["typed_properties"] += sum(a["known"] for a in addons)
        coverage["unsupported_properties"] += sum(not a["known"] for a in addons)
        coverage["skill_proc_properties"] += sum(a.get("reason") == "skill_proc" for a in addons)
        coverage["unknown_type_properties"] += sum(a.get("reason") == "unknown_type" for a in addons)
        coverage["client_alias_properties"] += sum(a.get("client_alias", False) for a in addons)
    coverage["exported_items"] = len(output)
    return {"version": 1, "source": {**source, "property_sources": PRIMARY_SOURCES,
                                      "type_table_sha256": TYPE_TABLE_SHA256},
            "items": output, "coverage": dict(sorted(coverage.items()))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True, help="bonus_inputs JSON from tools.client.elements")
    parser.add_argument("--catalog", type=Path, default=Path("data/catalog_items.json"))
    parser.add_argument("--type-table", type=Path, default=Path(".cache/client-schema/addon_table-original.txt"))
    parser.add_argument("--fetch-type-table", action="store_true",
                        help="Opt in to fetch the hash-pinned primary ID/type table")
    parser.add_argument("--output", type=Path, default=Path("data/catalog_client_properties.json"))
    parser.add_argument("--include-random", action="store_true",
                        help="Full audit export only; do not replace live random pools")
    args = parser.parse_args()
    inputs = json.loads(args.inputs.read_text(encoding="utf-8"))
    if inputs["source"].get("sha256") != CLIENT_SHA256:
        raise ValueError("Only the verified Comeback client is supported")
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    if args.fetch_type_table:
        fetch_type_table(args.type_table)
    result = build_client_properties(inputs, catalog, load_type_map(args.type_table),
                                     include_random=args.include_random)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["coverage"], ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
