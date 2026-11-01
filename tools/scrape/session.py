"""Доступ к comeback.pw.

Сайт закрыт JS-проверкой: обычный запрос получает страницу-заглушку, которая
считает хеш и ставит cookie. Пройти её может только настоящий браузер, поэтому
cookie получаем один раз через Playwright и дальше ходим обычным HTTP-клиентом.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

BASE = "https://comeback.pw"
DB_PREFIX = "/db/146"
CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache"
SESSION_FILE = CACHE_DIR / "session.json"


@dataclass
class Session:
    cookie_header: str
    user_agent: str

    def headers(self) -> dict[str, str]:
        return {
            "Cookie": self.cookie_header,
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "ru-RU,ru;q=0.9",
        }


def is_challenge(html: str) -> bool:
    return "get_jhash" in html and "content-block" not in html


def load_session() -> Session | None:
    if not SESSION_FILE.exists():
        return None
    data = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
    return Session(data["cookie_header"], data["user_agent"])


def save_session(session: Session) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    SESSION_FILE.write_text(
        json.dumps({"cookie_header": session.cookie_header, "user_agent": session.user_agent}),
        encoding="utf-8",
    )


def open_session() -> Session:
    """Проходит проверку в headless Chromium и возвращает cookie для HTTP-запросов."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(locale="ru-RU", viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        page.goto(f"{BASE}{DB_PREFIX}/", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_selector("#content-block", timeout=60_000)
        cookies = ctx.cookies()
        ua = page.evaluate("navigator.userAgent")
        browser.close()
    session = Session("; ".join(f"{c['name']}={c['value']}" for c in cookies), ua)
    save_session(session)
    return session


def get_session() -> Session:
    return load_session() or open_session()
