"""Numeric set tables copied from the verified Comeback 146 item markup."""

import hashlib
import json
import os
from pathlib import Path

import pytest

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "pwcalc.settings")

import django
from django.test import Client, override_settings

from tools.scrape.parse import parse_item

django.setup()

LION_MEMBERS = [14927, 14933, 14939, 14945]
LION_BONUSES = [{"pieces": 2, "texts": ["Сила +10"]},
                {"pieces": 4, "texts": ["Уменьшение физ урона +3%"]}]


def page(members=LION_MEMBERS, bonuses=LION_BONUSES, name="Сила безумного короля"):
    links = "".join(f'<li><a href="/db/146/item/{item_id}">Часть {item_id}</a></li>' for item_id in members)
    rows = "".join(f'<tr><td>{bonus["pieces"]}</td><td><span class="addon">{text}</span></td></tr>'
                   for bonus in bonuses for text in bonus["texts"])
    return f'''<div id="content-block"><div class="box_content_header_wrapper">Латы</div>
    <div class="data-tabs"><button data-bs-target="#suits-tab-pane">Комплект</button></div>
    <div class="tab-pane" id="suits-tab-pane"><div class="itemchar_body"><h6>{name}</h6>
    <span>Предметы в комплекте:</span><ul>{links}</ul><h6>Бонусы комплекта:</h6>
    <table class="table extra table-union"><thead><tr><th>Количество вещей</th><th>Бонус</th></tr></thead>
    <tbody>{rows}</tbody></table></div></div></div>'''


def source_record(item_id, html, cache_dir):
    filename = f"item-{item_id}.html"
    data = html.encode("utf-8")
    (cache_dir / filename).write_bytes(data)
    return {"id": item_id, "name": "Часть", "set": ["Старая строка"],
            "source": {"url": f"https://comeback.pw/db/146/item/{item_id}",
                       "cache_file": filename, "html_sha256": hashlib.sha256(data).hexdigest()}}


def test_parser_keeps_lion_set_thresholds_members_and_legacy_names():
    item = parse_item(page(), 14927)
    assert item["set"] == [f"Часть {item_id}" for item_id in LION_MEMBERS]
    assert item["set_bonus"] == {"id": "146:14927-14933-14939-14945", "name": "Сила безумного короля",
                                 "members": LION_MEMBERS, "bonuses": LION_BONUSES}


def test_parser_preserves_cumulative_richard_thresholds():
    members = [25701, 25702, 25703, 25704, 25705, 25713]
    bonuses = [{"pieces": 2, "texts": ["Показатель атаки +5"]},
               {"pieces": 5, "texts": ["Показатель защиты +10"]},
               {"pieces": 6, "texts": ["Показатель защиты +3"]}]
    result = parse_item(page(members, bonuses, "Тень перерождения"), 25701)["set_bonus"]
    assert result["members"] == members
    assert result["bonuses"] == bonuses


@pytest.mark.parametrize("pieces", [0, 5, "1.5", "two", "-1"])
def test_parser_rejects_malformed_set_thresholds(pieces):
    with pytest.raises(ValueError, match="комплект"):
        parse_item(page(bonuses=[{"pieces": pieces, "texts": ["Сила +10"]}]), 14927)


def test_generator_verifies_all_hashes_and_detects_conflicting_sources(tmp_path):
    from tools.scrape.enrich_sets import build_set_catalog

    first = source_record(14927, page(), tmp_path)
    second = source_record(14933, page(), tmp_path)
    result = build_set_catalog([second, first], tmp_path)
    assert result["version"] == 1 and len(result["sets"]) == 1
    assert [s["item_id"] for s in result["sets"][0]["sources"]] == [14927, 14933]
    assert result == build_set_catalog([first, second], tmp_path)
    second["source"]["html_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="SHA-256"):
        build_set_catalog([first, second], tmp_path)
    second = source_record(14933, page(bonuses=[{"pieces": 2, "texts": ["Сила +11"]}]), tmp_path)
    with pytest.raises(ValueError, match="противореч"):
        build_set_catalog([first, second], tmp_path)


def test_generator_rejects_foreign_sources_and_cache_path_escape(tmp_path):
    from tools.scrape.enrich_sets import build_set_catalog

    record = source_record(14927, page(), tmp_path)
    record["source"]["url"] = "https://comeback.pw/db/172/item/14927"
    with pytest.raises(ValueError, match="146"):
        build_set_catalog([record], tmp_path)
    record["source"]["url"] = "https://comeback.pw/db/146/item/14927"
    record["source"]["cache_file"] = "../outside.html"
    with pytest.raises(ValueError, match="кеш"):
        build_set_catalog([record], tmp_path)


def test_hash_validation_includes_items_without_sets_and_sidecar_rejects_stale_sources(tmp_path):
    from tools.scrape.enrich_sets import build_set_catalog, set_bonus_index

    plain = source_record(1, '<div id="content-block">Без комплекта</div>', tmp_path)
    plain.pop("set")
    assert build_set_catalog([plain], tmp_path) == {"version": 1, "sets": []}
    plain["source"]["html_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="SHA-256"):
        build_set_catalog([plain], tmp_path)
    member = source_record(14927, page(), tmp_path)
    sets = build_set_catalog([member], tmp_path)
    member["source"]["html_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="источник"):
        set_bonus_index(sets, [member])
    member = source_record(14927, page(), tmp_path)
    sets["sets"][0]["bonuses"][0]["pieces"] = True
    with pytest.raises(ValueError, match="порог"):
        set_bonus_index(sets, [member])


def test_api_enriches_items_without_erasing_legacy_data_and_tolerates_absent_sidecar(tmp_path):
    from pwcalc.views import catalog_data
    from tools.scrape.enrich_sets import build_set_catalog

    cache = tmp_path / "pages"
    cache.mkdir()
    records = [source_record(14927, page(), cache), source_record(14933, page(), cache)]
    data = tmp_path / "data"
    data.mkdir()
    (data / "catalog_items.json").write_text(json.dumps(records), encoding="utf-8")
    (data / "catalog_stones.json").write_text("[]", encoding="utf-8")
    try:
        with override_settings(BASE_DIR=tmp_path):
            catalog_data.cache_clear()
            assert "set_bonus" not in catalog_data()["items"][0]
            (data / "catalog_sets.json").write_text(json.dumps(build_set_catalog(records, cache)), encoding="utf-8")
            catalog_data.cache_clear()
            response = Client().get("/api/catalog/", HTTP_HOST="127.0.0.1")
            assert response.status_code == 200
            items = response.json()["items"]
            assert items[0]["set"] == ["Старая строка"]
            assert items[0]["set_bonus"]["bonuses"] == LION_BONUSES
            assert items[1]["set_bonus"]["id"] == items[0]["set_bonus"]["id"]
    finally:
        catalog_data.cache_clear()


def test_checked_in_sets_contain_real_lion_and_richard_tables():
    data = json.loads((Path(__file__).parents[1] / "data/catalog_sets.json").read_text(encoding="utf-8"))
    lion = next(s for s in data["sets"] if 14927 in s["members"])
    richard = next(s for s in data["sets"] if 25701 in s["members"])
    assert lion["members"] == LION_MEMBERS and lion["bonuses"] == LION_BONUSES
    assert richard["bonuses"] == [{"pieces": 2, "texts": ["Показатель атаки +5"]},
                                  {"pieces": 5, "texts": ["Показатель защиты +10"]},
                                  {"pieces": 6, "texts": ["Показатель защиты +3"]}]
    assert all(s["sources"] for s in data["sets"])
