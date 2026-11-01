import json
import os
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
        1, 2, 3, 4, 31, 42, 43, 44, 39, 40, 68, 29, 30,
    ]
    assert "{" not in data["effects"][0]["description"]
    assert {effect["kind"] for effect in data["effects"]} == {"buff", "debuff"}
    ids = [effect["id"] for effect in data["effects"]]
    assert len(ids) == len(set(ids))
    assert {effect["class"] for effect in data["effects"]} <= {
        None, "by", "ga", "ya", "rl", "js", "ij", "rg", "ej", "sj", "fx",
    }


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
