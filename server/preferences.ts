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

export function normalizePreferences(body: Partial<BudgetPreferences>): BudgetPreferences {
  const threshold = Number(body.highAmountThreshold);
  const householdAge = Number(body.householdAge);
  const householdSize = Number(body.householdSize);
  return {
    sectionOverrides: stringRecord(body.sectionOverrides),
    oneTimeExpenses: stringArray(body.oneTimeExpenses),
    fixedExpenses: stringArray(body.fixedExpenses),
    highAmountThreshold:
      Number.isFinite(threshold) && threshold >= 0 && threshold <= 1_000_000_000
        ? threshold
        : PREFS_DEFAULT.highAmountThreshold,
    householdBirthDate: validDate(body.householdBirthDate),
    householdAge: Number.isInteger(householdAge) && householdAge > 0 && householdAge <= 130 ? householdAge : null,
    householdSize: Number.isInteger(householdSize) && householdSize > 0 && householdSize <= 100 ? householdSize : null,
    theme: body.theme === "dark" ? "dark" : "light",
  };
}
