export const MAX_REPUTATION = Number.MAX_SAFE_INTEGER;

export function validateReputation(value = 0) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Репутация должна быть целым неотрицательным числом не больше ${MAX_REPUTATION}`);
  }
  return value === 0 ? 0 : value;
}

// The database keeps this requirement as text, often with a thousands space.
// An unreadable requirement remains unknown rather than allowing the item.
export function getRequiredReputation(item) {
  const extra = item?.specs_extra;
  const key = "Требуемая репутация";
  if (!extra || !Object.hasOwn(extra, key)) return 0;
  const raw = extra[key];
  if (typeof raw !== "string" || !/^[0-9]+(?:\s+[0-9]+)*$/u.test(raw.trim())) return null;
  const value = Number(raw.replace(/\s/gu, ""));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
