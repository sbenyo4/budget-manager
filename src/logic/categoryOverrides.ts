import type { Transaction } from "../types";
import { MAIN_LABELS, mainLabel, subLabel } from "./categoryNames";

export type SectionOverrides = Record<string, string>;

export const SECTION_OVERRIDES_KEY = "budget-manager:merchant-category-overrides-v2";
export const ONE_TIME_EXPENSES_KEY = "budget-manager:one-time-expenses-v1";
export const FIXED_EXPENSES_KEY = "budget-manager:fixed-expenses-v1";
export const CUSTOM_CATEGORY_PREFIX = "CUSTOM:";
const SUBSCRIPTIONS_CATEGORY = `${CUSTOM_CATEGORY_PREFIX}מינויים`;

export interface LegacyPreferences {
  sectionOverrides: SectionOverrides;
  oneTimeExpenses: string[];
  fixedExpenses: string[];
}

export const DEFAULT_CATEGORY_RULES: Array<{ category: string; patterns: string[] }> = [
  {
    category: SUBSCRIPTIONS_CATEGORY,
    patterns: [
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
    ],
  },
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
    patterns: ["מפעל הפיס", "סינמה", "מלון", "hotel", "vacation"],
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

const BRAND_MATCH_TOKENS = ["spotify", "ספוטיפיי", "netflix", "נטפליקס", "openai", "chatgpt", "icloud"];
const GENERIC_MERCHANT_TOKENS = new Set([
  "paypal",
  "paybox",
  "bit",
  "visa",
  "max",
  "cal",
  "isracard",
  "mastercard",
  "amex",
]);

export function loadSectionOverrides(): SectionOverrides {
  return {};
}

export function loadOneTimeExpenses(): Set<string> {
  return new Set();
}

export function loadFixedExpenses(): Set<string> {
  return new Set();
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

function meaningfulMerchantTokens(merchant: string): string[] {
  return merchant
    .split(" ")
    .filter((token) => token.length >= 4 && !GENERIC_MERCHANT_TOKENS.has(token));
}

function canonicalCategoryKey(labelOrKey: string): string | undefined {
  const normalized = labelOrKey.trim().toLowerCase();
  if (!normalized) return undefined;
  if (MAIN_LABELS[labelOrKey]) return labelOrKey;

  return Object.entries(MAIN_LABELS).find(
    ([key, label]) => key.toLowerCase() === normalized || label.trim().toLowerCase() === normalized
  )?.[0];
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

function merchantSimilarityScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100_000 + a.length;

  const compactA = a.replace(/\s+/g, "");
  const compactB = b.replace(/\s+/g, "");
  const brandScore = BRAND_MATCH_TOKENS.reduce((score, brand) => {
      const compactBrand = compactMerchantFingerprint(brand);
      return compactA.includes(compactBrand) && compactB.includes(compactBrand)
        ? Math.max(score, 90_000 + compactBrand.length)
        : score;
    }, 0);
  if (brandScore) return brandScore;

  if (compactA.length >= 5 && compactB.length >= 5 && (compactA.includes(compactB) || compactB.includes(compactA))) {
    return 80_000 + Math.min(compactA.length, compactB.length);
  }

  const tokensA = new Set(meaningfulMerchantTokens(a));
  const tokensB = meaningfulMerchantTokens(b);
  return tokensB.reduce((score, token) => score + (tokensA.has(token) ? token.length * token.length : 0), 0);
}

function bestMerchantMatch<T extends { merchant: string }>(merchant: string, candidates: T[]): T | undefined {
  return candidates
    .map((candidate) => ({ candidate, score: merchantSimilarityScore(merchant, candidate.merchant) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.candidate.merchant.length - a.candidate.merchant.length ||
        a.candidate.merchant.localeCompare(b.candidate.merchant, "he")
    )[0]?.candidate;
}

function learnedCategoryForMerchant(
  merchant: string,
  learned: Array<{ merchant: string; category: string; recurring: boolean }>
): { category?: string; recurring?: boolean } {
  const normalized = merchantFingerprint(merchant);
  const match = bestMerchantMatch(normalized, learned);
  return match ? { category: match.category, recurring: match.recurring } : {};
}

interface SavedOverride {
  merchant: string;
  category: string;
}

function savedOverridesFor(overrides: SectionOverrides): SavedOverride[] {
  return Object.entries(overrides).flatMap(([key, category]) => {
    if (key.startsWith("section:") || key.includes("::")) return [];
    const normalizedCategory = normalizeCategoryKey(category);
    return normalizedCategory ? [{ merchant: merchantFingerprint(key), category: normalizedCategory }] : [];
  });
}

function savedCategoryForMerchant(
  merchant: string,
  overrides: SectionOverrides,
  savedOverrides: SavedOverride[]
): string | undefined {
  const exact = normalizeCategoryKey(overrides[overrideKey("", merchant)] ?? "");
  if (exact) return exact;

  const normalized = merchantFingerprint(merchant);
  return bestMerchantMatch(normalized, savedOverrides)?.category;
}

function transactionAndDetails(tx: Transaction): Transaction[] {
  return [tx, ...(tx.detailTransactions ?? [])];
}

export function applyCategoryOverrides(transactions: Transaction[], overrides: SectionOverrides): Transaction[] {
  const savedOverrides = savedOverridesFor(overrides);
  const savedCategoryCache = new Map<string, string | undefined>();
  const defaultCategoryCache = new Map<string, string | undefined>();
  const learned = transactions.flatMap((tx) => transactionAndDetails(tx)).flatMap((tx) => {
    const merchant = merchantKey(tx);
    const category =
      savedCategoryWithCache(merchant, overrides, savedOverrides, savedCategoryCache) ||
      defaultCategoryWithCache(merchant) ||
      normalizeCategoryKey(tx.categoryMain);
    return isUsefulLearnedCategory(category)
      ? [{ merchant: merchantFingerprint(merchant), category, recurring: Boolean(tx.recurring) || isKnownRecurringMerchant(merchant) }]
      : [];
  });
  const learnedCache = new Map<string, { category?: string; recurring?: boolean }>();

  function savedCategoryWithCache(
    merchant: string,
    currentOverrides: SectionOverrides,
    currentSavedOverrides: SavedOverride[],
    cache: Map<string, string | undefined>
  ): string | undefined {
    const normalized = merchantFingerprint(merchant);
    if (cache.has(normalized)) return cache.get(normalized);
    const category = savedCategoryForMerchant(merchant, currentOverrides, currentSavedOverrides);
    cache.set(normalized, category);
    return category;
  }

  function learnedCategoryWithCache(merchant: string) {
    const normalized = merchantFingerprint(merchant);
    const cached = learnedCache.get(normalized);
    if (cached) return cached;
    const result = learnedCategoryForMerchant(merchant, learned);
    learnedCache.set(normalized, result);
    return result;
  }

  function defaultCategoryWithCache(merchant: string): string | undefined {
    const normalized = merchantFingerprint(merchant);
    if (defaultCategoryCache.has(normalized)) return defaultCategoryCache.get(normalized);
    const category = defaultCategoryForMerchant(merchant);
    defaultCategoryCache.set(normalized, category);
    return category;
  }

  const applyToTransaction = (tx: Transaction): Transaction => {
    const merchant = merchantKey(tx);
    const learnedMatch = learnedCategoryWithCache(merchant);
    const target =
      savedCategoryWithCache(merchant, overrides, savedOverrides, savedCategoryCache) ||
      defaultCategoryWithCache(merchant) ||
      learnedMatch.category;
    const recurring = tx.recurring || isKnownRecurringMerchant(merchant) || learnedMatch.recurring;
    const detailTransactions = tx.detailTransactions?.map(applyToTransaction);
    if (!target && !recurring && !detailTransactions) return tx;
    return {
      ...tx,
      ...(target ? { categoryMain: target, categorySub: "USER_DEFINED" } : {}),
      ...(recurring ? { recurring: true } : {}),
      ...(detailTransactions ? { detailTransactions } : {}),
    };
  };

  return transactions.map(applyToTransaction);
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
