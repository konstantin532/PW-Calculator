"""Join reviewed selections and item-specific speeds without replacing 146 data."""

from __future__ import annotations

import math


def enrich_item_defaults(items: list[dict], payload: dict) -> dict[str, int]:
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise ValueError("Неверная версия исходных свойств")
    by_id = {item["id"]: item for item in items}
    coverage = {"default_profiles": 0, "verified_weapon_speeds": 0, "property_corrections": 0}
    for field in ("property_corrections", "profiles", "weapon_speeds"):
        entries = payload.get(field, [])
        if not isinstance(entries, list):
            raise ValueError("Неверный список исходных свойств")
        seen = set()
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("Неверная запись исходных свойств")
            item_id = entry.get("item_id")
            if type(item_id) is not int or item_id <= 0 or item_id in seen:
                raise ValueError("Неверный или повторный ID исходных свойств")
            seen.add(item_id)
            record = by_id.get(item_id)
            if record is None:
                continue
            source = entry.get("source", {})
            if (source.get("comeback_url") != f"https://comeback.pw/db/146/item/{item_id}"
                    or source.get("comeback_html_sha256") != record.get("source", {}).get("html_sha256")):
                raise ValueError(f"Изменился источник исходных свойств предмета{item_id}")
            if field == "property_corrections":
                verified = source.get("verified_base_stats", {})
                stats = record.get("stats", {})
                bases = {"phys_def": stats.get("phys_def", 0), "hp": stats.get("hp", 0),
                         "elements": {key: stats.get(f"def_{key}", 0)
                                      for key in ("metal", "wood", "water", "fire", "earth")}}
                if verified != bases:
                    raise ValueError(f"Изменилась база исправленного предмета{item_id}")
                replacements = entry.get("replacements")
                if not isinstance(replacements, list) or not replacements:
                    raise ValueError("Нет подтверждённых исправлений свойства")
                corrections = {}
                options = [option for kind in ("options", "unique")
                           for option in record.get("addons", {}).get(kind, [])]
                for replacement in replacements:
                    old, new = replacement.get("was"), replacement.get("applied")
                    if not isinstance(old, str) or not isinstance(new, str) or not old or not new or old in corrections:
                        raise ValueError("Неверная или повторная поправка свойства")
                    matches = [option for option in options if option.get("text") == old]
                    if not matches:
                        raise ValueError(f"Исходная строка исправления отсутствует у предмета{item_id}")
                    for option in matches:
                        option["text"] = new
                    corrections[old] = new
                record["addon_corrections"] = corrections
                record.setdefault("source", {}).setdefault("corrections", {})["addons"] = {
                    "replacements": replacements, "verification": source.get("verification"),
                    "reference": source.get("api_url"), "api_sha256": source.get("api_sha256"),
                }
                coverage["property_corrections"] += 1
            elif field == "profiles":
                addons = entry.get("addons")
                if (not isinstance(addons, list) or not addons
                        or any(not isinstance(text, str) or not text for text in addons)):
                    raise ValueError("Неверный набор исходных свойств")
                record["default_addons"] = list(addons)
                record["default_addons_source"] = {
                    "label": "Исходный набор mypers, сверенный с Comeback1.4.6",
                    "comeback_url": source["comeback_url"],
                    "corrections": source.get("corrections", {}),
                }
                coverage["default_profiles"] += 1
            else:
                speed = entry.get("base_attack_speed")
                if type(speed) not in (int, float) or not math.isfinite(speed) or not 0 < speed <= 5:
                    raise ValueError("Неверная проверенная скорость оружия")
                stats = record.setdefault("stats", {})
                old_speed = stats.get("atk_speed")
                if old_speed != speed:
                    origin = record.setdefault("source", {})
                    origin.setdefault("raw_stats", {}).setdefault("atk_speed", old_speed)
                    origin.setdefault("corrections", {})["atk_speed"] = source.get("corrections", {}).get("atk_speed", {
                        "was": old_speed, "applied": speed,
                        "verification": "same_pw_id_and_both_146_base_attack_ranges",
                    })
                    stats["atk_speed"] = speed
                elif "atk_speed" not in record.get("source", {}).get("corrections", {}):
                    record.setdefault("source", {}).setdefault("corrections", {})["atk_speed"] = {
                        "was": old_speed, "applied": speed,
                        "verification": "same_pw_id_and_both_146_base_attack_ranges",
                        "reference": source.get("api_url"), "api_sha256": source.get("api_sha256"),
                    }
                coverage["verified_weapon_speeds"] += 1
    for record in items:
        if record.get("slot") != "weapon":
            continue
        speed = record.get("stats", {}).get("atk_speed")
        evidence = record.get("source", {}).get("corrections", {}).get("atk_speed", {})
        record["attack_speed_verified"] = (
            type(speed) in (int, float) and 0 < speed <= 5
            and evidence.get("value", evidence.get("applied")) == speed
        )
    return coverage
