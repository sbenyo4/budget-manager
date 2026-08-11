export interface CategoryOverrideInput {
  merchant: string;
  category: string | null;
}

export function normalizeCategoryOverrideInput(body: unknown): CategoryOverrideInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const candidate = body as { merchant?: unknown; category?: unknown };
  if (typeof candidate.merchant !== "string") return null;
  const merchant = candidate.merchant.trim();
  if (!merchant || merchant.length > 300) return null;
  if (candidate.category === null) return { merchant, category: null };
  if (typeof candidate.category !== "string") return null;
  const category = candidate.category.trim();
  return category && category.length <= 300 ? { merchant, category } : null;
}
