"""Client stone effects use the target's addon ID, never its suggestive name."""

import copy
import hashlib
import struct
from pathlib import Path

import pytest

from pwcalc.client_stones import enrich_client_stones
from tools.client.stones import build_stone_reference, decode_stone_table


def source():
    from tools.client.properties import CLIENT_SHA256

    schema = Path(__file__).resolve().parents[1] / "tools/client/schema_30003.json"
    return {"kind": "client_elements", "file_name": "elements.data", "bytes": 69355251,
            "header_version": 30003, "header_signature": 12288, "sha256": CLIENT_SHA256,
            "schema_sha256": hashlib.sha256(schema.read_bytes()).hexdigest()}


def stone_catalog():
    effect = {"stat": "Защита", "value": None, "percent": False, "raw": "Защита +2",
              "source_value": 2, "ambiguity": "physical_defense_or_defense_level"}
    return [{"id": 25154, "name": "Камень лагеря", "grade": 13, "section": "stones",
             "effects": {"weapon": copy.deepcopy(effect), "armor": copy.deepcopy(effect)},
             "source": {"url": "https://comeback.pw/db/146/item/25154", "html_sha256": "a" * 64,
                        "version": "Comeback PW 1.4.6"}}]


def inputs():
    return {"source": source(), "table": {"start": 11557358, "count": 198, "row_size": 436,
            "end": 11643686}, "stones": [{"ID": 25154, "Name": "Камень лагеря", "level": 13,
            "_offset": 11611858, "id_sub_type": 12636, "id_addon_damage": 2309,
            "id_addon_defence": 2310, "weapon_desc": "Защита +2", "armor_desc": "Защита +2"}],
            "addons": [{"ID": i, "Name": "Атака" if i == 2309 else "Защита", "num_params": 1,
                        "param1": 2, "param2": 0, "param3": 0} for i in (2309, 2310)]}


def test_defense_level_stone_is_proved_by_both_target_addon_types():
    original = stone_catalog()
    reference = build_stone_reference(inputs(), original, {2309: 60, 2310: 60})
    assert original[0]["effects"]["weapon"]["value"] is None
    entry = reference["corrections"][0]
    for target, addon_id in (("weapon", 2309), ("armor", 2310)):
        effect = entry["effects"][target]
        assert (effect["stat"], effect["value"], effect["percent"]) == ("Показатель защиты", 2, False)
        assert effect["client_addon_id"] == addon_id
        assert effect["typed_stat"] == "defense_level"
        assert effect["method"] == "primary_type_registry"


def test_flat_tooltip_fallback_requires_exact_scalar_parameter():
    payload = inputs()
    payload["stones"][0]["weapon_desc"] = "Физ. атака +2"
    effect = build_stone_reference(payload, stone_catalog(), {})["corrections"][0]["effects"]["weapon"]
    assert (effect["typed_stat"], effect["value"]) == ("phys_atk", 2)
    assert effect["method"] == "client_tooltip_and_equal_scalar"
    payload["addons"][0]["param1"] = 99
    effect = build_stone_reference(payload, stone_catalog(), {})["corrections"][0]["effects"]["weapon"]
    assert effect["value"] is None


def test_unknown_percentage_never_reinterprets_integer_bits():
    payload = inputs()
    payload["stones"][0]["weapon_desc"] = "Физ. атака +2%"
    effect = build_stone_reference(payload, stone_catalog(), {})["corrections"][0]["effects"]["weapon"]
    assert effect["value"] is None


def test_ranged_parameter_cannot_become_a_permanent_maximum():
    payload = inputs()
    payload["addons"][0].update(num_params=2, param1=1, param2=2)
    effect = build_stone_reference(payload, stone_catalog(), {2309: 70})["corrections"][0]["effects"]["weapon"]
    assert effect["value"] is None


def test_runtime_preserves_original_ambiguity_and_is_idempotent():
    stones = stone_catalog()
    before = copy.deepcopy(stones[0])
    reference = build_stone_reference(inputs(), stones, {2309: 60, 2310: 60})
    result = enrich_client_stones(stones, reference)
    assert result["client_stones"] == 1
    assert stones[0]["source"]["url"] == before["source"]["url"]
    assert stones[0]["source"]["client_stones"]["old_effects"] == before["effects"]
    assert stones[0]["effects"]["weapon"]["value"] == 2
    snapshot = copy.deepcopy(stones)
    enrich_client_stones(stones, reference)
    assert stones == snapshot


def test_runtime_rejects_trailing_invalid_record_without_partial_mutation():
    stones = stone_catalog()
    reference = build_stone_reference(inputs(), stones, {2309: 60, 2310: 60})
    bad = copy.deepcopy(reference["corrections"][0])
    bad["item_id"] = 99999
    bad["effects"]["weapon"]["value"] = float("nan")
    reference["corrections"].append(bad)
    before = copy.deepcopy(stones)
    with pytest.raises(ValueError):
        enrich_client_stones(stones, reference)
    assert stones == before


@pytest.mark.parametrize("change", ["name", "grade", "hash"])
def test_runtime_rejects_stale_catalogue_identity(change):
    stones = stone_catalog()
    reference = build_stone_reference(inputs(), stones, {2309: 60, 2310: 60})
    if change == "hash":
        stones[0]["source"]["html_sha256"] = "b" * 64
    else:
        stones[0][change] = "another" if change == "name" else 14
    with pytest.raises(ValueError):
        enrich_client_stones(stones, reference)


def test_bounded_stone_decoder_handles_unaligned_absolute_offsets():
    row = bytearray(436)
    struct.pack_into("<ii", row, 0, 25154, 12636)
    name = "Камень лагеря".encode("utf-16-le")
    row[8:8 + len(name)] = name
    struct.pack_into("<i", row, 328, 13)
    struct.pack_into("<ii", row, 352, 2309, 2310)
    data = b"xx" + struct.pack("<i", 1) + row + b"PRIVATE TAIL"
    parsed = decode_stone_table(data, 6, 1, {2309, 2310}, {12636})
    assert parsed[0]["ID"] == 25154
    assert parsed[0]["level"] == 13
    assert parsed[0]["_offset"] == 6
    assert "PRIVATE TAIL" not in str(parsed)
    with pytest.raises(ValueError):
        decode_stone_table(data[:400], 6, 1, {2309, 2310}, {12636})


def test_reviewed_sidecar_covers_all_existing_stones_and_targets():
    import json

    root = Path(__file__).resolve().parents[1]
    reference = json.loads((root / "data/catalog_client_stones.json").read_text(encoding="utf-8"))
    catalog = json.loads((root / "data/catalog_stones.json").read_text(encoding="utf-8"))
    assert {r["item_id"] for r in reference["corrections"]} == {r["id"] for r in catalog}
    assert len(reference["corrections"]) == 126
    assert sum(len(r["effects"]) for r in reference["corrections"]) == 252
    assert reference["coverage"]["unknown_effects"] == 0
