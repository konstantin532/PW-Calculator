const UNKNOWN = "неизвестно · не учтено";
const STAT_LABELS = {
  hp: "Здоровье", phys_atk: "Физическая атака", mag_atk: "Магическая атака",
  phys_def: "Физическая защита", mag_def: "Магическая защита",
  str: "Сила", dex: "Ловкость", int: "Интеллект", vit: "Выносливость",
  metal: "Защита от металла", wood: "Защита от дерева", water: "Защита от воды",
  fire: "Защита от огня", earth: "Защита от земли",
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function formatValue(value, percent = false) {
  if (Array.isArray(value)) {
    if (value.length !== 2 || !value.every(Number.isFinite)) return UNKNOWN;
    return value.map((part) => formatValue(part)).join("–") + (percent ? "%" : "");
  }
  if (!Number.isFinite(value)) return UNKNOWN;
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 8 }) + (percent ? "%" : "");
}

function stageTable(stages) {
  const table = node("table", "stat-explanation-stages");
  const caption = node("caption", "", "Порядок расчёта");
  const head = node("tr");
  for (const text of ["Этап", "Расчёт", "Результат"]) {
    const th = node("th", "", text);
    th.scope = "col";
    head.append(th);
  }
  const thead = node("thead");
  thead.append(head);
  const tbody = node("tbody");
  for (const stage of stages) {
    const row = node("tr");
    const label = node("th", "", stage.label || "Этап расчёта");
    label.scope = "row";
    row.append(label, node("td", "stat-explanation-expression", stage.expression || "—"),
      node("td", "stat-explanation-value", formatValue(stage.value)));
    tbody.append(row);
  }
  table.append(caption, thead, tbody);
  return table;
}

function sourceDetails(source, index, openSources) {
  const details = node("details", "stat-explanation-source");
  const key = `${index}:${source.kind || ""}:${source.label || ""}`;
  details.dataset.sourceKey = key;
  details.open = openSources.has(key);
  const inactive = source.active === false;
  const hasUnresolved = (source.entries || []).some((entry) => entry.value === null);
  const hasKnown = (source.entries || []).some((entry) => entry.value !== null);
  const status = inactive || (hasUnresolved && !hasKnown) ? "Не учтён"
    : hasUnresolved ? "Частично учтён" : "Учтён";
  details.classList.toggle("is-inactive", inactive);
  details.classList.toggle("has-unresolved", hasUnresolved);
  const summary = node("summary");
  summary.append(node("span", "stat-explanation-source-name", source.label || "Источник"),
    node("span", "stat-explanation-source-status", status));
  details.append(summary);
  if (source.reason) details.append(node("p", "stat-explanation-source-reason", source.reason));
  const entries = node("ul", "stat-explanation-entries");
  for (const entry of source.entries || []) {
    const item = node("li");
    const label = entry.label && entry.label !== entry.stat ? entry.label : STAT_LABELS[entry.stat] || entry.label || "Свойство";
    item.append(node("span", "", label),
      node("span", "stat-explanation-value", formatValue(entry.value, entry.percent)));
    entries.append(item);
  }
  if (entries.children.length) details.append(entries);
  else details.append(node("p", "stat-explanation-source-reason", "Нет числовой прибавки к этому показателю."));
  return details;
}

/** Each calculator document owns its explanation data and modal dialog. */
export function createStatExplanationsUI() {
  let explanations = {};
  let currentKey = null;
  let opener = null;
  const dialog = node("dialog", "game-dialog stat-explanations-dialog");
  dialog.id = "stat-explanations-dialog";
  dialog.setAttribute("aria-labelledby", "stat-explanations-title");
  const header = node("header", "dialog-title");
  const heading = node("h2", "", "Из чего получилась эта цифра");
  heading.id = "stat-explanations-title";
  const close = node("button", "dialog-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Закрыть объяснение");
  close.autofocus = true;
  close.addEventListener("click", () => dialog.close());
  header.append(heading, close);
  const content = node("div", "dialog-content stat-explanations-content");
  dialog.append(header, content);
  document.body.append(dialog);

  function updateContent() {
    const explanation = explanations[currentKey];
    if (!explanation) return;
    const scrollTop = content.scrollTop;
    const openSources = new Set([...content.querySelectorAll("details[open]")].map((item) => item.dataset.sourceKey));
    const focusedSource = document.activeElement?.closest("details[data-source-key]")?.dataset.sourceKey;
    const body = document.createDocumentFragment();
    const result = node("div", "stat-explanation-result");
    result.append(node("h3", "", explanation.title || "Показатель"),
      node("strong", "", formatValue(explanation.result)));
    body.append(result);
    if (explanation.stages?.length) body.append(stageTable(explanation.stages));
    else body.append(node("p", "stat-explanation-note", "Подробности расчёта пока недоступны."));
    if (explanation.note) body.append(node("p", "stat-explanation-note", explanation.note));
    if (explanation.sources?.length) {
      body.append(node("h3", "stat-explanation-section-title", "Источники"),
        node("p", "stat-explanation-note", "Ниже — состав прибавок. Они уже включены в этапы выше; повторно складывать их не нужно."));
      for (const [index, source] of explanation.sources.entries()) body.append(sourceDetails(source, index, openSources));
    }
    if (explanation.warnings?.length) {
      const warnings = node("section", "stat-explanation-warnings");
      warnings.append(node("h3", "", "Что не удалось учесть"));
      const list = node("ul");
      for (const warning of explanation.warnings) list.append(node("li", "", warning));
      warnings.append(list);
      body.append(warnings);
    }
    content.replaceChildren(body);
    content.scrollTop = scrollTop;
    if (focusedSource) [...content.querySelectorAll("details")].find((item) => item.dataset.sourceKey === focusedSource)
      ?.querySelector("summary")?.focus({ preventScroll: true });
  }

  function open(key, trigger = null) {
    if (!explanations[key]) return false;
    const changed = currentKey !== key;
    currentKey = key;
    opener = trigger || document.activeElement;
    if (changed) content.replaceChildren();
    updateContent();
    if (!dialog.open) dialog.showModal();
    return true;
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("button[data-explain]");
    if (trigger) open(trigger.dataset.explain, trigger);
  });
  dialog.addEventListener("close", () => {
    const target = opener?.isConnected ? opener
      : [...document.querySelectorAll("button[data-explain]")].find((button) => button.dataset.explain === currentKey);
    target?.focus({ preventScroll: true });
  });
  return {
    open,
    render(nextExplanations) {
      explanations = nextExplanations || {};
      if (dialog.open) {
        if (explanations[currentKey]) updateContent();
        else dialog.close();
      }
    },
  };
}
