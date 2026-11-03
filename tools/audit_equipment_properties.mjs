// Offline audit of the exact catalog shipped with this checkout. No catalog writes.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { formatAddonValue, getItemBonuses, parseAddonOption } from "../static/js/engine/equipment.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const items = load("data/catalog_items.json"), stones = load("data/catalog_stones.json");
const normalize = (label) => String(label).toLowerCase().replaceAll("ё", "е").replaceAll(".", "").replace(/\s+/gu, " ").trim();
const fixedLabels = new Set(["крит", "макс физ атака", "физическая атака макс", "макс маг атака", "магическая атака макс"]);
const rows = new Map(), errors = [];
let negativeMaximumAttackOptions = 0;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const baseItem = { id: 1, name: "Проверка свойства", slot: "weapon", grade: 100, sockets: { craft: { 4: 100 } } };

function probe(part, slot = "weapon", extra = {}) {
  try { return getItemBonuses({ item: { ...baseItem, slot: /^ring[12]$/u.test(slot) ? "ring" : slot, ...part }, ...extra }, slot); }
  catch (error) { return { contributions: [], unresolved: [], auditError: error.message }; }
}

function add(record, kind, label, result, { percent = false, value, format = true, example = label } = {}) {
  let status = "supported";
  if (result.auditError) status = "invalid_source_value";
  else if (!result.contributions.length) {
    if (kind === "set") status = "set_description_missing";
    else if (kind === "stone" && value === null) status = "ambiguous_value";
    else if (kind === "base" && label === "atk_speed") status = "ambiguous_units";
    else if (percent) status = "formula_required";
    else if (!format) status = "conditional_or_unparsed";
    else status = "unsupported_label";
  } else if (fixedLabels.has(normalize(label))) status = "supported_added_alias";
  const key = `${kind}\0${normalize(label)}\0${percent}\0${status}`;
  if (!rows.has(key)) rows.set(key, { kind, label, percent, status, occurrences: 0, ids: new Set(), namedIds: new Set(), examples: [], stats: new Set() });
  const row = rows.get(key);
  row.occurrences++;
  row.ids.add(record.id);
  if (record.name) row.namedIds.add(record.id);
  result.contributions.forEach((entry) => row.stats.add(entry.stat));
  if (row.examples.length < 3 && !row.examples.some((entry) => entry.id === record.id)) row.examples.push({
    id: record.id, name: record.name ?? null, text: example,
    url: record.source?.url ?? null, cache_file: record.source?.cache_file ?? null, html_sha256: record.source?.html_sha256 ?? null,
    reason: result.auditError ?? result.unresolved[0]?.reason ?? null,
  });
  if (result.auditError) errors.push({ id: record.id, kind, label, error: result.auditError });
}

for (const item of items) {
  const slot = item.slot === "ring" ? "ring1" : item.slot ?? "weapon";
  for (const [key, value] of Object.entries(item.stats ?? {})) {
    add(item, "base", key, probe({ stats: { [key]: value } }, slot), { value, example: `${key}: ${JSON.stringify(value)}` });
  }
  if (item.refine) add(item, "refine", item.refine.stat, probe({ refine: item.refine }, slot, { refine: 1 }), { value: item.refine.levels?.[0] });
  for (const type of ["options", "unique"]) for (const addon of item.addons?.[type] ?? []) {
    const parsed = parseAddonOption(addon.text);
    if (parsed && fixedLabels.has(normalize(parsed.label)) && normalize(parsed.label) !== "крит" && parsed.min < 0) negativeMaximumAttackOptions++;
    // Audit support for a possible exact roll, not a promise of a particular roll.
    const selected = parsed && parsed.min !== parsed.max ? formatAddonValue(addon.text, parsed.max) : addon.text;
    const kind = type === "unique" && addon.chance === 100 ? "guaranteed" : "addon";
    const result = probe({ addons: { count: 1, options: [{ text: addon.text }] } }, slot, { addons: [selected] });
    add(item, kind, parsed?.label ?? addon.text, result, { percent: parsed?.percent ?? false, format: !!parsed, example: addon.text });
  }
  for (const [label, value] of Object.entries(item.specs_extra ?? {})) {
    const result = probe({ specs_extra: { [label]: value } }, slot);
    // Parsed reputation is an equipment requirement, not an omitted stat bonus.
    if (label === "Требуемая репутация" && !result.unresolved.length) continue;
    add(item, "specs_extra", label, result, { value, example: `${label}: ${value}` });
  }
  if (item.set?.length) add(item, "set", "Бонус комплекта", probe({ set: item.set }, slot), { example: item.set.join("; ") });
}
for (const stone of stones) for (const [target, effect] of Object.entries(stone.effects ?? {})) {
  const slot = target === "weapon" ? "weapon" : target === "armor" ? "chest" : "necklace";
  add(stone, "stone", effect.stat, probe({}, slot, { stones: [stone] }), { value: effect.value, percent: effect.percent === true, example: `${target}: ${effect.raw ?? effect.stat}` });
}

const evidenceChecks = [12647, 22, 32261, 32263, 12638].map((id) => {
  const record = [...items, ...stones].find((item) => item.id === id);
  const cache = resolve(root, ".cache/pages", record.source.cache_file);
  let hashMatches = false;
  try { hashMatches = sha256(readFileSync(cache)) === record.source.html_sha256; } catch { /* Cache is optional outside the source checkout. */ }
  return { id, url: record.source.url, cache_file: record.source.cache_file, html_sha256: record.source.html_sha256, hash_matches: hashMatches,
    labels: [...new Set([...(record.addons?.options ?? []).map((addon) => parseAddonOption(addon.text)?.label),
      ...Object.values(record.effects ?? {}).map((effect) => effect.stat)].filter((label) => fixedLabels.has(normalize(label))))] };
});
const outputRows = [...rows.values()].map(({ ids, namedIds, stats, ...row }) => ({ ...row, records: ids.size, named_records: namedIds.size, stats: [...stats].sort() }))
  .sort((a, b) => a.status.localeCompare(b.status) || b.occurrences - a.occurrences || a.label.localeCompare(b.label, "ru"));
const statuses = {};
for (const row of outputRows) {
  statuses[row.status] ??= { rows: 0, occurrences: 0, families: new Set() };
  statuses[row.status].rows++;
  statuses[row.status].occurrences += row.occurrences;
  statuses[row.status].families.add(normalize(row.label));
}
for (const status of Object.values(statuses)) status.families = status.families.size;
const catalogBytes = readFileSync(resolve(root, "data/catalog_items.json"));
const stoneBytes = readFileSync(resolve(root, "data/catalog_stones.json"));
const supportedFamilies = new Set(outputRows.filter((row) => row.status.startsWith("supported")).map((row) => normalize(row.label)));
const unresolvedFamilies = new Set(outputRows.filter((row) => !row.status.startsWith("supported")).map((row) => normalize(row.label)));
const partialFamilies = [...supportedFamilies].filter((label) => unresolvedFamilies.has(label));
const report = {
  version: 1, audited_on: "2026-11-03", game: "Comeback PW 1.4.6", command: "node tools/audit_equipment_properties.mjs",
  methodology: "One occurrence per stored base key, refine descriptor, addon option/unique row, stone target effect, extra field or set record. Addon ranges are probed at an allowed exact maximum; alternatives are not summed together. Counts include unnamed source records and repeated options. Status is parser coverage, not validation of game formulas or availability in drops.",
  summary: { items: items.length, named_items: items.filter((item) => item.name).length, stones: stones.length,
    property_families: new Set(outputRows.map((row) => normalize(row.label))).size,
    supported_families: supportedFamilies.size, unresolved_families: unresolvedFamilies.size,
    fully_supported_families: supportedFamilies.size - partialFamilies.length,
    partially_supported_families: partialFamilies.length,
    fully_unresolved_families: unresolvedFamilies.size - partialFamilies.length,
    raw_attack_speed_above_5: items.filter((item) => item.stats?.atk_speed > 5).length,
    raw_attack_speed_nonpositive: items.filter((item) => item.stats?.atk_speed <= 0).length,
    negative_maximum_attack_options: negativeMaximumAttackOptions,
    all_source_urls_are_146: [...items, ...stones].every((record) => record.source?.url === `https://comeback.pw/db/146/item/${record.id}`),
    items_sha256: sha256(catalogBytes), stones_sha256: sha256(stoneBytes), statuses, validation_errors: errors.length },
  evidence_checks: evidenceChecks, rows: outputRows, validation_errors: errors,
};
writeFileSync(resolve(root, "docs/equipment-properties-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const csvCell = (value) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
const csv = [["status", "source", "label", "percent", "occurrences", "records", "named_records", "stats", "example_url", "example_text", "reason"],
  ...outputRows.map((row) => [row.status, row.kind, row.label, row.percent, row.occurrences, row.records, row.named_records, row.stats.join(", "), row.examples[0]?.url, row.examples[0]?.text, row.examples[0]?.reason])];
writeFileSync(resolve(root, "docs/equipment-properties-audit.csv"), `\uFEFF${csv.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`, "utf8");
console.log(JSON.stringify(report.summary, null, 2));
if (errors.length) process.exitCode = 1;
