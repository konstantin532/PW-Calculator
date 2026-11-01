import json
import sys

import pytest

from tools.mypers.extract import build_catalog, main, parse_language, sprite_positions


def test_language_accepts_js_object_literals_without_execution():
    language = parse_language('var langs={ij:{1:{mi:"Покров",desc:"Защита {tb}%",}},yo:{tb:"защита"}};')
    assert language["ij"]["1"]["mi"] == "Покров"


@pytest.mark.parametrize(
    "source",
    [
        "var langs={}; alert('executed');",
        "var langs={value: function(){ return 1; }};",
        "var langs=[];",
    ],
)
def test_language_rejects_executable_code_and_wrong_shape(source):
    with pytest.raises(ValueError):
        parse_language(source)


def test_sprite_coordinates_accept_zero_and_negative_pixel_positions():
    css = ".s32-32-1 {background-position: -32px 0;}.s32-32-2 {background-position: 0 -64px;}"
    positions = sprite_positions(css)
    assert positions[1] == {"x": 32, "y": 0, "width": 32, "height": 32}
    assert positions[2]["y"] == 64
    assert 3 not in positions


def test_numeric_keys_inside_strings_are_not_rewritten():
    language = parse_language("""var langs={1:{mi:'Example {2: value}',desc:"x,3: y"}};""")
    assert language["1"] == {"mi": "Example {2: value}", "desc": "x,3: y"}


def test_language_normalizes_exponential_numeric_keys():
    language = parse_language('var langs={ij:{1e3:{mi:"Тысяча"},1.01e3:{mi:"Тысяча десять"}}};')
    assert language["ij"]["1000"]["mi"] == "Тысяча"
    assert language["ij"]["1010"]["mi"] == "Тысяча десять"


def test_language_rejects_duplicate_normalized_keys():
    with pytest.raises(ValueError):
        parse_language('var langs={1e3:"first",1000:"second"};')


def test_language_allows_explicit_javascript_duplicate_policy():
    assert parse_language('var langs={sx:"first",sx:"last"};', allow_duplicate_keys=True) == {"sx": "last"}


def test_catalog_retains_variants_and_flags_unverified_records():
    record = {"id": 1, "mi": 1, "ir": "ij", "pg": "rk", "states": {"11": [{"rs": {"type": "tb", "val": 100}}]}}
    language = {"yo": {"ij": {"1": {"mi": "Покров", "mi rs": "Светлый покров", "desc": "{tb}%"}}}}
    catalog = build_catalog([record, {"id": 2, "mi": 2, "ir": "gunner"}], language, {})
    assert len(catalog["skills"]) == 1
    skill = catalog["skills"][0]
    assert skill["kind"] == "buff"
    assert skill["names"]["mi rs"] == "Светлый покров"
    assert skill["source_record"] == record
    assert skill["verification"] == "unverified_for_comeback"
    assert skill["sprite"] is None


def test_catalog_keeps_shared_skills_without_guessing_names():
    skill = build_catalog([{"id": 1, "mi": 99}], {}, {})["skills"][0]
    assert skill["class"] is None and skill["kind"] is None
    assert skill["names"] == {}


def test_catalog_rejects_duplicate_ids_and_empty_results():
    record = {"id": 1, "mi": 1}
    with pytest.raises(ValueError, match="ID"):
        build_catalog([record, record], {}, {})
    with pytest.raises(ValueError, match="Пустой"):
        build_catalog([], {}, {})


def test_shared_translations_and_state_labels_have_separate_shapes():
    language = {
        "yo": {"99": {"mi": "Общее умение"}, "tb": "Защита", "ij": {}},
        "fuState": {"tb": "Защита на {tb}%"},
    }
    catalog = build_catalog([{"id": 1, "mi": 99}], language, {})
    assert catalog["skills"][0]["names"] == {"mi": "Общее умение"}
    assert catalog["state_labels"] == {"tb": "Защита"}
    assert catalog["state_descriptions"] == language["fuState"]


def test_cli_exports_source_effects_and_provenance(tmp_path, monkeypatch):
    record = {
        "id": 1,
        "mi": 1000,
        "ir": "ij",
        "pg": "rk",
        "hf": 1,
        "ue": 10,
        "lm": {"tb": 15},
        "qc": {"tb": {"0": 5}},
        "states": {"0": [{"type": "tb", "an": 1}]},
    }
    (tmp_path / "api_2__a=sb&k=yo.json").write_text(json.dumps({"success": True, "data": [record]}), encoding="utf-8")
    (tmp_path / "lang.min.js").write_text('var langs={yo:{ij:{1e3:{mi:"Покров",desc:"{tb}%"}}}};', encoding="utf-8")
    (tmp_path / "styles2-images.min.css").write_text(".s32-32-1 {background-position: -32px 0;}", encoding="utf-8")
    output = tmp_path / "output" / "skills.json"
    monkeypatch.setattr(sys, "argv", ["extract", "--cache", str(tmp_path), "--output", str(output)])
    main()
    catalog = json.loads(output.read_text(encoding="utf-8"))
    assert catalog["skills"][0]["source_record"] == record
    assert catalog["skills"][0]["names"]["mi"] == "Покров"
    assert catalog["skills"][0]["sprite"]["x"] == 32
    assert set(catalog["source_sha256"]) == {"api", "language", "css"}
    assert all(len(digest) == 64 for digest in catalog["source_sha256"].values())
