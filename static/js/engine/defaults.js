import { validateEquipmentChoice } from "./equipment.js?v=20261103-bonuses";

// A reviewed starting selection, still editable; not a guaranteed item property.
export function defaultAddons(item, slot) {
  if (item.client_fixed_addons !== undefined) return validateEquipmentChoice({ item, addons: [] }, slot).addons;
  const addons = Array.isArray(item.default_addons) ? [...item.default_addons] : item.default_addons ?? [];
  return validateEquipmentChoice({ item, addons }, slot).addons;
}

export function createDefaultChoice(item, slot) {
  return validateEquipmentChoice({ item, refine: 0, stones: [], addons: defaultAddons(item, slot) }, slot);
}
