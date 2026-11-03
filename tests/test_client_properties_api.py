import copy
import json
import os
from pathlib import Path

import django
import pytest
from django.test import Client

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'pwcalc.settings')
django.setup()

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / 'data/catalog_items.json').read_text(encoding='utf-8'))
PROPERTIES = json.loads((ROOT / 'data/catalog_client_properties.json').read_text(encoding='utf-8'))
TARGETS = {21418, 14970, 26389, 25718, 11213}


@pytest.fixture
def records():
    return copy.deepcopy([item for item in CATALOG if item['id'] in TARGETS])


@pytest.fixture
def payload():
    result = copy.deepcopy(PROPERTIES)
    result['items'] = [row for row in result['items'] if row['item_id'] in TARGETS]
    return result


def test_real_fixed_properties_preserve_raw_pools_and_archive_obsolete_defaults(records, payload):
    from pwcalc.client_properties import enrich_client_properties

    cape = next(item for item in records if item['id'] == 21418)
    cape['default_addons'] = ['Сила +7']
    cape['default_addons_source'] = {'label': 'old reference'}
    before = copy.deepcopy({item['id']: item for item in records})
    coverage = enrich_client_properties(records, payload, expected_client_sha256=payload['source']['sha256'])
    assert coverage['client_fixed_profiles'] == 5
    assert coverage['client_fixed_slots'] == 16
    assert coverage['client_fixed_empty_profiles'] == 1
    assert len(cape['client_fixed_addons']['slots']) == 5
    assert cape['client_fixed_addons']['required'] is True
    assert [row['stat'] for row in cape['client_fixed_addons']['slots']] == ['str', 'dex', 'vit', 'int', 'cast_time']
    assert 'default_addons' not in cape and 'default_addons_source' not in cape
    proof = cape['source']['client_fixed_properties']
    assert proof['previous_defaults'] == {'addons': ['Сила +7'], 'source': {'label': 'old reference'}}
    assert proof['file_sha256'] == payload['source']['sha256']
    assert proof['row_offset'] == 6728716
    for item in records:
        assert item['addons'] == before[item['id']]['addons']
        assert item['stats'] == before[item['id']]['stats']
        assert item['source'].get('corrections') == before[item['id']]['source'].get('corrections')
    gm = next(item for item in records if item['id'] == 11213)
    assert gm['client_fixed_addons'] == {'required': False, 'slots': []}
    once = copy.deepcopy(records)
    enrich_client_properties(records, payload)
    assert records == once


@pytest.mark.parametrize(('field', 'value'), [
    ('name', 'wrong name'), ('offset', -1), ('addon_count', 4), ('fixed', False),
    ('guaranteed', False), ('complete', False),
])
def test_bad_profile_is_rejected_before_any_mutation(records, payload, field, value):
    from pwcalc.client_properties import enrich_client_properties

    cape = next(row for row in payload['items'] if row['item_id'] == 21418)
    cape[field] = value
    before = copy.deepcopy(records)
    with pytest.raises(ValueError):
        enrich_client_properties(records, payload)
    assert records == before


@pytest.mark.parametrize(('field', 'value'), [
    ('known', False), ('stat', None), ('min', float('nan')), ('percent', None), ('text', 'Сила +9999'),
])
def test_inconsistent_typed_slot_is_never_served(records, payload, field, value):
    from pwcalc.client_properties import enrich_client_properties

    next(row for row in payload['items'] if row['item_id'] == 21418)['addons'][0][field] = value
    before = copy.deepcopy(records)
    with pytest.raises(ValueError):
        enrich_client_properties(records, payload)
    assert records == before


def test_source_duplicate_and_cross_sidecar_mismatch_are_rejected(records, payload):
    from pwcalc.client_properties import enrich_client_properties

    before = copy.deepcopy(records)
    with pytest.raises(ValueError):
        enrich_client_properties(records, payload, expected_client_sha256='1' * 64)
    duplicated = copy.deepcopy(payload)
    duplicated['items'].append(copy.deepcopy(duplicated['items'][0]))
    with pytest.raises(ValueError):
        enrich_client_properties(records, duplicated)
    payload['source']['schema_sha256'] = '0' * 64
    with pytest.raises(ValueError):
        enrich_client_properties(records, payload)
    assert records == before


def test_options_only_unknown_null_and_duplicate_fixed_slots_are_preserved():
    from pwcalc.client_properties import enrich_client_properties

    profile = next(row for row in PROPERTIES['items']
                   if row['guaranteed'] and any(not a['known'] for a in row['addons'] if a['kind'] == 'options'))
    item = copy.deepcopy(next(row for row in CATALOG if row['id'] == profile['item_id']))
    payload = {**PROPERTIES, 'items': [copy.deepcopy(profile)]}
    enrich_client_properties([item], payload)
    slots = item['client_fixed_addons']['slots']
    assert len(slots) == profile['addon_count']
    assert all(row['kind'] == 'options' for row in slots)
    assert any(row['known'] is False and row['stat'] is row['min'] is row['max'] is None for row in slots)
    duplicate = copy.deepcopy(next(row for row in PROPERTIES['items'] if row['item_id'] == 21418))
    duplicate['addons'] = [duplicate['addons'][0], copy.deepcopy(duplicate['addons'][0])]
    duplicate['addon_count'] = 2
    cape = copy.deepcopy(next(row for row in CATALOG if row['id'] == 21418))
    enrich_client_properties([cape], {**PROPERTIES, 'items': [duplicate]})
    assert len(cape['client_fixed_addons']['slots']) == 2


def test_all_fixed_profiles_apply_and_unrelated_items_stay_unchanged():
    from pwcalc.client_properties import enrich_client_properties

    items = copy.deepcopy(CATALOG)
    fixed_ids = {row['item_id'] for row in PROPERTIES['items']}
    unrelated = copy.deepcopy([row for row in items if row['id'] not in fixed_ids])
    coverage = enrich_client_properties(items, PROPERTIES)
    assert coverage['client_fixed_profiles'] == 2535
    assert coverage['client_fixed_slots'] == 8072
    assert coverage['client_fixed_known_slots'] == 7795
    assert coverage['client_fixed_unknown_slots'] == 277
    assert [row for row in items if row['id'] not in fixed_ids] == unrelated


def test_catalog_api_serves_client_speeds_and_fixed_blocks_after_legacy_defaults():
    from pwcalc.views import catalog_data

    catalog_data.cache_clear()
    response = Client().get('/api/catalog/', HTTP_HOST='127.0.0.1')
    assert response.status_code == 200
    data = response.json()
    assert data['coverage']['client_weapon_speeds'] == 3122
    assert data['coverage']['client_fixed_profiles'] == 2535
    cape = next(row for row in data['items'] if row['id'] == 21418)
    ring = next(row for row in data['items'] if row['id'] == 26389)
    assert len(cape['client_fixed_addons']['slots']) == 5
    assert any(row['stat'] == 'cast_time' and row['min'] == -6 for row in ring['client_fixed_addons']['slots'])
    meteor = next(row for row in data['items'] if row['id'] == 33533)
    assert meteor['stats']['atk_speed'] == 1.25
    assert meteor['source']['corrections']['atk_speed']['evidence'] == 'user_supplied_comeback_146_game_capture'
