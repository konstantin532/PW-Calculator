const FIELDS = [
  ["hp_percent", "Бонус максимальных ЖС", "%"],
  ["mp_percent", "Бонус максимальных МЭ", "%"],
  ["phys_def_percent", "Предметный бонус физической защиты", "%"],
  ["mag_def_percent", "Предметный бонус защиты стихий", "%"],
  ["accuracy_percent", "Предметный бонус меткости", "%"],
  ["evasion_percent", "Предметный бонус уклонения", "%"],
  ["speed_percent", "Предметный бонус скорости движения", "%"],
  ["hp_regen", "Бонус восстановления ЖС", ""],
  ["mp_regen", "Бонус восстановления МЭ", ""],
  ["experience_percent", "Дополнительный опыт", "%"],
  ["monster_slayer", "Показатель урона монстрам", ""],
  ["monster_guard", "Показатель защиты от монстров", ""],
  ["weapon_damage_metal", "Урон оружия металлом", ""],
  ["weapon_damage_wood", "Урон оружия деревом", ""],
  ["weapon_damage_water", "Урон оружия водой", ""],
  ["weapon_damage_fire", "Урон оружия огнём", ""],
  ["weapon_damage_earth", "Урон оружия землёй", ""],
  ["attack_interval", "Поправка интервала атак", " сек."],
  ["range", "Бонус дальности атаки", " м"],
];
const fmt = (value) => Number.isFinite(value) ? value.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) : "неизвестно";
const percentage = (value) => Number.isFinite(value) ? `${fmt(Math.round(value * 10) / 10)}%` : "неизвестно";
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function metric(label, value) {
  const row = node("div", "bonus-detail-row");
  row.append(node("dt", "", label), node("dd", "", value));
  return row;
}
function group(title, entries) {
  const section = node("section", "bonus-detail-group");
  section.append(node("h3", "", title));
  const list = node("dl", "bonus-detail-metrics");
  for (const [label, value] of entries) list.append(metric(label, value));
  section.append(list);
  return section;
}

/** A read-only view of the same computed totals; this module grants no bonuses. */
export function createEquipmentBonusDetails(element) {
  return {
    render(stats) {
      const body = document.createDocumentFragment();
      body.append(node("p", "bonus-detail-note", "Бонусы активных вещей и комплектов. Постоянные прибавки уже включены в итоговые показатели персонажа; восстановление, опыт, показатели PvE и стихийные добавки оружия приведены отдельно."));
      body.append(group("Снижение урона за счёт обычной защиты", [
        ["Физическая защита", percentage(stats.physDefPct)],
        ["Средняя защита стихий", percentage(stats.magDefPct)],
      ]));
      body.append(group("Отдельные свойства снижения урона", [
        ["Физический урон", percentage(stats.damageReductionPhys)],
        ["Магический урон", percentage(stats.damageReductionMag)],
      ]));
      const extras = FIELDS.map(([key, label, unit]) => {
        const value = stats.extraBonuses ? stats.extraBonuses[key] ?? 0 : null;
        return [label, Number.isFinite(value) ? `${value > 0 ? "+" : ""}${fmt(value)}${unit}` : "неизвестно"];
      });
      body.append(group("Дополнительные параметры предметов", extras));
      body.append(node("p", "bonus-detail-note", "Восстановление и максимальные ЖС/МЭ — разные показатели. Значения PvE приведены в уровнях. Для стихийного урона оружия и PvE нужен расчёт по конкретной цели. Процент от обычной защиты и отдельное снижение урона применяются отдельно."));
      const sets = node("section", "bonus-detail-sets");
      sets.append(node("h3", "", "Комплекты"));
      if (!stats.equipmentSets?.length) sets.append(node("p", "bonus-detail-note", "Активные части подтверждённых комплектов не надеты."));
      for (const set of stats.equipmentSets ?? []) {
        const article = node("article", "bonus-detail-set");
        article.append(node("h4", "", set.name), node("p", "bonus-detail-count", `Активных частей: ${set.count}`));
        const list = node("ul", "bonus-detail-thresholds");
        for (const bonus of set.bonuses) {
          const entry = node("li", bonus.active ? "is-active" : "");
          entry.append(node("p", "bonus-detail-threshold-label", `${bonus.pieces} ч. · ${bonus.active ? "порог достигнут" : "нужно больше активных частей"}`));
          for (const text of bonus.texts) entry.append(node("p", "", text));
          list.append(entry);
        }
        article.append(list);
        sets.append(article);
      }
      body.append(sets);
      element.replaceChildren(body);
    },
  };
}
