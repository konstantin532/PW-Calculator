from pathlib import Path

import pytest

from tools.scrape.catalog import page_count, parse_list, parse_total, section_url
from tools.scrape.parse import parse_item, parse_stone_effects

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_armor_item_fields():
    item = parse_item(load("item_armor_4872.html"), 4872)
    assert item["name"] == "☆☆Защитная броня"
    assert item["type"] == "Верх" and item["subtype"] == "Тяжелый нагрудник"
    assert item["grade"] == 1 and item["level"] == 1
    assert item["req"] == {"str": 5, "dex": 5}
    assert item["stats"] == {
        "phys_def": 48,
        "def_metal": 20,
        "def_wood": 20,
        "def_water": 20,
        "def_fire": 20,
        "def_earth": 20,
    }
    assert "Воин" in item["classes"] and len(item["classes"]) == 12
    assert item["sockets"]["craft"][4] == 0.29 and item["sockets"]["drop"][0] == 93.5
    assert item["addons"]["count"] == "0~3"
    assert {"text": "Сила +1", "chance": 8.7912} in item["addons"]["options"]
    assert item["refine"] == {
        "stat": "Здоровье",
        "base": 14,
        "levels": [14, 28, 42, 60, 80, 105, 139, 182, 238, 308, 406, 525],
    }
    assert item["icon"].endswith(".jpg")


def test_weapon_item_fields():
    item = parse_item(load("item_weapon_14801.html"), 14801)
    assert item["stats"]["phys_atk"] == [445, 827]
    assert item["stats"]["atk_speed"] == 10 and item["stats"]["range"] == 3
    assert item["req"] == {"str": 163, "dex": 123}
    assert item["level"] == 80 and item["grade"] == 10
    assert item["addons"]["count"] == "3"
    assert item["refine"]["stat"] == "Физ. атака" and item["refine"]["levels"][11] == 675
    assert item["decompose"].startswith("Дух оружия")


def test_stone_effects_parsed_from_description():
    item = parse_item(load("item_stone_2009.html"), 2009)
    assert item["grade"] == 5
    effects = parse_stone_effects(item["description"])
    assert effects["weapon"] == {
        "stat": "уровень магической энергии",
        "value": 40,
        "percent": False,
        "raw": "уровень магической энергии +40 ед",
    }
    assert effects["armor"]["value"] == 40


def test_stone_effects_with_abbreviations():
    desc = ["Магический камень. Влияние на оружие: физ. атака +16 ед. Влияние на доспехи: физ. защита +26 ед."]
    effects = parse_stone_effects(desc)
    assert effects["weapon"]["stat"] == "физ. атака" and effects["weapon"]["value"] == 16
    assert effects["armor"]["stat"] == "физ. защита" and effects["armor"]["value"] == 26


def test_skill_book_has_no_stats():
    item = parse_item(load("item_book_9443.html"), 9443)
    assert item["name"] == "Светлый удар тигра"
    assert item["stats"] == {}
    assert any("Класс: воин" in line for line in item["description"])


def test_list_rows_and_pagination():
    html = load("list_armor_125_127.html")
    rows = parse_list(html)
    assert len(rows) == 15
    assert rows[0].item_id == 8451 and rows[0].name == "Доспехи новичка"
    assert rows[1].icon.endswith(".jpg")
    assert parse_total(html) == 161 and page_count(161) == 11


def test_section_url():
    assert section_url("armor", "125") == "/db/146/armor/125/0"
    assert section_url("armor", "125", 3) == "/db/146/armor/125/0?page=3"
    assert section_url("stones", "/stones/all", 2) == "/db/146/stones/all?page=2"


def test_challenge_page_raises():
    with pytest.raises(ValueError):
        parse_item("<html><body><script>get_jhash()</script></body></html>", 1)
