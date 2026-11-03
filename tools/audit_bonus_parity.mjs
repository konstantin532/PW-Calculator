// Audit every stored value in the effective /api/catalog payload. No catalog writes.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ammoWeaponGradeRange, fixedAddonSlots, formatAddonValue, getItemBonuses, itemFitsSlot, parseAddonOption, SLOTS, validateEquipmentChoice } from "../static/js/engine/equipment.js";
import { getRequiredReputation } from "../static/js/engine/reputation.js";
import { resolveSetBonuses } from "../static/js/engine/sets.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let catalogPath = resolve(root, ".cache/bonus-parity-catalog.json");
for (let index = 2; index < process.argv.length; index++) {
  if (process.argv[index] === "--catalog" && process.argv[index + 1]) catalogPath = resolve(process.argv[++index]);
  else throw new Error("Usage: node tools/audit_bonus_parity.mjs [--catalog path/to/effective-catalog.json]");
}
const bytes = (path) => readFileSync(resolve(root, path));
const load = (path) => JSON.parse(bytes(path));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (label) => String(label).toLowerCase().replaceAll("ё", "е").replaceAll(".", "").replace(/\s+/gu, " ").trim();
const payloadBytes = readFileSync(catalogPath), catalog = JSON.parse(payloadBytes);
if (!Array.isArray(catalog.items) || !catalog.items.length || !Array.isArray(catalog.stones) || !catalog.stones.length) throw new Error("Effective catalog has no items or stones");
const items = catalog.items, stones = catalog.stones;
const rawItems = load("data/catalog_items.json"), rawStones = load("data/catalog_stones.json");
const rawItemsById = new Map(rawItems.map((record) => [record.id, record]));
const rawStonesById = new Map(rawStones.map((record) => [record.id, record]));
const itemsById = new Map(items.map((record) => [record.id, record]));
const setSidecar = load("data/catalog_sets.json");
const clientProperties = existsSync(resolve(root, "data/catalog_client_properties.json")) ? load("data/catalog_client_properties.json") : null;
const clientSpeeds = existsSync(resolve(root, "data/catalog_client_speeds.json")) ? load("data/catalog_client_speeds.json") : null;
const clientPropertiesById = new Map((clientProperties?.items ?? []).map((entry) => [entry.item_id, entry]));
const clientSpeedsById = new Map((clientSpeeds?.items ?? []).map((entry) => [entry.item_id, entry]));
const baseline = load("docs/equipment-properties-audit.json");
const baselineMap = new Map(baseline.rows.map(({ label }) => [normalize(label), { original_family: normalize(label), current_families: new Set(), transformations: [] }]));
const historicalUnion = new Set(baselineMap.keys());
const rows = new Map(), errors = [], probeCounts = {}, corrections = [], setChecks = [];
const clientProfiles = [], clientSpeedChecks = [], stoneChecks = [];
const provenancePaths = ["data/catalog_items.json", "data/catalog_stones.json", "data/catalog_sets.json", "data/catalog_defaults.json",
  "docs/equipment-properties-audit.json", "static/js/engine/equipment.js", "static/js/engine/sets.js", "static/js/engine/eligibility.js",
  ...["data/catalog_client_properties.json", "data/catalog_client_speeds.json", "data/catalog_client_stones.json", "pwcalc/client_data.py", "tools/client/properties.py"]
    .filter((path) => existsSync(resolve(root, path)))];
const inputHashes = Object.fromEntries(provenancePaths.map((path) => [path, hash(bytes(path))]));

// Historical label extraction is used only to account for all original163 families.
// It never supplies values to the current calculation or numeric probe.
function historicalLabel(text) {
  if (typeof text !== "string" || /[\u0000-\u001f\u007f]/u.test(text)) return text;
  const match = /^(.+?)\s*([+-]\s*\d+(?:[.,]\d+)?)(?:\s*[~–]\s*([+-]?\s*\d+(?:[.,]\d+)?))?\s*(%|ед\.?)?\s*$/u.exec(text);
  if (!match) return text;
  if (!/^[\p{L}][\p{L}\p{N}\s().·:/'-]*$/u.test(match[1].trim())) return text;
  const values = [match[2], match[3]].filter((value) => value !== undefined).map((value) => Number(value.replace(/\s/gu, "").replace(",", ".")));
  return values.every((value) => Number.isFinite(value) && Math.abs(value) <= 1e9) ? match[1].trim() : text;
}

function failure(record, kind, raw, error) {
  errors.push({ id: record?.id ?? null, name: record?.name ?? null, kind, raw, error: String(error), url: record?.source?.url ?? null });
}

function probe(record, kind, raw, operation) {
  probeCounts[kind] = (probeCounts[kind] ?? 0) + 1;
  try {
    const result = operation();
    for (const entry of result.contributions) {
      const values = Array.isArray(entry.value) ? entry.value : [entry.value];
      if (!values.length || values.some((value) => !Number.isFinite(value))) throw new Error(`Non-finite contribution ${entry.stat}`);
    }
    return result;
  } catch (error) {
    failure(record, kind, raw, error.message);
    return { flat: {}, ranges: { phys_atk: [0, 0], mag_atk: [0, 0] }, warnings: [error.message],
      contributions: [], unresolved: [{ reason: error.message, value: null }], audit_error: true };
  }
}

function isolated(record, slot, part = {}) {
  return { id: record.id, name: record.name ?? `Запись ${record.id}`, source: record.source,
    attack_speed_verified: record.attack_speed_verified, slot: /^ring[12]$/u.test(slot) ? "ring" : slot,
    grade: 100, sockets: { craft: { 4: 100 } }, ...part };
}

const information = new Set(["прочность", "опыт", "обыкновенный полет", "ускоренный полет",
  "око джунглей: с его помощью вы можете следить за изменениями всего сущего"]);
function semantic(record, kind, label, raw, results, { value, requirement = false } = {}) {
  const name = normalize(label), text = normalize(raw);
  if (requirement) return ["equipment_requirement", "Проверяемое требование, не самостоятельная числовая прибавка."];
  if (information.has(name)) return ["item_information", "Информация об отдельной вещи, опыте или полете; не прибавляется к боевым атрибутам."];
  if (/^повышение боевого духа\s+1$/u.test(text)) return ["outside146_battle_spirit", "Боевой дух исключён пользователем из механик Comeback1.4.6."];
  const applied = results.every((result) => result.contributions.length > 0 && !result.unresolved.length && !result.audit_error);
  if (kind === "base" && label === "atk_speed") {
    const proof = record.attack_speed_verified === true || Boolean(record.source?.corrections?.atk_speed);
    if (!proof) {
      if (applied) failure(record, kind, raw, "Unverified /db/146 attack speed was applied numerically");
      return ["unknown_source", "Риск устранён отказом от непроверенной скорости; число не считается ударами/сек, остаётся предупреждение и базовый fallback."];
    }
  }
  if (applied) return ["numeric_calculated", "Общий обработчик применил все проверяемые числовые варианты в исходных единицах."];
  if (kind === "stone" && record.id === 25154 && value === null) return ["unknown_source", "В проверяемом эффективном снимке для этого назначения ещё нет типизированного клиентского эффекта; null и предупреждение сохранены."];
  if (name === "параметры неизвестны (требуется оценка)") return ["unknown_source", "Сам первоисточник помечает параметры неизвестными."];
  if ((record.id === 11215 && text.startsWith("+защита от металла-защита от огня")) || (record.id === 12328 && text.startsWith("+физ атака-защита"))) {
    return ["unknown_source", "Составная неоднозначная подпись GM/безымянной записи; разделение чисел не угадывается."];
  }
  if (["addon", "guaranteed"].includes(kind) && typeof raw === "string" && raw.includes(":")) return ["situational_proc", "Условное срабатывание оружия или временное состояние; постоянная прибавка не начисляется."];
  failure(record, kind, raw, results.map((result) => result.unresolved.map((entry) => entry.reason).join(" ")).join(" | ") || "Expected numeric or known semantic variant was not classified");
  return ["unknown_source", "Неразобранный числовой/неизвестный контекст — ошибка аудита, требующая исправления."];
}

function observe(record, kind, label, raw, results, options = {}) {
  const [status, reason] = options.forced ?? semantic(record, kind, label, raw, results, options);
  const family = normalize(label), legacy = normalize(options.legacyLabel ?? label);
  const mapping = baselineMap.get(legacy);
  if (mapping) {
    mapping.current_families.add(family);
    if (legacy !== family && mapping.transformations.length < 3) mapping.transformations.push({ id: record.id, raw_before: options.rawBefore ?? raw, raw_after: raw,
      reason: options.rawBefore && options.rawBefore !== raw ? "source_provenance_correction" : "verified_parser_label" });
  }
  const stats = [...new Set(results.flatMap((result) => result.contributions.map((entry) => entry.stat)))].sort();
  const contextKey = JSON.stringify([kind, options.target ?? "", options.percent === true, options.level ?? null, status, stats]);
  if (!rows.has(family)) rows.set(family, { family, labels: new Set(), occurrences: 0, ids: new Set(), contexts: new Map() });
  const row = rows.get(family);
  row.labels.add(label); row.occurrences++; row.ids.add(`${kind === "stone" ? "stone" : "item"}:${record.id}`);
  if (!row.contexts.has(contextKey)) row.contexts.set(contextKey, { kind, target: options.target ?? null, percent: options.percent === true,
    level: options.level ?? null, semantic_status: status, reason, occurrences: 0, ids: new Set(), stats, variants: new Map(), examples: [] });
  const context = row.contexts.get(contextKey);
  context.occurrences++; context.ids.add(record.id);
  const variantKey = JSON.stringify([raw, options.value ?? null, options.rolls ?? null]);
  if (!context.variants.has(variantKey)) context.variants.set(variantKey, { raw, value: options.value ?? null, tested_rolls: options.rolls ?? null,
    occurrences: 0, first_record_id: record.id, contributions: results.map((result) => result.contributions.map(({ stat, value, percent }) => ({ stat, value, percent }))) });
  context.variants.get(variantKey).occurrences++;
  if (context.examples.length < 3 && !context.examples.some((example) => example.id === record.id)) context.examples.push({ id: record.id, name: record.name ?? null,
    raw, url: record.source?.url ?? null, cache_file: record.source?.cache_file ?? null, html_sha256: record.source?.html_sha256 ?? null,
    unresolved: results.flatMap((result) => result.unresolved.map((entry) => entry.reason)) });
}

function textProbe(record, kind, text, slot, legacyText = text) {
  const parsed = parseAddonOption(text), rolls = parsed ? [...new Set([parsed.min, parsed.max])] : [null];
  const results = rolls.map((value) => {
    const selected = parsed ? formatAddonValue(text, value) : text;
    return probe(record, kind, selected, () => getItemBonuses({ item: isolated(record, slot, { addons: { count: 1, options: [{ text }] } }), addons: [selected] }, slot));
  });
  observe(record, kind, parsed?.label ?? text, text, results, { percent: parsed?.percent ?? false, rolls,
    legacyLabel: historicalLabel(legacyText), rawBefore: legacyText });
  return results[0];
}

function clientResult(result) {
  return { contributions: result.contributions.map(({ stat, value, percent }) => ({ stat, value, percent })),
    warnings: result.warnings ?? [], unresolved: result.unresolved.map(({ label, reason, value }) => ({ label, reason, value: value ?? null })) };
}

// Client fixed slots form an independent scope. They must not inflate or erase
// the historical163-family web audit below, and unknown is never a numeric zero.
for (const item of items) {
  const slot = item.slot === "ring" ? "ring1" : item.slot ?? "weapon";
  const sourceRecord = clientPropertiesById.get(item.id);
  let fixed;
  try { fixed = fixedAddonSlots(item); }
  catch (error) { failure(item, "client_fixed_metadata", item.client_fixed_addons, error.message); continue; }
  if (fixed === null) {
    if (sourceRecord?.fixed === true) failure(item, "client_fixed_metadata", item.id, "Verified fixed client profile is missing from effective API payload");
    continue;
  }
  if (!sourceRecord) failure(item, "client_fixed_metadata", item.id, "Effective fixed profile has no pinned client sidecar record");
  const metadata = item.client_fixed_addons;
  const profileItem = isolated(item, slot, { client_fixed_addons: metadata });
  let defaultChoice;
  try { defaultChoice = validateEquipmentChoice({ item: profileItem, addons: [] }, slot); }
  catch (error) { failure(item, "client_fixed_default", item.id, error.message); continue; }
  const profile = { item_id: item.id, name: item.name ?? null, required: metadata.required, slot_count: fixed.length,
    client_table: sourceRecord?.table ?? null, client_offset: sourceRecord?.offset ?? null,
    default_selected_count: defaultChoice.addons.length, default_selected: defaultChoice.addons,
    slots: [], endpoint_checks: [] };
  const endpoints = { min: [], max: [] }, selected = { min: [], max: [] };
  for (const [index, definition] of fixed.entries()) {
    const parsed = parseAddonOption(definition.text);
    const known = definition.known === true && typeof definition.stat === "string";
    const informational = ["durability", "durability_percent"].includes(definition.stat);
    const rolls = known && parsed ? [...new Set([parsed.min, parsed.max])] : [null];
    const slotItem = isolated(item, slot, { client_fixed_addons: { required: true, slots: [definition] } });
    const results = rolls.map((value) => probe(item, "client_fixed_slot", `${index}:${definition.addon_id}:${value}`, () =>
      getItemBonuses({ item: slotItem, addons: [value === null ? definition.text : formatAddonValue(definition.text, value)] }, slot)));
    let status;
    if (!known) {
      status = definition.reason === "skill_proc" ? "client_situational_proc_with_warning"
        : /^повышение боевого духа\s+1$/u.test(normalize(definition.raw_name ?? "")) ? "client_outside146_battle_spirit_with_warning"
          : "client_unknown_effect_with_warning";
      if (results.some((result) => result.contributions.length || !result.unresolved.some((entry) => entry.value === null)
          || !result.warnings?.length || result.audit_error)) {
        failure(item, "client_unknown_effect", definition.text, "Unknown client effect must have null, warning, and no numeric contribution");
      }
    } else {
      status = informational ? "client_item_information" : "client_numeric_calculated";
      if (!parsed || !Number.isFinite(definition.min) || !Number.isFinite(definition.max)
          || Math.abs(parsed.min - definition.min) > 1e-8 || Math.abs(parsed.max - definition.max) > 1e-8
          || parsed.percent !== (definition.percent === true)) {
        status = "client_known_metadata_mismatch";
        failure(item, "client_fixed_bounds", definition.text, "Parser bounds/units disagree with typed client metadata");
      }
      if (!informational && results.some((result, resultIndex) => {
        const entries = result.contributions.filter((entry) => entry.stat === definition.stat);
        const expected = rolls[resultIndex];
        return result.audit_error || result.unresolved.length || entries.length !== 1 || entries.some((entry) => {
          const values = Array.isArray(entry.value) ? entry.value : [entry.value];
          // A maximum-attack modifier deliberately grants zero to the lower edge.
          const maximumOnly = /^макс(?:имальная)?\s/u.test(normalize(parsed?.label ?? "")) || /\sмакс$/u.test(normalize(parsed?.label ?? ""));
          return values.some((value, edge) => Math.abs(value - (maximumOnly && edge === 0 ? 0 : expected)) > 1e-8)
            || entry.percent !== (definition.percent === true);
        });
      })) {
        status = "client_known_effect_not_calculated";
        failure(item, "client_fixed_value", definition.text, "Typed fixed effect is not applied at both declared bounds");
      }
    }
    profile.slots.push({ index, addon_id: definition.addon_id ?? null, type: definition.type ?? null, text: definition.text,
      known, stat: definition.stat ?? null, expected_min: definition.min ?? null, expected_max: definition.max ?? null,
      percent: definition.percent ?? null, source_reason: definition.reason ?? null, semantic_status: status,
      numeric_value_if_unknown: known ? undefined : null, tested_rolls: rolls, results: results.map(clientResult) });
    for (const endpoint of ["min", "max"]) {
      selected[endpoint].push(known && parsed ? formatAddonValue(definition.text, parsed[endpoint]) : definition.text);
      endpoints[endpoint].push(results[endpoint === "min" ? 0 : results.length - 1]);
    }
  }
  for (const endpoint of ["min", "max"]) {
    const result = probe(item, "client_fixed_profile", `${item.id}:${endpoint}`, () =>
      getItemBonuses({ item: profileItem, addons: selected[endpoint] }, slot));
    const expected = sumExpected(endpoints[endpoint]);
    if (result.audit_error || !sameNumbers(result.flat, expected.flat) || !Object.keys(expected.ranges).every((key) =>
      result.ranges[key].every((value, edge) => Math.abs(value - expected.ranges[key][edge]) < 1e-8))) {
      failure(item, "client_fixed_profile", `${item.id}:${endpoint}`, "Full profile differs from the sum of isolated fixed slots");
    }
    profile.endpoint_checks.push({ endpoint, selected: selected[endpoint], flat: result.flat, ranges: result.ranges,
      warnings: result.warnings ?? [], unresolved: result.unresolved.map(({ reason, value }) => ({ reason, value: value ?? null })) });
  }
  if ((metadata.required || !fixed.length) && defaultChoice.addons.length !== fixed.length) {
    failure(item, "client_fixed_default", item.id, "Required client properties are missing, or zero-slot item generates fake choices");
  }
  clientProfiles.push(profile);
}

for (const item of items) {
  const slot = item.slot === "ring" ? "ring1" : item.slot ?? "weapon", rawItem = rawItemsById.get(item.id);
  if (!rawItem) failure(item, "catalog", item.id, "Effective item is absent from raw146 catalog");
  for (const [key, value] of Object.entries(item.stats ?? {})) {
    const result = probe(item, "base", `${key}: ${JSON.stringify(value)}`, () => getItemBonuses({ item: isolated(item, slot, { stats: { [key]: value } }) }, slot));
    observe(item, "base", key, `${key}: ${JSON.stringify(value)}`, [result], { value });
  }
  if (item.refine) {
    if (!Array.isArray(item.refine.levels) || !item.refine.levels.length) failure(item, "refine", item.refine, "Refine has no level values");
    for (const [index, value] of (item.refine.levels ?? []).entries()) {
      const result = probe(item, "refine", `${item.refine.stat} +${index + 1}: ${value}`, () => getItemBonuses({ item: isolated(item, slot, { refine: item.refine }), refine: index + 1 }, slot));
      observe(item, "refine", item.refine.stat, `${item.refine.stat} +${index + 1}: ${value}`, [result], { value, level: index + 1 });
    }
  }
  for (const pool of ["options", "unique"]) {
    const entries = item.addons?.[pool] ?? [];
    if (!Array.isArray(entries)) { failure(item, pool, entries, "Property pool is not an array"); continue; }
    for (const addon of entries) {
      if (!addon || typeof addon.text !== "string") { failure(item, pool, addon, "Property has no text"); continue; }
      const kind = pool === "unique" && addon.chance === 100 ? "guaranteed" : "addon";
      const replacement = item.source?.corrections?.addons?.replacements?.find((entry) => entry.applied === addon.text);
      const original = rawItem?.addons?.[pool]?.find((entry) => entry.text === addon.text);
      const before = original?.text ?? replacement?.was ?? addon.text;
      textProbe(item, kind, addon.text, slot, before);
      if (replacement) corrections.push({ id: item.id, kind, before, applied: addon.text, evidence: item.source.corrections.addons });
    }
  }
  for (const [label, value] of Object.entries(item.specs_extra ?? {})) {
    const requirement = (label === "Требуемая репутация" && getRequiredReputation(item) !== null) || (label === "Условия применения" && ammoWeaponGradeRange(item) !== null);
    const result = probe(item, "specs_extra", `${label}: ${value}`, () => getItemBonuses({ item: isolated(item, slot, { specs_extra: { [label]: value } }) }, slot));
    observe(item, "specs_extra", label, `${label}: ${value}`, [result], { value, requirement });
  }
  if (item.set?.length) {
    const valid = item.set_bonus && typeof item.set_bonus.id === "string";
    const result = probe(item, "set_definition", item.set_bonus?.id ?? item.set.join("; "), () => getItemBonuses({ item: isolated(item, slot, { set: item.set, set_bonus: item.set_bonus }) }, slot));
    if (!valid || result.unresolved.length) failure(item, "set_definition", item.set_bonus ?? item.set, "Legacy set lacks a validated structured definition");
    observe(item, "set_definition", "Бонус комплекта", item.set_bonus?.id ?? item.set.join("; "), [result], {
      forced: ["numeric_calculated", "Структура комплекта распознана; каждый числовой порог дополнительно проверен отдельным движком."],
    });
  }
}
for (const stone of stones) for (const [target, effect] of Object.entries(stone.effects ?? {})) {
  const slot = target === "weapon" ? "weapon" : target === "armor" ? "chest" : "necklace";
  const result = probe(stone, "stone", effect.raw ?? effect.stat, () => getItemBonuses({ item: isolated(stone, slot), stones: [stone] }, slot));
  observe(stone, "stone", effect.stat, `${target}: ${effect.raw ?? effect.stat}`, [result], { target, value: effect.value, percent: effect.percent === true,
    legacyLabel: rawStonesById.get(stone.id)?.effects?.[target]?.stat ?? effect.stat });
  if (stone.id === 25154) stoneChecks.push({ item_id: stone.id, target, effective_effect: effect,
    resolved: result.contributions.length > 0 && !result.unresolved.length && !result.audit_error, ...clientResult(result) });
}

const definitions = new Map();
for (const item of items) if (item.set_bonus) {
  const previous = definitions.get(item.set_bonus.id);
  if (previous && JSON.stringify(previous.definition) !== JSON.stringify(item.set_bonus)) failure(item, "set_definition", item.set_bonus.id, "Conflicting source set definitions");
  else if (!previous) definitions.set(item.set_bonus.id, { definition: item.set_bonus, record: item });
}
const setProbeSlot = (index) => SLOTS[index].id;
function setEquipment(definition, count) {
  // Synthetic active holders isolate the count/formula contract. They retain
  // exact source member IDs; this is not a claim that missing members are selectable.
  return Object.fromEntries(definition.members.slice(0, count).map((id, index) => {
    const slot = setProbeSlot(index);
    return [slot, { item: { id, slot: /^ring[12]$/u.test(slot) ? "ring" : slot, set_bonus: definition } }];
  }));
}
function sumExpected(results) {
  const flat = {}, ranges = { phys_atk: [0, 0], mag_atk: [0, 0] };
  for (const result of results) {
    for (const [key, value] of Object.entries(result.flat)) flat[key] = (flat[key] ?? 0) + value;
    for (const key of Object.keys(ranges)) for (let index = 0; index < 2; index++) ranges[key][index] += result.ranges[key][index];
  }
  return { flat, ranges };
}
function sameNumbers(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => Math.abs((left[key] ?? 0) - (right[key] ?? 0)) < 1e-8);
}
for (const [id, { definition, record }] of definitions) {
  const parsed = [];
  for (const threshold of definition.bonuses) for (const text of threshold.texts) {
    historicalUnion.add(normalize(historicalLabel(text)));
    parsed.push({ pieces: threshold.pieces, result: textProbe(record, "set_threshold", text, "tome") });
  }
  for (const count of [...new Set([1, ...definition.bonuses.map((threshold) => threshold.pieces), definition.members.length])]) {
    probeCounts.set_activation = (probeCounts.set_activation ?? 0) + 1;
    try {
      const result = resolveSetBonuses(setEquipment(definition, count));
      const expected = sumExpected(parsed.filter((entry) => entry.pieces <= count).map((entry) => entry.result));
      const active = result.sources.filter((source) => source.active).length;
      const expectedActive = definition.bonuses.filter((threshold) => threshold.pieces <= count).length;
      if (result.warnings.length || active !== expectedActive || !sameNumbers(result.flat, expected.flat)
          || !Object.keys(expected.ranges).every((key) => result.ranges[key].every((value, index) => Math.abs(value - expected.ranges[key][index]) < 1e-8))) {
        failure(record, "set_activation", `${id}: ${count}`, `Set threshold accounting differs: ${JSON.stringify({ warnings: result.warnings, active, expectedActive, actual: result.flat, expected: expected.flat })}`);
      }
      setChecks.push({ id, name: definition.name, active_members: count, active_thresholds: active, expected_thresholds: expectedActive,
        flat: result.flat, ranges: result.ranges, missing_catalog_member_ids: definition.members.filter((member) => !itemsById.has(member)) });
    } catch (error) { failure(record, "set_activation", `${id}: ${count}`, error.message); }
  }
}
if (definitions.size !== setSidecar.sets.length) failure(null, "sets", definitions.size, `API set count differs from sidecar ${setSidecar.sets.length}`);

const sourceChecks = { records: items.length + stones.length, exact_146_urls: 0, cached_html_checked: 0, cached_html_missing: 0, cached_html_mismatches: [] };
for (const record of [...items, ...stones]) {
  if (record.source?.url === `https://comeback.pw/db/146/item/${record.id}`) sourceChecks.exact_146_urls++;
  else failure(record, "source", record.source?.url, "Record source URL is not the exact146 item URL");
  const path = record.source?.cache_file ? resolve(root, ".cache/pages", record.source.cache_file) : null;
  if (path && existsSync(path)) {
    sourceChecks.cached_html_checked++;
    if (hash(readFileSync(path)) !== record.source.html_sha256) {
      sourceChecks.cached_html_mismatches.push(record.id);
      failure(record, "source", record.source.cache_file, "Cached primary HTML SHA256 differs from record provenance");
    }
  } else sourceChecks.cached_html_missing++;
}
for (const mapping of baselineMap.values()) if (!mapping.current_families.size) failure(null, "baseline_family", mapping.original_family, "Historical family disappeared without an explicit mapping");

const outputRows = [...rows.values()].map(({ contexts, labels, ids, ...row }) => ({ ...row, labels: [...labels].sort(), records: ids.size,
  semantic_statuses: [...new Set([...contexts.values()].map((context) => context.semantic_status))].sort(),
  stats: [...new Set([...contexts.values()].flatMap((context) => context.stats))].sort(),
  contexts: [...contexts.values()].map(({ ids, variants, ...context }) => ({ ...context, records: ids.size, variant_count: variants.size, variants: [...variants.values()] })),
})).sort((left, right) => left.family.localeCompare(right.family, "ru"));
const semanticSummary = {};
for (const row of outputRows) for (const context of row.contexts) {
  semanticSummary[context.semantic_status] ??= { families: new Set(), contexts: 0, occurrences: 0 };
  const group = semanticSummary[context.semantic_status]; group.families.add(row.family); group.contexts++; group.occurrences += context.occurrences;
}
for (const status of Object.values(semanticSummary)) status.families = status.families.size;
const unverifiedWeapons = items.filter((item) => Object.hasOwn(item.stats ?? {}, "atk_speed") && item.attack_speed_verified !== true && !item.source?.corrections?.atk_speed);
for (const entry of clientSpeeds?.items ?? []) {
  const item = itemsById.get(entry.item_id);
  if (!item || item.slot !== "weapon") continue;
  const proof = item.source?.client_attack_speed;
  const passed = item.attack_speed_verified === true && Math.abs((item.stats?.atk_speed ?? NaN) - entry.aps) < 1e-8
    && proof?.file_sha256 === clientSpeeds.source?.sha256 && proof?.row_offset === entry.row_offset
    && proof?.attack_interval === entry.attack_interval;
  if (!passed) failure(item, "client_attack_speed", item.id, "Effective APS/provenance differs from the pinned client interval");
  clientSpeedChecks.push({ item_id: item.id, attack_interval: entry.attack_interval, expected_aps: entry.aps,
    effective_aps: item.stats?.atk_speed ?? null, passed });
}
const wind = itemsById.get(14970)?.set_bonus;
const windChecks = wind ? setChecks.filter((check) => check.id === wind.id) : [];
if (!wind || ![2, 4, 6].every((count) => windChecks.some((check) => check.active_members === count))) failure(itemsById.get(14970), "wind_case", 14970, "Wind set14970 lacks all2/4/6 probes");
const fiveNewAliases = ["Уровень ЖС", "Скорость перемещения", "Показатель Силы духа", "Интл", "Ловк"];
const baselinePlusFiveAliases = new Set([...baselineMap.keys(), ...fiveNewAliases.map(normalize)]);
const incompleteCape = itemsById.get(21418);
const capeClientProfile = clientProfiles.find((profile) => profile.item_id === 21418);
const capeResolved = capeClientProfile?.slot_count === 5 && ["str", "dex", "vit", "int", "cast_time"]
  .every((stat) => capeClientProfile.slots.some((slot) => slot.stat === stat && slot.semantic_status === "client_numeric_calculated"));
const dataCompleteness = incompleteCape && !capeResolved ? [{ category: "source_data_completeness", item_id: incompleteCape.id, name: incompleteCape.name,
  source_url: incompleteCape.source.url, source_html_sha256: incompleteCape.source.html_sha256,
  supplied_addon_count: incompleteCape.addons?.count ?? null, supplied_options: incompleteCape.addons?.options ?? [],
  distinct_from_formula_failure: true,
  reason: "Effective payload is missing the reviewed five-property client profile for21418; the old web row alone is not complete.",
  next_evidence: "Regenerate the effective API dump after client overlay integration: STR/DEX/VIT/INT6~7 and channeling-6%.",
}] : [];
const clientStatuses = {};
for (const profile of clientProfiles) for (const slot of profile.slots) clientStatuses[slot.semantic_status] = (clientStatuses[slot.semantic_status] ?? 0) + 1;
const clientUnknowns = clientProfiles.flatMap((profile) => profile.slots.filter((slot) => !slot.known).map((slot) => ({
  item_id: profile.item_id, addon_id: slot.addon_id, text: slot.text, status: slot.semantic_status, value: null,
  warnings: slot.results.flatMap((result) => result.warnings),
})));
for (const path of provenancePaths) if (hash(bytes(path)) !== inputHashes[path]) failure(null, "input_changed_during_audit", path, "Input changed during audit; rerun against a stable snapshot");
if (hash(readFileSync(catalogPath)) !== hash(payloadBytes)) failure(null, "input_changed_during_audit", catalogPath, "Effective catalog snapshot changed during audit; rerun");
if (baselineMap.size !== 163) failure(null, "baseline_family_count", baselineMap.size, "Expected historical163-family baseline");
const report = { version: 1, audited_on: new Date().toISOString(), game: "Comeback PW1.4.6", command: "node tools/audit_bonus_parity.mjs --catalog .cache/bonus-parity-catalog.json",
  methodology: "The historical163-family baseline remains separate from effective client fixed profiles. Every effective web field, refine level, options/unique row, stone target and extra field is visited. Retained web pools are isolated; they are not claimed active where fixed client slots supersede them. Every fixed client slot is checked at min/max, then whole profiles are compared with isolated slot sums. Unknown client effects require null, warnings and no contribution. All166 sets and reached thresholds are probed. These checks do not replace measurements in the game.",
  inputs: { effective_catalog: relative(root, catalogPath).replaceAll("\\", "/"), effective_catalog_sha256: hash(payloadBytes),
    hashes: inputHashes, coverage: catalog.coverage },
  summary: { items: items.length, named_items: items.filter((item) => item.name).length, stones: stones.length,
    historical_baseline_families: baselineMap.size, historical_baseline_plus_five_new_set_aliases: baselinePlusFiveAliases.size,
    historical_with_all_set_labels_families: historicalUnion.size,
    effective_families: outputRows.length, contexts: outputRows.reduce((sum, row) => sum + row.contexts.length, 0),
    occurrences: outputRows.reduce((sum, row) => sum + row.occurrences, 0), probes: probeCounts, semantic_statuses: semanticSummary,
    sets: definitions.size, set_threshold_texts: [...definitions.values()].reduce((sum, { definition }) => sum + definition.bonuses.reduce((n, threshold) => n + threshold.texts.length, 0), 0),
    set_activation_checks: setChecks.length, corrected_addon_rows: corrections.length,
    client_fixed_profiles: clientProfiles.length, client_fixed_zero_slot_profiles: clientProfiles.filter((profile) => profile.slot_count === 0).length,
    client_fixed_slot_checks: clientProfiles.reduce((sum, profile) => sum + profile.slot_count, 0), client_fixed_statuses: clientStatuses,
    client_fixed_unknown_effects_with_warning: clientUnknowns.length, client_attack_speed_checks: clientSpeedChecks.length,
    client_attack_speed_failed_checks: clientSpeedChecks.filter((check) => !check.passed).length,
    unverified_attack_speed_records: unverifiedWeapons.length, named_unverified_attack_speed_records: unverifiedWeapons.filter((item) => item.name).length,
    unverified_attack_speed_risk: unverifiedWeapons.length ? "remaining_unverified_records_warn_and_use_explicit_fallback" : "no_unverified_records_in_effective_snapshot", empty_families: outputRows.filter((row) => !row.contexts.length || !row.occurrences).length,
    missing_baseline_families: [...baselineMap.values()].filter((mapping) => !mapping.current_families.size).length,
    known_data_completeness_limitations: dataCompleteness.length, validation_errors: errors.length },
  source_checks: sourceChecks, corrections, baseline_family_map: [...baselineMap.values()].map(({ current_families, ...mapping }) => ({ ...mapping, current_families: [...current_families].sort() })),
  historical_baseline: { source_file: "docs/equipment-properties-audit.json", sha256: inputHashes["docs/equipment-properties-audit.json"], families: baselineMap.size,
    scope: "Original web labels; independent from effective client-fixed accounting." },
  client_fixed_audit: { source_file: "data/catalog_client_properties.json", source: clientProperties?.source ?? null,
    statuses: clientStatuses, unknown_effects_with_warning: clientUnknowns, profiles: clientProfiles },
  client_attack_speed_audit: { source_file: "data/catalog_client_speeds.json", source: clientSpeeds?.source ?? null, checks: clientSpeedChecks },
  family_accounting: { five_new_set_aliases: fiveNewAliases, all_set_labels_not_in_baseline: [...historicalUnion].filter((family) => !baselineMap.has(family)).sort() },
  limitations: { source_data_completeness: dataCompleteness, primary_html_cache_optional: true,
    set_probe_scope: "Set probes isolate arithmetic with synthetic active holders. Source member IDs absent from the effective catalog are listed in set_checks and are not asserted to be selectable.",
    formula_scope: "Parser and set arithmetic checks do not replace controlled measurements in the Comeback146 game client.",
  },
  set_counting_reference: { url: "https://mypers.ru/js/pwscripts.min.js?v26", cached_file: ".cache/mypers/pwscripts.min.js", line: 1,
    sha256: "365299f09ce10267b48f03693023875b5f601386fb4313e822b4b04baff04dea", method: "sd.prototype.up", offset: 278481,
    rule: "Iterates each active equipped slot and increments q for matching set family; no item-ID deduplication. Equal rings in two allowed slots count twice; sd.vq grants each reached threshold once." },
  set_checks: setChecks, case_checks: { wind_14970: wind ? { item_id: 14970, definition: wind, checks: windChecks } : null,
    cape_21418: { resolved_from_client: capeResolved, client_profile: capeClientProfile ?? null }, stone_25154: stoneChecks }, families: outputRows, validation_errors: errors,
};
writeFileSync(resolve(root, "docs/bonus-parity-matrix.json"), `${JSON.stringify(report, null, 2)}\n`);
const csvCell = (value) => { const text = String(value ?? ""), safe = /^[=+\-@]/u.test(text) ? `'${text}` : text; return `"${safe.replaceAll('"', '""')}"`; };
const csv = [["family", "semantic_statuses", "contexts", "occurrences", "records", "stats", "variant_count", "example_url", "notes"],
  ...outputRows.map((row) => [row.family, row.semantic_statuses.join(" | "), row.contexts.length, row.occurrences, row.records, row.stats.join(" | "),
    row.contexts.reduce((sum, context) => sum + context.variant_count, 0), row.contexts[0]?.examples[0]?.url, [...new Set(row.contexts.map((context) => context.reason))].join(" | ")])];
writeFileSync(resolve(root, "docs/bonus-parity-matrix.csv"), `\uFEFF${csv.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`);
const clientCsv = [["item_id", "name", "required", "slot", "addon_id", "semantic_status", "stat", "minimum", "maximum", "tested_rolls", "warnings"],
  ...clientProfiles.flatMap((profile) => profile.slots.length ? profile.slots.map((slot) => [profile.item_id, profile.name, profile.required,
    slot.index, slot.addon_id, slot.semantic_status, slot.stat ?? "unknown", slot.expected_min ?? "unknown", slot.expected_max ?? "unknown",
    JSON.stringify(slot.tested_rolls), slot.results.flatMap((result) => result.warnings).join(" | ")])
    : [[profile.item_id, profile.name, profile.required, "", "", "client_no_addons_generated", "not applicable", "not applicable", "not applicable", "[]", ""]])];
writeFileSync(resolve(root, "docs/bonus-parity-client-fixed.csv"), `\uFEFF${clientCsv.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`);
console.log(JSON.stringify(report.summary, null, 2));
if (errors.length || report.summary.empty_families || report.summary.missing_baseline_families) process.exitCode = 1;
