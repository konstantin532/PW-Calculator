import os
from unittest.mock import MagicMock

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "pwcalc.settings")

import django
from django.test import Client

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
    assert data["effects"][0]["name"] == "Железный покров"
    assert "{" not in data["effects"][0]["description"]
    assert {effect["kind"] for effect in data["effects"]} == {"buff", "debuff"}
    ids = [effect["id"] for effect in data["effects"]]
    assert len(ids) == len(set(ids))


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
