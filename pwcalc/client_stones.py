"""Join reviewed stone facts in memory, retaining the original website record."""

from __future__ import annotations

import copy
import math
import re

from pwcalc.client_data import validate_client_source

_LABELS = {
    "phys_atk": "Физическая атака", "mag_atk": "Магическая атака",
    "phys_def": "Физическая защита", "mag_def": "Магическая защита",
    "hp": "Здоровье", "mp": "Мана", "accuracy": "Меткость", "evasion": "Уклонение",
    "vit": "Телосложение", "crit": "Крит", "cast_time": "Время пения",
    "attack_level": "Показатель атаки", "defense_level": "Показатель защиты",
}
for _element, _name in (("metal", "металла"), ("wood", "дерева"), ("water", "воды"),
                        ("fire", "огня"), ("earth", "земли")):
    _LABELS[f"def_{_element}"] = f"Защита от {_name}"
    _LABELS[f"weapon_damage_{_element}"] = f"Урон от {_name}"


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e9


def enrich_client_stones(stones: list[dict], payload: dict) -> dict:
    """Validate every row first; never read a game installation at runtime."""
    if not isinstance(payload, dict) or type(payload.get("version")) is not int or payload["version"] != 1:
        raise ValueError("Неверная версия клиентских камней")
    source = payload.get("source")
    validated = validate_client_source(source)
    table = payload.get("table")
    if (not isinstance(table, dict) or table.get("row_size") != 436 or table.get("count") != 198
            or table.get("start") != 11557358 or table.get("end") != 11643686):
        raise ValueError("Изменилась проверенная таблица клиентских камней")
    corrections = payload.get("corrections")
    if not isinstance(corrections, list):
        raise ValueError("Неверный список клиентских камней")
    by_id = {stone["id"]: stone for stone in stones}
    pending = []
    seen = set()
    unknown_effects = 0
    for entry in corrections:
        if not isinstance(entry, dict):
            raise ValueError("Неверная строка клиентского камня")
        item_id = entry.get("item_id")
        if type(item_id) is not int or item_id <= 0 or item_id in seen:
            raise ValueError("Неверный или повторный ID клиентского камня")
        seen.add(item_id)
        origin, effects = entry.get("source"), entry.get("effects")
        if not isinstance(origin, dict) or not isinstance(effects, dict) or set(effects) != {"weapon", "armor"}:
            raise ValueError("Неверные эффекты клиентского камня")
        offset = origin.get("record_offset")
        if (type(offset) is not int or not table["start"] <= offset < table["end"]
                or (offset - table["start"]) % 436 or offset + 436 > validated["size"]):
            raise ValueError("Неверное смещение клиентского камня")
        if (not isinstance(entry.get("name"), str) or not entry["name"].strip()
                or type(entry.get("grade")) is not int or not 0 < entry["grade"] <= 100
                or origin.get("comeback_url") != f"https://comeback.pw/db/146/item/{item_id}"
                or not isinstance(origin.get("comeback_html_sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", origin["comeback_html_sha256"])):
            raise ValueError("Неверное описание/источник клиентского камня")
        definitions = origin.get("addon_definitions")
        if not isinstance(definitions, dict):
            raise ValueError("Нет первичных параметров клиентского камня")
        for target, effect in effects.items():
            definition = definitions.get(target)
            if (not isinstance(effect, dict) or not isinstance(definition, dict)
                    or type(effect.get("client_addon_id")) is not int or effect["client_addon_id"] <= 0
                    or definition.get("ID") != effect["client_addon_id"]
                    or not isinstance(definition.get("raw_params"), list) or len(definition["raw_params"]) != 3
                    or any(type(value) is not int for value in definition["raw_params"])
                    or type(effect.get("percent")) is not bool
                    or not isinstance(effect.get("raw"), str) or not isinstance(effect.get("client_raw"), str)):
                raise ValueError("Неверное подтверждение эффекта клиентского камня")
            if effect.get("method") == "unresolved":
                if effect.get("value") is not None or effect.get("typed_stat") is not None:
                    raise ValueError("Неизвестный эффект камня получил выдуманное число")
                unknown_effects += 1
            elif (effect.get("method") not in {"primary_type_registry", "client_tooltip_and_equal_scalar"}
                    or effect.get("typed_stat") not in _LABELS
                    or effect.get("stat") != _LABELS[effect["typed_stat"]]
                    or not _number(effect.get("value"))):
                raise ValueError("Неверное значение клиентского камня")
        stone = by_id.get(item_id)
        if stone is None:
            continue
        if (stone.get("section") != "stones" or stone.get("name") != entry["name"]
                or stone.get("grade") != entry["grade"] or not isinstance(stone.get("source"), dict)
                or stone["source"].get("url") != origin["comeback_url"]
                or stone["source"].get("html_sha256") != origin["comeback_html_sha256"]):
            raise ValueError("Изменился исходный камень 1.4.6")
        proof = {"file_sha256": validated["file_hash"], "schema_sha256": validated["schema_hash"],
                 "header_version": source["header_version"], "header_signature": source["header_signature"],
                 "record_offset": offset, "raw_fields": copy.deepcopy(origin.get("raw_fields")),
                 "addon_definitions": copy.deepcopy(definitions),
                 "old_effects": copy.deepcopy(stone["source"].get("client_stones", {}).get(
                     "old_effects", origin.get("old_effects", stone.get("effects", {}))))}
        pending.append((stone, copy.deepcopy(effects), proof))
    for stone, effects, proof in pending:
        stone["effects"] = effects
        stone["source"]["client_stones"] = proof
    return {"client_stones": len(pending), "client_stone_rows_unmatched": len(corrections) - len(pending),
            "client_stone_unknown_effects": unknown_effects}


__all__ = ["enrich_client_stones", "validate_client_source"]
