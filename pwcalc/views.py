"""Страница калькулятора и данные для панели баффов."""

import json
import re
from functools import lru_cache

from django.conf import settings
from django.http import JsonResponse

from pwcalc.classes import CLASS_NAMES
from pwcalc.effect_panels import (
    CLASS_EFFECT_PANELS,
    DEFAULT_PANEL_IDS,
    EXCLUDED_PANEL_SPRITES,
    PANEL_IDS,
    PARAMETER_LABELS,
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
                "names": skill["names"],
                "descriptions": skill["descriptions"],
                # An allowlist of parsed JSON data, never original JavaScript.
                "record": {
                    "an": record.get("an", skill_id),
                    "mi": record.get("mi"),
                    "ue": record.get("ue", 1),
                    "hi": record.get("hi", []),
                    "lm": record.get("lm", {}),
                    "qc": record.get("qc", {}),
                    "states": record.get("states", {}),
                    "addition_hf": record.get("addition_hf", {}),
                },
            }
        )
    return effects


def effects_api(request):
    effects = panel_effects()
    available_ids = {effect["id"] for effect in effects}
    panels = {
        code: [skill_id for skill_id in panel if skill_id in available_ids]
        for code, panel in CLASS_EFFECT_PANELS.items()
    }
    used_parameters = {key for effect in effects for field in ("lm", "qc") for key in effect["record"][field]}
    labels = {key: value for key, value in PARAMETER_LABELS.items() if key in used_parameters}
    return JsonResponse({"verification": "unverified_for_comeback", "effects": effects,
                         "panels": panels, "parameter_labels": labels})


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
