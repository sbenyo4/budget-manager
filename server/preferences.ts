import { PREFS_DEFAULT, type BudgetPreferences } from "./db.js";

const MAX_PREFERENCE_ITEMS = 5_000;
const MAX_PREFERENCE_TEXT = 300;

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? value
    : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.slice(0, MAX_PREFERENCE_TEXT))
    .slice(0, MAX_PREFERENCE_ITEMS);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => key.length <= MAX_PREFERENCE_TEXT && typeof item === "string")
      .slice(0, MAX_PREFERENCE_ITEMS)
      .map(([key, item]) => [key, item.slice(0, MAX_PREFERENCE_TEXT)])
  );
}

function installmentRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) =>
        key.length <= MAX_PREFERENCE_TEXT &&
        typeof item === "number" &&
        Number.isInteger(item) &&
        item >= 2 &&
        item <= 120
      )
      .slice(0, MAX_PREFERENCE_ITEMS)
  );
}

export function normalizePreferences(body: Partial<BudgetPreferences>): BudgetPreferences {
  return { ...PREFS_DEFAULT, ...normalizePreferencesPatch(body) };
}

export function normalizePreferencesPatch(body: Partial<BudgetPreferences>): Partial<BudgetPreferences> {
  const patch: Partial<BudgetPreferences> = {};
  const threshold = Number(body.highAmountThreshold);
  const householdAge = Number(body.householdAge);
  const householdSize = Number(body.householdSize);
  const autoLogoutMinutes = Number(body.autoLogoutMinutes);

  if (body.sectionOverrides && typeof body.sectionOverrides === "object" && !Array.isArray(body.sectionOverrides)) {
    patch.sectionOverrides = stringRecord(body.sectionOverrides);
  }
  if (body.installmentOverrides && typeof body.installmentOverrides === "object" && !Array.isArray(body.installmentOverrides)) {
    patch.installmentOverrides = installmentRecord(body.installmentOverrides);
  }
  if (Array.isArray(body.oneTimeExpenses)) patch.oneTimeExpenses = stringArray(body.oneTimeExpenses);
  if (Array.isArray(body.fixedExpenses)) patch.fixedExpenses = stringArray(body.fixedExpenses);
  if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1_000_000_000) {
    patch.highAmountThreshold = threshold;
  }
  if (body.householdBirthDate === null) patch.householdBirthDate = null;
  else {
    const birthDate = validDate(body.householdBirthDate);
    if (birthDate) patch.householdBirthDate = birthDate;
  }
  if (body.householdAge === null) patch.householdAge = null;
  else if (Number.isInteger(householdAge) && householdAge > 0 && householdAge <= 130) patch.householdAge = householdAge;
  if (body.householdSize === null) patch.householdSize = null;
  else if (Number.isInteger(householdSize) && householdSize > 0 && householdSize <= 100) patch.householdSize = householdSize;
  if (Number.isInteger(autoLogoutMinutes) && autoLogoutMinutes >= 1 && autoLogoutMinutes <= 1_440) {
    patch.autoLogoutMinutes = autoLogoutMinutes;
  }
  if (body.theme === "light" || body.theme === "dark") patch.theme = body.theme;
  return patch;
}
