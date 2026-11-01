"""Страница калькулятора и данные для панели баффов."""

import json
import re
from functools import lru_cache

from django.conf import settings
from django.http import JsonResponse

from pwcalc.classes import CLASS_NAMES

# Реальные IDs стартовой панели в исходном gqSkillsIds[1].rk.
# Номер рисунка — source_record.an; mi служит ключом перевода.
DEFAULT_PANEL_IDS = [17, 18, 19, 20, 5, 1, 3, 4, 6, 7, 92, 41, 42]
# Современный блок, который пользователь явно исключил для Comeback 1.4.6.
EXCLUDED_PANEL_SPRITES = frozenset({62, 61, 60, 310, 10048, 359, 360, 366, 367, 393, 394, 10040})
PANEL_IDS = (
    DEFAULT_PANEL_IDS
    + [1, 2, 3, 4, 62, 61, 60, 310, 10048, 359, 360, 366, 367, 393, 394, 10040, 31, 42, 43, 44, 39, 40, 68]
    + [29, 30, 5, 6, 7, 24, 25, 26, 27, 28]
    + list(range(115, 131))
    + list(range(133, 140))
    + [142]
    + list(range(144, 160))
    + [180, 324, 325, 327, 329, 331, 334, 337, 339, 77, 69, 63]
)


def _fill(template: str, values: dict) -> str:
    def value(match: re.Match) -> str:
        raw = values.get(match.group(1))
        if isinstance(raw, int | float):
            return f"{raw:g}".replace(".", ",")
        return match.group(0)

    return re.sub(r"\{(\w+)\}", value, template)


@lru_cache(maxsize=1)
def panel_effects() -> list[dict]:
    catalog = json.loads((settings.BASE_DIR / "data" / "skills.json").read_text(encoding="utf-8"))
    by_id = {skill["id"]: skill for skill in catalog["skills"]}
    effects = []
    for skill_id in dict.fromkeys(PANEL_IDS):
        skill = by_id.get(skill_id)
        if skill is None:
            continue
        if skill["class"] is not None and skill["class"] not in CLASS_NAMES:
            continue
        name = skill["names"].get("mi")
        if not name:
            continue
        record = skill["source_record"]
        if record.get("an") in EXCLUDED_PANEL_SPRITES:
            continue
        description = skill["descriptions"].get("desc", "")
        effects.append(
            {
                "id": skill_id,
                "sprite_id": record.get("an", skill_id),
                "panel_default": skill_id in DEFAULT_PANEL_IDS,
                "name": name,
                "class": skill["class"],
                "kind": "debuff" if skill["kind"] == "debuff" else "buff",
                "description": _fill(description, record.get("lm", {})),
            }
        )
    return effects


def effects_api(request):
    return JsonResponse({"verification": "unverified_for_comeback", "effects": panel_effects()})


@lru_cache(maxsize=1)
def catalog_data() -> dict:
    """Serve a fixed reviewed snapshot, independent of the live crawler's writes."""
    data_dir = settings.BASE_DIR / "data"
    catalogs = {}
    for kind in ("items", "stones"):
        path = data_dir / f"catalog_{kind}.json"
        if not path.exists():
            path = data_dir / f"{kind}.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        # Legacy crawler data can contain external icons: keep the UI entirely local.
        for record in records:
            if (record.get("icon") or "").startswith("http"):
                record["icon"] = None
        catalogs[kind] = records
    meta_path = data_dir / "catalog_meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    coverage = {**meta.get("coverage", {}), "items": len(catalogs["items"]), "stones": len(catalogs["stones"])}
    return {"version": "Comeback PW 1.4.6", "verification": "unverified_for_comeback",
            **catalogs, "coverage": coverage}


def catalog_api(request):
    return JsonResponse(catalog_data(), json_dumps_params={"ensure_ascii": False})
