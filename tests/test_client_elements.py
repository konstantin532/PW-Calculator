"""Small independently packed records exercise the public client reader."""
import hashlib
import json
import struct
from pathlib import Path

import pytest


def _named_row(size, item_id, name, *, major=None, subtype=None):
    row = bytearray(size)
    struct.pack_into('<I', row, 0, item_id)
    name_offset = 4
    if major is not None:
        struct.pack_into('<II', row, 4, major, subtype)
        name_offset = 12
    encoded = name.encode('utf-16-le')
    row[name_offset:name_offset + len(encoded)] = encoded
    return row


def _fixture(tmp_path, *, tail=b'NPC DATA MUST NOT BE EXPORTED'):
    addon = _named_row(84, 333, 'B_U22')
    struct.pack_into('<II', addon, 68, 1, 1031127695)
    weapon_sub = _named_row(356, 18, 'Простой меч')
    struct.pack_into('<f', weapon_sub, 332, 1.0)  # probability_normal
    struct.pack_into('<f', weapon_sub, 344, 0.9)
    weapon = _named_row(1424, 22, 'Меч', major=1, subtype=18)
    struct.pack_into('<f', weapon, 652, 3.0)
    struct.pack_into('<f', weapon, 732, 1.0)  # added probability_addon_num5
    struct.pack_into('<If', weapon, 740, 333, 1.0)
    armor = _named_row(1132, 21418, 'Плащ', major=125, subtype=127)
    struct.pack_into('<I', armor, 400, 2)
    struct.pack_into('<f', armor, 560, 1.0)  # added probability_addon_num4
    struct.pack_into('<If', armor, 564, 333, 0.0)  # fixed addon may have zero probability
    ring = _named_row(1172, 26389, 'Кольцо', major=176, subtype=178)
    struct.pack_into('<If', ring, 616, 333, 1.0)
    records = [
        [addon], [_named_row(68, 1, 'Мечи')], [weapon_sub], [weapon],
        [_named_row(68, 125, 'Накидки')], [_named_row(72, 127, 'Накидка')], [armor],
        [_named_row(68, 176, 'Кольца')], [_named_row(72, 178, 'Кольцо')], [ring],
    ]
    payload = bytearray(struct.pack('<HHI', 30003, 12288, 1742378400))
    offsets = []
    counts = []
    for rows in records:
        counts.append(len(payload))
        payload.extend(struct.pack('<I', len(rows)))
        offsets.append(len(payload))
        payload.extend(b''.join(rows))
    parsed_end = len(payload)
    payload.extend(tail)
    path = tmp_path / 'elements.data'
    path.write_bytes(payload)
    return path, offsets, counts, parsed_end


def test_reads_only_ten_item_tables_without_rewriting_header(tmp_path):
    from tools.client.elements import read_elements

    path, offsets, _, end = _fixture(tmp_path)
    before = path.read_bytes()
    result = read_elements(path)
    assert path.read_bytes() == before
    assert result['source']['file_name'] == 'elements.data'
    assert result['source']['sha256'] == hashlib.sha256(before).hexdigest()
    assert result['source']['header_version'] == 30003
    assert result['source']['header_signature'] == 12288
    assert result['parsed_bytes'] == end < len(before)
    assert len(result['tables']) == 10
    weapon = result['tables'][3]['rows'][0]
    assert weapon['ID'] == 22 and weapon['Name'] == 'Меч'
    assert weapon['_offset'] == offsets[3]
    assert weapon['probability_addon_num5'] == 1
    armor = result['tables'][6]['rows'][0]
    assert armor['fixed_props'] == 2
    assert armor['addons_1_id_addon'] == 333
    assert armor['addons_1_probability_addon'] == 0
    assert result['tables'][9]['row_size'] == 1172
    assert 'NPC DATA' not in json.dumps(result, ensure_ascii=False)
    assert str(tmp_path) not in json.dumps(result, ensure_ascii=False)


@pytest.mark.parametrize(('offset', 'value'), [(0, 80), (2, 0)])
def test_rejects_different_header(tmp_path, offset, value):
    from tools.client.elements import ElementsFormatError, read_elements

    path, *_ = _fixture(tmp_path)
    data = bytearray(path.read_bytes())
    struct.pack_into('<H', data, offset, value)
    path.write_bytes(data)
    with pytest.raises(ElementsFormatError, match='header'):
        read_elements(path)


def test_rejects_incomplete_table_and_unbounded_record_count(tmp_path):
    from tools.client.elements import ElementsFormatError, read_elements

    path, _, counts, end = _fixture(tmp_path)
    original = path.read_bytes()
    path.write_bytes(original[:end - 1])
    with pytest.raises(ElementsFormatError, match='bounds'):
        read_elements(path)
    damaged = bytearray(original)
    struct.pack_into('<I', damaged, counts[3], 0xFFFFFFFF)
    path.write_bytes(damaged)
    with pytest.raises(ElementsFormatError, match='count|bounds'):
        read_elements(path)


@pytest.mark.parametrize(('table', 'field_offset'), [(3, 4), (3, 8), (6, 564), (9, 616)])
def test_rejects_unresolved_item_references(tmp_path, table, field_offset):
    from tools.client.elements import ElementsFormatError, read_elements

    path, offsets, *_ = _fixture(tmp_path)
    data = bytearray(path.read_bytes())
    struct.pack_into('<I', data, offsets[table] + field_offset, 999999)
    path.write_bytes(data)
    with pytest.raises(ElementsFormatError, match='reference'):
        read_elements(path)


@pytest.mark.parametrize('value', [float('nan'), float('inf'), -0.1, 1.1])
def test_rejects_nonfinite_or_out_of_range_probability(tmp_path, value):
    from tools.client.elements import ElementsFormatError, read_elements

    path, offsets, *_ = _fixture(tmp_path)
    data = bytearray(path.read_bytes())
    struct.pack_into('<f', data, offsets[3] + 744, value)
    path.write_bytes(data)
    with pytest.raises(ElementsFormatError, match='float|probability'):
        read_elements(path)


def test_rejects_duplicate_ids(tmp_path):
    from tools.client.elements import ElementsFormatError, read_elements

    path, offsets, counts, _ = _fixture(tmp_path)
    data = bytearray(path.read_bytes())
    first = data[offsets[0]:offsets[0] + 84]
    data[offsets[0] + 84:offsets[0] + 84] = first
    struct.pack_into('<I', data, counts[0], 2)
    path.write_bytes(data)
    with pytest.raises(ElementsFormatError, match='duplicate'):
        read_elements(path)


def test_blank_reserved_names_are_reported_without_hiding_valid_rows(tmp_path):
    from tools.client.elements import read_elements

    path, offsets, *_ = _fixture(tmp_path)
    data = bytearray(path.read_bytes())
    data[offsets[3] + 12:offsets[3] + 76] = bytes(64)
    path.write_bytes(data)
    result = read_elements(path)
    assert result['tables'][3]['blank_names'] == 1
    assert result['tables'][3]['rows'][0]['Name'] == ''


@pytest.mark.parametrize('invalid_name', [b'\x00\xd8', b'\x01\x00'])
def test_rejects_malformed_or_control_character_names(tmp_path, invalid_name):
    from tools.client.elements import ElementsFormatError, read_elements

    path, offsets, *_ = _fixture(tmp_path)
    data = bytearray(path.read_bytes())
    data[offsets[3] + 12:offsets[3] + 14] = invalid_name
    path.write_bytes(data)
    with pytest.raises(ElementsFormatError, match='UTF-16|Control character'):
        read_elements(path)


def test_speed_sidecar_uses_client_subtype_interval_and_preserves_catalog(tmp_path):
    from tools.client.elements import build_speed_reference, read_elements

    path, offsets, *_ = _fixture(tmp_path)
    parsed = read_elements(path)
    catalog = [{'id': 22, 'name': 'Меч', 'section': 'weapon', 'stats': {'atk_speed': 4, 'range': 3}},
               {'id': 21418, 'section': 'armor'}]
    snapshot = json.dumps(catalog)
    reference = build_speed_reference(
        parsed, catalog, command='python -m tools.client.elements --elements elements.data')
    assert json.dumps(catalog) == snapshot
    assert len(reference['items']) == 1
    row = reference['items'][0]
    assert row['item_id'] == 22 and row['aps'] == 1.11
    assert row['attack_interval'] == pytest.approx(0.9)
    assert row['row_offset'] == offsets[3]
    assert row['subtype_offset'] == offsets[2]
    assert row['range_matches_catalog'] is True
    assert reference['source']['aps_reference_url'].endswith('GetProps/WEAPON_ESSENCE.cs')
    assert str(tmp_path) not in json.dumps(reference)


def test_speed_reference_rejects_missing_weapon_and_ambiguous_interval(tmp_path):
    from tools.client.elements import ElementsFormatError, build_speed_reference, read_elements

    path, offsets, *_ = _fixture(tmp_path)
    with pytest.raises(ElementsFormatError, match='missing'):
        build_speed_reference(read_elements(path), [{'id': 999, 'section': 'weapon'}])
    data = bytearray(path.read_bytes())
    struct.pack_into('<f', data, offsets[2] + 344, 0.0)
    path.write_bytes(data)
    with pytest.raises(ElementsFormatError, match='interval'):
        build_speed_reference(read_elements(path), [{'id': 22, 'section': 'weapon'}])


def test_compact_export_keeps_fixed_zero_chance_addons_and_source_offsets(tmp_path):
    from tools.client.elements import bonus_inputs, read_elements

    path, offsets, *_ = _fixture(tmp_path)
    result = bonus_inputs(read_elements(path))
    cape = next(item for item in result['items'] if item['ID'] == 21418)
    assert cape['addons'] == [{'id': 333, 'probability': 0.0}]
    assert cape['fixed_props'] == 2
    assert cape['offset'] == offsets[6]
    assert result['addons'][0]['param1'] == 1031127695
    assert result['addons'][0]['_offset'] == offsets[0]
    assert result['weapon_subtypes'][0]['attack_speed'] == pytest.approx(0.9)
    assert all('rows' not in table for table in result['tables'])


def test_cli_writes_scoped_export_without_overwriting_any_input(tmp_path, monkeypatch):
    from tools.client import elements

    monkeypatch.setattr(elements, 'REPOSITORY_ROOT', tmp_path)
    cache = tmp_path / '.cache'
    cache.mkdir()
    path, *_ = _fixture(cache)
    output = cache / 'items.json'
    original = path.read_bytes()
    elements.main(['--elements', str(path), '--output', str(output)])
    assert len(json.loads(output.read_text(encoding='utf-8'))['tables']) == 10
    assert path.read_bytes() == original
    with pytest.raises(SystemExit):
        elements.main(['--elements', str(path), '--output', str(tmp_path / 'outside.json')])
    # A binary input can have any filename: even then read-only means never overwrite it.
    renamed = cache / 'source.json'
    renamed.write_bytes(original)
    with pytest.raises(SystemExit):
        elements.main(['--elements', str(renamed), '--output', str(renamed)])
    assert renamed.read_bytes() == original


def test_cli_rejects_existing_hard_link_to_read_only_input(tmp_path, monkeypatch):
    from tools.client import elements

    monkeypatch.setattr(elements, 'REPOSITORY_ROOT', tmp_path)
    cache = tmp_path / '.cache'
    cache.mkdir()
    path, *_ = _fixture(cache)
    original = path.read_bytes()
    output = cache / 'linked-output.json'
    output.write_bytes(b'existing output')
    actual_samefile = Path.samefile
    # The Windows sandbox forbids hard-link creation. Model only the filesystem's
    # identity answer; the CLI's parsing, output guard and writes remain real.
    monkeypatch.setattr(Path, 'samefile', lambda self, other:
                        True if {self, Path(other)} == {output, path} else actual_samefile(self, other))
    with pytest.raises(SystemExit):
        elements.main(['--elements', str(path), '--output', str(output)])
    assert path.read_bytes() == original


def test_committed_speed_reference_covers_existing_catalog_and_known_weapon_rates():
    root = Path(__file__).resolve().parents[1]
    reference = json.loads((root / 'data/catalog_client_speeds.json').read_text(encoding='utf-8'))
    catalog = json.loads((root / 'data/catalog_items.json').read_text(encoding='utf-8'))
    weapons = {item['id'] for item in catalog if item.get('section') == 'weapon'}
    entries = {item['item_id']: item for item in reference['items']}
    assert set(entries) == weapons
    assert len(entries) == len(reference['items'])
    assert all(item['normal_probability'] == 1 and item['range_matches_catalog'] for item in entries.values())
    assert entries[22]['aps'] == 1.11
    assert entries[78]['aps'] == 1.0
    assert entries[12647]['aps'] == entries[33533]['aps'] == 1.25
    assert reference['source']['header_version'] == 30003
    assert reference['source']['header_signature'] == 12288
    assert reference['source']['file_name'] == 'elements.data'
    assert len(reference['source']['sha256']) == len(reference['source']['schema_sha256']) == 64
    assert reference['source']['schema_sha256'] == hashlib.sha256(
        (root / 'tools/client/schema_30003.json').read_bytes()).hexdigest()
