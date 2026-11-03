import copy
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / 'data/catalog_items.json').read_text(encoding='utf-8'))
SPEEDS = json.loads((ROOT / 'data/catalog_client_speeds.json').read_text(encoding='utf-8'))
TARGETS = {22, 78, 12647, 33533}


@pytest.fixture
def records():
    return copy.deepcopy([item for item in CATALOG if item['id'] in TARGETS])


@pytest.fixture
def payload():
    result = copy.deepcopy(SPEEDS)
    result['items'] = [row for row in result['items'] if row['item_id'] in TARGETS]
    return result


def test_client_speeds_override_real_146_values_and_preserve_every_history(records, payload):
    from pwcalc.client_data import enrich_client_speeds

    before = copy.deepcopy({item['id']: item for item in records})
    coverage = enrich_client_speeds(records, payload)
    after = {item['id']: item for item in records}
    assert coverage['client_weapon_speeds'] == 4
    assert coverage['client_weapon_speeds_unknown'] == 0
    assert after[22]['stats']['atk_speed'] == 1.11
    assert after[78]['stats']['atk_speed'] == 1.0
    assert after[12647]['stats']['atk_speed'] == after[33533]['stats']['atk_speed'] == 1.25
    for item_id, item in after.items():
        assert item['attack_speed_verified'] is True
        source = item['source']
        assert source['raw_stats']['atk_speed'] == before[item_id]['source'].get(
            'raw_stats', {}).get('atk_speed', before[item_id]['stats']['atk_speed'])
        proof = source['client_attack_speed']
        assert proof['file_sha256'] == payload['source']['sha256']
        assert proof['schema_sha256'] == payload['source']['schema_sha256']
        assert proof['subtype_id'] > 0 and proof['row_offset'] > proof['subtype_offset']
        assert proof['aps'] == item['stats']['atk_speed']
        assert source.get('corrections') == before[item_id]['source'].get('corrections')
        assert item['stats']['phys_atk'] == before[item_id]['stats']['phys_atk']
    assert after[33533]['source']['raw_stats']['atk_speed'] == 15
    assert after[33533]['source']['corrections']['atk_speed']['evidence'] == (
        'user_supplied_comeback_146_game_capture')


def test_shared_client_source_validation_does_not_require_speed_specific_metadata(payload):
    from pwcalc.client_data import validate_client_source

    source = copy.deepcopy(payload['source'])
    del source['aps_reference_url']
    before = copy.deepcopy(source)
    result = validate_client_source(source)
    assert result == {'file_hash': source['sha256'], 'schema_hash': source['schema_sha256'], 'size': source['bytes']}
    assert source == before


def test_overlay_keeps_legacy_reference_and_is_idempotent(records, payload):
    from pwcalc.client_data import enrich_client_speeds

    sword = next(item for item in records if item['id'] == 22)
    sword['source']['raw_stats'] = {'atk_speed': 4}
    correction = {'was': 4, 'applied': 1.11, 'verification': 'legacy_reference'}
    sword['source']['corrections'] = {'atk_speed': correction}
    sword['stats']['atk_speed'] = 1.11
    enrich_client_speeds(records, payload)
    once = copy.deepcopy(records)
    enrich_client_speeds(records, payload)
    assert records == once
    assert sword['source']['corrections']['atk_speed'] == correction
    assert sword['source']['raw_stats']['atk_speed'] == 4


@pytest.mark.parametrize(('field', 'value'), [
    ('header_version', 80), ('header_signature', 0), ('schema_sha256', '0' * 64),
    ('sha256', 'not-a-sha256'), ('sha256', 'g' * 64), ('file_name', 'F:/game/elements.data'),
])
def test_bad_source_metadata_is_rejected_before_any_item_changes(records, payload, field, value):
    from pwcalc.client_data import enrich_client_speeds

    payload['source'][field] = value
    before = copy.deepcopy(records)
    with pytest.raises(ValueError):
        enrich_client_speeds(records, payload)
    assert records == before


@pytest.mark.parametrize(('field', 'value'), [
    ('attack_interval', float('nan')), ('attack_interval', 0), ('attack_interval', True),
    ('aps', float('nan')), ('aps', 5.01), ('aps', 1.2),
    ('range', 999), ('range_matches_catalog', False), ('row_offset', -1), ('subtype_id', 0),
])
def test_bad_known_row_never_leaves_a_partial_overlay(records, payload, field, value):
    from pwcalc.client_data import enrich_client_speeds

    payload['items'][-1][field] = value
    before = copy.deepcopy(records)
    with pytest.raises(ValueError):
        enrich_client_speeds(records, payload)
    assert records == before


def test_payload_version_and_duplicate_ids_are_rejected(records, payload):
    from pwcalc.client_data import enrich_client_speeds

    before = copy.deepcopy(records)
    invalid_version = {**payload, 'version': 2}
    with pytest.raises(ValueError):
        enrich_client_speeds(records, invalid_version)
    payload['items'].append(copy.deepcopy(payload['items'][0]))
    with pytest.raises(ValueError):
        enrich_client_speeds(records, payload)
    assert records == before


def test_unknown_ids_and_nonweapon_items_are_left_alone(records, payload):
    from pwcalc.client_data import enrich_client_speeds

    payload['items'] = [next(row for row in payload['items'] if row['item_id'] == 22)]
    unknown = {**payload['items'][0], 'item_id': 999999}
    flying = {'id': 999998, 'section': 'flysword', 'slot': 'flight',
              'stats': {'atk_speed': 100, 'range': 3}, 'source': {'own': 'unchanged'}}
    payload['items'].extend([unknown, {**unknown, 'item_id': flying['id']}])
    records.append(flying)
    before = copy.deepcopy({item['id']: item for item in records})
    coverage = enrich_client_speeds(records, payload)
    assert coverage['client_weapon_speeds'] == 1
    assert coverage['client_weapon_speeds_unknown'] == 3
    for item in records:
        if item['id'] != 22:
            assert item == before[item['id']]


def test_optional_client_name_must_match_current_item_name(records, payload):
    from pwcalc.client_data import enrich_client_speeds

    row = next(row for row in payload['items'] if row['item_id'] == 22)
    row['name'] = 'Другое оружие'
    before = copy.deepcopy(records)
    with pytest.raises(ValueError):
        enrich_client_speeds(records, payload)
    assert records == before


def test_changed_current_146_range_is_not_silently_overlaid(records, payload):
    from pwcalc.client_data import enrich_client_speeds

    records[-1]['stats']['range'] += 0.001
    before = copy.deepcopy(records)
    with pytest.raises(ValueError):
        enrich_client_speeds(records, payload)
    assert records == before


def test_all_existing_weapons_include_verified_zero_range_records():
    from pwcalc.client_data import enrich_client_speeds

    items = copy.deepcopy(CATALOG)
    unrelated = copy.deepcopy([item for item in items if item.get('section') != 'weapon'])
    coverage = enrich_client_speeds(items, SPEEDS)
    assert coverage['client_weapon_speeds'] == len(SPEEDS['items']) == 3122
    assert coverage['client_weapon_speeds_unknown'] == 0
    assert [item for item in items if item.get('section') != 'weapon'] == unrelated
    zero_range = next(item for item in items if item['id'] == 22388)
    assert zero_range['stats']['range'] == 0
    assert zero_range['attack_speed_verified'] is True
