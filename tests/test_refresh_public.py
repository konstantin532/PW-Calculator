import hashlib

import pytest

from tools.scrape.refresh_public import BASE, cache_path, public_url, refresh


def test_public_refresh_uses_existing_cache_url_identity(tmp_path):
    url = public_url("/weapon/292/0?page=2")
    assert url == f"{BASE}/weapon/292/0?page=2"
    assert cache_path(tmp_path, url).name == hashlib.sha1(url.encode()).hexdigest() + ".html"
    for path in ("/../../outside", "item/1", "/item/../1"):
        with pytest.raises(ValueError):
            public_url(path)


def test_expired_refresh_never_launches_a_browser(tmp_path, monkeypatch):
    import playwright.async_api

    def forbidden_browser():
        raise AssertionError("An expired public-page budget must not launch or request anything")

    monkeypatch.setattr(playwright.async_api, "async_playwright", forbidden_browser)
    # Expiry must return before the coroutine schedules any browser work.
    # Driving its first step also avoids creating a Windows loop/socketpair
    # for a path that is required to perform no I/O.
    pending = refresh(pages=tmp_path / "pages", manifest=tmp_path / "progress.json",
                      categories=["heavy_chest"], seconds=0)
    with pytest.raises(StopIteration) as completed:
        pending.send(None)
    result = completed.value.value
    assert result["counts"] == {}
    assert result["categories"] == {}
    assert result["method"] == "normal_public_browser_no_session_export"


def test_icon_refresh_rejects_html_and_unrelated_urls(tmp_path):
    import json

    from tools.scrape.refresh_icons import PUBLIC_SAMPLE, collect_urls, valid_image

    pages, data_dir = tmp_path / "pages", tmp_path / "data"
    pages.mkdir()
    data_dir.mkdir()
    (pages / "public.html").write_text(
        f'<div class="box_content_header_wrapper"><img src="{PUBLIC_SAMPLE}">', encoding="utf-8")
    (data_dir / "catalog_items.json").write_text(json.dumps([
        {"source": {"icon_url": "https://example.com/other.png"}},
    ]), encoding="utf-8")
    assert collect_urls(pages, data_dir) == {PUBLIC_SAMPLE}
    assert valid_image(b"\xff\xd8\xff" + b"small public icon")
    assert not valid_image(b"<html>public JavaScript page</html>")
    assert not valid_image(b"\xff\xd8\xff" + bytes(262144))
