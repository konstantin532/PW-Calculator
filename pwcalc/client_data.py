"""Apply reviewed client speed facts without reading a player's installation."""
from __future__ import annotations

import hashlib
import math
import re
from pathlib import Path

_SCHEMA = Path(__file__).resolve().parents[1] / "tools/client/schema_30003.json"
_APS_REFERENCE = "https://github.com/Wrechid/sELedit-/blob/master/sELedit/COMMON/GetProps/WEAPON_ESSENCE.cs"


def _number(value) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def _hash(value) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", value):
        raise ValueError("Неверный SHA256 клиентских данных")
    return value.lower()


def validate_client_source(source: dict) -> dict:
    """Validate shared item provenance using only the repository's own schema."""
    if not isinstance(source, dict):
        raise ValueError("Нет источника клиентских данных")
    if (source.get("kind") != "client_elements" or source.get("file_name") != "elements.data"
            or type(source.get("header_version")) is not int or source["header_version"] != 30003
            or type(source.get("header_signature")) is not int or source["header_signature"] != 12288):
        raise ValueError("Неверный header клиентских данных")
    file_hash = _hash(source.get("sha256"))
    schema_hash = _hash(source.get("schema_sha256"))
    if schema_hash != hashlib.sha256(_SCHEMA.read_bytes()).hexdigest():
        raise ValueError("Изменилась схема клиентских данных")
    size = source.get("bytes")
    if type(size) is not int or size < 8:
        raise ValueError("Неверный размер клиентского источника")
    return {"file_hash": file_hash, "schema_hash": schema_hash, "size": size}


def enrich_client_speeds(items: list[dict], payload: dict) -> dict[str, int]:
    """Validate an entire sidecar, then update matching weapons in memory.

    Unknown item IDs and nonweapon records are left unchanged. Existing weapons
    without a client row retain their prior evidence and count as unknown here.
    Historical DB values and earlier corrections, including game captures, stay
    under their existing keys. Only our client evidence is refreshed.
    """
    if not isinstance(payload, dict) or type(payload.get("version")) is not int or payload["version"] != 1:
        raise ValueError("Неверная версия клиентских скоростей")
    source = payload.get("source")
    validated = validate_client_source(source)
    file_hash, schema_hash, size = (validated[key] for key in ("file_hash", "schema_hash", "size"))
    if source.get("aps_reference_url") != _APS_REFERENCE:
        raise ValueError("Неверный первичный источник скорости")
    entries = payload.get("items")
    if not isinstance(entries, list):
        raise ValueError("Неверный список клиентских скоростей")
    by_id = {item["id"]: item for item in items}
    weapon_ids = {item["id"] for item in items if item.get("section") == "weapon"}
    pending = []
    seen = set()
    unmatched = 0
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Неверная строка клиентской скорости")
        item_id = entry.get("item_id")
        if type(item_id) is not int or item_id <= 0 or item_id in seen:
            raise ValueError("Неверный или повторный ID клиентской скорости")
        seen.add(item_id)
        interval, speed, distance = (entry.get(key) for key in ("attack_interval", "aps", "range"))
        if (not _number(interval) or interval <= 0 or not _number(speed) or not 0 < speed <= 5
                or speed != round(1 / interval, 2) or not _number(distance) or distance < 0):
            raise ValueError(f"Неверная клиентская скорость/дальность предмета{item_id}")
        if (entry.get("range_matches_catalog") is not True
                or not _number(entry.get("normal_probability")) or entry["normal_probability"] != 1):
            raise ValueError(f"Не подтверждены условия скорости предмета{item_id}")
        for field, width in (("row_offset", 1424), ("subtype_offset", 356)):
            offset = entry.get(field)
            if type(offset) is not int or offset < 4 or offset % 4 or offset + width > size:
                raise ValueError(f"Неверное смещение клиентских данных предмета{item_id}")
        if type(entry.get("subtype_id")) is not int or entry["subtype_id"] <= 0:
            raise ValueError(f"Неверный subtype клиентского предмета{item_id}")
        if "name" in entry and not isinstance(entry["name"], str):
            raise ValueError(f"Неверное имя клиентского предмета{item_id}")
        record = by_id.get(item_id)
        if item_id not in weapon_ids:
            unmatched += 1
            continue
        if "name" in entry and entry["name"] != record.get("name", ""):
            raise ValueError(f"Изменилось имя предмета{item_id}")
        stats, origin = record.get("stats"), record.get("source", {})
        if (not isinstance(stats, dict) or not _number(stats.get("range")) or stats["range"] != distance
                or not isinstance(origin, dict) or not isinstance(origin.get("raw_stats", {}), dict)):
            raise ValueError(f"Изменилась база предмета{item_id}")
        if origin.get("version", "Comeback PW 1.4.6") != "Comeback PW 1.4.6":
            raise ValueError(f"Изменилась версия предмета{item_id}")
        proof = {"file_sha256": file_hash, "schema_sha256": schema_hash,
                 "header_version": source["header_version"], "header_signature": source["header_signature"],
                 "row_offset": entry["row_offset"], "subtype_id": entry["subtype_id"],
                 "subtype_offset": entry["subtype_offset"], "attack_interval": interval, "aps": speed,
                 "range": distance, "normal_probability": 1, "reference": _APS_REFERENCE}
        pending.append((record, proof))
    # No mutation occurs until all entries, including trailing rows, pass validation.
    for record, proof in pending:
        stats = record["stats"]
        origin = record.setdefault("source", {})
        origin.setdefault("raw_stats", {}).setdefault("atk_speed", stats.get("atk_speed"))
        origin["client_attack_speed"] = proof
        stats["atk_speed"] = proof["aps"]
        record["attack_speed_verified"] = True
    return {"client_weapon_speeds": len(pending),
            "client_weapon_speeds_unknown": len(weapon_ids) - len(pending),
            "client_speed_rows_unmatched": unmatched}
