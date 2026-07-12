import type { Classification, ClassifiedTransaction, Transaction } from "../types";

/**
 * Classification rules over the open-finance.ai category taxonomy
 * (https://docs.open-finance.ai/docs/transaction-categories).
 *
 * Sub-category rules win over main-category rules; merchant overrides win
 * over both. Anything unmatched is flagged discretionary-for-review — the
 * safe default in a no-buy challenge.
 */

/** "MAIN/SUB" → Hebrew reason. Checked before the main-level rules. */
const MANDATORY_SUBS = new Map<string, string>([
  ["HOUSEHOLD_&_SERVICES/RENT", "שכר דירה"],
  ["HOUSEHOLD_&_SERVICES/MORTGAGE", "משכנתא"],
  ["HOUSEHOLD_&_SERVICES/COMMUNICATIONS", "תקשורת — סלולר / אינטרנט"],
  ["HOUSEHOLD_&_SERVICES/UTILITIES", "חשבונות — חשמל / מים / גז"],
  ["HOUSEHOLD_&_SERVICES/INSURANCE_&_FEES", "ביטוח ואגרות"],
  ["HOUSEHOLD_&_SERVICES/SERVICES", "שירותים לבית"],
  ["HOUSEHOLD_&_SERVICES/HOME", "אחזקת בית"],
  ["HOUSEHOLD_&_SERVICES/HOUSEHOLD_&_SERVICES_OTHER", "משק בית"],
  ["HOME_IMPROVEMENTS/RENOVATION_&_REPAIRS", "תיקונים הכרחיים"],
  ["FOOD_&_DRINKS/GROCERIES", "מזון בסיסי — סופרמרקט"],
  ["TRANSPORT/CAR_&_FUEL", "רכב ודלק"],
  ["TRANSPORT/PUBLIC_TRANSPORT", "תחבורה ציבורית"],
  ["HEALTH_&_BEAUTY/HEALTHCARE", "בריאות"],
  ["HEALTH_&_BEAUTY/PHARMACY", "בית מרקחת"],
  ["HEALTH_&_BEAUTY/EYECARE", "אופטיקה"],
  ["OTHER/KIDS", "ילדים"],
  ["OTHER/EDUCATION", "חינוך"],
  ["OTHER/PETS", "חיות מחמד"],
  ["OTHER/CHARITY", "תרומות"],
  ["OTHER/BUSINESS_EXPENSES", "הוצאות עסק"],
  // Observed in real data, not in the documented taxonomy:
  ["OTHER/GOVERNMENT SERVICES", "שירותים עירוניים / ממשלתיים"],
  ["INCOMES_EXPENSES/OTHER", "עמלות בנק"],
]);

const DISCRETIONARY_SUBS = new Map<string, string>([
  ["FOOD_&_DRINKS/RESTAURANT", "מסעדות ומשלוחים"],
  ["FOOD_&_DRINKS/COFFEE_&_SNACKS", "קפה ונשנושים"],
  ["FOOD_&_DRINKS/ALCOHOL_&_TOBACCO", "אלכוהול וטבק"],
  ["FOOD_&_DRINKS/BARS", "ברים"],
  ["FOOD_&_DRINKS/FOOD_&_DRINKS_OTHER", "אוכל בחוץ — אחר"],
  ["HOME_IMPROVEMENTS/FURNITURE_&_INTERIOR", "ריהוט ועיצוב"],
  ["HOME_IMPROVEMENTS/GARDEN", "גינה"],
  ["HOME_IMPROVEMENTS/HOME_IMPROVEMENTS_OTHER", "שיפוצים — לא דחוף"],
  ["TRANSPORT/FLIGHTS", "טיסות"],
  ["TRANSPORT/TAXI", "מוניות"],
  ["TRANSPORT/TRANSPORT_OTHER", "מוניות ותחבורה אחרת"],
  ["HEALTH_&_BEAUTY/BEAUTY", "טיפוח ויופי"],
  ["OTHER/CASH_WITHDRAWALS", "משיכת מזומן — לבדיקה"],
]);

/** Main-category fallback when no sub-level rule matched. */
const MAIN_RULES = new Map<string, { classification: Classification; reason: string }>([
  ["HOUSEHOLD_&_SERVICES", { classification: "mandatory", reason: "משק בית ושירותים" }],
  ["FINANCE", { classification: "mandatory", reason: "פיננסי — עמלות / הלוואות / חיסכון" }],
  ["LOAN_TRANSACTION", { classification: "mandatory", reason: "משכנתא / החזר הלוואה" }],
  ["SHOPPING", { classification: "discretionary", reason: "קניות" }],
  ["LEISURE", { classification: "discretionary", reason: "פנאי ובילויים" }],
]);

/**
 * Merchant-level overrides win over the category — e.g. a "groceries" charge
 * at a convenience store at midnight is still discretionary snacking.
 */
const MERCHANT_OVERRIDES: Array<{
  match: RegExp;
  classification: Classification;
  reason: string;
}> = [
  { match: /סופר.?פארם|בית מרקחת|pharm/i, classification: "mandatory", reason: "בית מרקחת — בריאות" },
  // Butchers/fishmongers get miscategorized as COFFEE_&_SNACKS by the provider
  { match: /חנות בשר|בשרים|קצבי|דגים|ירקות|מעדני/, classification: "mandatory", reason: "מזון בסיסי — בשר / דגים / ירקות" },
  { match: /am:?pm|אי.?אם.?פי.?אם|יומנגס|קיוסק/i, classification: "discretionary", reason: "נשנושים — לא קניית מזון בסיסית" },
];

export function classify(tx: Transaction): ClassifiedTransaction {
  for (const override of MERCHANT_OVERRIDES) {
    if (override.match.test(tx.merchant)) {
      return { ...tx, classification: override.classification, reason: override.reason };
    }
  }

  const key = `${tx.categoryMain}/${tx.categorySub}`;
  const mandatoryReason = MANDATORY_SUBS.get(key);
  if (mandatoryReason) {
    return { ...tx, classification: "mandatory", reason: mandatoryReason };
  }
  const discretionaryReason = DISCRETIONARY_SUBS.get(key);
  if (discretionaryReason) {
    return { ...tx, classification: "discretionary", reason: discretionaryReason };
  }

  const mainRule = MAIN_RULES.get(tx.categoryMain);
  if (mainRule) {
    return { ...tx, ...mainRule };
  }

  return {
    ...tx,
    classification: "discretionary",
    reason: `לא מסווג (${tx.categoryMain}/${tx.categorySub}) — לבדיקה`,
  };
}

export function classifyAll(txs: Transaction[]): ClassifiedTransaction[] {
  return txs.map(classify);
}
