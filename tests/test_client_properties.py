"""The original client distinguishes fixed property blocks from random pools."""

import copy
import struct

import pytest

from tools.client.properties import build_client_properties, format_addon


def definition(addon_id, params, name="test"):
    values = list(params) + [0, 0, 0]
    return {"ID": addon_id, "Name": name, "num_params": len(params),
            "param1": values[0], "param2": values[1], "param3": values[2]}


def float_bits(value):
    return struct.unpack("<i", struct.pack("<f", value))[0]


def source_item(item_id=21418, fixed=2, p0=0):
    return {"ID": item_id, "Name": "★Плащ прочности·Долина бога",
            "table": "ARMOR_ESSENCE", "offset": 6728716, "fixed_props": fixed,
            "addon_count_probabilities": {"0": p0, "3": 1 - p0},
            "addons": [{"id": i, "probability": int(i == 1451)}
                       for i in [1451, 1456, 1466, 1461, 333]],
            "rands": [], "uniques": []}


def inputs(item=None):
    return {"source": {"sha256": "client", "schema_sha256": "schema"},
            "addons": [definition(i, [6, 7]) for i in [1451, 1456, 1461, 1466]]
                      + [definition(333, [float_bits(.06)])],
            "items": [item or source_item()]}


TYPE_MAP = {1451: 41, 1456: 42, 1461: 43, 1466: 44, 333: 11}
CATALOG = [{"id": 21418, "name": "★Плащ прочности·Долина бога"}]


def test_cape_fixed_block_keeps_zero_probability_properties_and_ranges():
    original = inputs()
    before = copy.deepcopy(original)
    profile = build_client_properties(original, CATALOG, TYPE_MAP)["items"][0]
    assert original == before
    assert profile["fixed"] is True
    assert profile["guaranteed"] is True
    assert profile["addon_count"] == 5
    assert [a["stat"] for a in profile["addons"]] == ["str", "dex", "vit", "int", "cast_time"]
    assert profile["addons"][0]["text"] == "Сила +6~7"
    assert profile["addons"][1]["chance"] == 0
    assert profile["addons"][-1]["text"] == "Время пения -6%"
    assert profile["addons"][2]["min"] == 6
    assert profile["addons"][2]["max"] == 7


def test_optional_fixed_block_is_not_guaranteed():
    result = build_client_properties(inputs(source_item(p0=1)), CATALOG, TYPE_MAP)
    assert result["items"][0]["guaranteed"] is False


def test_random_pool_does_not_become_fixed_or_force_five_properties():
    profile = build_client_properties(inputs(source_item(fixed=0)), CATALOG, TYPE_MAP,
                                      include_random=True)["items"][0]
    assert profile["fixed"] is False
    assert profile["guaranteed"] is False
    assert profile["addon_count"] == 3


def test_unknown_fixed_addon_is_explicit_and_has_no_invented_value():
    unknown = inputs()
    profile = build_client_properties(unknown, CATALOG, {1451: 41})["items"][0]
    assert profile["complete"] is False
    assert profile["guaranteed"] is True
    assert len(profile["addons"]) == 5
    assert profile["addons"][1]["known"] is False
    assert profile["addons"][1]["stat"] is None
    assert profile["addons"][1]["min"] is None


def test_same_number_bits_are_converted_only_for_typed_percentage_fields():
    bits = float_bits(.03)
    percent = format_addon(definition(358, [bits]), {358: 45})
    assert (percent["stat"], percent["min"], percent["percent"]) == ("crit", 3, True)
    integer = format_addon(definition(1451, [bits, bits]), {1451: 41})
    assert integer["known"] is False  # The enormous integer is invalid, never 3%.


@pytest.mark.parametrize("type_id,stat,label", [(43, "int", "Интеллект"), (44, "vit", "Телосложение")])
def test_intelligence_and_vitality_are_not_swapped(type_id, stat, label):
    addon = format_addon(definition(10, [6, 10]), {10: type_id})
    assert addon["stat"] == stat
    assert addon["text"] == f"{label} +6~10"


def test_regeneration_uses_primary_formatter_half_units():
    addon = format_addon(definition(10, [40]), {10: 39})
    assert (addon["stat"], addon["min"], addon["text"]) == ("hp_regen", 20, "Скор. восст. HP +20")


def test_changed_name_and_reserved_empty_rows_are_not_exported():
    for name in ["Другой предмет", ""]:
        value = inputs()
        value["items"][0]["Name"] = name
        assert build_client_properties(value, CATALOG, TYPE_MAP)["items"] == []


def test_zero_probability_count_has_no_active_block_even_with_ids():
    item = source_item()
    item["addon_count_probabilities"] = {"0": 1}
    profile = build_client_properties(inputs(item), CATALOG, TYPE_MAP)["items"][0]
    assert profile["addon_count"] == 0
    assert profile["guaranteed"] is False
    assert profile["addons"] == []
    assert len(profile["non_generating_addons"]) == 5


def test_duplicate_fixed_slots_are_preserved():
    item = source_item()
    item["addons"] = [{"id": 1451, "probability": .5}] * 2
    profile = build_client_properties(inputs(item), CATALOG, TYPE_MAP)["items"][0]
    assert profile["addon_count"] == 2
    assert len(profile["addons"]) == 2


def test_random_pools_are_audited_but_not_shipped_as_runtime_replacements():
    result = build_client_properties(inputs(source_item(fixed=0)), CATALOG, TYPE_MAP)
    assert result["items"] == []
    assert result["coverage"]["random_items"] == 1


def test_custom_alias_requires_the_pinned_client_and_exact_signature():
    from tools.client.properties import CLIENT_SHA256

    item = definition(6000, [12, 12], "Интеллект +12")
    assert format_addon(item, {}, client_hash=CLIENT_SHA256)["stat"] == "int"
    assert format_addon(item, {}, client_hash="other")["known"] is False
    item["param1"] = 19
    assert format_addon(item, {}, client_hash=CLIENT_SHA256)["known"] is False


def test_r9_fixed_five_properties_are_not_capped_by_source_count_three():
    item = source_item(item_id=25718, fixed=3)
    item["Name"] = "★★Мантия мага небес"
    rows = [definition(1349, [180, 180]), definition(2024, [float_bits(.01)]),
            definition(2273, [6, 10]), definition(2168, [float_bits(.02)]),
            definition(2302, [float_bits(.04)])]
    item["addons"] = [{"id": row["ID"], "probability": .2} for row in rows]
    result = build_client_properties({"source": {}, "addons": rows, "items": [item]},
                                    [{"id": 25718, "name": item["Name"]}],
                                    {1349: 35, 2024: 45, 2273: 44, 2168: 13, 2302: 61})
    profile = result["items"][0]
    assert profile["addon_count"] == 5
    assert [a["text"] for a in profile["addons"]] == ["Здоровье +180", "Крит +1%",
        "Телосложение +6~10", "Физическая защита +2%", "Магическая защита +4%"]
    assert result["coverage"]["fixed_count_expanded"] == 1


def test_skill_proc_does_not_turn_its_skill_number_into_passive_stats():
    result = format_addon(definition(500, [1234], "PROC_04"), {500: 55})
    assert result["reason"] == "skill_proc"
    assert result["min"] is None
    assert result["stat"] is None
    assert result["raw_params"] == [1234, 0, 0]
    assert "500" in result["text"] and "PROC_04" in result["text"]


def test_primary_type_table_tampering_is_rejected(tmp_path):
    from tools.client.properties import load_type_map

    source = tmp_path / "addon_table.txt"
    source.write_text("1451\t44", encoding="utf-16")
    with pytest.raises(ValueError, match="Unverified"):
        load_type_map(source)


def test_percent_float_noise_has_one_canonical_value_in_text_and_bounds():
    # ID 464 on item14814: the stored float32 is 0.30000001192092896.
    result = format_addon(definition(464, [1050253722]), {464: 47})
    assert result["min"] == result["max"] == 30
    assert result["text"] == "Меткость +30%"


def test_decimal_percentage_text_keeps_the_same_bound_precision():
    result = format_addon(definition(1, [float_bits(.123456)]), {1: 47})
    assert result["text"] == f"Меткость +{result['min']}%"

