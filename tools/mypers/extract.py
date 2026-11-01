"""python -m tools.mypers.extract --cache .cache/mypers --output data/skills.json.

Читает сохранённые ответы API и словарь JSON5, не исполняя JavaScript сайта.
Это каталог исходных данных, а не подтверждённый набор механик Comeback.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from decimal import Decimal
from pathlib import Path

import json5

CLASS_NAMES = {
    "by": "Воин",
    "ga": "Маг",
    "ya": "Оборотень",
    "rl": "Друид",
    "ij": "Жрец",
    "js": "Лучник",
    "fx": "Убийца",
    "sj": "Шаман",
    "ej": "Страж",
    "rg": "Мистик",
    "uf": "Призрак",
    "he": "Жнец",
}
KINDS = {"rk": "buff", "hb": "debuff"}


def parse_language(source: str, *, allow_duplicate_keys: bool = False) -> dict:
    match = re.fullmatch(r"\s*var\s+langs\s*=\s*(.*?)\s*;?\s*", source, re.S)
    if match is None:
        raise ValueError("Ожидалось присваивание var langs = {...}")
    # JS допускает числовые ключи без кавычек, JSON5 требует строки.
    # Пропускаем строковые литералы целиком, чтобы не менять их содержимое.
    tokens = r"""("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|([{,]\s*)(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*:)"""

    def quote_key(token: re.Match) -> str:
        if token.group(1):
            return token.group(1)
        number = Decimal(token.group(3))
        if number != number.to_integral_value():
            raise ValueError("Ожидался целочисленный ключ перевода")
        return f'{token.group(2)}"{int(number)}"'

    body = re.sub(
        tokens,
        quote_key,
        match.group(1),
    )
    result = json5.loads(body, allow_duplicate_keys=allow_duplicate_keys)
    if not isinstance(result, dict):
        raise ValueError("Словарь переводов должен быть объектом")
    return result


def sprite_positions(css: str) -> dict[int, dict]:
    positions = {}
    pattern = r"\.s32-32-(\d+)\s*\{\s*background-position:\s*(-?\d+)(?:px)?\s+(-?\d+)(?:px)?\s*;?\s*}"
    for skill_id, x, y in re.findall(pattern, css):
        positions[int(skill_id)] = {"x": -int(x), "y": -int(y), "width": 32, "height": 32}
    return positions


def build_catalog(records: list[dict], language: dict, positions: dict) -> dict:
    skills = []
    seen = set()
    translations = language.get("yo", {})
    for record in records:
        class_code = record.get("ir")
        # Неизвестные классы нельзя молча включать в версию 1.4.6.
        if class_code is not None and class_code not in CLASS_NAMES:
            continue
        skill_id = record["id"]
        if skill_id in seen:
            raise ValueError(f"Повтор ID умения: {skill_id}")
        seen.add(skill_id)
        section = translations.get(class_code, {}) if class_code else translations
        translated = section.get(str(record["mi"]), {})
        skills.append(
            {
                "id": skill_id,
                "class": class_code,
                "kind": KINDS.get(record.get("pg")),
                "names": {key: translated[key] for key in translated if key == "mi" or key.startswith("mi ")},
                "descriptions": {key: translated[key] for key in translated if key.startswith("desc")},
                "sprite": positions.get(skill_id),
                "verification": "unverified_for_comeback",
                # Сохраняем структуру уровней/вариантов без догадок об их семантике.
                "source_record": record,
            }
        )
    if not skills:
        raise ValueError("Пустой каталог умений")
    return {
        "schema_version": 1,
        "source": "https://mypers.ru/",
        "verification": "unverified_for_comeback",
        "classes": CLASS_NAMES,
        "state_labels": {key: value for key, value in translations.items() if isinstance(value, str)},
        "state_descriptions": language.get("fuState", {}),
        "skills": sorted(skills, key=lambda skill: skill["id"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=Path(".cache/mypers"))
    parser.add_argument("--output", type=Path, default=Path("data/skills.json"))
    args = parser.parse_args()
    files = {
        "api": args.cache / "api_2__a=sb&k=yo.json",
        "language": args.cache / "lang.min.js",
        "css": args.cache / "styles2-images.min.css",
    }
    api = json.loads(files["api"].read_text(encoding="utf-8"))
    if api.get("success") is not True or not isinstance(api.get("data"), list):
        raise ValueError("API не вернул успешный список умений")
    catalog = build_catalog(
        api["data"],
        # В оригинале три повторных ключа. Как в JS, последнее значение побеждает.
        parse_language(files["language"].read_text(encoding="utf-8"), allow_duplicate_keys=True),
        sprite_positions(files["css"].read_text(encoding="utf-8")),
    )
    catalog["source_sha256"] = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in files.items()}
    catalog["language_duplicate_policy"] = "last_value_as_in_javascript"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    skills = catalog["skills"]
    print(
        f"skills={len(skills)}, named={sum(bool(s['names']) for s in skills)}, "
        f"sprites={sum(s['sprite'] is not None for s in skills)}"
    )


if __name__ == "__main__":
    main()
