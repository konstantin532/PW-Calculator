"""Каталог разделов базы и разбор страниц-списков."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from bs4 import BeautifulSoup, SoupStrainer

from .session import DB_PREFIX

# Разделы снаряжения: подраздел «0» показывает все подтипы раздела.
EQUIPMENT_SECTIONS: dict[str, list[str]] = {
    "armor": ["125", "150", "216", "316", "346", "369"],
    "weapon": ["1", "5", "9", "13", "182", "292", "23749", "25333"],
    "decoration": ["171", "234", "247"],
}

# Разделы камней и книг умений: одна страница-список на раздел (с пагинацией).
LIST_SECTIONS: dict[str, str] = {
    "stones": "/stones/all",
    "jasper": "/jasper/all",
    "skills": "/skills/all",
}

PAGE_SIZE = 15
SHOWN_RE = re.compile(r"Показано\s+(\d+)-(\d+)\s+из\s+(\d+)")


@dataclass(frozen=True)
class ListRow:
    item_id: int
    name: str
    kind: str
    level_or_price: str
    icon: str | None


def section_url(section: str, sub: str, page: int = 1) -> str:
    path = f"{DB_PREFIX}/{section}/{sub}/0" if section in EQUIPMENT_SECTIONS else f"{DB_PREFIX}{sub}"
    return f"{path}?page={page}" if page > 1 else path


def parse_total(html: str) -> int:
    m = SHOWN_RE.search(html)
    return int(m.group(3)) if m else 0


def page_count(total: int) -> int:
    return max(1, math.ceil(total / PAGE_SIZE))


def parse_list(html: str) -> list[ListRow]:
    soup = BeautifulSoup(html, "lxml", parse_only=SoupStrainer(id="content-block"))
    block = soup.select_one("#content-block")
    if block is None:
        return []
    rows: list[ListRow] = []
    for tr in block.select("table tbody tr"):
        tds = tr.find_all("td")
        if len(tds) < 4:
            continue
        link = tds[1].find("a", href=re.compile(r"/item/\d+"))
        if link is None:
            continue
        item_id = int(re.search(r"/item/(\d+)", link["href"]).group(1))
        img = link.find("img")
        rows.append(
            ListRow(
                item_id=item_id,
                name=link.get_text(" ", strip=True),
                kind=tds[2].get_text(" ", strip=True),
                level_or_price=tds[3].get_text(" ", strip=True),
                icon=img["src"] if img and img.has_attr("src") else None,
            )
        )
    return rows
