import type { Transaction } from "../../src/types";

const CATEGORIES = ["SHOPPING", "FOOD_&_DRINKS", "HOUSEHOLD_&_SERVICES", "TRANSPORT"];

function merchantName(index: number, variant = 0): string {
  const id = String(index).padStart(5, "0");
  if (variant === 1) return `Synthetic Merchant${id} Branch${index % 17}`;
  if (variant === 2) return `SYNTHETIC MERCHANT${id}`;
  if (variant === 3) return `Synthetic-Merchant${id}`;
  return `Synthetic Merchant${id}`;
}

function transaction(index: number, merchantCount: number, nested = false): Transaction {
  const merchantIndex = index % merchantCount;
  return {
    id: `${nested ? "detail" : "tx"}-${index}`,
    date: `2026-${String((index % 8) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
    billingDate: nested ? "2026-08-10" : undefined,
    merchant: merchantName(merchantIndex, index % 4),
    amount: 20 + (index % 480),
    status: "BOOKED",
    source: nested ? "card" : index % 5 === 0 ? "bank" : "card",
    type: "expense",
    categoryMain: CATEGORIES[index % CATEGORIES.length],
    categorySub: "USER_DEFINED",
    recurring: index % 23 === 0,
    cardLast4: nested ? String(5000 + (index % 4)) : undefined,
  };
}

export function anonymizedCategoryScenario(
  transactionCount: number,
  merchantCount: number,
  overrideCount: number
): { transactions: Transaction[]; overrides: Record<string, string> } {
  const transactions = Array.from({ length: transactionCount }, (_, index) => {
    const tx = transaction(index, merchantCount);
    if (index % 100 !== 0) return tx;
    const details = Array.from({ length: 4 }, (_, detailIndex) =>
      transaction(transactionCount + index * 4 + detailIndex, merchantCount, true)
    );
    return {
      ...tx,
      merchant: `Synthetic Card Debit ${index}`,
      source: "bank" as const,
      categoryMain: "INCOMES_EXPENSES",
      categorySub: "CREDIT_CARD_CHECKING",
      detailTransactions: details,
    };
  });
  const overrides = Object.fromEntries(
    Array.from({ length: overrideCount }, (_, index) => [
      merchantName(index % merchantCount),
      CATEGORIES[(index + 1) % CATEGORIES.length],
    ])
  );
  return { transactions, overrides };
}
