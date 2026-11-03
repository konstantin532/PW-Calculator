import {
  SLOTS, availableAddonTexts, formatAddonValue, getItemBonuses, itemFitsSlot,
  maxSockets, maximumAddons, parseAddonOption,
} from "./engine/equipment.js?v=20261103-explanations";

const PAGE_SIZE = 80;
const SLOT_NAMES = new Map(SLOTS.map(({ id, name }) => [id, name]));
const CLASS_NAMES = new Set(["Воин", "Маг", "Оборотень", "Друид", "Лучник", "Жрец", "Мистик", "Страж", "Шаман", "Убийца"]);
const CLASS_BY_ID = { by: "Воин", ga: "Маг", ya: "Оборотень", rl: "Друид", js: "Лучник", ij: "Жрец", rg: "Мистик", ej: "Страж", sj: "Шаман", fx: "Убийца" };
const STONE_TARGETS = { weapon: "weapon", helmet: "armor", cape: "armor", chest: "armor", wrists: "armor", legs: "armor", boots: "armor", necklace: "decoration", belt: "decoration", ring1: "decoration", ring2: "decoration" };
const STAT_NAMES = {
  vit: "Выносливость", int: "Интеллект", str: "Сила", dex: "Ловкость", hp: "Здоровье", mp: "Магическая энергия",
  phys_atk: "Физическая атака", mag_atk: "Магическая атака", phys_def: "Физическая защита", mag_def: "Магическая защита",
  def_metal: "Защита от металла", def_wood: "Защита от дерева", def_water: "Защита от воды", def_fire: "Защита от огня", def_earth: "Защита от земли",
  accuracy: "Меткость", evasion: "Уклонение", crit: "Шанс критического удара", crit_damage: "Критический урон", speed: "Скорость передвижения",
  cast_time: "Время пения", attack_level: "Показатель атаки", defense_level: "Показатель защиты", spirit: "Сила духа", stealth: "Скрытность", detection: "Обнаружение", range: "Дальность",
};
const PERCENT_STATS = new Set(["crit", "crit_damage", "cast_time"]);
const TYPE_GROUPS = { magic: "Инт", light: "Лайт", heavy: "Хэви" };
const fmt = (value) => Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const norm = (value) => String(value ?? "").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
const text = (value) => String(value ?? "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
const hasName = (item) => typeof item?.name === "string" && item.name.trim().length > 0;
const supportedClasses = (item) => !Array.isArray(item.classes) || !item.classes.length || item.classes.some((name) => CLASS_NAMES.has(name));
const displayName = (item) => hasName(item) ? item.name : `Предмет ${item.id ?? "без ID"}`;
const subtype = (item) => item.subtype || item.type || "Без подтипа";
const guaranteed = (item) => (item.addons?.unique ?? []).filter((entry) => entry.chance === 100 && typeof entry.text === "string").map((entry) => entry.text);
const offeredAddons = (item) => [...new Set(availableAddonTexts(item))].filter((entry) => !guaranteed(item).includes(entry));
const chosenAddons = (choice) => (choice.addons ?? []).filter((entry) => !guaranteed(choice.item).includes(entry));

function node(tag, props = {}, children = []) {
  const result = Object.assign(document.createElement(tag), props);
  result.append(...children);
  return result;
}

function button(label, action, props = {}) {
  const result = node("button", { type: "button", textContent: label, ...props });
  result.addEventListener("click", action);
  return result;
}

function armorGroup(label) {
  const value = norm(label);
  if (/тяжел/.test(value)) return "heavy";
  if (/легк/.test(value)) return "light";
  if (/магическ|мантия|капюшон/.test(value)) return "magic";
  return null;
}

function searchMatches(item, query) {
  const levels = [...query.matchAll(/(?:^|\s)ур\.?\s*:\s*(\d+)(?=\s|$)/giu)].map((match) => Number(match[1]));
  if (levels.some((level) => item.level !== level)) return false;
  const term = norm(query.replace(/(?:^|\s)ур\.?\s*:\s*\d+(?=\s|$)/giu, " "));
  const haystack = norm(`${item.name} ${item.id}`);
  return term.split(/\s+/).every((word) => haystack.includes(word));
}

function titleColor(item) {
  return /^#[a-f\d]{6}$/i.test(item.name_color ?? "") ? item.name_color : "";
}

function defaultGroup(cls) {
  if (["by", "ya", "ej"].includes(cls)) return "heavy";
  if (["js", "fx"].includes(cls)) return "light";
  return "magic";
}

/** Floating equipment windows own presentation; the current build stays in app.js. */
export function createEquipmentUI({ getState, getCatalog, isReady, getEligibility, onEquip, onUnequip, onMessage = () => {}, renderIcon }) {
  let opened = null, popup = null, gemPopup = null, tooltip = null, hoverTarget = null;
  let position = null, gemPosition = null, gemIndex = null, activeTab = null, anchor = null;
  let query = "", selectedTypes = new Set(), currentPage = 0, gemQuery = "", gemPage = 0;
  let availableOnly = true;
  let errorMessage = "", revision = 0, endDrag = null;
  let pointerGesture = null, pendingRender = false, pointerFinishTimer = null, stackedGems = false;

  const entry = () => opened ? getState().equipment?.[opened.slot] : null;
  const message = (error) => {
    errorMessage = error instanceof Error ? error.message : String(error);
    onMessage(errorMessage, true);
    const output = popup?.querySelector(".equipment-feedback");
    if (output) { output.textContent = errorMessage; output.hidden = false; clampWindow(popup, position); }
  };

  function eligibility(choice, slot) {
    try {
      const result = getEligibility?.(slot, choice);
      if (result && typeof result.usable === "boolean") return result;
      return { usable: false, reasons: ["Не удалось проверить требования предмета."], requirements: [] };
    } catch (error) {
      return { usable: false, reasons: [error instanceof Error ? error.message : "Не удалось проверить требования предмета."], requirements: [] };
    }
  }

  function requirementValue(value, key) {
    if (key === "class") {
      const names = (Array.isArray(value) ? value : String(value ?? "").split(/[,/]/u))
        .map((name) => CLASS_BY_ID[name] ?? String(name).trim()).filter((name) => CLASS_NAMES.has(name));
      return names.join(", ") || "Не подтверждён";
    }
    return typeof value === "number" && Number.isFinite(value) ? fmt(value) : text(value ?? "Не подтверждено");
  }

  function requirementFields(status) {
    return (status.requirements ?? []).map((requirement) => {
      const current = requirement.met ? "" : ` (есть ${requirementValue(requirement.current, requirement.key)})`;
      return field(text(requirement.label), `${requirementValue(requirement.required, requirement.key)}${current}`,
        requirement.met ? "equipment-tooltip__requirement" : "equipment-tooltip__requirement equipment-tooltip__requirement--unmet");
    });
  }

  function hideTooltip() {
    tooltip?.remove(); tooltip = null; hoverTarget = null;
  }

  function close(restoreFocus = false) {
    const closedSlot = opened?.slot;
    pointerGesture = null; pendingRender = false;
    clearTimeout(pointerFinishTimer); pointerFinishTimer = null;
    endDrag?.(); endDrag = null;
    popup?.remove(); gemPopup?.remove(); hideTooltip();
    popup = null; gemPopup = null; opened = null; gemIndex = null;
    position = null; gemPosition = null; activeTab = null; errorMessage = ""; stackedGems = false;
    const returnTarget = anchor?.isConnected ? anchor : closedSlot ? document.querySelector(`[data-slot="${closedSlot}"]`) : null;
    if (restoreFocus) returnTarget?.focus({ preventScroll: true });
  }

  function clampWindow(element, desired) {
    if (!element || !desired) return;
    const rect = element.getBoundingClientRect();
    desired.x = Math.max(8, Math.min(desired.x, window.innerWidth - rect.width - 8));
    desired.y = Math.max(8, Math.min(desired.y, window.innerHeight - rect.height - 8));
    element.style.left = `${desired.x}px`;
    element.style.top = `${desired.y}px`;
  }

  function nextTo(element, source) {
    const sourceRect = source?.getBoundingClientRect() ?? { left: 16, right: 16, top: 16 };
    const width = element.getBoundingClientRect().width;
    return { x: sourceRect.right + width + 16 <= window.innerWidth ? sourceRect.right + 8 : sourceRect.left - width - 8, y: sourceRect.top };
  }

  function placeGemWindows() {
    if (!popup || !gemPopup || !position) return;
    gemPopup.style.maxHeight = "";
    clampWindow(popup, position);
    const main = popup.getBoundingClientRect(), gems = gemPopup.getBoundingClientRect();
    const gap = 8, margin = 8;
    if (main.width + gems.width + gap + margin * 2 <= window.innerWidth) {
      if (!gemPosition || stackedGems) {
        if (main.right + gap + gems.width > window.innerWidth - margin && main.left - gap - gems.width < margin) {
          position.x = margin; clampWindow(popup, position);
        }
        gemPosition = nextTo(gemPopup, popup);
      }
      stackedGems = false;
      clampWindow(gemPopup, gemPosition);
      return;
    }
    stackedGems = true;
    const pairHeight = main.height + gap + gems.height;
    if (pairHeight <= window.innerHeight - margin * 2) {
      position.y = Math.max(margin, Math.min(position.y, window.innerHeight - margin - pairHeight));
      clampWindow(popup, position);
      gemPosition = { x: position.x, y: position.y + main.height + gap };
    } else {
      // On a short screen keep the parent header reachable above the gem window.
      position.y = margin; clampWindow(popup, position);
      const headerHeight = popup.querySelector(".equipment-window__header").getBoundingClientRect().height;
      const top = Math.max(position.y + headerHeight + gap, window.innerHeight - margin - gems.height);
      gemPopup.style.maxHeight = `${Math.max(1, window.innerHeight - top - margin)}px`;
      gemPosition = { x: position.x, y: top };
    }
    clampWindow(gemPopup, gemPosition);
  }

  function header(element, title, onClose, isGem = false) {
    const bar = node("header", { className: "equipment-window__header" }, [
      node("h2", { id: isGem ? "equipment-gem-title" : "equipment-window-title", textContent: title }),
      button("×", onClose, { className: "equipment-window__close", ariaLabel: "Закрыть", title: "Закрыть (Esc)" }),
    ]);
    bar.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault(); hideTooltip(); endDrag?.();
      const start = element.getBoundingClientRect(), x = event.clientX, y = event.clientY;
      const targetPosition = isGem ? gemPosition : position;
      const move = (next) => {
        if (next.pointerId !== event.pointerId) return;
        targetPosition.x = start.left + next.clientX - x;
        targetPosition.y = start.top + next.clientY - y;
        clampWindow(element, targetPosition);
        if (!isGem && gemPopup && stackedGems) placeGemWindows();
      };
      const end = (next) => {
        if (next && next.pointerId !== event.pointerId) return;
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", end);
        document.removeEventListener("pointercancel", end);
        element.classList.remove("is-dragging"); endDrag = null;
      };
      endDrag = end; element.classList.add("is-dragging");
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", end);
      document.addEventListener("pointercancel", end);
    });
    return bar;
  }

  function makeWindow(isGem = false) {
    const result = node("section", { className: `equipment-window${isGem ? " equipment-window--gems" : ""}` });
    result.setAttribute("role", "dialog");
    result.setAttribute("aria-modal", "false");
    result.setAttribute("aria-labelledby", isGem ? "equipment-gem-title" : "equipment-window-title");
    result.addEventListener("pointerdown", hideTooltip);
    document.body.append(result);
    return result;
  }

  function commit(choice) {
    hideTooltip(); errorMessage = "";
    const before = revision;
    try {
      onEquip(opened.slot, choice);
      if (before === revision) render();
      return true;
    } catch (error) { message(error); return false; }
  }

  function currentChoice(patch = {}) {
    const current = entry();
    return { item: current.item, refine: current.refine ?? 0, stones: [...(current.stones ?? [])], addons: [...chosenAddons(current)], ...patch };
  }

  function slotItems() {
    return (getCatalog().items ?? []).filter((item) => hasName(item) && supportedClasses(item) && itemFitsSlot(item, opened.slot));
  }

  function resetFilters() {
    query = ""; currentPage = 0;
    const types = [...new Set(slotItems().map(subtype))];
    const currentType = entry() ? subtype(entry().item) : null;
    if (currentType && types.includes(currentType)) selectedTypes = new Set([currentType]);
    else {
      const preferred = types.filter((type) => armorGroup(type) === defaultGroup(getState().cls));
      selectedTypes = new Set(preferred.length ? preferred : types);
    }
  }

  function open(slot, source) {
    if (!SLOT_NAMES.has(slot)) return;
    if (!(typeof isReady === "function" ? isReady() : isReady)) {
      onMessage("Сначала дождитесь загрузки базы предметов.", true); return;
    }
    close(); anchor = source ?? document.querySelector(`[data-slot="${slot}"]`);
    opened = { slot, mode: getState().equipment?.[slot]?.item ? "editor" : "picker" };
    resetFilters(); render();
    (popup.querySelector("[data-control='item-search'],[data-control='refine']") ?? popup.querySelector("[data-control='item-preview']"))?.focus({ preventScroll: true });
  }

  function icon(item, slot = opened?.slot) {
    const result = node("span", { className: "equipment-icon", ariaHidden: "true" });
    result.append(renderIcon(item, slot));
    return result;
  }

  function attachPreview(element, choice, slot, stone = false) {
    const show = (event) => showTooltip(choice, slot, element, event, stone);
    element.addEventListener("pointerenter", show);
    element.addEventListener("focus", show);
    element.addEventListener("pointerleave", hideTooltip);
    element.addEventListener("blur", hideTooltip);
  }

  function field(label, value, className = "") {
    return node("div", { className: `equipment-tooltip__line ${className}` }, [
      node("span", { textContent: label }), node("span", { textContent: value }),
    ]);
  }

  function itemTooltip(choice, slot, status) {
    const item = choice.item;
    const title = node("strong", { className: "equipment-tooltip__title", textContent: `${displayName(item)}${choice.stones?.length ? ` (ячеек: ${choice.stones.length})` : ""}${choice.refine ? ` +${choice.refine}` : ""}` });
    if (titleColor(item)) title.style.color = titleColor(item);
    const content = node("div", {}, [title]);
    if (!status.usable) content.append(node("p", { className: "equipment-tooltip__unusable", textContent: "Требования не выполнены. Бонусы не учитываются" }));
    const descriptions = (Array.isArray(item.description) ? item.description : []).map(text).filter(Boolean);
    const flags = descriptions.filter((line) => /привяз|невозможно|не исчезает|нельзя|уничтож|не теряется/i.test(line));
    if (flags.length) content.append(node("p", { className: "equipment-tooltip__binding", textContent: flags[0] }));
    content.append(node("p", { className: "equipment-tooltip__kind", textContent: subtype(item) }));
    if (Number.isFinite(item.grade)) content.append(field("Уровень", fmt(item.grade)));
    // Header numbers match the game's base item + refinement; gems and rolls stay below.
    let base;
    // A source-guaranteed unique is shown below, alongside the selected properties.
    // Remove that list from this read-only calculation so header stats stay base + refine.
    const baseItem = { ...item, addons: { ...item.addons, unique: [] } };
    try { base = getItemBonuses({ ...choice, item: baseItem, stones: [], addons: [] }, slot); } catch { base = null; }
    const stats = item.stats ?? {};
    if (Number.isFinite(stats.atk_speed)) {
      content.append(field(stats.atk_speed > 0 && stats.atk_speed <= 5 ? "Скорость атаки (раз в секунду)" : "Скорость атаки (значение базы)", fmt(stats.atk_speed)));
    }
    if (Number.isFinite(stats.range)) content.append(field("Дальность", fmt(stats.range)));
    for (const key of ["phys_atk", "mag_atk"]) {
      const values = base?.ranges?.[key] ?? stats[key];
      if (Array.isArray(values) && (values.some((value) => value !== 0) || Object.hasOwn(stats, key))) content.append(field(STAT_NAMES[key], values.map(fmt).join("–")));
    }
    for (const [key, value] of Object.entries(base?.flat ?? stats)) {
      if (["phys_atk", "mag_atk", "atk_speed", "range"].includes(key) || typeof value !== "number") continue;
      content.append(field(STAT_NAMES[key] ?? key, `${fmt(value)}${PERCENT_STATS.has(key) ? "%" : ""}`));
    }
    if (Number.isFinite(item.max_durability)) content.append(field("Максимальная прочность", fmt(item.max_durability)));
    content.append(...requirementFields(status));
    if (!status.usable && !(status.requirements ?? []).some((requirement) => !requirement.met)) {
      content.append(node("p", { className: "equipment-tooltip__unusable", textContent: (status.reasons ?? []).join("\n") }));
    }
    for (const [label, value] of Object.entries(item.specs_extra ?? {})) {
      if (label !== "Требуемая репутация") content.append(field(text(label), text(value)));
    }
    const permanent = guaranteed(item);
    for (const addon of [...new Set([...permanent, ...(choice.addons ?? [])])]) content.append(node("p", { className: "equipment-tooltip__addon", textContent: text(addon) }));
    if (!chosenAddons(choice).length && offeredAddons(item).length) {
      const options = node("div", { className: "equipment-tooltip__options" }, [node("p", { textContent: `Возможные свойства · до ${maximumAddons(item)}` })]);
      for (const addon of offeredAddons(item)) options.append(node("p", { textContent: text(addon) }));
      content.append(options);
    }
    for (const stone of choice.stones ?? []) {
      const effect = stone.effects?.[STONE_TARGETS[slot]];
      content.append(node("p", { className: "equipment-tooltip__gem", textContent: `${stone.name}${effect ? `: ${effect.raw ?? `${effect.stat} +${fmt(effect.value)}${effect.percent ? "%" : ""}`}` : ""}` }));
    }
    const extraFlags = flags.slice(1);
    if (extraFlags.length) content.append(node("p", { className: "equipment-tooltip__binding equipment-tooltip__section", textContent: extraFlags.join("\n") }));
    const flavor = descriptions.filter((line) => !flags.includes(line));
    if (flavor.length) content.append(node("p", { className: "equipment-tooltip__flavor equipment-tooltip__section", textContent: flavor.join("\n") }));
    if (item.price) content.append(field("Цена (база)", text(item.price)));
    content.append(node("small", { className: "equipment-tooltip__source", textContent: `Comeback PW 1.4.6 · ID ${item.id}` }));
    return content;
  }

  function stoneTooltip(stone, slot) {
    const title = node("strong", { className: "equipment-tooltip__title", textContent: stone.name });
    if (titleColor(stone)) title.style.color = titleColor(stone);
    const content = node("div", {}, [title]);
    if (Number.isFinite(stone.grade)) content.append(field("Уровень камня", fmt(stone.grade)));
    const effect = stone.effects?.[STONE_TARGETS[slot]];
    if (effect) content.append(node("p", { className: "equipment-tooltip__gem", textContent: effect.raw ?? `${effect.stat} +${fmt(effect.value)}${effect.percent ? "%" : ""}` }));
    for (const line of stone.description ?? []) content.append(node("p", { className: "equipment-tooltip__flavor", textContent: text(line) }));
    content.append(node("small", { className: "equipment-tooltip__source", textContent: `Comeback PW 1.4.6 · ID ${stone.id}` }));
    return content;
  }

  function placeTooltip(x, y) {
    if (!tooltip) return;
    const rect = tooltip.getBoundingClientRect();
    const left = x + rect.width + 18 < window.innerWidth ? x + 14 : x - rect.width - 12;
    tooltip.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(y + 12, window.innerHeight - rect.height - 8))}px`;
  }

  function showTooltip(choice, slot, source, event, stone = false) {
    hideTooltip(); hoverTarget = source;
    const status = stone ? null : eligibility(choice, slot);
    tooltip = node("aside", { className: `equipment-tooltip${status && !status.usable ? " equipment-tooltip--unusable" : ""}`, role: "tooltip" }, [stone ? stoneTooltip(choice, slot) : itemTooltip(choice, slot, status)]);
    document.body.append(tooltip);
    const rect = source.getBoundingClientRect();
    placeTooltip(event?.clientX ?? rect.right, event?.clientY ?? rect.top);
  }

  function resultRow(item, choose, stone = false) {
    const choice = { item, refine: 0, stones: [], addons: [] };
    const status = stone ? null : eligibility(choice, opened.slot);
    const name = node("span", { className: "equipment-result__name", textContent: item.name });
    if (titleColor(item)) name.style.color = titleColor(item);
    const row = button("", choose, { className: `equipment-result${status && !status.usable ? " equipment-result--unusable" : ""}`, ariaLabel: `Выбрать ${item.name}` });
    if (status && !status.usable) row.setAttribute("aria-description", (status.reasons ?? []).join(". "));
    row.append(icon(item), node("span", { className: "equipment-result__copy" }, [name,
      node("small", { textContent: `${stone ? "Ранг" : "Ур."} ${stone ? item.grade ?? "—" : item.level ?? "—"} · ${subtype(item)} · ID ${item.id}` }),
    ]));
    if (status && !status.usable) row.append(node("span", { className: "equipment-requirement-mark", textContent: "!", ariaHidden: "true" }));
    attachPreview(row, stone ? item : choice, opened.slot, stone);
    return row;
  }

  function paging(total, page, onPage) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const change = (next, direction) => {
      const owner = document.activeElement?.closest(".equipment-window");
      onPage(next);
      const preferred = owner?.querySelector(`[data-page-action="${direction}"]`);
      const fallback = owner?.querySelector(".equipment-pagination button:not(:disabled)");
      (preferred?.disabled ? fallback : preferred)?.focus({ preventScroll: true });
    };
    const previous = button("‹", () => change(page - 1, "previous"), { disabled: page <= 0, ariaLabel: "Предыдущая страница" });
    const next = button("›", () => change(page + 1, "next"), { disabled: page >= pages - 1, ariaLabel: "Следующая страница" });
    previous.dataset.pageAction = "previous"; next.dataset.pageAction = "next";
    return node("footer", { className: "equipment-pagination" }, [
      previous,
      node("span", { textContent: `${page + 1}/${pages} · ${total} предм.`, ariaLive: "polite" }),
      next,
    ]);
  }

  function renderPickerResults(container) {
    hideTooltip();
    const state = getState();
    const items = slotItems().filter((item) => selectedTypes.has(subtype(item)) && searchMatches(item, query)
      && (!availableOnly || ((!Number.isFinite(item.level) || item.level <= state.level)
        && (!Array.isArray(item.classes) || !item.classes.length || item.classes.includes(CLASS_BY_ID[state.cls])))))
      .sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.id - b.id);
    currentPage = Math.min(currentPage, Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1));
    const list = node("div", { className: "equipment-results", ariaLabel: "Предметы" });
    for (const item of items.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)) {
      list.append(resultRow(item, () => {
        if (commit({ item, refine: 0, stones: [], addons: [] })) close(true);
      }));
    }
    if (!items.length) list.append(node("p", { className: "equipment-empty", textContent: "Предметов не найдено. Измените поиск, тип или ограничение уровня и класса." }));
    container.replaceChildren(list, paging(items.length, currentPage, (page) => { currentPage = page; renderPickerResults(container); }));
    clampWindow(popup, position);
  }

  function renderPicker() {
    popup.classList.add("equipment-window--picker");
    popup.append(header(popup, `Выбор: ${SLOT_NAMES.get(opened.slot)}`, () => close(true)));
    const results = node("div", { className: "equipment-picker-results" });
    const input = node("input", { type: "search", value: query, placeholder: "Название, ID или ур:100", ariaLabel: "Поиск предмета", className: "equipment-search" });
    input.dataset.control = "item-search";
    const refresh = () => { query = input.value; currentPage = 0; renderPickerResults(results); };
    input.addEventListener("input", refresh);
    const form = node("form", { className: "equipment-search-row" }, [input, button("⌕", refresh, { ariaLabel: "Найти предмет" })]);
    form.addEventListener("submit", (event) => { event.preventDefault(); refresh(); });
    popup.append(form);
    const types = [...new Set(slotItems().map(subtype))].sort((a, b) => a.localeCompare(b, "ru"));
    const filters = node("div", { className: "equipment-type-filters" });
    const grouped = types.length > 0 && types.every((type) => armorGroup(type));
    if (grouped) {
      for (const [group, label] of Object.entries(TYPE_GROUPS)) {
        const groupTypes = types.filter((type) => armorGroup(type) === group);
        if (!groupTypes.length) continue;
        const checkbox = node("input", { type: "checkbox", checked: groupTypes.every((type) => selectedTypes.has(type)) });
        checkbox.dataset.control = `type-${group}`;
        checkbox.addEventListener("change", () => {
          for (const type of groupTypes) { if (checkbox.checked) selectedTypes.add(type); else selectedTypes.delete(type); }
          currentPage = 0; renderPickerResults(results);
        });
        filters.append(node("label", { title: groupTypes.join(", ") }, [checkbox, document.createTextNode(label)]));
      }
      filters.append(button("Все", () => { selectedTypes = new Set(types); currentPage = 0; render(); }, { className: "equipment-text-action" }));
    } else {
      const select = node("select", { ariaLabel: "Тип предмета" }, [node("option", { value: "", textContent: "Все типы" })]);
      select.dataset.control = "item-type";
      for (const type of types) select.append(node("option", { value: type, textContent: type }));
      select.value = selectedTypes.size === 1 ? [...selectedTypes][0] : "";
      select.addEventListener("change", () => { selectedTypes = new Set(select.value ? [select.value] : types); currentPage = 0; renderPickerResults(results); });
      filters.append(select);
    }
    const available = node("input", { type: "checkbox", checked: availableOnly });
    available.dataset.control = "item-available";
    available.addEventListener("change", () => { availableOnly = available.checked; currentPage = 0; renderPickerResults(results); });
    popup.append(filters, node("label", { className: "equipment-available" }, [available, document.createTextNode("По уровню и классу")]), results);
    renderPickerResults(results);
  }

  function refineControl(current) {
    const levels = [0, ...Array.from({ length: 12 }, (_, index) => index + 1).filter((level) => typeof current.item.refine?.levels?.[level - 1] === "number" && Number.isFinite(current.item.refine.levels[level - 1]))];
    const currentLevel = current.refine ?? 0;
    if (levels.length === 1 && currentLevel === 0) return null;
    const wrapper = node("div", { className: "equipment-refinement-section" });
    if (!levels.includes(currentLevel)) wrapper.append(node("p", { className: "equipment-refine-warning", textContent: `Заточка +${currentLevel}: в базе нет подтверждённого значения.` }));
    if (levels.length === 1) {
      wrapper.append(button("Снять заточку", () => commit(currentChoice({ refine: 0 })), { className: "equipment-refine-clear" }));
      return wrapper;
    }
    const input = node("input", { type: "number", min: "0", max: String(levels.at(-1)), step: "1", value: String(currentLevel), ariaLabel: "Уровень заточки" });
    input.dataset.control = "refine";
    const set = (value) => {
      if (!Number.isInteger(value) || !levels.includes(value)) { input.value = String(entry()?.refine ?? 0); message(new Error("Этот уровень заточки не подтверждён базой для предмета.")); return; }
      if (value !== (entry()?.refine ?? 0)) commit(currentChoice({ refine: value }));
    };
    const step = (direction) => {
      const value = entry()?.refine ?? 0;
      const next = direction > 0 ? levels.find((level) => level > value) : [...levels].reverse().find((level) => level < value);
      if (next !== undefined) set(next);
    };
    input.addEventListener("change", () => set(Number(input.value)));
    input.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); step(event.key === "ArrowUp" ? 1 : -1);
    });
    input.addEventListener("wheel", (event) => {
      if (document.activeElement !== input || event.deltaY === 0) return;
      event.preventDefault(); step(event.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    wrapper.append(node("div", { className: "equipment-refinement" }, [
      node("label", { textContent: "Заточка" }, [input]),
      button("−", () => step(-1), { ariaLabel: "Уменьшить заточку", disabled: !levels.some((level) => level < currentLevel), title: "Предыдущий подтверждённый уровень заточки" }),
      button("+", () => step(1), { ariaLabel: "Увеличить заточку", disabled: !levels.some((level) => level > currentLevel), title: "Следующий подтверждённый уровень заточки" }),
    ]));
    return wrapper;
  }

  function compatibleStones() {
    const current = entry(), target = STONE_TARGETS[opened.slot];
    return (getCatalog().stones ?? []).filter((stone) => hasName(stone) && stone.effects?.[target]
      && !(Number.isFinite(current.item.grade) && Number.isFinite(stone.grade) && stone.grade > current.item.grade));
  }

  function renderStones(current) {
    const capacity = maxSockets(current.item, opened.slot), stones = current.stones ?? [];
    const panel = node("section", { className: "equipment-tab-panel" });
    panel.append(node("p", { className: "equipment-hint", textContent: `Камни: ${stones.length}/${capacity} ячеек` }));
    if (!capacity) { panel.append(node("p", { className: "equipment-hint", textContent: "В базе не подтверждены ячейки для этого предмета." })); return panel; }
    const cells = node("div", { className: "equipment-gem-cells" });
    for (let index = 0; index < capacity; index += 1) {
      const stone = stones[index];
      const cell = node("div", { className: "equipment-gem-cell" });
      const choose = button(stone ? "" : "+", () => {
        gemIndex = index; gemQuery = ""; gemPage = 0; gemPosition = null;
        renderGemPicker(); gemPopup.querySelector("input")?.focus({ preventScroll: true });
      }, { className: "equipment-gem", ariaLabel: stone ? `Заменить камень: ${stone.name}` : `Вставить камень в ячейку ${index + 1}`, title: stone?.name ?? "Вставить камень" });
      choose.dataset.control = `gem-${index}`;
      if (stone) { choose.append(icon(stone)); attachPreview(choose, stone, opened.slot, true); }
      cell.append(choose);
      if (stone) {
        const remove = button("×", () => commit(currentChoice({ stones: stones.filter((_, other) => other !== index) })), { className: "equipment-gem-action", ariaLabel: `Извлечь ${stone.name}`, title: "Извлечь камень" });
        remove.dataset.control = `gem-remove-${index}`;
        const duplicate = button("+", () => commit(currentChoice({ stones: [...stones, stone] })), { className: "equipment-gem-action", ariaLabel: `Ещё один ${stone.name}`, title: "Вставить такой же", disabled: stones.length >= capacity });
        duplicate.dataset.control = `gem-copy-${index}`;
        cell.append(node("div", { className: "equipment-gem-actions" }, [remove, duplicate]));
      }
      cells.append(cell);
    }
    panel.append(cells);
    return panel;
  }

  function closeGems(restoreFocus = false) {
    const previous = gemIndex;
    gemIndex = null; gemPopup?.remove(); gemPopup = null; gemPosition = null; stackedGems = false; hideTooltip();
    if (restoreFocus) popup?.querySelector(`[data-control="gem-${previous}"]`)?.focus({ preventScroll: true });
  }

  function renderGemPicker() {
    if (gemIndex === null || !entry()) { closeGems(); return; }
    hideTooltip();
    if (!gemPopup) gemPopup = makeWindow(true);
    gemPopup.replaceChildren(header(gemPopup, "Выбор камня", () => closeGems(true), true));
    const input = node("input", { type: "search", value: gemQuery, placeholder: "Название или ID камня", ariaLabel: "Поиск камня", className: "equipment-search" });
    input.dataset.control = "gem-search";
    const resultContainer = node("div");
    const refresh = () => {
      hideTooltip();
      const stones = compatibleStones().filter((stone) => searchMatches(stone, gemQuery)).sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0) || a.id - b.id);
      gemPage = Math.min(gemPage, Math.max(0, Math.ceil(stones.length / PAGE_SIZE) - 1));
      const list = node("div", { className: "equipment-results", ariaLabel: "Подходящие камни" });
      for (const stone of stones.slice(gemPage * PAGE_SIZE, (gemPage + 1) * PAGE_SIZE)) {
        list.append(resultRow(stone, () => {
          const next = [...(entry().stones ?? [])];
          const focusIndex = Math.min(gemIndex, next.length);
          if (gemIndex >= next.length) next.push(stone); else next[gemIndex] = stone;
          const previousIndex = gemIndex;
          gemIndex = null;
          if (commit(currentChoice({ stones: next }))) {
            closeGems();
            popup?.querySelector(`[data-control="gem-${focusIndex}"]`)?.focus({ preventScroll: true });
          }
          else { gemIndex = previousIndex; renderGemPicker(); }
        }, true));
      }
      if (!stones.length) list.append(node("p", { className: "equipment-empty", textContent: "Подходящие камни не найдены. Камень должен подходить по типу и рангу предмета." }));
      resultContainer.replaceChildren(list, paging(stones.length, gemPage, (page) => { gemPage = page; refresh(); }));
      clampWindow(gemPopup, gemPosition);
    };
    input.addEventListener("input", () => { gemQuery = input.value; gemPage = 0; refresh(); });
    gemPopup.append(node("div", { className: "equipment-search-row" }, [input]), resultContainer);
    refresh();
    placeGemWindows();
  }

  function selectedOption(selected, options) {
    const exact = options.indexOf(selected);
    if (exact >= 0) return exact;
    const value = parseAddonOption(selected);
    if (!value || value.min !== value.max) return -1;
    return options.findIndex((option) => {
      const source = parseAddonOption(option);
      return source && source.label === value.label && source.percent === value.percent && value.min >= source.min && value.min <= source.max;
    });
  }

  function renderAddons(current) {
    const panel = node("section", { className: "equipment-tab-panel equipment-properties" });
    const maximum = maximumAddons(current.item), chosen = chosenAddons(current), options = offeredAddons(current.item);
    const fixed = guaranteed(current.item);
    if (fixed.length) {
      panel.append(node("p", { className: "equipment-hint", textContent: "Постоянные свойства" }));
      for (const property of fixed) panel.append(node("p", { className: "equipment-property-text", textContent: property }));
    }
    panel.append(node("p", { className: "equipment-hint", textContent: `Выбранные свойства: ${chosen.length}/${maximum}` }));
    if (!maximum || !options.length) { panel.append(node("p", { className: "equipment-hint", textContent: "Дополнительные свойства для выбора не подтверждены базой." })); return panel; }
    const save = (index, value) => {
      const next = [...chosenAddons(entry())];
      if (value === null) next.splice(index, 1); else next[index] = value;
      commit(currentChoice({ addons: next }));
    };
    for (let index = 0; index < Math.min(chosen.length + 1, maximum); index += 1) {
      const selected = chosen[index], optionIndex = selectedOption(selected, options);
      const select = node("select", { ariaLabel: `Свойство ${index + 1}` }, [node("option", { value: "", textContent: "Выбрать свойство…" })]);
      select.dataset.control = `property-${index}`;
      for (const [number, option] of options.entries()) select.append(node("option", { value: String(number), textContent: option }));
      if (optionIndex >= 0) select.value = String(optionIndex);
      else if (selected) {
        select.append(node("option", { value: "current", textContent: selected })); select.value = "current";
      }
      select.addEventListener("change", () => {
        if (select.value === "") { if (selected) save(index, null); return; }
        const option = options[Number(select.value)];
        if (!option) return;
        const range = parseAddonOption(option);
        try { save(index, range && range.min !== range.max ? formatAddonValue(option, range.max) : option); } catch (error) { message(error); }
      });
      const row = node("div", { className: "equipment-property" }, [select]);
      const range = optionIndex >= 0 ? parseAddonOption(options[optionIndex]) : null;
      if (selected && range && range.min !== range.max) {
        const value = parseAddonOption(selected);
        const input = node("input", { type: "number", min: String(range.min), max: String(range.max), step: "any", value: String(value?.min === value?.max ? value.min : range.max), ariaLabel: `Значение свойства ${range.label}`, title: `От ${fmt(range.min)} до ${fmt(range.max)}` });
        input.dataset.control = `property-value-${index}`;
        input.addEventListener("change", () => {
          try { save(index, formatAddonValue(options[optionIndex], Number(input.value))); }
          catch (error) { input.value = String(value?.min === value?.max ? value.min : range.max); message(error); }
        });
        row.append(input);
      }
      if (selected) row.append(button("×", () => save(index, null), { className: "equipment-text-action", ariaLabel: `Убрать свойство ${index + 1}` }));
      panel.append(row);
    }
    return panel;
  }

  function renderSet(current) {
    const panel = node("section", { className: "equipment-tab-panel" });
    const pieces = (current.item.set ?? []).filter((piece) => typeof piece === "string");
    if (!pieces.length) { panel.append(node("p", { className: "equipment-hint", textContent: "В базе не указан комплект для этого предмета." })); return panel; }
    const worn = new Set(Object.values(getState().equipment ?? {}).filter(Boolean).map((choice) => norm(choice.item.name)));
    panel.append(node("p", { className: "equipment-hint", textContent: `Надето: ${pieces.filter((piece) => worn.has(norm(piece))).length}/${pieces.length}` }));
    for (const piece of pieces) panel.append(node("p", { className: worn.has(norm(piece)) ? "equipment-set-piece is-equipped" : "equipment-set-piece", textContent: `${worn.has(norm(piece)) ? "✓ " : ""}${piece}` }));
    panel.append(node("p", { className: "equipment-hint", textContent: "Бонус комплекта пока не рассчитывается." }));
    return panel;
  }

  function renderEditor() {
    const current = entry();
    if (!current?.item) { opened.mode = "picker"; resetFilters(); renderPicker(); return; }
    const status = eligibility(current, opened.slot);
    popup.classList.add("equipment-window--editor");
    popup.classList.toggle("equipment-window--unusable", !status.usable);
    popup.append(header(popup, SLOT_NAMES.get(opened.slot), () => close(true)));
    const preview = button("", () => {}, { className: `equipment-editor-icon${status.usable ? "" : " equipment-editor-icon--unusable"}`, ariaLabel: `Характеристики: ${displayName(current.item)}${status.usable ? "" : ". Требования не выполнены. Бонусы не учитываются"}` });
    if (!status.usable) preview.setAttribute("aria-description", (status.reasons ?? []).join(". "));
    preview.dataset.control = "item-preview";
    preview.append(icon(current.item)); attachPreview(preview, current, opened.slot);
    const name = node("strong", { className: "equipment-editor-name", textContent: displayName(current.item) });
    if (titleColor(current.item)) name.style.color = titleColor(current.item);
    const replace = button("Заменить", () => { closeGems(); opened.mode = "picker"; resetFilters(); render(); popup.querySelector("input")?.focus(); }, { className: "equipment-text-action" });
    replace.dataset.control = "replace-item";
    const remove = button("Снять", () => {
      try { onUnequip(opened.slot); close(true); } catch (error) { message(error); }
    }, { className: "equipment-text-action" });
    remove.dataset.control = "remove-item";
    popup.append(node("div", { className: "equipment-editor-item" }, [preview, node("div", { className: "equipment-editor-copy" }, [name, node("div", { className: "equipment-editor-actions" }, [replace, remove])])]));
    if (!status.usable) popup.append(node("p", { className: "equipment-editor-status", role: "status", textContent: `Бонусы не учитываются, пока не выполнены требования. ${(status.reasons ?? []).join(" ")}` }));
    const refinement = refineControl(current);
    if (refinement) popup.append(refinement);
    const tabs = node("div", { className: "equipment-tabs" });
    for (const [id, label] of [["stones", "Камни"], ["properties", "Характеристики"], ["set", "Комплект"]]) {
      const tab = button(label, () => { activeTab = activeTab === id ? null : id; if (activeTab !== "stones") closeGems(); render(); }, { ariaExpanded: String(activeTab === id), ariaControls: `equipment-panel-${id}` });
      tab.dataset.control = `tab-${id}`; tabs.append(tab);
    }
    popup.append(tabs);
    if (activeTab) {
      const panel = activeTab === "stones" ? renderStones(current) : activeTab === "properties" ? renderAddons(current) : renderSet(current);
      panel.id = `equipment-panel-${activeTab}`; popup.append(panel);
    }
  }

  function focusSnapshot() {
    const active = document.activeElement;
    if (!active || !(popup?.contains(active) || gemPopup?.contains(active))) return null;
    return { key: active.dataset.control, isGem: gemPopup?.contains(active), start: ["search", "text"].includes(active.type) ? active.selectionStart : null, end: ["search", "text"].includes(active.type) ? active.selectionEnd : null };
  }

  function render() {
    // A blur/change may update the build during pointerdown, before its click.
    // Keep that live button in the DOM until click dispatch; only presentation waits.
    if (pointerGesture && pointerGesture.target.isConnected
      && (popup?.contains(pointerGesture.target) || gemPopup?.contains(pointerGesture.target))) {
      pendingRender = true;
      return;
    }
    pendingRender = false;
    revision += 1; hideTooltip();
    if (!opened) return;
    const focus = focusSnapshot();
    if (!popup) popup = makeWindow();
    popup.className = "equipment-window";
    popup.replaceChildren();
    if (opened.mode === "editor") renderEditor(); else renderPicker();
    popup.append(node("p", { className: "equipment-feedback", textContent: errorMessage, hidden: !errorMessage, role: "status" }));
    position ??= nextTo(popup, anchor); clampWindow(popup, position);
    if (gemIndex !== null) renderGemPicker(); else closeGems();
    if (focus?.key) {
      const controls = [...((focus.isGem ? gemPopup : popup)?.querySelectorAll("[data-control]") ?? [])];
      const target = controls.find((control) => control.dataset.control === focus.key);
      target?.focus({ preventScroll: true });
      if (target && focus.start !== null) target.setSelectionRange(focus.start, focus.end);
    }
  }

  function finishPointerGesture() {
    pointerGesture = null;
    clearTimeout(pointerFinishTimer); pointerFinishTimer = null;
    if (pendingRender) render();
  }

  document.addEventListener("pointerdown", (event) => {
    clearTimeout(pointerFinishTimer); pointerFinishTimer = null;
    pointerGesture = popup?.contains(event.target) || gemPopup?.contains(event.target)
      ? { id: event.pointerId, target: event.target } : null;
  }, true);
  document.addEventListener("click", () => {
    // Capture runs before the existing button handler, so that handler can render.
    pointerGesture = null;
    clearTimeout(pointerFinishTimer); pointerFinishTimer = null;
    // A task, rather than a microtask, also waits through all native click listeners.
    if (pendingRender) pointerFinishTimer = setTimeout(finishPointerGesture, 0);
  }, true);
  document.addEventListener("pointerup", (event) => {
    if (pointerGesture?.id !== event.pointerId) return;
    // A drag or cancelled activation may have no click; finish after native click.
    pointerFinishTimer = setTimeout(finishPointerGesture, 0);
  }, true);
  document.addEventListener("pointercancel", finishPointerGesture, true);

  document.addEventListener("pointerdown", (event) => {
    if (opened && !popup?.contains(event.target) && !gemPopup?.contains(event.target) && !anchor?.contains(event.target)) close();
    if (!hoverTarget?.contains(event.target)) hideTooltip();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    hideTooltip();
    if (!opened) return;
    event.preventDefault();
    if (gemIndex !== null) closeGems(true); else close(true);
  });
  const previewSlot = (event) => {
    const source = event.target.closest?.("[data-slot]");
    if (!source || !SLOT_NAMES.has(source.dataset.slot)) return;
    const choice = getState().equipment?.[source.dataset.slot];
    if (choice?.item && source !== hoverTarget) showTooltip(choice, source.dataset.slot, source, event);
  };
  document.addEventListener("pointerover", previewSlot);
  document.addEventListener("focusin", previewSlot);
  document.addEventListener("pointerout", (event) => { if (hoverTarget?.contains(event.target) && !hoverTarget.contains(event.relatedTarget)) hideTooltip(); });
  document.addEventListener("focusout", (event) => { if (hoverTarget?.contains(event.target)) hideTooltip(); });
  document.addEventListener("pointermove", (event) => { if (tooltip && hoverTarget?.contains(event.target)) placeTooltip(event.clientX, event.clientY); });
  window.addEventListener("resize", () => { if (gemPopup) placeGemWindows(); else clampWindow(popup, position); hideTooltip(); });
  window.addEventListener("scroll", hideTooltip, { passive: true });
  return { open, render, close };
}
