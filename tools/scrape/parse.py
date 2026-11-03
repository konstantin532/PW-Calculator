"""Разбор страницы предмета comeback.pw в словарь с нормализованными полями."""

from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup, SoupStrainer, Tag

# Подписи характеристик → ключи. Чего нет в карте, остаётся в specs_extra.
STAT_LABELS: dict[str, str] = {
    "Защита": "phys_def",
    "Физическая защита": "phys_def",
    "Защита от металла": "def_metal",
    "Защита от дерева": "def_wood",
    "Защита от воды": "def_water",
    "Защита от огня": "def_fire",
    "Защита от земли": "def_earth",
    "Магическая защита": "mag_def",
    "Физическая атака": "phys_atk",
    "Физ атака": "phys_atk",
    "Магическая атака": "mag_atk",
    "Скорость атаки": "atk_speed",
    "Дальность": "range",
    "Здоровье": "hp",
    "Мана": "mp",
    "Меткость": "accuracy",
    "Уклонение": "evasion",
    "Шанс крит. удара": "crit",
    "Скорость": "speed",
}

REQ_LABELS: dict[str, str] = {
    "Требуется силы": "str",
    "Требуется ловкости": "dex",
    "Требуется интеллекта": "int",
    "Требуется телосложения": "vit",
    "Требуется выносливости": "vit",
    "Требуется магии": "int",
}

META_LABELS = {
    "Тип": "type",
    "Подтип": "subtype",
    "Ранг/Уровень": "grade",
    "Ранг\\уровень": "grade",
    "Требуемый уровень": "level",
    "Цена": "price",
    "Количество в ячейке": "stack",
    "Используется персонажем(ами)": "classes",
    "Разбирается в": "decompose",
    "Ломается в": "breaks_into",
    "Цена вставки": "socket_price",
    "Цена выемки": "unsocket_price",
    "Привязка": "bind",
}

NUM_RE = re.compile(r"[-+]?\d+(?:[.,]\d+)?")


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _numbers(text: str) -> list[float]:
    return [float(n.replace(",", ".")) for n in NUM_RE.findall(text.replace("\xa0", "").replace(" ", ""))]


def _number(text: str) -> float | None:
    nums = _numbers(text)
    return nums[0] if nums else None


def parse_stat_value(label: str, raw: str) -> Any:
    """'10 - 18' → [10, 18]; '+48' → 48; '3 м.' → 3; '1.25' → 1.25."""
    rng = re.search(r"(\d+)\s*-\s*(\d+)", raw)
    if rng and label in ("Физическая атака", "Магическая атака"):
        return [int(rng.group(1)), int(rng.group(2))]
    nums = _numbers(raw)
    if not nums:
        return raw
    value = nums[0]
    return int(value) if value.is_integer() else value


def parse_item(html: str, item_id: int | None = None) -> dict[str, Any]:
    # The database repeats a large navigation tree on every item page.
    # Parse only the item region; this preserves its original markup while
    # avoiding the unrelated menu for every record in a full catalog import.
    soup = BeautifulSoup(html, "lxml", parse_only=SoupStrainer(id="content-block"))
    block = soup.select_one("#content-block")
    if block is None:
        raise ValueError("нет блока содержимого (страница-заглушка?)")

    header = block.select_one(".box_content_header_wrapper")
    name = _clean(header.get_text(" ")) if header else ""
    icon_tag = header.find("img") if header else None
    icon = icon_tag["src"] if icon_tag and icon_tag.has_attr("src") else None

    crumbs = [_clean(li.get_text(" ")) for li in block.select(".breadcrumb .breadcrumb_item")]

    item: dict[str, Any] = {
        "id": item_id,
        "name": name,
        "icon": icon,
        "breadcrumb": crumbs[:-1],
        "stats": {},
        "req": {},
        "specs_extra": {},
        "sockets": {},
        "description": [],
    }
    if header is not None:
        colored_name = header.select_one("font[color], [style*='color']")
        if colored_name is not None:
            raw_color = colored_name.get("color", "")
            if not raw_color:
                color_match = re.search(r"(?:^|;)\s*color\s*:\s*(#[\da-fA-F]{3,6})(?:\s*;|\s*$)",
                                        colored_name.get("style", ""))
                raw_color = color_match.group(1) if color_match else ""
            if re.fullmatch(r"#(?:[\da-fA-F]{3}|[\da-fA-F]{6})", raw_color):
                item["name_color"] = raw_color.lower()
    specs = block.select_one(".data_specs ul")
    if specs is not None:
        for li in specs.find_all("li", recursive=False):
            _parse_spec_line(li, item)

    tabs = {b.get("data-bs-target", "").lstrip("#"): _clean(b.get_text(" ")) for b in block.select(".data-tabs button")}
    for pane in block.select(".tab-pane"):
        pane_id = pane.get("id", "")
        title = tabs.get(pane_id, pane_id)
        if pane_id == "addons-pane":
            item["addons"] = _parse_addons(pane)
        elif pane_id == "refine-tab-pane":
            item["refine"] = _parse_refine(pane)
        elif "комплект" in title.lower() or "set" in pane_id:
            item["set"] = [_clean(li.get_text(" ")) for li in pane.find_all("li")]
            item["set_bonus"] = parse_set_bonus(pane, item_id)
    return item


def validate_set_bonus(value: Any, item_id: int | None = None) -> dict[str, Any]:
    """Validate a numeric-threshold set descriptor without interpreting its effects."""
    if not isinstance(value, dict) or not isinstance(value.get("name"), str) or not value["name"].strip():
        raise ValueError("комплект: отсутствует название")
    members = value.get("members")
    if (not isinstance(members, list) or len(members) < 2
            or any(type(member) is not int or member <= 0 for member in members)
            or len(set(members)) != len(members)):
        raise ValueError("комплект: неверные ID частей")
    members = sorted(members)
    if item_id is not None and item_id not in members:
        raise ValueError(f"комплект: предмет {item_id} отсутствует среди частей")
    identity = "146:" + "-".join(map(str, members))
    if value.get("id", identity) != identity:
        raise ValueError("комплект: ID не соответствует частям")
    bonuses = value.get("bonuses")
    if not isinstance(bonuses, list) or not bonuses:
        raise ValueError("комплект: отсутствуют бонусы")
    normalized = []
    seen = set()
    for bonus in bonuses:
        if not isinstance(bonus, dict):
            raise ValueError("комплект: неверная запись бонуса")
        pieces, texts = bonus.get("pieces"), bonus.get("texts")
        if type(pieces) is not int or not 1 <= pieces <= len(members) or pieces in seen:
            raise ValueError("комплект: неверный или повторный числовой порог")
        if (not isinstance(texts, list) or not texts
                or any(not isinstance(text, str) or not text.strip() or len(text) > 500
                       or any(ord(char) < 32 for char in text) for text in texts)
                or len(set(texts)) != len(texts)):
            raise ValueError("комплект: неверное описание бонуса")
        seen.add(pieces)
        normalized.append({"pieces": pieces, "texts": sorted(texts)})
    return {"id": identity, "name": _clean(value["name"]), "members": members,
            "bonuses": sorted(normalized, key=lambda entry: entry["pieces"])}


def parse_set_bonus(pane: Tag, item_id: int | None = None) -> dict[str, Any]:
    """Keep source member IDs and every threshold, alongside legacy names."""
    tables = pane.select("table.table-union")
    if len(tables) != 1:
        raise ValueError("комплект: ожидается одна таблица числовых бонусов")
    table = tables[0]
    body = table.find_parent("div", class_="itemchar_body")
    if body is None:
        raise ValueError("комплект: отсутствует блок описания")
    heading = body.find("h6")
    members = []
    for link in body.select("ul a[href]"):
        match = re.fullmatch(r"(?:https://comeback\.pw)?/db/146/item/([1-9]\d*)", link["href"])
        if match is None:
            raise ValueError("комплект: часть ссылается не на предмет 146")
        members.append(int(match[1]))
    grouped: dict[int, list[str]] = {}
    for row in table.select("tbody tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) != 2 or re.fullmatch(r"[1-9]\d*", cells[0].get_text(strip=True)) is None:
            raise ValueError("комплект: неверный числовой порог таблицы")
        pieces = int(cells[0].get_text(strip=True))
        texts = [_clean(addon.get_text(" ")) for addon in cells[1].select(".addon")]
        if not texts:
            texts = [_clean(cells[1].get_text(" "))]
        grouped.setdefault(pieces, []).extend(texts)
    return validate_set_bonus({"name": _clean(heading.get_text(" ")) if heading else "",
                               "members": members,
                               "bonuses": [{"pieces": pieces, "texts": texts}
                                           for pieces, texts in grouped.items()]}, item_id)


def _parse_spec_line(li: Tag, item: dict[str, Any]) -> None:
    primary = li.find("span", class_="specs_primary")
    secondary = li.find("div", class_="specs_secondary")
    if primary is None or secondary is None:
        text = _clean(li.get_text(" "))
        if text:
            item["description"].append(text)
        # Tomes show their fixed properties as separate gold lines rather
        # than a specs/addons table. Preserve those explicit lines verbatim.
        fixed = []
        for font in li.select('font[color="#ffcb4a"]'):
            # Gold lines are the source's fixed-property block. Keep numeric
            # statements with units or unsigned wording as well: an unknown
            # effect must reach the engine's warning path, not disappear here.
            fixed.extend(line.strip() for line in font.get_text("\n").splitlines()
                         if NUM_RE.search(line) and re.search(r"[^\W\d_]", line))
        if fixed:
            item.setdefault("fixed_properties", []).extend(fixed)
        return
    label = _clean(primary.get_text(" "))
    raw = _clean(secondary.get_text(" "))
    if label in STAT_LABELS:
        item["stats"][STAT_LABELS[label]] = parse_stat_value(label, raw)
    elif label in REQ_LABELS:
        item["req"][REQ_LABELS[label]] = int(_number(raw) or 0)
    elif label in META_LABELS:
        key = META_LABELS[label]
        if key == "classes":
            item[key] = [c.strip() for c in raw.split(",") if c.strip()]
        elif key in ("level", "grade", "stack"):
            item[key] = int(_number(raw) or 0)
        else:
            item[key] = raw
    elif label.startswith("Шанс создания с") or label.startswith("Шанс выпадения с"):
        kind = "craft" if "создания" in label else "drop"
        slots = int(_number(label) or 0)
        item["sockets"].setdefault(kind, {})[slots] = _number(raw)
    else:
        item["specs_extra"][label] = raw


def _parse_addons(pane: Tag) -> dict[str, Any]:
    result: dict[str, Any] = {"count": None, "options": [], "unique": []}
    target = "options"
    for el in pane.find_all(["h6", "li"]):
        text = _clean(el.get_text(" "))
        if el.name == "h6":
            target = "unique" if "уникальн" in text.lower() else "options"
            continue
        if text.startswith("Количество:"):
            result["count"] = text.split(":", 1)[1].strip()
            continue
        spans = el.find_all("span")
        if len(spans) >= 2:
            result[target].append({"text": _clean(spans[0].get_text(" ")), "chance": _number(spans[1].get_text())})
    return result


def _parse_refine(pane: Tag) -> dict[str, Any] | None:
    items = [_clean(li.get_text(" ")) for li in pane.find_all("li")]
    if not items:
        return None
    head = items[0]
    levels: dict[int, float] = {}
    for text in items[1:]:
        m = re.match(r"(\d+):\s*([-+]?\d+(?:[.,]\d+)?)", text)
        if m:
            levels[int(m.group(1))] = float(m.group(2).replace(",", "."))
    stat_name = re.sub(r"\s*[-+]\d.*$", "", head)
    return {"stat": stat_name, "base": _number(head), "levels": [levels.get(i) for i in range(1, 13)]}


STONE_TARGETS = {"оружие": "weapon", "доспехи": "armor", "броню": "armor",
                 "бижутерию": "decoration", "бижутерия": "decoration"}
STONE_PREFIX = r"(?:Влияние на|Действие на|Эффект при инкрустации в)\s+"
STONE_EFFECT_RE = re.compile(STONE_PREFIX + r"(оружие|доспехи|броню|бижутери[юя]):\s*(.+?)(?=\s*"
                             + STONE_PREFIX + r"|\s*$)", re.S | re.I)
STONE_VALUE_RE = re.compile(r"^(.*?)\s*([-+]\s*\d+(?:[.,]\d+)?)\s*(%|ед\.?)?", re.S)


def parse_stone_effects(description: list[str]) -> dict[str, dict[str, Any]]:
    """«Влияние на оружие: физ. атака +16 ед.» → {"weapon": {"stat": "физ. атака", "value": 16, "percent": False}}."""
    effects: dict[str, dict[str, Any]] = {}
    joined = " ".join(description)
    for target, body in STONE_EFFECT_RE.findall(joined):
        target = target.lower()
        body = _clean(body).rstrip(".")
        m = STONE_VALUE_RE.match(body)
        if not m:
            effects[STONE_TARGETS[target]] = {"stat": body, "value": None, "percent": False, "raw": body}
            continue
        value = float(m.group(2).replace(" ", "").replace(",", "."))
        effects[STONE_TARGETS[target]] = {
            "stat": m.group(1).strip().rstrip(":"),
            "value": int(value) if value.is_integer() else value,
            "percent": m.group(3) == "%",
            "raw": body,
        }
        if m.group(1).strip().casefold() == "защита":
            # This source wording does not identify physical defense versus
            # defense level. Preserve its number without guessing the stat.
            effects[STONE_TARGETS[target]]["source_value"] = effects[STONE_TARGETS[target]]["value"]
            effects[STONE_TARGETS[target]]["value"] = None
            effects[STONE_TARGETS[target]]["ambiguity"] = "physical_defense_or_defense_level"
    return effects
