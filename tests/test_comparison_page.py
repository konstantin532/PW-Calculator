import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "pwcalc.settings")

import django
from bs4 import BeautifulSoup
from django.test import Client

django.setup()


def test_comparison_reuses_two_named_calculators():
    response = Client().get("/compare/", HTTP_HOST="127.0.0.1")
    assert response.status_code == 200
    soup = BeautifulSoup(response.content, "html.parser")
    frames = soup.select("iframe")
    assert len(frames) == 2
    assert all(frame.get("src", "").startswith("/calculator/") for frame in frames)
    assert len({frame.get("title") for frame in frames}) == 2
    assert all(frame.get("title") for frame in frames)
    assert "/static/js/comparison-page.js" in response.content.decode()
    assert response.headers["X-Frame-Options"] == "DENY"


def test_only_embedded_calculator_can_be_framed_by_same_origin():
    response = Client().get("/calculator/", HTTP_HOST="127.0.0.1")
    assert response.status_code == 200
    soup = BeautifulSoup(response.content, "html.parser")
    assert "comparison-embedded" in soup.body.get("class", [])
    assert soup.select_one("#stats-body") is not None
    assert soup.select_one("#paperdoll") is not None
    assert soup.select_one("#buff-list") is not None
    assert soup.select_one("#btn-compare") is None
    assert not soup.select("iframe")
    assert response.headers["X-Frame-Options"] == "SAMEORIGIN"


def test_single_calculator_keeps_comparison_entry_and_frame_protection():
    response = Client().get("/", HTTP_HOST="127.0.0.1")
    assert response.status_code == 200
    soup = BeautifulSoup(response.content, "html.parser")
    entry = soup.select_one("#btn-compare")
    assert entry is not None
    assert entry.get_text(strip=True) == "Сравнить с другим персонажем"
    assert entry.find_parent("nav").get("aria-label") == "Сравнение персонажей"
    assert entry not in soup.select_one(".toolbar").descendants
    assert "comparison-embedded" not in soup.body.get("class", [])
    assert response.headers["X-Frame-Options"] == "DENY"


def test_comparison_mode_switch_keeps_both_calculators_on_the_page():
    response = Client().get("/compare/", HTTP_HOST="127.0.0.1")
    soup = BeautifulSoup(response.content, "html.parser")
    switch = soup.select_one("#single-calculator")
    assert switch.name == "button"
    assert switch.get("type") == "button"
    assert switch.get("aria-expanded") == "true"
    controlled = [soup.find(id=value) for value in switch.get("aria-controls", "").split()]
    assert len(controlled) == 3
    assert all(element is not None for element in controlled)
    assert any(element.select_one("#frame-right") is not None for element in controlled)


def test_comparison_endpoints_keep_local_host_restriction():
    for url in ("/compare/", "/calculator/"):
        assert Client().get(url, HTTP_HOST="example.com").status_code == 400
