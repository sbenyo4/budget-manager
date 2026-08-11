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
const COMPACT_BRAND_MATCH_TOKENS = BRAND_MATCH_TOKENS.map((brand) =>
  brand
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
);
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

const COMPILED_DEFAULT_CATEGORY_RULES = DEFAULT_CATEGORY_RULES.map((rule) => ({
  category: rule.category,
  patterns: rule.patterns.map((pattern) => {
    const normalized = merchantFingerprint(pattern);
    return { normalized, compact: normalized.replace(/\s+/g, "") };
  }),
}));

const COMPILED_RECURRING_MERCHANT_PATTERNS = RECURRING_MERCHANT_PATTERNS.map((pattern) => {
  const normalized = merchantFingerprint(pattern);
  return { normalized, compact: normalized.replace(/\s+/g, "") };
});

function meaningfulMerchantTokens(merchant: string): string[] {
  return merchant
    .split(" ")
    .filter((token) => token.length >= 4 && !GENERIC_MERCHANT_TOKENS.has(token));
}

interface MerchantMatchFeatures {
  normalized: string;
  compact: string;
  tokens: string[];
  tokenSet: Set<string>;
  brands: string[];
  brandSet: Set<string>;
}

function merchantMatchFeatures(merchant: string): MerchantMatchFeatures {
  const normalized = merchantFingerprint(merchant);
  const compact = normalized.replace(/\s+/g, "");
  const tokens = meaningfulMerchantTokens(normalized);
  const brands = COMPACT_BRAND_MATCH_TOKENS.filter((brand) => compact.includes(brand));
  return {
    normalized,
    compact,
    tokens,
    tokenSet: new Set(tokens),
    brands,
    brandSet: new Set(brands),
  };
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
  return COMPILED_DEFAULT_CATEGORY_RULES.find((rule) =>
    rule.patterns.some(
      (pattern) => normalized.includes(pattern.normalized) || compact.includes(pattern.compact)
    )
  )?.category;
}

function isKnownRecurringMerchant(merchant: string): boolean {
  const normalized = merchantFingerprint(merchant);
  const compact = compactMerchantFingerprint(merchant);
  return COMPILED_RECURRING_MERCHANT_PATTERNS.some(
    (pattern) => normalized.includes(pattern.normalized) || compact.includes(pattern.compact)
  );
}

function isUsefulLearnedCategory(category: string): boolean {
  return Boolean(category) && category !== "OTHER" && category !== "INCOMES_EXPENSES";
}

function merchantSimilarityScore(a: MerchantMatchFeatures, b: MerchantMatchFeatures): number {
  if (!a.normalized || !b.normalized) return 0;
  if (a.normalized === b.normalized) return 100_000 + a.normalized.length;

  const brandScore = a.brands.reduce(
    (score, brand) => b.brandSet.has(brand) ? Math.max(score, 90_000 + brand.length) : score,
    0
  );
  if (brandScore) return brandScore;

  if (
    a.compact.length >= 5 &&
    b.compact.length >= 5 &&
    (a.compact.includes(b.compact) || b.compact.includes(a.compact))
  ) {
    return 80_000 + Math.min(a.compact.length, b.compact.length);
  }

  const sharedTokens = b.tokens.filter((token) => a.tokenSet.has(token));
  if (sharedTokens.length < 2) return 0;
  return sharedTokens.reduce((score, token) => score + token.length * token.length, 0);
}

type MerchantMatcher<T> = (merchant: string) => T | undefined;

function createMerchantMatcher<T extends { merchant: string }>(candidates: T[]): MerchantMatcher<T> {
  if (candidates.length === 0) return () => undefined;
  const prepared = candidates.map((candidate) => ({
    candidate,
    features: merchantMatchFeatures(candidate.merchant),
  }));
  return (merchant: string) => {
    const features = merchantMatchFeatures(merchant);
    let best: { candidate: T; score: number } | undefined;
    for (const entry of prepared) {
      const candidate = entry.candidate;
      const score = merchantSimilarityScore(features, entry.features);
      if (score <= 0) continue;
      if (
        !best ||
        score > best.score ||
        (score === best.score && candidate.merchant.length > best.candidate.merchant.length) ||
        (score === best.score &&
          candidate.merchant.length === best.candidate.merchant.length &&
          candidate.merchant.localeCompare(best.candidate.merchant, "he") < 0)
      ) {
        best = { candidate, score };
      }
    }
    return best?.candidate;
  };
}

function learnedCategoryForMerchant(
  merchant: string,
  learnedMatcher: MerchantMatcher<{ merchant: string; category: string; recurring: boolean }>
): { category?: string; recurring?: boolean } {
  const match = learnedMatcher(merchant);
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
  savedOverrideMatcher: MerchantMatcher<SavedOverride>
): string | undefined {
  const exact = normalizeCategoryKey(overrides[overrideKey("", merchant)] ?? "");
  if (exact) return exact;

  return savedOverrideMatcher(merchant)?.category;
}

function transactionAndDetails(tx: Transaction): Transaction[] {
  return [tx, ...(tx.detailTransactions ?? [])];
}

export function applyCategoryOverrides(transactions: Transaction[], overrides: SectionOverrides): Transaction[] {
  const savedOverrides = savedOverridesFor(overrides);
  const savedOverrideMatcher = createMerchantMatcher(savedOverrides);
  const savedCategoryCache = new Map<string, string | undefined>();
  const defaultCategoryCache = new Map<string, string | undefined>();
  const learnedByMerchant = new Map<string, { merchant: string; category: string; recurring: boolean }>();
  for (const tx of transactions.flatMap((transaction) => transactionAndDetails(transaction))) {
    const merchant = merchantKey(tx);
    const category =
      savedCategoryWithCache(merchant, overrides, savedOverrideMatcher, savedCategoryCache) ||
      defaultCategoryWithCache(merchant) ||
      normalizeCategoryKey(tx.categoryMain);
    if (!isUsefulLearnedCategory(category)) continue;
    const normalizedMerchant = merchantFingerprint(merchant);
    if (!learnedByMerchant.has(normalizedMerchant)) {
      learnedByMerchant.set(normalizedMerchant, {
        merchant: normalizedMerchant,
        category,
        recurring: Boolean(tx.recurring) || isKnownRecurringMerchant(merchant),
      });
    }
  }
  const learned = [...learnedByMerchant.values()];
  const learnedMatcher = createMerchantMatcher(learned);
  const learnedCache = new Map<string, { category?: string; recurring?: boolean }>();

  function savedCategoryWithCache(
    merchant: string,
    currentOverrides: SectionOverrides,
    currentSavedOverrideMatcher: MerchantMatcher<SavedOverride>,
    cache: Map<string, string | undefined>
  ): string | undefined {
    const normalized = merchantFingerprint(merchant);
    if (cache.has(normalized)) return cache.get(normalized);
    const category = savedCategoryForMerchant(merchant, currentOverrides, currentSavedOverrideMatcher);
    cache.set(normalized, category);
    return category;
  }

  function learnedCategoryWithCache(merchant: string) {
    const normalized = merchantFingerprint(merchant);
    const cached = learnedCache.get(normalized);
    if (cached) return cached;
    const exact = learnedByMerchant.get(normalized);
    const result = exact
      ? { category: exact.category, recurring: exact.recurring }
      : learnedCategoryForMerchant(merchant, learnedMatcher);
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
      savedCategoryWithCache(merchant, overrides, savedOverrideMatcher, savedCategoryCache) ||
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
