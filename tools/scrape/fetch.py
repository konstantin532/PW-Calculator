"""Загрузка страниц с кэшем на диске, ограничением темпа и несколькими потоками.

Сервер отвечает по 4–6 секунд на страницу, поэтому страницы качаются в несколько
потоков, но между стартами запросов держится пауза, чтобы не давить на сайт.
"""

from __future__ import annotations

import hashlib
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TypeVar

from .session import BASE, CACHE_DIR, Session, get_session, is_challenge, open_session

PAGES_DIR = CACHE_DIR / "pages"
MIN_GAP_SECONDS = 0.4
WORKERS = 4

T = TypeVar("T")


class Fetcher:
    def __init__(self, session: Session | None = None, gap: float = MIN_GAP_SECONDS, workers: int = WORKERS):
        self.session = session or get_session()
        self.gap = gap
        self.workers = workers
        self._lock = threading.Lock()
        self._last_start = 0.0
        PAGES_DIR.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def cache_path(url: str) -> Path:
        return PAGES_DIR / (hashlib.sha1(url.encode("utf-8")).hexdigest() + ".html")

    def get(self, path_or_url: str, *, refresh: bool = False) -> str:
        url = path_or_url if path_or_url.startswith("http") else BASE + path_or_url
        cached = self.cache_path(url)
        if cached.exists() and not refresh:
            return cached.read_text(encoding="utf-8")
        html = self._download(url)
        if is_challenge(html):
            with self._lock:
                self.session = open_session()
            html = self._download(url)
            if is_challenge(html):
                raise RuntimeError(f"Сайт не пропустил запрос даже после новой сессии: {url}")
        cached.write_text(html, encoding="utf-8")
        return html

    def map(self, func: Callable[[T], object], items: Iterable[T]) -> list:
        """Выполняет func для каждого элемента в пуле потоков, порядок результатов сохраняется."""
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            return list(pool.map(func, items))

    def _throttle(self) -> None:
        with self._lock:
            wait = self.gap - (time.monotonic() - self._last_start)
            if wait > 0:
                time.sleep(wait)
            self._last_start = time.monotonic()

    def _download(self, url: str) -> str:
        last: Exception | None = None
        for attempt in range(4):
            self._throttle()
            req = urllib.request.Request(url, headers=self.session.headers())
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    return resp.read().decode("utf-8", "replace")
            except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
                last = exc
                time.sleep(3 * (attempt + 1))
        raise RuntimeError(f"не удалось скачать {url}: {last}")
