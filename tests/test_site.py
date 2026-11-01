import json
import os
import re
from pathlib import Path
from unittest.mock import MagicMock

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "pwcalc.settings")

import django
from django.test import Client

from pwcalc import views
from tools import serve

django.setup()


def test_home_page_has_calculator_layout():
    response = Client().get("/", HTTP_HOST="127.0.0.1")
    assert response.status_code == 200
    text = response.content.decode()
    assert 'lang="ru"' in text
    for element_id in ("buff-list", "btn-new", "char-class", "stats-body", "paperdoll", "bag"):
        assert f'id="{element_id}"' in text
    assert "/static/js/app.js" in text


def test_effects_api_lists_named_buffs_and_marks_them_unverified():
    response = Client().get("/api/effects/", HTTP_HOST="127.0.0.1")
    assert response.status_code == 200
    data = response.json()
    assert data["verification"] == "unverified_for_comeback"
    assert data["effects"][0]["name"] == "Техника боя с мечом"
    assert data["effects"][0]["sprite_id"] == 1
    by_id = {effect["id"]: effect for effect in data["effects"]}
    assert by_id[1]["name"] == "Железный покров"
    assert by_id[1]["sprite_id"] == 42
    assert 619 not in by_id
    assert not ({62, 61, 60, 310, 10048, 359, 360, 366, 367, 393, 394, 10040}
                & {effect["sprite_id"] for effect in data["effects"]})
    assert [effect["sprite_id"] for effect in data["effects"] if effect["panel_default"]] == [
        1, 2, 3, 4, 31, 42, 43, 44, 39, 40, 29, 30,
    ]
    assert "{" not in data["effects"][0]["description"]
    assert {effect["kind"] for effect in data["effects"]} == {"buff", "debuff"}
    ids = [effect["id"] for effect in data["effects"]]
    assert len(ids) == len(set(ids))
    assert {effect["class"] for effect in data["effects"]} <= {
        None, "by", "ga", "ya", "rl", "js", "ij", "rg", "ej", "sj", "fx",
    }


def test_effects_api_class_panels_match_observed_original_order():
    data = Client().get("/api/effects/", HTTP_HOST="127.0.0.1").json()
    # Actual record IDs in gqSkillsIds[class].rk; the twelve excluded modern
    # sprite families and the user-excluded Copper Leaf have been removed.
    # These are not translation/sprite IDs.
    assert data["panels"] == {
        "by": [17, 18, 19, 20, 5, 1, 3, 4, 6, 7, 41, 42],
        "ga": [22, 23, 24, 5, 1, 3, 4, 6, 7],
        "ya": [11, 12, 8, 5, 1, 3, 4, 6, 7],
        "rl": [25, 21, 5, 1, 3, 4, 6, 7],
        "ij": [26, 5, 1, 3, 4, 6, 7],
        "js": [28, 164, 5, 1, 3, 4, 6, 7],
        "fx": [29, 5, 1, 3, 4, 6, 7, 54],
        "sj": [34, 35, 5, 1, 3, 4, 6, 7],
        "ej": [38, 5, 1, 3, 4, 6, 7, 39, 109],
        "rg": [161, 5, 1, 3, 4, 6, 7, 40],
    }
    effects = {effect["id"]: effect for effect in data["effects"]}
    assert [effects[skill_id]["sprite_id"] for skill_id in data["panels"]["ga"]] == [
        5, 6, 7, 31, 42, 43, 44, 39, 40,
    ]
    assert all(skill_id in effects for panel in data["panels"].values() for skill_id in panel)


def test_copper_leaf_is_never_offered_even_if_reintroduced_to_extra_panel(monkeypatch):
    # User's Comeback client does not have this effect. Record 92 is not
    # record 68: 68 is only its sprite number, shared numbering is unrelated.
    monkeypatch.setattr(views, "PANEL_IDS", [*views.PANEL_IDS, 92])
    views.panel_effects.cache_clear()
    try:
        data = Client().get("/api/effects/", HTTP_HOST="127.0.0.1").json()
        assert all(effect["id"] != 92 for effect in data["effects"])
        assert all(92 not in panel for panel in data["panels"].values())
    finally:
        views.panel_effects.cache_clear()


def test_effects_api_exposes_original_level_and_cultivation_metadata():
    data = Client().get("/api/effects/", HTTP_HOST="127.0.0.1").json()
    effect = next(effect for effect in data["effects"] if effect["id"] == 1)
    assert effect["names"]["mi rs"] == "Светлый железный покров"
    assert effect["names"]["mi je"] == "Темный железный покров"
    assert "{tb}" in effect["descriptions"]["desc"]
    record = effect["record"]
    assert set(record) == {"an", "mi", "ue", "hi", "lm", "qc", "states", "addition_hf"}
    assert record["hi"] == []
    assert next(effect for effect in data["effects"] if effect["id"] == 41)["record"]["hi"] == [1]
    assert record["an"] == 42
    assert record["ue"] == 10
    assert record["lm"]["tb"] == 15
    assert record["qc"]["tb"] == {"0": 5, "11": {"rs": -5, "je": -5}}
    assert record["addition_hf"] == {"11": {"rs": [], "je": []}}
    assert record["states"]["0"] == [{"type": "tb", "an": 1}]
    assert record["states"]["11"][0]["rs"]["val"] == 100


def test_effects_api_labels_only_parameters_present_in_available_records():
    data = Client().get("/api/effects/", HTTP_HOST="127.0.0.1").json()
    labels = data["parameter_labels"]
    assert {key: labels[key] for key in ("oj_for_fu", "ve", "mp", "tb")} == {
        "oj_for_fu": "требуемый уровень", "ve": "дальность",
        "mp": "маг. энергия", "tb": "повышает физ. защиту",
    }
    used = {key for effect in data["effects"] for field in ("lm", "qc") for key in effect["record"][field]}
    assert set(labels) <= used
    assert all(isinstance(label, str) for label in labels.values())


def test_effect_sprites_and_cultivation_variants_have_local_css_positions():
    data = Client().get("/api/effects/", HTTP_HOST="127.0.0.1").json()
    stylesheet = (Path(__file__).resolve().parents[1] / "static/mypers/skin-assets.css").read_text(encoding="utf-8")
    available = {int(sprite_id) for sprite_id in re.findall(r"\.ref-skill-(\d+)\s*\{", stylesheet)}
    needed = {effect["sprite_id"] for effect in data["effects"]}
    for effect in data["effects"]:
        for variants in effect["record"].get("addition_hf", {}).values():
            needed.update(
                variant["an"] for variant in variants.values() if isinstance(variant, dict) and "an" in variant
            )
    assert needed <= available
    state_icons = {int(sprite_id) for sprite_id in re.findall(r"\.ref-state-(\d+)\s*\{", stylesheet)}

    def check_states(value):
        if isinstance(value, dict):
            if value.get("an"):
                assert value["an"] in state_icons
            for child in value.values():
                check_states(child)
        elif isinstance(value, list):
            for child in value:
                check_states(child)

    for effect in data["effects"]:
        check_states(effect["record"]["states"])


def test_effects_filter_unavailable_classes_in_default_and_expanded_panels(tmp_path, monkeypatch):
    unavailable = ("uf", "he", "bard", "monkey", "unknown")
    records = []
    for skill_id, class_code in zip([17, 18, 19, 20, 5, 180, 324, 325, 327, 329], unavailable * 2, strict=True):
        records.append({"id": skill_id, "class": class_code, "kind": "buff", "names": {"mi": class_code},
                        "descriptions": {}, "source_record": {"an": 900 + skill_id}})
    for skill_id, class_code in [(1, "by"), (331, None)]:
        records.append({"id": skill_id, "class": class_code, "kind": "buff", "names": {"mi": "Available"},
                        "descriptions": {}, "source_record": {"an": 900 + skill_id}})
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "skills.json").write_text(json.dumps({"skills": records}), encoding="utf-8")
    monkeypatch.setattr(views.settings, "BASE_DIR", tmp_path)
    views.panel_effects.cache_clear()
    try:
        effects = views.panel_effects()
        assert [effect["id"] for effect in effects] == [1, 331]
        assert [effect["panel_default"] for effect in effects] == [True, False]
    finally:
        views.panel_effects.cache_clear()


def test_local_server_rejects_other_hosts():
    assert Client().get("/", HTTP_HOST="example.com").status_code == 400


def test_launcher_opens_browser_after_successful_bind(monkeypatch):
    server = MagicMock()
    server.server_port = 8000
    server.__enter__.return_value = server
    server.serve_forever.side_effect = KeyboardInterrupt
    bind = MagicMock(return_value=server)
    browser = MagicMock()
    monkeypatch.setattr(serve, "make_server", bind)
    monkeypatch.setattr(serve.webbrowser, "open", browser)
    monkeypatch.setattr("sys.argv", ["serve"])
    assert serve.main() == 0
    assert bind.call_args.args[0:2] == ("127.0.0.1", 8000)
    browser.assert_called_once_with("http://127.0.0.1:8000/")
    server.__exit__.assert_called_once()


def test_launcher_does_not_open_browser_when_port_is_busy(monkeypatch):
    monkeypatch.setattr(serve, "make_server", MagicMock(side_effect=OSError("busy")))
    browser = MagicMock()
    monkeypatch.setattr(serve.webbrowser, "open", browser)
    monkeypatch.setattr("sys.argv", ["serve"])
    assert serve.main() == 1
    browser.assert_not_called()


def test_launcher_can_run_without_browser(monkeypatch):
    server = MagicMock()
    server.__enter__.return_value = server
    monkeypatch.setattr(serve, "make_server", MagicMock(return_value=server))
    browser = MagicMock()
    monkeypatch.setattr(serve.webbrowser, "open", browser)
    monkeypatch.setattr("sys.argv", ["serve", "--no-browser"])
    assert serve.main() == 0
    browser.assert_not_called()
