import type { Transaction } from "../types";
import { MAIN_LABELS, mainLabel, subLabel } from "./categoryNames";

export type SectionOverrides = Record<string, string>;

export const SECTION_OVERRIDES_KEY = "budget-manager:merchant-category-overrides-v2";
export const ONE_TIME_EXPENSES_KEY = "budget-manager:one-time-expenses-v1";
export const FIXED_EXPENSES_KEY = "budget-manager:fixed-expenses-v1";
export const CUSTOM_CATEGORY_PREFIX = "CUSTOM:";

export interface LegacyPreferences {
  sectionOverrides: SectionOverrides;
  oneTimeExpenses: string[];
  fixedExpenses: string[];
}

export const DEFAULT_CATEGORY_RULES: Array<{ category: string; patterns: string[] }> = [
  {
    category: "HOUSEHOLD_&_SERVICES",
    patterns: [
      "חשמל",
      "מים",
      "מי אביבים",
      "ארנונה",
      "עיריית",
      "גז",
      "פז גז",
      "בזק",
      "פרטנר",
      "סלקום",
      "הוט",
      "נטפליקס",
      "netflix",
      "ועד בית",
      "דירה",
    ],
  },
  {
    category: "HEALTH_&_BEAUTY",
    patterns: [
      "בריאות",
      "קופת חולים",
      "כללית",
      "מכבי",
      "מאוחדת",
      "לאומית",
      "סופר פארם",
      "דראגסטורס",
      "pharm",
      "הראל-ביטוח בריאות",
      "ביטוח בריאות",
    ],
  },
  {
    category: "TRANSPORT",
    patterns: [
      "דלק",
      "פז",
      "סונול",
      "פנגו",
      "gett",
      "מוניות",
      "רכב",
      "מוטורס",
      "מוסך",
      "תחבורה",
      "ר.רכב",
      "חניונים",
      "לימוזין",
    ],
  },
  {
    category: "FOOD_&_DRINKS",
    patterns: [
      "שופרסל",
      "רמי לוי",
      "טיב טעם",
      "ויקטורי",
      "יוחננוף",
      "am:pm",
      "אי.אם.פי.אם",
      "רד  מרקט",
      "קפה",
      "מסעד",
      "פלאפל",
      "סמבוסביח",
      "wolt",
      "וולט",
      "סופר",
    ],
  },
  {
    category: "LEISURE",
    patterns: ["spotify", "ספוטיפיי", "מפעל הפיס", "סינמה", "מלון", "hotel", "vacation"],
  },
  {
    category: "SHOPPING",
    patterns: ["google", "openai", "chatgpt", "אייבורי", "מטריקס", "amazon", "זארה", "ikea", "איקאה"],
  },
  {
    category: "LOAN_TRANSACTION",
    patterns: ["משכנתא"],
  },
  {
    category: "TRADING",
    patterns: ["ני”ע", "ני\"ע", "ניירות", "דיבידנד"],
  },
];

const RECURRING_MERCHANT_PATTERNS = [
  "spotify",
  "ספוטיפיי",
  "netflix",
  "נטפליקס",
  "youtube premium",
  "יוטיוב פרימיום",
  "icloud",
  "apple.com/bill",
  "openai",
  "chatgpt",
];

export function loadSectionOverrides(): SectionOverrides {
  try {
    const raw = window.localStorage.getItem(SECTION_OVERRIDES_KEY);
    return raw ? normalizeSectionOverrides(JSON.parse(raw) as SectionOverrides) : {};
  } catch {
    return {};
  }
}

export function loadOneTimeExpenses(): Set<string> {
  try {
    const raw = window.localStorage.getItem(ONE_TIME_EXPENSES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function loadFixedExpenses(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FIXED_EXPENSES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function readLegacyPreferences(): LegacyPreferences {
  return {
    sectionOverrides: loadSectionOverrides(),
    oneTimeExpenses: [...loadOneTimeExpenses()],
    fixedExpenses: [...loadFixedExpenses()],
  };
}

export function hasLegacyPreferences(preferences: LegacyPreferences): boolean {
  return (
    Object.keys(preferences.sectionOverrides).length > 0 ||
    preferences.oneTimeExpenses.length > 0 ||
    preferences.fixedExpenses.length > 0
  );
}

export function merchantKey(tx: Transaction): string {
  return (tx.merchant || subLabel(tx.categorySub)).trim().replace(/\s+/g, " ");
}

export function overrideKey(_category: string, merchant: string): string {
  return merchant;
}

export function customCategoryKey(label: string): string {
  const canonical = canonicalCategoryKey(label);
  return canonical ?? `${CUSTOM_CATEGORY_PREFIX}${label}`;
}

export function categoryLabel(category: string): string {
  const normalized = normalizeCategoryKey(category);
  return normalized.startsWith(CUSTOM_CATEGORY_PREFIX)
    ? normalized.slice(CUSTOM_CATEGORY_PREFIX.length)
    : mainLabel(normalized);
}

export function normalizeCategoryKey(category: string): string {
  if (!category) return category;
  if (MAIN_LABELS[category]) return category;

  const customLabel = category.startsWith(CUSTOM_CATEGORY_PREFIX)
    ? category.slice(CUSTOM_CATEGORY_PREFIX.length)
    : category;
  return canonicalCategoryKey(customLabel) ?? category;
}

function merchantFingerprint(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactMerchantFingerprint(merchant: string): string {
  return merchantFingerprint(merchant).replace(/\s+/g, "");
}

function canonicalCategoryKey(labelOrKey: string): string | undefined {
  const normalized = labelOrKey.trim().toLowerCase();
  if (!normalized) return undefined;
  if (MAIN_LABELS[labelOrKey]) return labelOrKey;

  return Object.entries(MAIN_LABELS).find(
    ([key, label]) => key.toLowerCase() === normalized || label.trim().toLowerCase() === normalized
  )?.[0];
}

function normalizeSectionOverrides(overrides: SectionOverrides): SectionOverrides {
  return Object.fromEntries(
    Object.entries(overrides).map(([key, value]) => [key, normalizeCategoryKey(value)])
  );
}

export function defaultCategoryForMerchant(merchant: string): string | undefined {
  const normalized = merchantFingerprint(merchant);
  const compact = compactMerchantFingerprint(merchant);
  return DEFAULT_CATEGORY_RULES.find((rule) =>
    rule.patterns.some((pattern) => {
      const normalizedPattern = merchantFingerprint(pattern);
      const compactPattern = compactMerchantFingerprint(pattern);
      return normalized.includes(normalizedPattern) || compact.includes(compactPattern);
    })
  )?.category;
}

function isKnownRecurringMerchant(merchant: string): boolean {
  const normalized = merchantFingerprint(merchant);
  const compact = compactMerchantFingerprint(merchant);
  return RECURRING_MERCHANT_PATTERNS.some((pattern) => {
    const normalizedPattern = merchantFingerprint(pattern);
    const compactPattern = compactMerchantFingerprint(pattern);
    return normalized.includes(normalizedPattern) || compact.includes(compactPattern);
  });
}

function isUsefulLearnedCategory(category: string): boolean {
  return Boolean(category) && category !== "OTHER" && category !== "INCOMES_EXPENSES";
}

function merchantsLookSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const compactA = a.replace(/\s+/g, "");
  const compactB = b.replace(/\s+/g, "");
  if (compactA.length >= 5 && compactB.length >= 5 && (compactA.includes(compactB) || compactB.includes(compactA))) {
    return true;
  }

  const tokensA = new Set(a.split(" ").filter((token) => token.length >= 4));
  const tokensB = b.split(" ").filter((token) => token.length >= 4);
  return tokensB.some((token) => tokensA.has(token));
}

function learnedCategoryForMerchant(
  merchant: string,
  learned: Array<{ merchant: string; category: string; recurring: boolean }>
): { category?: string; recurring?: boolean } {
  const normalized = merchantFingerprint(merchant);
  const match = learned.find((candidate) => merchantsLookSimilar(normalized, candidate.merchant));
  return match ? { category: match.category, recurring: match.recurring } : {};
}

export function applyCategoryOverrides(transactions: Transaction[], overrides: SectionOverrides): Transaction[] {
  const learned = transactions.flatMap((tx) => {
    const merchant = merchantKey(tx);
    const category =
      normalizeCategoryKey(overrides[overrideKey(tx.categoryMain, merchant)] ?? "") ||
      defaultCategoryForMerchant(merchant) ||
      normalizeCategoryKey(tx.categoryMain);
    return isUsefulLearnedCategory(category)
      ? [{ merchant: merchantFingerprint(merchant), category, recurring: Boolean(tx.recurring) || isKnownRecurringMerchant(merchant) }]
      : [];
  });

  return transactions.map((tx) => {
    const merchant = merchantKey(tx);
    const learnedMatch = learnedCategoryForMerchant(merchant, learned);
    const target =
      normalizeCategoryKey(overrides[overrideKey(tx.categoryMain, merchant)] ?? "") ||
      defaultCategoryForMerchant(merchant) ||
      learnedMatch.category;
    const recurring = tx.recurring || isKnownRecurringMerchant(merchant) || learnedMatch.recurring;
    if (!target && !recurring) return tx;
    return {
      ...tx,
      ...(target ? { categoryMain: target, categorySub: "USER_DEFINED" } : {}),
      ...(recurring ? { recurring: true } : {}),
    };
  });
}

export function categoryChoices(categories: string[], overrides: SectionOverrides) {
  const unique = [
    ...new Set(
      [
      ...Object.keys(MAIN_LABELS),
      ...categories,
      ...Object.values(overrides),
      ...DEFAULT_CATEGORY_RULES.map((rule) => rule.category),
      ].map(normalizeCategoryKey)
    ),
  ];

  return unique
    .map((key) => ({ value: key, label: categoryLabel(key) }))
    .sort((a, b) => a.label.localeCompare(b.label, "he"));
}
