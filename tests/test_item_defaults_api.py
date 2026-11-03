import copy
import gzip
import json
import os

import django
import pytest
from django.conf import settings
from django.test import Client

from pwcalc.item_defaults import enrich_item_defaults

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "pwcalc.settings")
django.setup()

def inputs(item_id):
    items = json.loads((settings.BASE_DIR / "data/catalog_items.json").read_text(encoding="utf-8"))
    record = next(item for item in items if item["id"] == item_id)
    payload = json.loads((settings.BASE_DIR / "data/catalog_defaults.json").read_text(encoding="utf-8"))
    return record, payload


def test_ring_profile_and_weapon_speed_are_added_without_changing_primary_source():
    ring, payload = inputs(26389)
    weapon, _ = inputs(22)
    original_ring = copy.deepcopy(ring)
    coverage = enrich_item_defaults([ring, weapon], payload)
    assert set(ring["default_addons"]) == {"Крит +3%", "Время пения -6%", "Показатель атаки +2"}
    assert ring["source"] == original_ring["source"]
    assert weapon["stats"]["atk_speed"] == 1.11
    assert weapon["source"]["raw_stats"]["atk_speed"] == 4
    assert coverage["default_profiles"] == 1
    assert coverage["verified_weapon_speeds"] == 1


def test_game_confirmed_meteor_evidence_is_preserved():
    meteor, payload = inputs(33533)
    original = copy.deepcopy(meteor["source"]["corrections"]["atk_speed"])
    enrich_item_defaults([meteor], payload)
    assert meteor["stats"]["atk_speed"] == 1.25
    assert meteor["source"]["corrections"]["atk_speed"] == original


def test_stale_source_and_duplicate_profile_fail_explicitly():
    ring, payload = inputs(26389)
    ring["source"]["html_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="источник"):
        enrich_item_defaults([ring], payload)
    ring, payload = inputs(26389)
    duplicate = next(item for item in payload["profiles"] if item["item_id"] == 26389)
    payload["profiles"].append(copy.deepcopy(duplicate))
    with pytest.raises(ValueError, match="повтор"):
        enrich_item_defaults([ring], payload)


def test_corrupted_percent_is_corrected_only_with_item_specific_evidence():
    boots, payload = inputs(32965)
    before = copy.deepcopy(boots["addons"])
    coverage = enrich_item_defaults([boots], payload)
    assert coverage["property_corrections"] == 1
    assert any(entry["text"] == "Уменьшение урона от стихий +3%" for entry in boots["addons"]["options"])
    assert boots["addon_corrections"]["Уменьшение урона от стихий +1022739087%"] == "Уменьшение урона от стихий +3%"
    assert before != boots["addons"]
    assert boots["source"]["corrections"]["addons"]


def test_large_public_catalog_response_is_compressed_for_browser():
    response = Client().get("/api/catalog/", HTTP_HOST="127.0.0.1", HTTP_ACCEPT_ENCODING="gzip")
    assert response.status_code == 200
    assert response.get("Content-Encoding") == "gzip"
    inflated = gzip.decompress(response.content)
    assert len(response.content) < len(inflated) / 3
    catalog = json.loads(inflated)
    assert catalog["coverage"]["default_profiles"] >= 1500
    assert next(item for item in catalog["items"] if item["id"] == 22)["stats"]["atk_speed"] == 1.11
