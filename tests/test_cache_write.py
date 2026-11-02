from tools.scrape.cache_write import publish_bytes


def test_publish_exposes_complete_content_without_replacing_existing_file(tmp_path):
    target = tmp_path / "page.html"
    assert publish_bytes(target, b"complete source page") is True
    assert target.read_bytes() == b"complete source page"
    assert publish_bytes(target, b"another source page") is False
    assert target.read_bytes() == b"complete source page"
    assert list(tmp_path.iterdir()) == [target]


def test_publish_loses_race_without_overwriting_the_crawler(tmp_path, monkeypatch):
    import os

    target = tmp_path / "page.html"
    operation = "rename" if os.name == "nt" else "link"
    original_publish = getattr(os, operation)

    def crawler_wins(staging, destination):
        # The new data is complete before publication, but the independent
        # crawler claims the destination after the initial existence check.
        assert staging.read_bytes() == b"new complete page"
        destination.write_bytes(b"independent crawler's page")
        original_publish(staging, destination)

    monkeypatch.setattr(os, operation, crawler_wins)
    assert publish_bytes(target, b"new complete page") is False
    assert target.read_bytes() == b"independent crawler's page"
    assert list(tmp_path.iterdir()) == [target]
