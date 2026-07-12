/** A single expense transaction, normalized from the open-finance.ai API. */
export interface Transaction {
  id: string;
  /** ISO date, e.g. "2026-07-05" */
  date: string;
  /** Merchant / payee name as it appears on the account */
  merchant: string;
  /** Amount in ILS, always positive; direction is in `type` */
  amount: number;
  /** Money in or out. Optional for demo data — undefined means expense. */
  type?: "income" | "expense";
  /** Where the transaction lives: the bank account (= account state, incl.
   *  aggregate card debits) or the credit card (= detail / future charges).
   *  Optional for demo data — undefined means bank. */
  source?: "bank" | "card";
  /** Main category from the open-finance.ai taxonomy, e.g. "FOOD_&_DRINKS" */
  categoryMain: string;
  /** Sub category from the taxonomy, e.g. "RESTAURANT" */
  categorySub: string;
  /** True when this is a known recurring charge (rent, subscription…) */
  recurring?: boolean;
}

export type Classification = "mandatory" | "discretionary";

export interface ClassifiedTransaction extends Transaction {
  classification: Classification;
  /** Human-readable reason for the classification (shown in tooltip/table) */
  reason: string;
}
