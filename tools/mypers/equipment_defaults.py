"""Cross-check editable mypers presets against the Comeback 1.4.6 catalogue.

The modern API is evidence for a planning preset, never an item catalogue or a
guarantee that a random property rolls. Every imported number must also occur in
the 1.4.6 item's own offered properties. Network access is explicitly opt-in.
"""

import argparse
import hashlib
import json
import re
from collections import Counter
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

GROUP_SLOTS = {
    "ft": "helmet", "rv": "chest", "tg": "legs", "rx": "boots", "mj": "wrists", "wy": "cape",
    "vx": "necklace", "st": "belt", "oq": "ring", "ta": "weapon", "qn": "tome", "it": "ammo", "ic": "flight",
}
ALLOWED_CLASSES = {"Воин", "Маг", "Оборотень", "Друид", "Лучник", "Жрец", "Убийца", "Шаман", "Страж", "Мистик"}
# Meanings/signs are taken from ra()/dv() in the original pwscripts.min.js.
# Labels and final rendered texts come solely from the 1.4.6 item record.
TYPE_LABELS = {
    "hp": (["Здоровье", "ЖС", "HP", "Максимум здоровья", "Максимальный запас здоровья"], False, 1),
    "mp": (["Мана", "МЭ", "MP", "Магическая энергия", "Уровень магической энергии"], False, 1),
    "mana": (["Мана", "МЭ", "MP", "Магическая энергия", "Уровень магической энергии"], False, 1),
    "lf": (["Телосложение", "Выносливость", "Телослож", "ТЕЛ"], False, 1),
    "tx": (["Интеллект", "Магия"], False, 1), "om": (["Сила"], False, 1), "uy": (["Ловкость"], False, 1),
    "wf": (["Защита", "Физ защита", "Физическая защита"], False, 1),
    "ab_gq": (["Маг защита", "Магическая защита", "Сопротивляемость стихиям"], False, 1),
    "ld": (["Физ атака", "Физическая атака"], False, 1),
    "xq": (["Маг атака", "Магическая атака"], False, 1),
    "ed": (["Крит", "Шанс крит удара", "Шанс критического удара", "Вероятность критического удара"], True, 1),
    "ci": (["Время пения", "Время подготовки", "Пение"], True, -1),
    "channeling": (["Время пения", "Время подготовки", "Пение"], True, -1),
    "ad": (["Показатель атаки", "Уровень атаки"], False, 1),
    "sx": (["Показатель защиты", "Уровень защиты"], False, 1),
    "lw_eq": (["Защита от металла"], False, 1), "mo_eq": (["Защита от дерева"], False, 1),
    "dn_eq": (["Защита от воды"], False, 1), "vt_eq": (["Защита от огня"], False, 1),
    "sp_eq": (["Защита от земли"], False, 1),
    "cl": (["Скорость", "Скорость движения", "Скорость передвижения"], False, 1),
    "xn": (["Пауза между атаками"], False, -1),
    "co": (["Здоровье", "HP", "Макс ХП", "Максимум здоровья", "Максимальный запас здоровья"], True, 1),
    "cc": (["Мана", "MP", "МЭ", "Максимум маны", "Максимальный запас маны"], True, 1),
    "wf_eg": (["Защита", "Физ защита", "Физическая защита"], True, 1),
    "ab_gq_eg": (["Маг защита", "Магическая защита", "Сопротивляемость стихиям"], True, 1),
    "ae": (["Меткость", "Точность попадания"], False, 1),
    "ae_eg": (["Меткость", "Точность попадания", "Удар"], True, 1),
    "qe": (["Уклонение", "Уклон"], False, 1), "qe_eg": (["Уклонение", "Уклон"], True, 1),
    "max_oi_av": (["Макс физ атака", "Физическая атака макс"], False, 1),
    "max_xq": (["Макс маг атака", "Магическая атака макс"], False, 1),
    "su": (["Урон монстрам"], False, 1), "wz": (["Защита от монстров"], False, 1),
    "cx": (["Скор восст HP", "Восстановление здоровья", "Скорость восстановления здоровья"], False, 1),
    "mp_recovery": (["Скор восст MP", "Восстановление маны", "Скорость восстановления маны"], False, 1),
    "bu": (["Уменьшение физ урона", "Уменьшение физического урона", "Иммунитет к физическому урону"], True, 1),
    "ia": (["Уменьшение маг урона", "Уменьшение магического урона", "Уменьшение урона от стихий"], True, 1),
    "ct": (["Требования", "Требования к характеристикам"], True, -1),
    "fp": (["Дальность", "Дальность атаки"], False, 1),
    "cp": (["Прочность", "Максимальная прочность"], True, 1),
    "exp": (["Опыт"], True, 1), "mr": (["Сила духа"], False, 1),
}
ADDON_RE = re.compile(
    r"^(.+?)\s*([+-]\s*\d+(?:[.,]\d+)?)(?:\s*[~–]\s*([+-]?\s*\d+(?:[.,]\d+)?))?\s*(%|ед\.?)?\s*$"
)
COUNT_RE = re.compile(r"^(\d+)(?:\s*[~–—-]\s*(\d+))?$")
# Reviewed individual source errors. No float-bit decoding or global numeric conversion.
MAGIC_REDUCTION_IDS = {
    **dict.fromkeys([*range(32965, 32970), *range(34837, 34842), 36997, 37028], 3),
    **dict.fromkeys([35737, 35741, 35749, 35765, 35773, *range(36621, 36626)], 5),
}
MAGIC_REDUCTION_RAW = {
    3: "Уменьшение урона от стихий +1022739087%",
    5: "Уменьшение урона от стихий +1028443341%",
}
ELEMENTS = {"metal": "lw_eq", "wood": "mo_eq", "water": "dn_eq", "fire": "vt_eq", "earth": "sp_eq"}


def normalize(label):
    return " ".join(label.lower().replace("ё", "е").replace(".", "").split())


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
        return None
    try:
        parsed = Decimal(str(value).replace(" ", "").replace(",", "."))
        return parsed if parsed.is_finite() and abs(parsed) <= 1_000_000_000 else None
    except InvalidOperation:
        return None


def parse_addon(text):
    if not isinstance(text, str) or len(text) > 500 or any(ord(char) < 32 for char in text):
        return None
    match = ADDON_RE.fullmatch(text)
    if not match:
        return None
    label, first, last, unit = match.groups()
    first_value = number(first)
    last_value = number(last) if last is not None else first_value
    inherited_negative = first.strip().startswith("-") and last is not None and not last.strip().startswith(("+", "-"))
    if inherited_negative and last_value is not None:
        last_value = -last_value
    if first_value is None or last_value is None or not label.strip() or not label.strip()[0].isalpha():
        return None
    if (inherited_negative and last_value > first_value) or (not inherited_negative and last_value < first_value):
        return None
    return {"label": label.strip(), "min": min(first_value, last_value), "max": max(first_value, last_value),
            "percent": unit == "%", "unit": unit or "", "text": text}


def render_addon(option, value):
    if option["min"] == option["max"]:
        return option["text"]
    numeric = format(value, "f").rstrip("0").rstrip(".") if "." in format(value, "f") else format(value, "f")
    suffix = "%" if option["percent"] else " ед." if option["unit"] else ""
    return f"{option['label']} {'' if value < 0 else '+'}{numeric}{suffix}"


def guaranteed_texts(item):
    return list(dict.fromkeys(
        option["text"] for option in item.get("addons", {}).get("unique", [])
        if isinstance(option, dict) and option.get("chance") == 100 and isinstance(option.get("text"), str)
    ))


def maximum_addons(item):
    match = COUNT_RE.fullmatch(str(item.get("addons", {}).get("count", "")).strip())
    if not match or (match[2] is not None and int(match[2]) < int(match[1])):
        return None
    return min(20, max(0, int(match[2] or match[1]) - len(guaranteed_texts(item))))


def source_for(item, record, group, digest):
    return {"mypers_type": group, "mypers_id": record["id"], "pw_id": item["id"],
            "api_url": f"https://mypers.ru/api/api.php?a=sb&k={group}", "api_sha256": digest,
            "comeback_url": item["source"]["url"],
            "comeback_html_sha256": item["source"].get("html_sha256")}


def match_property(item, entry):
    if not isinstance(entry, dict) or entry.get("type") not in TYPE_LABELS:
        return None, "unknown_type", None
    labels, percent, sign = TYPE_LABELS[entry["type"]]
    original_value = number(entry.get("val"))
    if original_value is None:
        return None, "invalid_value", None
    value = sign * original_value
    labels = {normalize(label) for label in labels}
    candidates = [parsed for kind in ("unique", "options")
                  for option in item.get("addons", {}).get(kind, [])
                  if isinstance(option, dict) and (parsed := parse_addon(option.get("text")))
                  and normalize(parsed["label"]) in labels and parsed["percent"] == percent]
    matched = [option for option in candidates if option["min"] <= value <= option["max"]]
    if matched:
        # Prefer a fixed source string when fixed and ranged variants coexist.
        matched.sort(key=lambda option: (option["min"] != option["max"], option["text"]))
        return render_addon(matched[0], value), None, None
    # A single known fixed 1.4.6 correction, not a general nearest-value rule.
    if item["id"] == 9345 and entry["type"] == "cx" and original_value == 10:
        fixed = [option for option in candidates if option["min"] == option["max"] == 20]
        if len(fixed) == 1:
            return fixed[0]["text"], None, {"type": "cx", "original": 10, "applied": 20,
                                          "reason": "fixed_146_value_overrides_mypers"}
    return None, "value_mismatch" if candidates else "property_not_in_146", None


def attack_range(value):
    if value is None:
        return Decimal(0), Decimal(0)
    values = value if isinstance(value, list) else [value, value]
    if len(values) != 2:
        return None
    parsed = tuple(number(part) for part in values)
    return parsed if None not in parsed and parsed[0] <= parsed[1] else None


def defense_and_hp(record, original=False):
    stats = record if original else record.get("stats", {})
    if not isinstance(stats, dict):
        return None
    physical = number(stats.get("wf" if original else "phys_def", 0))
    hp = number(stats.get("hp", 0))
    elements = {}
    if original:
        magic = stats.get("ab_gq", 0)
        for element, original_key in ELEMENTS.items():
            elements[element] = number(magic.get(original_key, 0) if isinstance(magic, dict) else magic or 0)
    else:
        shared = number(stats.get("mag_def", 0))
        if shared is None:
            return None
        for element in ELEMENTS:
            value = number(stats.get(f"def_{element}", 0))
            elements[element] = None if value is None else shared + value
    if physical is None or hp is None or None in elements.values():
        return None
    return {"phys_def": physical, "hp": hp, "elements": elements}


def reviewed_property_corrections(catalogue, api_groups, api_hashes):
    candidates, conflicts = {}, set()
    for group in ("ft", "rx"):
        payload = api_groups.get(group, {})
        records = payload.get("data", []) if isinstance(payload, dict) else []
        if not isinstance(records, list):
            continue
        for record in records:
            if not isinstance(record, dict) or type(record.get("id")) is not int or record["id"] <= 0:
                continue
            item_id = record.get("pw_id")
            if type(item_id) is not int or item_id not in MAGIC_REDUCTION_IDS:
                continue
            item = catalogue.get(item_id)
            if not item or item.get("slot") != GROUP_SLOTS[group]:
                continue
            if item.get("source", {}).get("url") != f"https://comeback.pw/db/146/item/{item_id}":
                continue
            base = defense_and_hp(item)
            if base is None or base != defense_and_hp(record, original=True):
                continue
            expected = MAGIC_REDUCTION_IDS[item_id]
            raw = MAGIC_REDUCTION_RAW[expected]
            if not any(option.get("text") == raw for kind in ("options", "unique")
                       for option in item.get("addons", {}).get(kind, []) if isinstance(option, dict)):
                continue
            entries = record.get("nw", {}).get("wu", []) if isinstance(record.get("nw"), dict) else []
            if not isinstance(entries, list):
                continue
            values = [number(entry.get("val")) for entry in entries
                      if isinstance(entry, dict) and entry.get("type") == "ia"]
            if values != [expected]:
                if values:
                    conflicts.add(item_id)
                continue
            evidence = source_for(item, record, group, api_hashes[group])
            evidence["verification"] = "same_pw_id_and_all_base_physical_elemental_defenses_and_hp"
            evidence["verified_base_stats"] = {
                "phys_def": float(base["phys_def"]), "hp": float(base["hp"]),
                "elements": {key: float(value) for key, value in base["elements"].items()},
            }
            candidates.setdefault(item_id, {"item_id": item_id,
                                           "replacements": [{"was": raw,
                                                             "applied": f"Уменьшение урона от стихий +{expected}%"}],
                                           "source": evidence})
    return [candidates[item_id] for item_id in sorted(candidates) if item_id not in conflicts]


def build_catalog_defaults(items, api_groups, api_hashes):
    catalogue = {item["id"]: item for item in items}
    property_corrections = reviewed_property_corrections(catalogue, api_groups, api_hashes)
    for correction in property_corrections:
        item = deepcopy(catalogue[correction["item_id"]])
        replacements = {entry["was"]: entry["applied"] for entry in correction["replacements"]}
        for kind in ("options", "unique"):
            for option in item.get("addons", {}).get(kind, []):
                if isinstance(option, dict) and option.get("text") in replacements:
                    option["text"] = replacements[option["text"]]
        catalogue[item["id"]] = item
    profiles, speeds, rejected = {}, {}, Counter()
    conflicts, speed_conflicts, rejection_examples = set(), set(), []
    guaranteed_skipped = 0
    matched_records = 0
    speed_rejected = Counter()

    def reject(reason, record, group):
        rejected[reason] += 1
        if len(rejection_examples) < 60:
            rejection_examples.append({"type": group, "mypers_id": record.get("id"),
                                       "pw_id": record.get("pw_id"), "reason": reason})

    for group in sorted(api_groups):
        payload = api_groups[group]
        if group not in GROUP_SLOTS or not isinstance(payload, dict) or payload.get("success") is not True:
            raise ValueError(f"Invalid API group: {group}")
        records = payload.get("data")
        if not isinstance(records, list):
            raise ValueError(f"Invalid API records: {group}")
        for record in records:
            if not isinstance(record, dict):
                reject("invalid_record", {}, group)
                continue
            if type(record.get("id")) is not int or record["id"] <= 0:
                reject("invalid_original_id", record, group)
                continue
            item_id = record.get("pw_id")
            item = catalogue.get(item_id) if type(item_id) is int else None
            if not item:
                reject("missing_146_item", record, group)
                continue
            source = item.get("source", {})
            if source.get("url") != f"https://comeback.pw/db/146/item/{item_id}":
                reject("invalid_146_source", record, group)
                continue
            if item.get("slot") != GROUP_SLOTS[group]:
                reject("slot_mismatch", record, group)
                continue
            if item.get("classes") and not ALLOWED_CLASSES.intersection(item["classes"]):
                reject("unsupported_class", record, group)
                continue
            matched_records += 1
            evidence = source_for(item, record, group, api_hashes[group])
            if group == "ta":
                stats = item.get("stats", {})
                speed = number(record.get("sy"))
                physical = attack_range(stats.get("phys_atk"))
                magical = attack_range(stats.get("mag_atk"))
                original_physical = attack_range(record.get("ld"))
                original_magical = attack_range(record.get("xq"))
                if speed is None or not 0 < speed <= 5:
                    speed_rejected["invalid_original_speed"] += 1
                elif not physical or not magical or physical != original_physical or magical != original_magical:
                    speed_rejected["changed_attack_ranges"] += 1
                elif physical == magical == (0, 0):
                    speed_rejected["missing_attack_ranges"] += 1
                else:
                    speed_evidence = dict(evidence)
                    raw = source.get("raw_stats", {}).get("atk_speed", stats.get("atk_speed"))
                    speed_evidence["corrections"] = {"atk_speed": {
                        "was": raw, "applied": float(speed), "scope": f"item_{item_id}_only",
                        "verification_reference": evidence["api_url"],
                        "verification": "same_pw_id_and_both_146_base_attack_ranges",
                    }}
                    candidate = {"item_id": item_id, "base_attack_speed": float(speed), "source": speed_evidence}
                    if item_id in speeds and speeds[item_id]["base_attack_speed"] != float(speed):
                        speed_conflicts.add(item_id)
                    else:
                        speeds.setdefault(item_id, candidate)
            entries = record.get("nw", {}).get("wu") if isinstance(record.get("nw"), dict) else None
            if not isinstance(entries, list) or not entries:
                reject("no_original_preset", record, group)
                continue
            maximum = maximum_addons(item)
            if maximum is None:
                reject("unknown_146_count", record, group)
                continue
            if len(entries) > 20:
                reject("too_many_properties", record, group)
                continue
            addons, corrections, ignored = [], [], []
            guaranteed = set(guaranteed_texts(item))
            error = None
            for entry in entries:
                text, error, correction = match_property(item, entry)
                if error == "property_not_in_146":
                    value = number(entry["val"])
                    ignored.append({"type": entry["type"],
                                    "value": int(value) if value == value.to_integral_value() else float(value),
                                    "reason": "not_offered_by_146"})
                    error = None
                    continue
                if error:
                    break
                if text in guaranteed:
                    guaranteed_skipped += 1
                else:
                    addons.append(text)
                if correction:
                    corrections.append(correction)
            if error:
                reject(error, record, group)
                continue
            if len(addons) > maximum:
                reject("too_many_properties", record, group)
                continue
            # Filtering a modern extra is safe only when every editable slot
            # of the 1.4.6 item remains filled with exact, offered values.
            if ignored and len(addons) != maximum:
                reject("incomplete_146_preset", record, group)
                continue
            if not addons:
                reject("no_editable_defaults", record, group)
                continue
            if corrections:
                evidence["corrections"] = corrections
            if ignored:
                evidence["ignored"] = ignored
            candidate = {"item_id": item_id, "addons": addons, "source": evidence}
            if item_id in profiles and sorted(profiles[item_id]["addons"]) != sorted(addons):
                conflicts.add(item_id)
            else:
                profiles.setdefault(item_id, candidate)
    for item_id in conflicts:
        profiles.pop(item_id, None)
        rejected["conflicting_presets"] += 1
    for item_id in speed_conflicts:
        speeds.pop(item_id, None)
        speed_rejected["conflicting_speeds"] += 1
    return {"version": 1, "property_corrections": property_corrections,
            "profiles": [profiles[key] for key in sorted(profiles)],
            "weapon_speeds": [speeds[key] for key in sorted(speeds)],
            "coverage": {"api_groups": len(api_groups), "api_records": sum(len(p["data"]) for p in api_groups.values()),
                         "matching_146_records": matched_records, "profiles": len(profiles),
                         "property_corrections": len(property_corrections),
                         "profiles_with_corrections": sum("corrections" in p["source"] for p in profiles.values()),
                         "profiles_with_ignored_extras": sum("ignored" in p["source"] for p in profiles.values()),
                         "ignored_extra_properties": sum(len(p["source"].get("ignored", []))
                                                         for p in profiles.values()),
                         "weapon_speeds": len(speeds), "speed_rejected": dict(sorted(speed_rejected.items())),
                         "guaranteed_properties_skipped": guaranteed_skipped,
                         "rejected": dict(sorted(rejected.items())), "rejected_examples": rejection_examples,
                         "api_sha256": dict(sorted(api_hashes.items()))}}


def fetch_group(group, cache):
    data = urlencode({"action": "sb", "qo": group, "y": "undefined" + "0" * 21}).encode()
    request = Request(f"https://mypers.ru/api/api.php?a=sb&k={group}", data=data,
                      headers={"User-Agent": "Mozilla/5.0", "Referer": "https://mypers.ru/",
                               "Origin": "https://mypers.ru", "X-Requested-With": "XMLHttpRequest"})
    with urlopen(request, timeout=35) as response:
        raw = response.read()
    payload = json.loads(raw)
    if payload.get("success") is not True or not isinstance(payload.get("data"), list):
        raise ValueError(f"Unexpected API payload: {group}")
    (cache / f"{group}.json").write_bytes(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=Path(".cache/bonus-parity-original"))
    parser.add_argument("--items", type=Path, default=Path("data/catalog_items.json"))
    parser.add_argument("--output", type=Path, default=Path("data/catalog_defaults.json"))
    parser.add_argument("--fetch", action="store_true", help="Explicitly fetch public source API before rebuilding")
    args = parser.parse_args()
    if args.fetch:
        args.cache.mkdir(parents=True, exist_ok=True)
        for group in GROUP_SLOTS:
            fetch_group(group, args.cache)
    payloads, digests = {}, {}
    for group in GROUP_SLOTS:
        path = args.cache / f"{group}.json"
        if not path.is_file():
            raise FileNotFoundError(f"Missing source cache {path}; network requires --fetch")
        raw = path.read_bytes()
        payloads[group] = json.loads(raw)
        digests[group] = hashlib.sha256(raw).hexdigest()
    result = build_catalog_defaults(json.loads(args.items.read_text(encoding="utf-8")), payloads, digests)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in result["coverage"].items() if key != "rejected_examples"},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
