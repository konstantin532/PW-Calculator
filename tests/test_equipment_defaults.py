import copy
import json
from pathlib import Path

from tools.mypers.equipment_defaults import build_catalog_defaults, parse_addon

ROOT = Path(__file__).resolve().parents[1]


def source_item(item_id, options, count="3", unique=None):
    item = {
        "id": item_id, "name": "Кольцо 146", "slot": "ring", "addons": {"count": count, "options": options},
        "source": {"url": f"https://comeback.pw/db/146/item/{item_id}", "html_sha256": "a" * 64},
    }
    if unique:
        item["addons"]["unique"] = unique
    return item


def original(item_id=26389, addons=None):
    return {"id": 174, "pw_id": item_id, "nw": {"wu": addons if addons is not None else [
        {"type": "ci", "val": 6}, {"type": "ed", "val": 3}, {"type": "ad", "val": 2},
    ]}}


def build(items, records):
    return build_catalog_defaults(items, {"oq": {"success": True, "data": records}}, {"oq": "b" * 64})


def test_cloud_ring_preset_comes_only_from_exact_matching_146_properties():
    items = json.loads((ROOT / "data/catalog_items.json").read_text(encoding="utf-8"))
    ring = next(item for item in items if item["id"] == 26389)
    before = copy.deepcopy(ring)
    result = build([ring], [original()])
    profile = result["profiles"][0]
    assert profile["item_id"] == 26389
    assert profile["addons"] == ["Время пения -6%", "Крит +3%", "Показатель атаки +2"]
    assert profile["source"]["mypers_id"] == 174
    assert profile["source"]["pw_id"] == 26389
    assert profile["source"]["api_sha256"] == "b" * 64
    assert profile["source"]["comeback_url"] == "https://comeback.pw/db/146/item/26389"
    assert ring == before
    assert "guaranteed" not in json.dumps(profile)


def test_changed_values_unknown_types_and_absent_modern_items_are_rejected_as_whole_profiles():
    item = source_item(26389, [
        {"text": "Крит +3%", "chance": 33.33}, {"text": "Время пения -6%", "chance": 33.33},
        {"text": "Показатель атаки +2", "chance": 33.33},
    ])
    changed = original(addons=[{"type": "ed", "val": 4}])
    unknown = original(addons=[{"type": "combat_spirit", "val": 10}])
    modern = original(item_id=999999)
    result = build([item], [changed, unknown, modern])
    assert result["profiles"] == []
    assert result["coverage"]["rejected"]["value_mismatch"] == 1
    assert result["coverage"]["rejected"]["unknown_type"] == 1
    assert result["coverage"]["rejected"]["missing_146_item"] == 1


def test_ranges_use_exact_original_roll_and_percentage_direction_is_preserved():
    item = source_item(1, [
        {"text": "Интеллект +14~15", "chance": 50}, {"text": "Время пения -1~3%", "chance": 50},
    ], count="2")
    profile = build([item], [original(1, [{"type": "tx", "val": 14}, {"type": "ci", "val": 2}])])["profiles"][0]
    assert profile["addons"] == ["Интеллект +14", "Время пения -2%"]
    assert parse_addon("Время пения -1~3%")["min"] == -3


def test_guaranteed_properties_are_not_copied_and_slots_include_them():
    item = source_item(2, [{"text": "Интеллект +18~19", "chance": 100}], count="2",
                       unique=[{"text": "Урон монстрам +60", "chance": 100}])
    result = build([item], [original(2, [{"type": "su", "val": 60}, {"type": "tx", "val": 19}])])
    assert result["profiles"][0]["addons"] == ["Интеллект +19"]
    assert result["coverage"]["guaranteed_properties_skipped"] == 1
    overflow = build([item], [original(2, [{"type": "tx", "val": 18}, {"type": "tx", "val": 19}])])
    assert overflow["profiles"] == []
    assert overflow["coverage"]["rejected"]["too_many_properties"] == 1


def test_duplicate_conflicting_original_presets_and_invalid_data_are_not_imported():
    item = source_item(3, [{"text": "Интеллект +14~15", "chance": 100}], count="1")
    result = build([item], [original(3, [{"type": "tx", "val": 14}]), original(3, [{"type": "tx", "val": 15}])])
    assert result["profiles"] == []
    assert result["coverage"]["rejected"]["conflicting_presets"] == 1
    invalid = build([item], [original(3, [{"type": "tx", "val": True}])])
    assert invalid["profiles"] == []
    assert invalid["coverage"]["rejected"]["invalid_value"] == 1


def test_9345_correction_uses_only_fixed_comeback_value_and_is_recorded():
    item = source_item(9345, [{"text": "Скор. восст. HP +20", "chance": 100}], count="1")
    item["slot"] = "chest"
    record = original(9345, [{"type": "cx", "val": 10}])
    result = build_catalog_defaults([item], {"rv": {"success": True, "data": [record]}}, {"rv": "b" * 64})
    profile = result["profiles"][0]
    assert profile["addons"] == ["Скор. восст. HP +20"]
    assert profile["source"]["corrections"] == [{"type": "cx", "original": 10, "applied": 20,
                                                  "reason": "fixed_146_value_overrides_mypers"}]
    item["addons"]["options"][0]["text"] = "Скор. восст. HP +19~20"
    rebuilt = build_catalog_defaults([item], {"rv": {"success": True, "data": [record]}}, {"rv": "b" * 64})
    assert rebuilt["profiles"] == []


def test_weapon_speed_is_cross_checked_per_item_including_low_raw_rank_values():
    items = json.loads((ROOT / "data/catalog_items.json").read_text(encoding="utf-8"))
    items = [item for item in items if item["id"] in [22, 12647, 33533]]
    records = [
        {"id": 560, "pw_id": 22, "sy": 1.11, "ld": [131, 196], "xq": None},
        {"id": 1837, "pw_id": 12647, "sy": 1.25, "ld": [663, 995], "xq": [1212, 1481]},
        {"id": 1905, "pw_id": 33533, "sy": 1.25, "ld": [456, 684], "xq": [831, 1016]},
    ]
    result = build_catalog_defaults(items, {"ta": {"success": True, "data": records}}, {"ta": "c" * 64})
    speeds = {record["item_id"]: record for record in result["weapon_speeds"]}
    assert {key: value["base_attack_speed"] for key, value in speeds.items()} == {22: 1.11, 12647: 1.25, 33533: 1.25}
    correction = speeds[22]["source"]["corrections"]["atk_speed"]
    assert correction["was"] == 4
    assert correction["applied"] == 1.11
    assert correction["scope"] == "item_22_only"
    assert result["profiles"] == []


def test_weapon_speed_requires_both_base_attack_ranges_and_rejects_conflicts():
    item = source_item(4, [], count="0")
    item.update(slot="weapon", stats={"phys_atk": [100, 200], "mag_atk": [30, 40], "atk_speed": 4})
    record = {"id": 1, "pw_id": 4, "sy": 1.11, "ld": [100, 200], "xq": [30, 41]}
    result = build_catalog_defaults([item], {"ta": {"success": True, "data": [record]}}, {"ta": "c" * 64})
    assert result["weapon_speeds"] == []
    assert result["coverage"]["speed_rejected"]["changed_attack_ranges"] == 1
    record["xq"] = [30, 40]
    second = {**record, "id": 2, "sy": 1.25}
    result = build_catalog_defaults([item], {"ta": {"success": True, "data": [record, second]}}, {"ta": "c" * 64})
    assert result["weapon_speeds"] == []
    assert result["coverage"]["speed_rejected"]["conflicting_speeds"] == 1


def test_modern_extras_are_ignored_only_when_exact_matches_fill_all_146_slots():
    item = source_item(7, [{"text": "Здоровье +180"}, {"text": "Телосложение +6~10"},
                           {"text": "Крит +1%"}])
    item["slot"] = "chest"
    record = original(7, [{"type": "wf_eg", "val": 2}, {"type": "hp", "val": 180},
                         {"type": "lf", "val": 10}, {"type": "ed", "val": 1},
                         {"type": "ab_gq_eg", "val": 4}])
    result = build_catalog_defaults([item], {"rv": {"success": True, "data": [record]}}, {"rv": "b" * 64})
    profile = result["profiles"][0]
    assert profile["addons"] == ["Здоровье +180", "Телосложение +10", "Крит +1%"]
    assert profile["source"]["ignored"] == [
        {"type": "wf_eg", "value": 2, "reason": "not_offered_by_146"},
        {"type": "ab_gq_eg", "value": 4, "reason": "not_offered_by_146"},
    ]
    assert result["coverage"]["profiles_with_ignored_extras"] == 1
    assert result["coverage"]["ignored_extra_properties"] == 2
    assert all("%" not in text for text in profile["addons"][:2])


def test_real_25718_properties_offered_by_146_cannot_be_dropped_to_fit_three_slots():
    items = json.loads((ROOT / "data/catalog_items.json").read_text(encoding="utf-8"))
    item = next(item for item in items if item["id"] == 25718)
    record = original(25718, [{"type": "wf_eg", "val": 2}, {"type": "hp", "val": 180},
                              {"type": "lf", "val": 10}, {"type": "ed", "val": 1},
                              {"type": "ab_gq_eg", "val": 4}])
    result = build_catalog_defaults([item], {"rv": {"success": True, "data": [record]}}, {"rv": "b" * 64})
    assert result["profiles"] == []
    assert result["coverage"]["rejected"]["too_many_properties"] == 1


def test_modern_extra_filter_does_not_create_an_incomplete_or_unknown_146_preset():
    item = source_item(5, [{"text": "Здоровье +180"}, {"text": "Телосложение +10"},
                           {"text": "Крит +1%"}])
    entries = [{"type": "hp", "val": 180}, {"type": "lf", "val": 10},
               {"type": "wf_eg", "val": 2}, {"type": "ab_gq_eg", "val": 4}, {"type": "cl", "val": 0.3}]
    result = build([item], [original(5, entries)])
    assert result["profiles"] == []
    assert result["coverage"]["rejected"]["incomplete_146_preset"] == 1
    for extra, reason in [({"type": "wf_eg", "val": None}, "invalid_value"),
                          ({"type": "unverified_power", "val": 10}, "unknown_type"),
                          ({"type": "hp", "val": 181}, "value_mismatch")]:
        result = build([item], [original(5, [*entries[:2], {"type": "ed", "val": 1}, extra])])
        assert result["profiles"] == []
        assert result["coverage"]["rejected"][reason] == 1


def test_ignored_extras_and_guaranteed_properties_do_not_fill_missing_editable_slots():
    item = source_item(6, [{"text": "Интеллект +18~19"}, {"text": "Здоровье +350"}], count="3",
                       unique=[{"text": "Урон монстрам +60", "chance": 100}])
    entries = [{"type": "su", "val": 60}, {"type": "tx", "val": 19}, {"type": "wf_eg", "val": 2}]
    result = build([item], [original(6, entries)])
    assert result["profiles"] == []
    assert result["coverage"]["rejected"]["incomplete_146_preset"] == 1
    duplicate = [*entries, {"type": "hp", "val": 350}, {"type": "tx", "val": 19}]
    result = build([item], [original(6, duplicate)])
    assert result["profiles"] == []
    assert result["coverage"]["rejected"]["too_many_properties"] == 1


def test_exact_source_aliases_strike_percentage_and_immunity_keep_original_meanings():
    item = source_item(8, [{"text": "Удар +50%"}], count="1")
    profile = build([item], [original(8, [{"type": "ae_eg", "val": 50}])])["profiles"][0]
    assert profile["addons"] == ["Удар +50%"]
    tome = source_item(17627, [], count="2", unique=[
        {"text": "Телосложение +20", "chance": 100},
        {"text": "Иммунитет к физическому урону +3%", "chance": 100},
    ])
    tome["slot"] = "tome"
    record = original(17627, [{"type": "lf", "val": 20}, {"type": "bu", "val": 3}])
    result = build_catalog_defaults([tome], {"qn": {"success": True, "data": [record]}}, {"qn": "b" * 64})
    assert result["profiles"] == []
    assert result["coverage"]["guaranteed_properties_skipped"] == 2


def reduction_record(item_id=32965):
    examples = {
        32965: (376, 533, 827, 0, 3), 35737: (344, 603, 897, 0, 5),
        36997: (166, 0, 0, 500, 3), 37028: (168, 0, 0, 280, 3),
    }
    record_id, physical, elemental, hp, reduction = examples[item_id]
    return {"id": record_id, "pw_id": item_id, "wf": physical, "hp": hp,
            "ab_gq": {key: elemental for key in ["lw_eq", "mo_eq", "dn_eq", "vt_eq", "sp_eq"]},
            "nw": {"wu": [{"type": "ia", "val": reduction}]}}


def test_individual_magic_reduction_corrections_require_same_ids_and_all_base_stats():
    items = json.loads((ROOT / "data/catalog_items.json").read_text(encoding="utf-8"))
    items = [item for item in items if item["id"] in [32965, 35737, 36997, 37028]]
    before = copy.deepcopy(items)
    payloads = {"rx": {"success": True, "data": [reduction_record(32965), reduction_record(35737)]},
                "ft": {"success": True, "data": [reduction_record(36997), reduction_record(37028)]}}
    result = build_catalog_defaults(items, payloads, {"rx": "b" * 64, "ft": "c" * 64})
    corrections = {entry["item_id"]: entry for entry in result["property_corrections"]}
    assert set(corrections) == {32965, 35737, 36997, 37028}
    assert corrections[32965]["replacements"] == [{
        "was": "Уменьшение урона от стихий +1022739087%", "applied": "Уменьшение урона от стихий +3%",
    }]
    assert corrections[35737]["replacements"] == [{
        "was": "Уменьшение урона от стихий +1028443341%", "applied": "Уменьшение урона от стихий +5%",
    }]
    assert corrections[32965]["source"]["verified_base_stats"]["elements"]["water"] == 827
    assert corrections[36997]["source"]["verified_base_stats"]["hp"] == 500
    assert corrections[37028]["source"]["verified_base_stats"]["hp"] == 280
    assert result["coverage"]["property_corrections"] == 4
    assert items == before


def test_changed_defense_hp_unknown_raw_and_unapproved_ids_are_not_corrected():
    items = json.loads((ROOT / "data/catalog_items.json").read_text(encoding="utf-8"))
    boot = next(item for item in items if item["id"] == 32965)
    for change in ["physical", "element", "hp", "value"]:
        record = reduction_record()
        if change == "physical":
            record["wf"] += 1
        elif change == "element":
            record["ab_gq"]["dn_eq"] += 1
        elif change == "hp":
            record["hp"] = 1
        else:
            record["nw"]["wu"][0]["val"] = 5
        result = build_catalog_defaults([boot], {"rx": {"success": True, "data": [record]}}, {"rx": "b" * 64})
        assert result["property_corrections"] == [], change
    unknown = copy.deepcopy(boot)
    for option in unknown["addons"]["options"]:
        option["text"] = option["text"].replace("1022739087", "1022739088")
    payload = {"rx": {"success": True, "data": [reduction_record()]}}
    result = build_catalog_defaults([unknown], payload, {"rx": "b" * 64})
    assert result["property_corrections"] == []
    unknown["id"] = 999999
    unknown["source"]["url"] = "https://comeback.pw/db/146/item/999999"
    record = {**reduction_record(), "pw_id": 999999}
    result = build_catalog_defaults([unknown], {"rx": {"success": True, "data": [record]}}, {"rx": "b" * 64})
    assert result["property_corrections"] == []


def test_snapshot_corrections_cover_twenty_boots_and_two_helmets_without_float_reinterpretation():
    payload = json.loads((ROOT / "data/catalog_defaults.json").read_text(encoding="utf-8"))
    expected = {*range(32965, 32970), *range(34837, 34842), 36997, 37028,
                35737, 35741, 35749, 35765, 35773, *range(36621, 36626)}
    assert {entry["item_id"] for entry in payload["property_corrections"]} == expected
    assert len(payload["property_corrections"]) == 22
    assert sum(entry["source"]["mypers_type"] == "rx" for entry in payload["property_corrections"]) == 20
    assert sum(entry["source"]["mypers_type"] == "ft" for entry in payload["property_corrections"]) == 2
