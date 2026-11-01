import hashlib
import json
import os
from pathlib import Path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "pwcalc.settings")

import django
from django.test import Client

django.setup()

FIXTURES = Path(__file__).parent / "fixtures"


def test_catalog_api_exposes_comeback_snapshot_and_local_icons():
    response = Client().get("/api/catalog/", HTTP_HOST="127.0.0.1")
    assert response.status_code == 200
    catalog = response.json()
    assert catalog["version"] == "Comeback PW 1.4.6"
    assert catalog["verification"] == "unverified_for_comeback"
    assert len(catalog["items"]) > 100
    assert len(catalog["stones"]) >= 6
    assert catalog["coverage"]["items"] == len(catalog["items"])
    assert all(catalog["coverage"]["by_slot"].get(slot, 0) > 0 for slot in ("weapon", "cape", "wrists"))
    for record in catalog["items"] + catalog["stones"]:
        assert not (record.get("icon") or "").startswith("http")
    assert next(item for item in catalog["items"] if item["id"] == 259)["slot"] == "necklace"


def test_import_cache_uses_real_item_identity_and_keeps_prior_rich_fields(tmp_path):
    from tools.scrape.import_cache import import_cache

    pages = tmp_path / "pages"
    pages.mkdir()
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    icon_dir = tmp_path / "icons"
    url = "https://comeback.pw/db/146/item/4872"
    html = (FIXTURES / "item_armor_4872.html").read_text(encoding="utf-8")
    path = pages / (hashlib.sha1(url.encode()).hexdigest() + ".html")
    path.write_text(html, encoding="utf-8")
    (data_dir / "items.json").write_text(json.dumps([
        {"id": 4872, "name": "☆☆Защитная броня", "section": "armor", "custom": {"evidence": "keep"}},
        {"id": 259, "name": "Existing necklace", "section": "decoration", "type": "Ожерелье"},
    ]), encoding="utf-8")
    meta = import_cache(pages, data_dir, icon_dir)
    imported = json.loads((data_dir / "catalog_items.json").read_text(encoding="utf-8"))
    assert len((data_dir / "catalog_items.json").read_text(encoding="utf-8").splitlines()) == len(imported) + 2
    assert {item["id"] for item in imported} == {259, 4872}
    armor = next(item for item in imported if item["id"] == 4872)
    assert armor["slot"] == "chest"
    assert armor["stats"]["phys_def"] == 48
    assert armor["custom"]["evidence"] == "keep"
    assert armor["source"]["url"] == url
    assert meta["coverage"]["cached_item_pages"] == 1
    assert meta["coverage"]["items"] == 2
    assert meta["snapshot_at"]
    # Re-importing the same snapshot must keep identity and counts stable.
    assert import_cache(pages, data_dir, icon_dir)["coverage"]["items"] == 2


def test_slot_inference_does_not_turn_unknown_armor_into_a_helmet():
    from tools.scrape.import_cache import infer_slot

    assert infer_slot({"section": "armor", "type": "Верх"}) == "chest"
    assert infer_slot({"section": "armor", "type": "Голова"}) == "helmet"
    assert infer_slot({"section": "armor", "breadcrumb": ["Броня", "Головные уборы", "Шлемы"]}) == "helmet"
    assert infer_slot({"section": "armor", "type": "Неизвестно"}) is None


def test_sparse_candidate_cannot_erase_rich_record():
    from tools.scrape.import_cache import merge_records

    assert merge_records(
        {"id": 1, "stats": {"hp": 5}, "description": ["One", "Two"], "refine": {"levels": [1, 2]}},
        {"id": 1, "stats": {}, "description": [], "refine": None},
    ) == {"id": 1, "stats": {"hp": 5}, "description": ["One", "Two"], "refine": {"levels": [1, 2]}}
    assert merge_records({"levels": [1, 2]}, {"levels": [None, None]}) == {"levels": [1, 2]}
    assert merge_records({"sockets": {"craft": {"0": 90}}}, {"sockets": {"craft": {0: 90}}}) == {
        "sockets": {"craft": {"0": 90}},
    }


def test_meteor_source_and_game_observation_keep_distinct_provenance(tmp_path):
    from tools.scrape.import_cache import BASE, import_cache
    from tools.scrape.parse import parse_item

    html = (FIXTURES / "item_weapon_33533.html").read_text(encoding="utf-8")
    raw = parse_item(html, 33533)
    assert raw["name"] == "★★Метеор"
    assert raw["name_color"] == "#ff6000"
    assert raw["grade"] == 15
    assert raw["level"] == 101
    assert raw["req"] == {"str": 54, "int": 300}
    assert raw["stats"]["atk_speed"] == 15
    assert raw["stats"]["phys_atk"] == [456, 684]
    assert raw["stats"]["mag_atk"] == [831, 1016]
    assert raw["refine"]["stat"] == "Физ+маг атака"
    plus_eleven = raw["refine"]["levels"][10]
    assert plus_eleven == 754
    assert [x + plus_eleven for x in raw["stats"]["phys_atk"]] == [1210, 1438]
    assert [x + plus_eleven for x in raw["stats"]["mag_atk"]] == [1585, 1770]

    pages, data_dir, icons = (tmp_path / name for name in ("pages", "data", "icons"))
    pages.mkdir()
    filename = hashlib.sha1(f"{BASE}/item/33533".encode()).hexdigest() + ".html"
    (pages / filename).write_text(html, encoding="utf-8")
    import_cache(pages, data_dir, icons)
    meteor = json.loads((data_dir / "catalog_items.json").read_text(encoding="utf-8"))[0]
    assert meteor["stats"]["atk_speed"] == 1.25
    assert meteor["source"]["raw_stats"]["atk_speed"] == 15
    assert meteor["source"]["corrections"]["atk_speed"]["scope"] == "item_33533_only"
    assert meteor["source"]["html_sha256"] == hashlib.sha256((pages / filename).read_bytes()).hexdigest()


def test_importer_can_recover_a_missing_name_from_a_source_listing(tmp_path):
    from tools.scrape.import_cache import BASE, import_cache

    pages, data_dir, icons = (tmp_path / name for name in ("pages", "data", "icons"))
    pages.mkdir()
    data_dir.mkdir()
    (data_dir / "items.json").write_text(json.dumps([
        {"id": 4872, "section": "armor", "type": "Верх"},
        {"id": 1, "section": "armor", "type": "Верх"},
    ]), encoding="utf-8")
    html = (FIXTURES / "list_armor_125_127.html").read_text(encoding="utf-8")
    (pages / (hashlib.sha1(f"{BASE}/armor/125/127".encode()).hexdigest() + ".html")).write_text(
        html, encoding="utf-8")
    meta = import_cache(pages, data_dir, icons)
    items = json.loads((data_dir / "catalog_items.json").read_text(encoding="utf-8"))
    assert next(item for item in items if item["id"] == 4872)["name"] == "☆☆Защитная броня"
    assert next(item for item in items if item["id"] == 4872)["source"]["listing146"]["url"] == (
        f"{BASE}/armor/125/127")
    assert meta["coverage"]["items"] == 2
    assert meta["coverage"]["selectable_items"] == 1
    assert meta["coverage"]["items_confirmed_in_146_lists"] == 1
    assert meta["limitations"]["unnamed_item_ids"] == [1]


def test_importer_rejects_prior_records_from_other_database_versions(tmp_path):
    from tools.scrape.import_cache import import_cache

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "items.json").write_text(json.dumps([
        {"id": 1, "name": "Modern item", "section": "weapon",
         "source": {"url": "https://comeback.pw/db/172/item/1"}},
    ]), encoding="utf-8")
    meta = import_cache(tmp_path / "pages", data_dir, tmp_path / "icons")
    assert meta["coverage"]["items"] == 0
    assert meta["skipped_pages"]["prior_source_outside_146_item_url"] == 1
    assert json.loads((data_dir / "catalog_items.json").read_text(encoding="utf-8")) == []


def test_source_tome_list_establishes_missing_category_and_fixed_bonuses(tmp_path):
    from tools.scrape.import_cache import BASE, import_cache
    from tools.scrape.parse import parse_item

    pages = tmp_path / "pages"
    pages.mkdir()
    for route, fixture in (("/item/17579", "item_tome_17579.html"),
                           ("/item/410", "item_ammo_410.html"),
                           ("/bible/lvl_1", "list_tome_1.html")):
        (pages / (hashlib.sha1((BASE + route).encode()).hexdigest() + ".html")).write_text(
            (FIXTURES / fixture).read_text(encoding="utf-8"), encoding="utf-8")
    raw = parse_item((FIXTURES / "item_tome_17579.html").read_text(encoding="utf-8"), 17579)
    assert raw["breadcrumb"] == []
    assert raw["fixed_properties"] == ["Сила +4", "Телосложение +3"]
    data_dir = tmp_path / "data"
    meta = import_cache(pages, data_dir, tmp_path / "icons")
    items = json.loads((data_dir / "catalog_items.json").read_text(encoding="utf-8"))
    tome = next(item for item in items if item["id"] == 17579)
    assert tome["slot"] == "tome"
    assert tome["addons"]["unique"] == [
        {"text": "Сила +4", "chance": 100}, {"text": "Телосложение +3", "chance": 100},
    ]
    ammo = next(item for item in items if item["id"] == 410)
    assert ammo["slot"] == "ammo"
    assert ammo["stats"]["phys_atk"] == 3
    assert meta["coverage"]["by_slot"]["tome"] == 1


def test_supplement_uses_only_three_lists_and_stops_before_expired_requests(tmp_path, monkeypatch):
    from tools.scrape import supplement_cache as supplement
    from tools.scrape.catalog import section_url
    from tools.scrape.session import Session

    html = (FIXTURES / "list_armor_125_127.html").read_text(encoding="utf-8")
    for section, sub in supplement.TARGETS.values():
        url = "https://comeback.pw" + section_url(section, sub)
        (tmp_path / (hashlib.sha1(url.encode()).hexdigest() + ".html")).write_text(html, encoding="utf-8")
    monkeypatch.setattr(supplement, "load_session", lambda: Session("unused", "test"))

    def expired_throttle(self):
        raise AssertionError("An expired budget must not schedule or wait for more requests")

    monkeypatch.setattr(supplement.Fetcher, "_throttle", expired_throttle)
    result = supplement.supplement_cache(tmp_path, limit=999, seconds=0)
    assert result["max_items_per_slot"] == 15
    assert len(result["list_urls"]) == 3
    assert result["counts"]["cached_pages_used"] == 3
    assert result["counts"].get("live_requests", 0) == 0
