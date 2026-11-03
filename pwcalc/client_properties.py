"""Validate and join fixed client properties without changing raw DB pools."""
from __future__ import annotations

import copy
import math
import re
from collections import Counter

from pwcalc.client_data import validate_client_source
from tools.client.properties import TYPE_TABLE_SHA256, format_addon

_TABLES = {"WEAPON_ESSENCE": ("weapon", 1424, 5), "ARMOR_ESSENCE": ("armor", 1132, 4),
           "DECORATION_ESSENCE": ("decoration", 1172, 4)}


def _number(value) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def _slot(slot: dict, file_hash: str) -> dict:
    if not isinstance(slot, dict) or slot.get("kind") not in {"options", "rands", "unique"}:
        raise ValueError("Неверный вид свойства клиента")
    addon_id, kind = slot.get("addon_id"), slot.get("type")
    params, count = slot.get("raw_params"), slot.get("num_params")
    if (type(addon_id) is not int or addon_id <= 0
            or (kind is not None and (type(kind) is not int or kind < 0))
            or not isinstance(params, list) or len(params) != 3
            or any(type(value) is not int or not -(2 ** 31) <= value < 2 ** 31 for value in params)
            or type(count) is not int or not 0 <= count <= 3 or not isinstance(slot.get("raw_name"), str)):
        raise ValueError("Неверные исходные параметры свойства клиента")
    probability, chance = slot.get("probability"), slot.get("chance")
    if (not _number(probability) or not 0 <= probability <= 1 or not _number(chance)
            or chance != round(probability * 100, 6)):
        raise ValueError("Неверная вероятность свойства клиента")
    definition = {"ID": addon_id, "Name": slot["raw_name"], "num_params": count,
                  **{f"param{i + 1}": value for i, value in enumerate(params)}}
    expected = format_addon(definition, {} if kind is None else {addon_id: kind}, client_hash=file_hash)
    if type(slot.get("known")) is not bool:
        raise ValueError("Не указан статус известного свойства клиента")
    for field in ("known", "stat", "min", "max", "percent", "text", "attack_bound", "reason"):
        if slot.get(field) != expected.get(field):
            raise ValueError("Текст или тип свойства клиента не соответствует исходным параметрам")
    text = slot.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 500 or any(ord(c) < 32 for c in text):
        raise ValueError("Неверное описание свойства клиента")
    if slot["known"] and (not _number(slot["min"]) or not _number(slot["max"])
                          or slot["min"] > slot["max"] or type(slot["percent"]) is not bool):
        raise ValueError("Неверные числовые границы свойства клиента")
    return copy.deepcopy(slot)


def enrich_client_properties(items: list[dict], payload: dict, *, expected_client_sha256: str | None = None) -> dict:
    """Check all profiles before installing any fixed slots on loaded records."""
    if not isinstance(payload, dict) or type(payload.get("version")) is not int or payload["version"] != 1:
        raise ValueError("Неверная версия фиксированных свойств клиента")
    source = payload.get("source")
    validated = validate_client_source(source)
    file_hash = validated["file_hash"]
    if source.get("type_table_sha256") != TYPE_TABLE_SHA256:
        raise ValueError("Изменился первичный справочник типов свойств")
    if expected_client_sha256 is not None:
        if (not isinstance(expected_client_sha256, str)
                or not re.fullmatch(r"[0-9a-fA-F]{64}", expected_client_sha256)
                or expected_client_sha256.lower() != file_hash):
            raise ValueError("Свойства и скорости получены из разных файлов клиента")
    profiles = payload.get("items")
    if not isinstance(profiles, list):
        raise ValueError("Неверный список фиксированных свойств клиента")
    by_id = {item["id"]: item for item in items}
    seen, pending = set(), []
    coverage = Counter({key: 0 for key in (
        "client_fixed_profiles", "client_fixed_slots", "client_fixed_known_slots", "client_fixed_unknown_slots",
        "client_fixed_skill_proc_slots", "client_fixed_other_unknown_slots", "client_fixed_required_profiles",
        "client_fixed_empty_profiles", "client_fixed_unmatched_profiles")})
    for profile in profiles:
        if not isinstance(profile, dict):
            raise ValueError("Неверная запись фиксированных свойств")
        item_id = profile.get("item_id")
        if type(item_id) is not int or item_id <= 0 or item_id in seen:
            raise ValueError("Неверный или повторный ID фиксированных свойств")
        seen.add(item_id)
        table = profile.get("table")
        if table not in _TABLES or profile.get("fixed") is not True:
            raise ValueError("Случайный пул не является фиксированным блоком клиента")
        section, row_size, max_count = _TABLES[table]
        offset, fixed = profile.get("offset"), profile.get("fixed_props")
        if (type(offset) is not int or offset < 4 or offset % 4 or offset + row_size > validated["size"]
                or type(fixed) is not int or fixed <= 0 or not isinstance(profile.get("name"), str)
                or not profile["name"].strip()):
            raise ValueError("Неверное имя или смещение фиксированного предмета")
        probabilities = profile.get("raw_count_probabilities")
        if (not isinstance(probabilities, dict) or set(probabilities) != {str(i) for i in range(max_count + 1)}
                or any(not _number(value) or not 0 <= value <= 1 for value in probabilities.values())
                or abs(sum(probabilities.values()) - 1) > 0.00001):
            raise ValueError("Неверные вероятности числа свойств клиента")
        required = probabilities["0"] == 0
        if (type(profile.get("guaranteed")) is not bool or profile["guaranteed"] != required
                or type(profile.get("source_required")) is not bool or profile["source_required"] != required):
            raise ValueError("Неверная обязательность фиксированного блока")
        groups = {}
        for field in ("addons", "non_generating_addons"):
            raw = profile.get(field, [])
            if not isinstance(raw, list) or len(raw) > 80:
                raise ValueError("Неверный список свойств фиксированного предмета")
            groups[field] = [_slot(value, file_hash) for value in raw]
        if probabilities["0"] == 1 and groups["addons"]:
            raise ValueError("Негенерируемые свойства клиента не могут быть активными")
        slots = [slot for slot in groups["addons"] if slot["kind"] == "options"]
        count = profile.get("addon_count")
        if type(count) is not int or not 0 <= count <= 32 or count != len(slots):
            raise ValueError("Число фиксированных slots не соответствует addon_count")
        original = groups["non_generating_addons"] if probabilities["0"] == 1 else groups["addons"]
        complete = all(slot["known"] for slot in original if slot["kind"] == "options")
        if type(profile.get("complete")) is not bool or profile["complete"] != complete:
            raise ValueError("Неверный статус полноты фиксированного блока")
        record = by_id.get(item_id)
        if record is None:
            coverage["client_fixed_unmatched_profiles"] += 1
            continue
        if (record.get("section") != section or " ".join(profile["name"].split())
                != " ".join(record.get("name", "").split())):
            raise ValueError(f"Изменилось имя или раздел предмета{item_id}")
        origin = record.get("source", {})
        if not isinstance(origin, dict) or not isinstance(origin.get("client_fixed_properties", {}), dict):
            raise ValueError("Неверная история источника фиксированного предмета")
        speed_source = origin.get("client_attack_speed")
        if speed_source is not None and (not isinstance(speed_source, dict)
                                        or speed_source.get("file_sha256") != file_hash
                                        or speed_source.get("schema_sha256") != validated["schema_hash"]):
            raise ValueError("Свойства и скорость предмета получены из разных источников")
        proof = {"file_sha256": file_hash, "schema_sha256": validated["schema_hash"], "table": table,
                 "row_offset": offset, "fixed_props": fixed, "complete": complete,
                 "raw_count_probabilities": copy.deepcopy(probabilities), "type_table_sha256": TYPE_TABLE_SHA256}
        old = origin.get("client_fixed_properties", {}).get("previous_defaults")
        if old is not None:
            proof["previous_defaults"] = copy.deepcopy(old)
        elif "default_addons" in record or "default_addons_source" in record:
            proof["previous_defaults"] = {key: copy.deepcopy(record[field]) for key, field in
                                          (("addons", "default_addons"), ("source", "default_addons_source"))
                                          if field in record}
        pending.append((record, {"required": required, "slots": slots}, proof))
        coverage["client_fixed_profiles"] += 1
        coverage["client_fixed_slots"] += len(slots)
        coverage["client_fixed_known_slots"] += sum(slot["known"] for slot in slots)
        unknown = [slot for slot in slots if not slot["known"]]
        coverage["client_fixed_unknown_slots"] += len(unknown)
        skill_procs = sum(slot.get("reason") == "skill_proc" for slot in unknown)
        coverage["client_fixed_skill_proc_slots"] += skill_procs
        coverage["client_fixed_other_unknown_slots"] += len(unknown) - skill_procs
        coverage["client_fixed_required_profiles"] += required
        coverage["client_fixed_empty_profiles"] += not slots
    for record, block, proof in pending:
        record["client_fixed_addons"] = block
        record.setdefault("source", {})["client_fixed_properties"] = proof
        record.pop("default_addons", None)
        record.pop("default_addons_source", None)
    return dict(coverage)
