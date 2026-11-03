import { ATTRS, BASE_ATTR, CLASSES, MAX_LEVEL, clampLevel, computeStats, spentPoints, totalPoints } from "./engine/stats.js?v=20261103-activation";
import { SLOTS } from "./engine/equipment.js";
import { resolveEquipment } from "./engine/eligibility.js?v=20261103-activation";
import { MAX_REPUTATION, validateReputation } from "./engine/reputation.js";
import { parseBuild, serializeBuild } from "./engine/build.js";
import { changeClass, changeGender, normalizeGender } from "./engine/character.js";
import { createEffectsUI } from "./effects-ui.js";
import { createEquipmentUI } from "./equipment-ui.js?v=20261103-activation";
import { comparisonUrl, createComparisonSnapshot } from "./engine/comparison.js?v=20261103-comparison";
import { createComparisonBridge } from "./comparison-bridge.js?v=20261103-comparison";

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const pct = (n) => `${fmt(n)}%`;
const range = (values) => values.map(fmt).join("–");
const ATTR_NAMES = { vit: "Внсл", int: "Интл", str: "Сила", dex: "Ловк" };
const FULL_ATTR_NAMES = { vit: "Выносливость", int: "Интеллект", str: "Сила", dex: "Ловкость" };
const STORAGE_KEY = "pwcalc.comeback.builds.v1";
const PORTRAITS = { by: 1, ga: 2, ya: 3, rl: 4, ij: 5, js: 6, fx: 7, sj: 8, ej: 9, rg: 10 };
const CLASS_ICONS = { ga: 1, by: 2, ij: 3, js: 4, rl: 5, ya: 6, sj: 7, fx: 8, rg: 9, ej: 10 };
const CLASS_GRID_ORDER = ["by", "ga", "rl", "ya", "js", "ij", "sj", "fx", "rg", "ej"];
const TITLE_FIELDS = { phys_atk: "Физ. атака", mag_atk: "Маг. атака", phys_def: "Физ. защита", mag_def: "Маг. защита", accuracy: "Меткость", evasion: "Уклонение", attack_level: "Атака ПА", defense_level: "Защита ПЗ", hp: "Здоровье" };
const SLOT_SKINS = { helmet: "ft", chest: "rv", legs: "tg", boots: "rx", weapon: "ta", necklace: "vx", cape: "wy", wrists: "mj", belt: "st", ring1: "oq-left", ring2: "oq-right", tome: "qn", ammo: "it", flight: "ic" };
const STAT_ROWS = [
  ["Физ. атака", (s) => range(s.physAtk), "Физ. защита", (s) => fmt(s.physDef)],
  ["Маг. атака", (s) => range(s.magAtkRange), "Маг. защита", (s) => fmt(s.magDef)],
  ["Шанс крит.", (s) => pct(s.crit), "Металл", (s) => fmt(s.elements.metal)],
  ["Атак/сек", (s) => `${fmt(s.atkSpeed)} уд/сек`, "Дерево", (s) => fmt(s.elements.wood)],
  ["Время пения", (s) => pct(s.castTime), "Вода", (s) => fmt(s.elements.water)],
  ["Меткость", (s) => fmt(s.accuracy), "Огонь", (s) => fmt(s.elements.fire)],
  ["Уклонение", (s) => fmt(s.evasion), "Земля", (s) => fmt(s.elements.earth)],
  ["Атака ПА", (s) => fmt(s.attackLevel), "Защита ПЗ", (s) => fmt(s.defenseLevel)],
  ["Умен. физ. урона", (s) => pct(Math.round(s.physDefPct * 10) / 10), "Умен. маг. урона", (s) => pct(Math.round(s.magDefPct * 10) / 10)],
  ["Скорость", (s) => `${fmt(s.speed)} м/сек`, "Крит. урон", (s) => pct(s.critDamage)],
  ["", () => "", "Сила духа", (s) => fmt(s.spirit)],
  ["Скрытность", (s) => fmt(s.stealth), "Обнаружение", (s) => fmt(s.detection)],
];
const freshState = () => ({ version: 1, name: "Без имени", cls: "by", gender: "male", level: MAX_LEVEL, reputation: 0, attrs: Object.fromEntries(ATTRS.map((k) => [k, BASE_ATTR])), equipment: {}, effects: [], effectSettings: {}, addedEffects: [], hiddenEffects: [], titles: {} });
let state = freshState();
let catalog = { items: [], stones: [] };
let catalogReady = false;
let activeSavedId = null;
let allEffects = [];
let effectsUI;
let equipmentUI;
let characterPane = null;
let comparisonBridge;
let comparisonInitialized = false;
const calculate = (candidate = state) => computeStats({ ...candidate, effectCatalog: allEffects });

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function symbol(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", `/static/img/symbols.svg#${name}`);
  svg.append(use);
  return svg;
}

function slotSymbol(id) { return id.startsWith("ring") ? "ring" : { weapon: "sword", flight: "wings" }[id] ?? id; }
function itemImage(item, slot) {
  const fallback = () => symbol(slotSymbol(slot));
  if (!/^[a-f0-9]{16}\.(?:jpe?g|png|webp|gif)$/i.test(item?.icon ?? "")) return fallback();
  const img = el("img", { src: `/static/icons/${item.icon}`, alt: "", loading: "lazy" });
  img.addEventListener("error", () => img.replaceWith(fallback()), { once: true });
  return img;
}

function status(message, error = false) {
  $("page-status").textContent = message;
  $("page-status").dataset.error = String(error);
}
function dirty() { $("build-status").textContent = "Изменена"; comparisonBridge?.publish(); }
function clearShareHash() { if (location.hash.startsWith("#build=")) history.replaceState(null, "", location.pathname + location.search); }

function resetAttrs() { state.attrs = Object.fromEntries(ATTRS.map((k) => [k, BASE_ATTR])); }
function setAttr(key, value) {
  const others = spentPoints(state.attrs) - (state.attrs[key] - BASE_ATTR);
  const max = BASE_ATTR + totalPoints(state.level) - others;
  const next = Number.isFinite(value) ? Math.trunc(value) : BASE_ATTR;
  state.attrs[key] = Math.min(max, Math.max(BASE_ATTR, next));
  $("char-message").textContent = next > max ? `Свободных очков не хватает: максимум ${max}.` : "";
  dirty(); render();
}

function setupReputation() {
  const input = $("char-reputation");
  const reject = () => status("Репутация: введите только цифры от 0 до " + String(MAX_REPUTATION) + ".", true);
  const validText = (value) => value.length <= String(MAX_REPUTATION).length && /^[0-9]*$/u.test(value)
    && (value === "" || (Number.isSafeInteger(Number(value)) && Number(value) <= MAX_REPUTATION));
  const insertedText = (value) => input.value.slice(0, input.selectionStart ?? input.value.length)
    + value + input.value.slice(input.selectionEnd ?? input.value.length);
  input.addEventListener("beforeinput", (event) => {
    if (event.inputType.startsWith("insert") && event.data && !validText(insertedText(event.data))) {
      event.preventDefault(); reject();
    }
  });
  input.addEventListener("paste", (event) => {
    const value = event.clipboardData?.getData("text");
    if (value !== undefined && !validText(insertedText(value))) { event.preventDefault(); reject(); }
  });
  input.addEventListener("drop", (event) => {
    const value = event.dataTransfer?.getData("text");
    if (value !== undefined && !validText(insertedText(value))) { event.preventDefault(); reject(); }
  });
  input.addEventListener("input", () => {
    try {
      if (!validText(input.value)) throw new Error("Только цифры");
      const value = validateReputation(input.value === "" ? 0 : Number(input.value));
      state.reputation = value; dirty(); render();
    } catch {
      input.value = String(state.reputation); reject();
    }
  });
  input.addEventListener("blur", () => { input.value = String(state.reputation); });
}

function equipmentEligibility(slot, choice) {
  return resolveEquipment({ ...state, className: CLASSES[state.cls].name,
    equipment: { ...state.equipment, [slot]: choice } }).status[slot];
}

function setupCharacter() {
  for (const code of CLASS_GRID_ORDER) {
    const button = el("button", { type: "button", className: `ref-race-${CLASS_ICONS[code]}`, ariaLabel: CLASSES[code].name, title: CLASSES[code].name });
    button.dataset.class = code;
    button.dataset.tooltip = CLASSES[code].name;
    button.addEventListener("click", () => { state = changeClass(state, code); characterPane = null; effectsUI?.close(); equipmentUI?.close(); dirty(); render(); });
    $("char-class").append(button);
  }
  for (const button of document.querySelectorAll("[data-gender]")) button.addEventListener("click", () => {
    state = changeGender(state, button.dataset.gender); characterPane = null; effectsUI?.close(); equipmentUI?.close(); dirty(); render();
  });
  for (const [key, label] of Object.entries(TITLE_FIELDS)) {
    const input = el("input", { id: `title-${key}`, type: "number", min: 0, max: 50000, value: 0, inputMode: "numeric", ariaLabel: `Титул: ${label}` });
    input.addEventListener("change", () => {
      const value = Number(input.value);
      state.titles[key] = Number.isFinite(value) ? Math.min(50000, Math.max(0, Math.trunc(value))) : 0;
      dirty(); render();
    });
    $("title-fields").append(el("label", {}, [label, input]));
  }
  $("char-name").addEventListener("input", (e) => { state.name = e.target.value; dirty(); });
  $("char-level").addEventListener("change", (e) => {
    state.level = clampLevel(e.target.value);
    if (spentPoints(state.attrs) > totalPoints(state.level)) { resetAttrs(); $("char-message").textContent = "Для этого уровня распределение очков сброшено."; }
    dirty(); render();
  });
  for (const key of ATTRS) {
    const input = el("input", { type: "number", min: BASE_ATTR, id: `attr-${key}`, inputMode: "numeric", ariaLabel: FULL_ATTR_NAMES[key] });
    input.addEventListener("change", () => setAttr(key, Number(input.value)));
    const minus = el("button", { type: "button", textContent: "−", ariaLabel: `${FULL_ATTR_NAMES[key]} −1` });
    const plus = el("button", { type: "button", textContent: "+", ariaLabel: `${FULL_ATTR_NAMES[key]} +1` });
    minus.addEventListener("click", () => setAttr(key, state.attrs[key] - 1));
    plus.addEventListener("click", () => setAttr(key, state.attrs[key] + 1));
    $("attr-list").append(el("div", { className: "attr" }, [el("span", { textContent: ATTR_NAMES[key] }), minus, input, plus]));
  }
  $("btn-reset").addEventListener("click", () => { resetAttrs(); $("char-message").textContent = ""; dirty(); render(); });
  $("btn-new").addEventListener("click", () => {
    state = freshState(); activeSavedId = null; characterPane = null; effectsUI?.close(); equipmentUI?.close(); clearShareHash();
    $("char-name").value = state.name; $("char-reputation").value = String(state.reputation); $("build-status").textContent = "Новая"; $("char-message").textContent = "";
    render(); status("Создан новый персонаж. Сохранённые сборки доступны ниже.");
  });
  $("btn-clear-gear").addEventListener("click", () => { state.equipment = {}; equipmentUI?.close(); dirty(); render(); status("Экипировка снята."); });
  $("btn-help").addEventListener("click", () => $("info-dialog").showModal());
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => $(button.dataset.action).click()));
  document.querySelectorAll("[data-character-control]").forEach((button) => button.addEventListener("click", () => {
    characterPane = characterPane === button.dataset.characterControl ? null : button.dataset.characterControl;
    renderCharacterPane();
  }));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && characterPane) { characterPane = null; renderCharacterPane(); } });
}

function renderCharacterPane() {
  for (const name of ["class", "gender", "title"]) $(`${name}-panel`).hidden = characterPane !== name;
  document.querySelector(".identity__meta").hidden = Boolean(characterPane);
  document.querySelector(".identity-icons").hidden = Boolean(characterPane);
  for (const button of document.querySelectorAll("[data-character-control]")) button.setAttribute("aria-expanded", String(characterPane === button.dataset.characterControl));
  for (const button of document.querySelectorAll("[data-class]")) {
    button.classList.toggle("is-active", button.dataset.class === state.cls);
    button.setAttribute("aria-pressed", String(button.dataset.class === state.cls));
  }
  for (const button of document.querySelectorAll("#char-gender [data-gender]")) {
    button.classList.toggle("is-active", button.dataset.gender === state.gender);
    button.setAttribute("aria-pressed", String(button.dataset.gender === state.gender));
  }
  for (const key of Object.keys(TITLE_FIELDS)) $(`title-${key}`).value = state.titles?.[key] ?? 0;
}

function render() {
  const stats = calculate();
  $("char-level").value = stats.level;
  if (document.activeElement !== $("char-reputation")) $("char-reputation").value = String(state.reputation);
  $("emblem").textContent = CLASSES[state.cls].name;
  $("portrait").dataset.gender = state.gender;
  const gender = state.cls === "ya" ? "m" : state.cls === "rl" ? "f" : state.gender === "female" ? "f" : "m";
  $("portrait").querySelector("img").src = `/static/mypers/img/ns/default/${PORTRAITS[state.cls]}/${gender}/face.png`;
  $("class-icon").className = `ref-race-${CLASS_ICONS[state.cls]} is-active`;
  $("class-icon").dataset.tooltip = CLASSES[state.cls].name;
  $("class-icon").title = CLASSES[state.cls].name;
  $("gender-icon").className = `ref-gender-${gender === "m" ? 1 : 2} is-active`;
  $("paperdoll").dataset.gender = gender;
  for (const key of ["hp", "mp", "free"]) $(`out-${key}`).textContent = fmt(stats[key]);
  for (const key of ATTRS) {
    const input = $(`attr-${key}`);
    input.value = state.attrs[key]; input.max = state.attrs[key] + stats.free;
    input.title = `С экипировкой: ${fmt(stats.effectiveAttrs[key])}`;
    input.parentElement.children[1].disabled = state.attrs[key] <= BASE_ATTR;
    input.parentElement.children[3].disabled = stats.free <= 0;
  }
  $("stats-body").replaceChildren(...STAT_ROWS.map(([left, lv, right, rv]) => el("tr", {}, [el("td", { className: "label", textContent: left }), el("td", { className: "num", textContent: lv(stats) }), el("td", { className: "label", textContent: right }), el("td", { className: "num", textContent: rv(stats) })])));
  const warnings = [...new Set(stats.gearWarnings)];
  $("gear-warnings").replaceChildren(...warnings.map((warning) => el("li", { textContent: warning })));
  $("warning-count").textContent = warnings.length ? `(${warnings.length})` : "";
  renderCharacterPane();
  effectsUI?.render();
  renderGear(stats.equipmentStatus);
  equipmentUI?.render();
  comparisonBridge?.publish();
}

function setupDoll() {
  const rows = { left: 0, right: 0, bottom: 0 };
  for (const slot of SLOTS) {
    const button = el("button", { id: `slot-${slot.id}`, type: "button", className: `slot ref-ys ref-${SLOT_SKINS[slot.id]}-ys` });
    if (slot.side === "bottom") button.style.gridColumn = String(++rows.bottom);
    else button.style.gridRow = String(++rows[slot.side]);
    button.dataset.slot = slot.id;
    button.addEventListener("click", () => equipmentUI.open(slot.id, button));
    $("paperdoll").append(button);
  }
  for (const skin of ["pp", "pk", "gv", "xoa", "cosmos"]) $("paperdoll").append(el("span", { className: `reference-only-slot ref-ys ref-${skin}-ys`, title: "Ячейка оригинального оформления: в текущем расчёте не используется", ariaHidden: "true" }));
}
function renderGear(statuses = {}) {
  for (const slot of SLOTS) {
    const choice = state.equipment[slot.id];
    const button = $(`slot-${slot.id}`);
    button.classList.toggle("slot--filled", Boolean(choice));
    const unavailable = Boolean(choice && statuses[slot.id] && !statuses[slot.id].usable);
    button.classList.toggle("slot--unusable", unavailable);
    button.dataset.usable = String(!unavailable);
    const name = `${slot.name}${slot.id === "ring1" ? " 1" : slot.id === "ring2" ? " 2" : ""}`;
    button.setAttribute("aria-label", `${name}: ${choice ? choice.item.name : "пусто"}${unavailable ? ". Бонусы не учитываются. Требования не выполнены: " + statuses[slot.id].reasons.join("; ") : ""}`);
    if (choice) button.removeAttribute("title");
    else button.title = name;
    button.replaceChildren(...(choice ? [itemImage(choice.item, slot.id)] : []));
    if (choice?.refine) button.append(el("span", { className: "slot__rank", textContent: `+${choice.refine}` }));
  }
  const equipped = Object.entries(state.equipment).filter(([, choice]) => choice);
  $("gear-count").textContent = `${equipped.length} / ${SLOTS.length}`;
  const activeCount = equipped.filter(([slot]) => statuses[slot]?.usable).length;
  $("gear-count").title = `Выбрано предметов: ${equipped.length}; бонусы действуют: ${activeCount}`;
  $("equipped-summary").textContent = !equipped.length ? "Нет экипировки"
    : `Выбрано: ${equipped.length} · действуют: ${activeCount}`;
  $("btn-clear-gear").disabled = !equipped.length;
  $("bag").replaceChildren(...Array.from({ length: 32 }, (_, index) => {
    const entry = equipped[index];
    if (!entry) return el("span", { className: "bag-cell", ariaHidden: "true" });
    const [slot, choice] = entry;
    const cell = el("button", { type: "button", className: "bag-cell", ariaLabel: `Изменить: ${choice.item.name}` }, [itemImage(choice.item, slot)]);
    cell.dataset.slot = slot;
    if (statuses[slot] && !statuses[slot].usable) {
      cell.classList.add("bag-cell--unusable"); cell.dataset.usable = "false";
      cell.setAttribute("aria-label", `Изменить: ${choice.item.name}. Бонусы не учитываются. Требования не выполнены: ${statuses[slot].reasons.join("; ")}`);
    }
    cell.addEventListener("click", () => equipmentUI.open(slot, cell));
    return cell;
  }));
}

async function fetchJSON(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Сервер вернул ${response.status}`);
  return response.json();
}
async function loadCatalog() {
  $("btn-retry-catalog").hidden = true;
  try {
    const result = await fetchJSON("/api/catalog/");
    if (!Array.isArray(result.items) || !Array.isArray(result.stones)) throw new Error("Неизвестный формат каталога");
    catalog = result; catalogReady = true;
    $("catalog-items").textContent = fmt(catalog.items.length);
    $("catalog-stones").textContent = fmt(catalog.stones.length);
    $("catalog-status").textContent = "Локальный снимок базы Comeback PW 1.4.6; охват указан в отчёте.";
    loadHashBuild();
    comparisonBridge?.publish();
  } catch (error) {
    $("catalog-status").textContent = `Не удалось загрузить базу. ${error.message}`;
    $("btn-retry-catalog").hidden = false;
    status("База предметов недоступна. Можно распределять характеристики.", true);
  }
}
function setupDialogs() {
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(button.dataset.close).close()));
  $("btn-retry-catalog").addEventListener("click", loadCatalog);
}

async function setupEffects() {
  try {
    const result = await fetchJSON("/api/effects/");
    allEffects = result.effects;
    effectsUI.setCatalog(result);
    render();
  } catch {
    $("buff-list").replaceChildren(el("li", { className: "muted small-copy", textContent: "Не удалось загрузить умения. Обновите страницу, чтобы повторить." }));
  }
}

function readSaved() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("Не удалось прочитать сохранённые сборки");
  return value.filter((row) => row && typeof row.id === "string" && typeof row.json === "string" && typeof row.name === "string");
}
function applyBuild(json, id = null, preserveShareHash = false) {
  if (!catalogReady) throw new Error("База предметов ещё не загружена");
  const next = parseBuild(json, catalog.items, catalog.stones);
  next.gender = normalizeGender(next.cls, next.gender);
  calculate(next); state = next; activeSavedId = id; characterPane = null; effectsUI?.close(); equipmentUI?.close();
  $("char-name").value = state.name; $("char-reputation").value = String(state.reputation); $("char-message").textContent = ""; $("build-status").textContent = id ? "Сохранена" : "Загружена";
  if (!preserveShareHash) clearShareHash();
  render(); status(`Загружен персонаж: ${state.name || "Без имени"}.`);
  if ($("load-dialog").open) $("load-dialog").close();
}
function savedRows(rows, canDelete = true) {
  if (!rows.length) return [el("p", { className: "saved-empty", textContent: "Сохранённых персонажей пока нет." })];
  return rows.map((row) => {
    const button = el("button", { type: "button" }, [el("b", { textContent: row.name || "Без имени" }), el("small", { textContent: `${CLASSES[row.cls]?.name ?? "Персонаж"} · ур. ${row.level ?? "—"}` })]);
    button.addEventListener("click", () => { try { applyBuild(row.json, row.id); } catch (error) { status(error.message, true); $("load-message").textContent = error.message; } });
    const line = el("li", { className: "saved-row" }, [button]);
    if (canDelete) {
      const remove = el("button", { type: "button", className: "delete-build", textContent: "×", ariaLabel: `Удалить сборку: ${row.name}` });
      remove.addEventListener("click", () => {
        if (!confirm(`Удалить сохранённую сборку «${row.name}»?`)) return;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(readSaved().filter((item) => item.id !== row.id))); if (activeSavedId === row.id) activeSavedId = null; renderSaved(); status("Сохранённая сборка удалена."); }
        catch { status("Браузер не разрешил изменить сохранения.", true); }
      });
      line.append(remove);
    }
    return line;
  });
}
function renderSaved() {
  try { const rows = readSaved(); $("saved-builds").replaceChildren(...savedRows(rows)); $("load-builds").replaceChildren(...savedRows(rows, false)); }
  catch { $("saved-builds").replaceChildren(el("li", { className: "saved-empty", textContent: "Сохранения недоступны. Используйте файл сборки." })); }
}
function saveBuild() {
  try {
    const json = serializeBuild(state), rows = readSaved(), id = activeSavedId ?? crypto.randomUUID();
    const row = { id, name: state.name || "Без имени", cls: state.cls, level: state.level, json };
    const index = rows.findIndex((item) => item.id === id);
    if (index >= 0) rows[index] = row; else rows.unshift(row);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); activeSavedId = id;
    $("build-status").textContent = "Сохранена"; renderSaved(); status("Персонаж сохранён в этом браузере.");
  } catch (error) { status(`Не удалось сохранить: ${error.message}. Можно скачать сборку в файл.`, true); }
}
function exportBuild() {
  try {
    const json = serializeBuild(state), url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const anchor = el("a", { href: url, download: `${(state.name || "character").replace(/[^\p{L}\p{N}._-]/gu, "_")}.pwcalc.json` });
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status("Файл сборки скачан.");
  } catch (error) { status(error.message, true); }
}
async function shareBuild() {
  try {
    const bytes = new TextEncoder().encode(serializeBuild(state));
    if (bytes.length > 12000) throw new Error("Сборка слишком велика для ссылки. Используйте «Скачать сборку»");
    const encoded = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const url = `${location.origin}${location.pathname}${location.search}#build=${encoded}`;
    history.replaceState(null, "", url);
    try { await navigator.clipboard.writeText(url); status("Ссылка на сборку скопирована."); }
    catch { status("Ссылка на сборку находится в адресной строке. Скопируйте её оттуда."); }
  } catch (error) { status(error.message, true); }
}
function loadHashBuild() {
  if (!location.hash.startsWith("#build=")) return;
  try {
    const encoded = location.hash.slice(7);
    if (encoded.length > 20000) throw new Error("Ссылка слишком длинная");
    const raw = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    applyBuild(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(raw, (char) => char.charCodeAt(0))), null, true);
  } catch (error) { status(`Не удалось загрузить ссылку: ${error.message}`, true); }
}
function setupSaves() {
  $("btn-compare")?.addEventListener("click", () => {
    try { window.location.assign(comparisonUrl(serializeBuild(state))); }
    catch (error) { status(error.message, true); }
  });
  $("btn-save").addEventListener("click", saveBuild);
  $("btn-load").addEventListener("click", () => { $("load-message").textContent = ""; renderSaved(); $("load-dialog").showModal(); });
  $("btn-export").addEventListener("click", exportBuild);
  $("btn-share").addEventListener("click", shareBuild);
  for (const id of ["btn-import", "btn-load-file"]) $(id).addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { if (file.size > 1024 * 1024) throw new Error("Максимальный размер сборки — 1 МБ"); applyBuild(await file.text()); }
    catch (error) { const message = `Не удалось загрузить файл: ${error.message}`; status(message, true); $("load-message").textContent = message; }
    e.target.value = "";
  });
  window.addEventListener("hashchange", loadHashBuild);
  renderSaved();
}

effectsUI = createEffectsUI({ getState: () => state, onChange: () => { dirty(); render(); } });
equipmentUI = createEquipmentUI({
  getState: () => state, getCatalog: () => catalog, isReady: () => catalogReady,
  renderIcon: itemImage, onMessage: status, getEligibility: equipmentEligibility,
  onEquip: (slot, choice) => {
    const next = { ...state, equipment: { ...state.equipment, [slot]: choice } };
    const eligibility = calculate(next).equipmentStatus[slot];
    state = next; dirty(); render();
    status(`Выбрано: ${choice.item.name}${choice.refine ? ` +${choice.refine}` : ""}. ${eligibility.usable ? "Бонусы учитываются." : "Бонусы не учитываются: требования пока не выполнены."}`);
  },
  onUnequip: (slot) => {
    const equipment = { ...state.equipment };
    delete equipment[slot];
    state = { ...state, equipment }; dirty(); render(); status("Предмет снят.");
  },
});
comparisonBridge = createComparisonBridge({
  getPayload: () => ({ build: serializeBuild(state), snapshot: createComparisonSnapshot(state, calculate()), ready: catalogReady && comparisonInitialized }),
  onApply: (json) => {
    try { applyBuild(json); }
    catch (error) { status(`Не удалось применить сборку: ${error.message}`, true); }
  },
});
setupReputation(); setupCharacter(); setupDoll(); setupDialogs(); setupSaves(); render();
await Promise.allSettled([loadCatalog(), setupEffects()]);
comparisonInitialized = true;
comparisonBridge.publish();
