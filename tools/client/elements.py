"""Read ten item tables from the documented Comeback elements layout.

This reader never changes its input, interprets no NPC or account data, and
rejects other headers rather than rewriting them to a presumed PW version.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema_30003.json")
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
APS_REFERENCE_URL = "https://github.com/Wrechid/sELedit-/blob/master/sELedit/COMMON/GetProps/WEAPON_ESSENCE.cs"
MAX_FILE_BYTES = 256 * 1024 * 1024
MAX_TABLE_ROWS = 100_000
_SCALARS = {"int32": (4, "<i"), "float": (4, "<f")}


class ElementsFormatError(ValueError):
    """The supplied file does not satisfy the supported item layout."""


def _width(kind: str) -> int:
    if kind in _SCALARS:
        return _SCALARS[kind][0]
    prefix, _, amount = kind.partition(":")
    if prefix not in {"string", "wstring"} or not amount.isdecimal():
        raise ElementsFormatError(f"Unsupported schema field type: {kind}")
    return int(amount)


def _value(data: bytes, offset: int, kind: str):
    if kind in _SCALARS:
        value = struct.unpack_from(_SCALARS[kind][1], data, offset)[0]
        if isinstance(value, float) and not math.isfinite(value):
            raise ElementsFormatError(f"Nonfinite float at byte {offset}")
        return value
    value = data[offset:offset + _width(kind)]
    if kind.startswith("wstring:"):
        try:
            return value.decode("utf-16-le").split("\0", 1)[0]
        except UnicodeDecodeError as error:
            raise ElementsFormatError(f"Invalid UTF-16 string at byte {offset}") from error
    value = value.split(b"\0", 1)[0]
    try:
        return value.decode("gb18030")
    except UnicodeDecodeError:
        # Asset paths are evidence only. Preserve bytes without inventing text.
        return {"raw_hex": value.hex()}


def _validate_references(tables: list[dict]) -> None:
    addon_ids = {row["ID"] for row in tables[0]["rows"]}
    for index, major_index, subtype_index in ((3, 1, 2), (6, 4, 5), (9, 7, 8)):
        major_ids = {row["ID"] for row in tables[major_index]["rows"]}
        subtype_ids = {row["ID"] for row in tables[subtype_index]["rows"]}
        for row in tables[index]["rows"]:
            if row["id_major_type"] not in major_ids or row["id_sub_type"] not in subtype_ids:
                raise ElementsFormatError(f"Invalid major/subtype reference in item {row['ID']}")
            for key, value in row.items():
                if ((key.startswith(("addons_", "rands_", "uniques_")) and "_id_" in key)
                        or key == "levelup_addon") and value and value not in addon_ids:
                    raise ElementsFormatError(f"Invalid addon reference {value} in item {row['ID']}")


def read_elements(path: Path | str) -> dict:
    """Return validated raw rows plus source metadata for the first ten tables.

    File paths in returned provenance are basenames. Trailing tables are neither
    decoded nor exported; the whole input is hashed to identify the source.
    """
    path = Path(path)
    size = path.stat().st_size
    if not 8 <= size <= MAX_FILE_BYTES:
        raise ElementsFormatError("Invalid file bounds for elements header")
    data = path.read_bytes()
    schema_bytes = SCHEMA_PATH.read_bytes()
    schema = json.loads(schema_bytes)
    version, signature = struct.unpack_from("<HH", data)
    if (version, signature) != (schema["format_version"], schema["signature"]):
        raise ElementsFormatError(f"Unsupported elements header: {version}/{signature}")
    position = schema["header_bytes"]
    tables = []
    for layout in schema["tables"]:
        position += layout["padding_bytes"]
        if position + 4 > len(data):
            raise ElementsFormatError(f"Count bounds exceeded at {layout['name']}")
        count = struct.unpack_from("<I", data, position)[0]
        position += 4
        row_size = sum(_width(kind) for _, kind in layout["fields"])
        if row_size != layout["row_size"]:
            raise ElementsFormatError(f"Schema row size mismatch in {layout['name']}")
        if count > MAX_TABLE_ROWS or position + count * row_size > len(data):
            raise ElementsFormatError(f"Record count/bounds exceeded at {layout['name']}")
        rows = []
        ids = set()
        for index in range(count):
            offset = position + index * row_size
            row = {"_offset": offset}
            for name, kind in layout["fields"]:
                value = _value(data, offset, kind)
                if "probability" in name and not 0 <= value <= 1.00001:
                    raise ElementsFormatError(f"Invalid probability at byte {offset}")
                row[name] = value
                offset += _width(kind)
            if row["ID"] <= 0 or row["ID"] in ids:
                raise ElementsFormatError(f"Invalid/duplicate ID {row['ID']} in {layout['name']}")
            ids.add(row["ID"])
            if any(ord(char) < 32 for char in row["Name"]):
                raise ElementsFormatError(f"Control character in name of item {row['ID']}")
            rows.append(row)
        tables.append({"name": layout["name"], "count": count, "row_size": row_size,
                       "offset": position, "blank_names": sum(not row["Name"] for row in rows), "rows": rows})
        position += count * row_size
    _validate_references(tables)
    return {"source": {"kind": "client_elements", "file_name": path.name, "bytes": len(data),
                       "sha256": hashlib.sha256(data).hexdigest(), "header_version": version,
                       "header_signature": signature, "timestamp": struct.unpack_from("<I", data, 4)[0],
                       "schema_sha256": hashlib.sha256(schema_bytes).hexdigest(),
                       "scope": [table["name"] for table in tables]},
            "parsed_bytes": position, "tables": tables}


def bonus_inputs(parsed: dict) -> dict:
    """Expose item facts and raw addon pools without interpreting their effects."""
    tables = parsed["tables"]
    items = []
    for index in (3, 6, 9):
        table = tables[index]
        for row in table["rows"]:
            item = {key: value for key, value in row.items()
                    if not key.startswith(("addons_", "rands_", "uniques_", "file_", "probability_addon_"))
                    and key not in {"_offset", "realname"}}
            item.update(table=table["name"], offset=row["_offset"])
            item["addon_count_probabilities"] = {
                key.removeprefix("probability_addon_num"): value
                for key, value in row.items() if key.startswith("probability_addon_num")}
            for prefix, stem, amount in (("addons", "addon", 32), ("rands", "rand", 32), ("uniques", "unique", 16)):
                item[prefix] = [{"id": row[f"{prefix}_{i}_id_{stem}"],
                                 "probability": row[f"{prefix}_{i}_probability_{stem}"]}
                                for i in range(1, amount + 1) if row.get(f"{prefix}_{i}_id_{stem}")]
            items.append(item)
    return {"source": parsed["source"], "parsed_bytes": parsed["parsed_bytes"],
            "tables": [{key: value for key, value in table.items() if key != "rows"} for table in tables],
            "addons": tables[0]["rows"], "weapon_subtypes": tables[2]["rows"], "items": items}


def build_speed_reference(parsed: dict, catalog: list[dict], *, command: str = "") -> dict:
    """Resolve every existing catalog weapon through its actual client subtype."""
    weapons = {row["ID"]: row for row in parsed["tables"][3]["rows"]}
    subtypes = {row["ID"]: row for row in parsed["tables"][2]["rows"]}
    entries = []
    seen = set()
    for item in catalog:
        if item.get("section") != "weapon":
            continue
        item_id = item["id"]
        if item_id in seen:
            raise ElementsFormatError(f"Duplicate catalog weapon {item_id}")
        seen.add(item_id)
        if item_id not in weapons:
            raise ElementsFormatError(f"Catalog weapon {item_id} missing from client")
        weapon = weapons[item_id]
        subtype = subtypes[weapon["id_sub_type"]]
        interval = subtype["attack_speed"]
        if interval <= 0:
            raise ElementsFormatError(f"Nonpositive weapon interval for {item_id}")
        speed_probabilities = [subtype[f"probability_{name}"] for name in
                               ("fastest", "fast", "normal", "slow", "slowest")]
        if speed_probabilities != [0.0, 0.0, 1.0, 0.0, 0.0]:
            raise ElementsFormatError(f"Ambiguous subtype speed probabilities for {item_id}")
        catalog_range = item.get("stats", {}).get("range")
        entries.append({"item_id": item_id, "attack_interval": interval, "aps": round(1 / interval, 2),
                        "range": weapon["attack_range"], "range_matches_catalog":
                        catalog_range is not None and abs(catalog_range - weapon["attack_range"]) <= 0.00001,
                        "normal_probability": subtype["probability_normal"], "row_offset": weapon["_offset"],
                        "subtype_id": subtype["ID"], "subtype_offset": subtype["_offset"]})
    source = {**parsed["source"], "command": command, "aps_reference_url": APS_REFERENCE_URL}
    return {"version": 1, "source": source, "items": sorted(entries, key=lambda item: item["item_id"])}


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--elements", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path, help="Compact item export under the repository .cache")
    parser.add_argument("--catalog", type=Path)
    parser.add_argument("--speeds-output", type=Path)
    args = parser.parse_args(argv)
    root = REPOSITORY_ROOT
    output = args.output.resolve()
    if not output.is_relative_to(root / ".cache") or output.suffix != ".json":
        parser.error("--output must be a .json file under repository .cache")
    if bool(args.catalog) != bool(args.speeds_output):
        parser.error("--catalog and --speeds-output must be used together")
    if args.speeds_output and args.speeds_output.resolve() != root / "data" / "catalog_client_speeds.json":
        parser.error("--speeds-output must be data/catalog_client_speeds.json")
    inputs = {args.elements.resolve()}
    if args.catalog:
        inputs.add(args.catalog.resolve())
    outputs = {output}
    if args.speeds_output:
        outputs.add(args.speeds_output.resolve())
    if inputs & outputs or any(destination.exists() and source.exists() and destination.samefile(source)
                               for destination in outputs for source in inputs):
        parser.error("Read-only input must not be used as an output")
    parsed = read_elements(args.elements)
    inputs = bonus_inputs(parsed)
    speeds = None
    if args.catalog:
        command = ("python -m tools.client.elements --elements <client>/elements.data "
                   "--output .cache/client-data/item-inputs.json --catalog data/catalog_items.json "
                   "--speeds-output data/catalog_client_speeds.json")
        speeds = build_speed_reference(parsed, json.loads(args.catalog.read_text(encoding="utf-8")), command=command)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(inputs, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    if speeds is not None:
        metadata = json.dumps({key: value for key, value in speeds.items() if key != "items"}, ensure_ascii=False)
        rows = ",\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in speeds["items"])
        args.speeds_output.write_text(metadata[:-1] + ',"items":[\n' + rows + "\n]}\n", encoding="utf-8")
    print(f"Read {sum(table['count'] for table in parsed['tables'])} item-table rows; source unchanged")


if __name__ == "__main__":
    main()
