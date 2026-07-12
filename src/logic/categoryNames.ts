/** Hebrew labels for open-finance.ai main categories. */
export const MAIN_LABELS: Record<string, string> = {
  "HOUSEHOLD_&_SERVICES": "משק בית ושירותים",
  HOME_IMPROVEMENTS: "שיפוץ ועיצוב הבית",
  "FOOD_&_DRINKS": "אוכל ומשקאות",
  TRANSPORT: "תחבורה",
  SHOPPING: "קניות",
  LEISURE: "פנאי ובילויים",
  "HEALTH_&_BEAUTY": "בריאות ויופי",
  FINANCE: "פיננסי",
  OTHER: "אחר",
  INCOMES_EXPENSES: "בנקאות ועמלות",
  TRADING: "ניירות ערך",
  TRANSFER: "העברות",
  ASSETS: "פיקדונות והשקעות",
  RETURN: "החזרים וזיכויים",
  LOAN_TRANSACTION: "משכנתא והלוואות",
  DEPOSIT: "שיקים",
  SALARY: "משכורת",
  PENSION: "פנסיה",
  REIMBURSEMENTS: "החזרים",
  BENEFITS: "קצבאות",
};

/** Hebrew labels for sub-categories worth translating; rest fall back to raw. */
const SUB_LABELS: Record<string, string> = {
  CREDIT_CARD_CHECKING: "חיוב כרטיס אשראי",
  SECURITIES: "ניירות ערך",
  FOREIGN_EXCHANGE: "מט״ח",
  BANK_TRANSFER: "העברה בנקאית",
  SAVINGS: "פיקדון / חיסכון",
  INVESTMENTS: "העברה להשקעות",
  MORTGAGE: "משכנתא",
  CHQ_INCOME: "שיק",
  REFUND: "זיכוי",
};

export function mainLabel(main: string): string {
  return MAIN_LABELS[main] ?? main;
}

export function subLabel(sub: string): string {
  return SUB_LABELS[sub] ?? sub.replace(/_/g, " ").toLowerCase();
}

export function displaySubLabel(sub: string): string {
  if (!sub || sub === "USER_DEFINED" || sub === "UNCATEGORIZED") return "";
  return subLabel(sub);
}

/**
 * Fixed category → palette-slot assignment (color follows the entity, never
 * its rank — the same category keeps its color across periods and filters).
 * Expense mains and income mains are separate charts, so slots may repeat
 * between the two sets but are unique within each. Categories without a slot
 * (transfers, bank fees, home improvements…) share the neutral gray; their
 * identity is carried by the legend labels and the table.
 */
const CATEGORY_SLOTS: Record<string, number> = {
  // expense chart
  "HOUSEHOLD_&_SERVICES": 1,
  "FOOD_&_DRINKS": 2,
  TRANSPORT: 3,
  "HEALTH_&_BEAUTY": 4,
  SHOPPING: 5,
  LEISURE: 6,
  TRADING: 7,
  FINANCE: 8,
  // income chart
  SALARY: 1,
  ASSETS: 2,
  REIMBURSEMENTS: 3,
  BENEFITS: 4,
  PENSION: 5,
  RETURN: 6,
};

export function mainColor(main: string): string {
  const slot = CATEGORY_SLOTS[main];
  return slot ? `var(--cat-${slot})` : "var(--cat-other)";
}
