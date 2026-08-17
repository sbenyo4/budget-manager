import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOpenFinanceTransaction,
  normalizeOpenFinanceTransactions,
  type RawTransaction,
} from "../server/openFinance.ts";
import {
  dedupeCardProviderAliasTransactions,
  dedupePendingInvestmentTransactions,
} from "../src/api/openFinance.ts";
import { cardDebitCutoffs } from "../src/logic/flows.ts";
import { selectPendingCardTransactions } from "../src/logic/pendingBilling.ts";
import type { Transaction } from "../src/types.ts";

function baseCardTransaction(overrides: Partial<RawTransaction> = {}): RawTransaction {
  return {
    id: "tx-1",
    date: { transactionDate: "2026-07-19", valueDate: "2026-08-16" },
    amount: {
      originalAmount: { amount: -1300, currency: "ILS" },
      chargedAmount: { amount: -1300, currency: "ILS" },
    },
    merchantName: "מפעלי ע.שנפ ושות' בע\"מ",
    category: { main: "TRANSPORT", sub: "CAR_&_FUEL" },
    status: "PENDING",
    ...overrides,
  };
}

test("marks provider details=תשלומים as an installment whose monthly amount is pending", () => {
  const normalized = normalizeOpenFinanceTransaction(
    baseCardTransaction({ details: "תשלומים", isCreditCardInstallment: false }),
    0,
    "card"
  );

  assert.deepEqual(normalized.installment, { monthlyAmountPending: true });
  assert.equal(normalized.originalAmount, 1300);
  assert.equal(normalized.amount, 1300);
  assert.equal(normalized.billingDate, "2026-08-16");
});

test("keeps a provider-supplied installment amount and position", () => {
  const normalized = normalizeOpenFinanceTransaction(
    baseCardTransaction({
      amount: { originalAmount: { amount: -1300, currency: "ILS" } },
      installments: { number: 1, total: 4 },
      isCreditCardInstallment: true,
    }),
    0,
    "card"
  );

  assert.deepEqual(normalized.installment, { number: 1, total: 4 });
  assert.equal(normalized.amount, 325);
  assert.equal(normalized.originalAmount, 1300);
});

test("exposes only recognized merchant contact fields from provider metadata", () => {
  const normalized = normalizeOpenFinanceTransaction(
    baseCardTransaction({
      description: {
        description: "merchant charge",
        additionalInfo: JSON.stringify({
          merchant: {
            businessAddress: "1 Rothschild Blvd, Tel Aviv",
            phoneNumber: "+972-3-555-0101",
            email: "service@example.com",
            websiteUrl: "https://example.com",
          },
          accountNo: "must-not-be-exposed",
        }),
      },
    }),
    0,
    "card"
  );

  assert.deepEqual(normalized.merchantDetails, {
    address: "1 Rothschild Blvd, Tel Aviv",
    phone: "+972-3-555-0101",
    email: "service@example.com",
    website: "https://example.com",
    source: "open_finance",
  });
  assert.equal(JSON.stringify(normalized).includes("must-not-be-exposed"), false);
});

test("maps the documented structured merchantAddress returned by Open Finance", () => {
  const normalized = normalizeOpenFinanceTransaction(
    baseCardTransaction({
      merchantAddress: {
        streetName: "רוטשילד",
        buildingNumber: "1",
        townName: "תל אביב-יפו",
        postCode: "6688101",
        country: "IL",
      },
    }),
    0,
    "card"
  );

  assert.deepEqual(normalized.merchantDetails, {
    address: "רוטשילד 1, תל אביב-יפו",
    source: "open_finance",
  });
});

test("accepts the numeric postCode/buildingNumber shapes the live API returns", () => {
  const normalized = normalizeOpenFinanceTransaction(
    baseCardTransaction({
      merchantAddress: {
        streetName: "דרך השלום",
        buildingNumber: 10,
        townName: "תל אביב - יפ",
        postCode: 6789212,
        country: "IL",
      },
    }),
    0,
    "card"
  );

  assert.equal(normalized.merchantDetails?.address, "דרך השלום 10, תל אביב - יפ");
});

test("does not repeat a building number already present in the street name", () => {
  const normalized = normalizeOpenFinanceTransaction(
    baseCardTransaction({
      merchantAddress: {
        streetName: "רובינשטיין יצחק 20",
        buildingNumber: "20",
        townName: "תל אביב - יפו",
        postCode: 6821241,
        country: "IL",
      },
    }),
    0,
    "card"
  );

  assert.equal(normalized.merchantDetails?.address, "רובינשטיין יצחק 20, תל אביב - יפו");
});

test("keeps a foreign country but drops the ZZ unknown-country placeholder", () => {
  const foreign = normalizeOpenFinanceTransaction(
    baseCardTransaction({ merchantAddress: { townName: "MADRID", country: "ES" } }),
    0,
    "card"
  );
  const unknown = normalizeOpenFinanceTransaction(
    baseCardTransaction({ merchantAddress: { townName: "STOCKHOLM    ", country: "ZZ" } }),
    0,
    "card"
  );

  assert.equal(foreign.merchantDetails?.address, "MADRID, ES");
  assert.equal(unknown.merchantDetails?.address, "STOCKHOLM");
});

test("exposes the provider charge reference for disputing a transaction", () => {
  const normalized = normalizeOpenFinanceTransaction(
    baseCardTransaction({ transactionProviderIdentifier: "100826891103958" }),
    0,
    "card"
  );

  assert.equal(normalized.providerReference, "100826891103958");
});

function pendingInvestment(id: string, amount: number): RawTransaction {
  return {
    id,
    providerId: "hapoalim",
    accountNumber: "checking-account",
    date: { valueDate: "2026-08-06" },
    amount: {
      originalAmount: { amount: -amount, currency: "ILS" },
      chargedAmount: { amount: -amount, currency: "ILS" },
    },
    description: {
      description: "ני”ע-קניה",
      additionalInfo: JSON.stringify({
        accountNo: "account-1",
        pendingEventDate: "2026-08-05",
        transactionDescription: "ני”ע-קניה",
      }),
    },
    status: "PENDING",
    category: { main: "INCOMES_EXPENSES", sub: "OTHER" },
  };
}

test("keeps only the fee-inclusive pending securities debit returned by Hapoalim", () => {
  const normalized = normalizeOpenFinanceTransactions([
    pendingInvestment("principal", 21_999),
    pendingInvestment("with-fee", 22_001.11),
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "bank:with-fee");
  assert.equal(normalized[0].amount, 22_001.11);
});

test("does not merge distinct pending securities purchases", () => {
  const normalized = normalizeOpenFinanceTransactions([
    pendingInvestment("first", 10_000),
    pendingInvestment("second", 12_000),
  ]);

  assert.equal(normalized.length, 2);
});

test("merges two card records when one is missing the billing date", () => {
  const normalized = normalizeOpenFinanceTransactions([], [
    baseCardTransaction({
      id: "incomplete-copy",
      date: { transactionDate: "2026-07-19" },
    }),
    baseCardTransaction({ id: "dated-copy", status: "BOOKED" }),
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "card:dated-copy");
  assert.equal(normalized[0].billingDate, "2026-08-16");
});

test("keeps distinct fully reported card records with different provider IDs", () => {
  const normalized = normalizeOpenFinanceTransactions([], [
    baseCardTransaction({ id: "first-purchase", providerId: "provider-a" }),
    baseCardTransaction({
      id: "second-purchase",
      providerId: "provider-b",
      category: { main: "SHOPPING", sub: "SHOPPING_OTHER" },
      status: "BOOKED",
    }),
  ]);

  assert.deepEqual(
    normalized.map((transaction) => transaction.id),
    ["card:first-purchase", "card:second-purchase"]
  );
});

test("merges the Brand duplicate when one merchant name has the provider suffix", () => {
  const amount = {
    originalAmount: { amount: -59, currency: "ILS" },
    chargedAmount: { amount: -59, currency: "ILS" },
  };
  const date = { transactionDate: "2026-08-09", valueDate: "2026-08-16" };
  const normalized = normalizeOpenFinanceTransactions([], [
    baseCardTransaction({
      id: "brand-with-suffix",
      accountNumber: "9699",
      date,
      amount,
      merchantName: 'בראנד אספקה טכנית בע"מ-צמ',
      status: "BOOKED",
    }),
    baseCardTransaction({
      id: "brand-clean",
      accountNumber: "9699",
      date: { transactionDate: "2026-08-09" },
      amount,
      merchantName: 'בראנד אספקה טכנית בע"מ',
      status: "PENDING",
    }),
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "card:brand-with-suffix");
  assert.equal(normalized[0].merchant, 'בראנד אספקה טכנית בע"מ-צמ');
  assert.equal(normalized.reduce((total, tx) => total + tx.amount, 0), 59);

  const pending = selectPendingCardTransactions(normalized, cardDebitCutoffs(normalized), "9699");
  assert.equal(pending.length, 1);
  assert.equal(pending.reduce((total, tx) => total + tx.amount, 0), 59);
});

test("client fallback also removes the Brand provider alias before rendering", () => {
  const transaction = (
    id: string,
    merchant: string,
    status: string,
    billingDate?: string
  ): Transaction => ({
    id,
    source: "card",
    cardLast4: "9699",
    date: "2026-08-09",
    ...(billingDate ? { billingDate } : {}),
    merchant,
    amount: 59,
    status,
    type: "expense",
    categoryMain: "SHOPPING",
    categorySub: "SHOPPING_OTHER",
  });

  const transactions = dedupeCardProviderAliasTransactions([
    transaction("card:brand-with-suffix", 'בראנד אספקה טכנית בע"מ-צמ', "BOOKED", "2026-08-16"),
    transaction("card:brand-clean", 'בראנד אספקה טכנית בע"מ', "PENDING"),
  ]);

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].id, "card:brand-with-suffix");
  assert.equal(transactions.reduce((total, tx) => total + tx.amount, 0), 59);
});

test("client fallback keeps two legitimate identical booked card purchases", () => {
  const transaction = (id: string): Transaction => ({
    id,
    source: "card",
    cardLast4: "9699",
    date: "2026-08-09",
    billingDate: "2026-08-16",
    merchant: "Same merchant",
    amount: 59,
    status: "BOOKED",
    type: "expense",
    categoryMain: "SHOPPING",
    categorySub: "SHOPPING_OTHER",
  });

  const transactions = dedupeCardProviderAliasTransactions([
    transaction("card:first"),
    transaction("card:second"),
  ]);

  assert.deepEqual(transactions.map(({ id }) => id), ["card:first", "card:second"]);
  assert.equal(transactions.reduce((total, tx) => total + tx.amount, 0), 118);
});

test("keeps similar card purchases when their amounts differ", () => {
  const normalized = normalizeOpenFinanceTransactions([], [
    baseCardTransaction({ id: "first-purchase" }),
    baseCardTransaction({
      id: "second-purchase",
      amount: {
        originalAmount: { amount: -1301, currency: "ILS" },
        chargedAmount: { amount: -1301, currency: "ILS" },
      },
    }),
  ]);

  assert.deepEqual(normalized.map((tx) => tx.id), ["card:first-purchase", "card:second-purchase"]);
});

test("deduplicates card purchases before attaching them to a bank debit", () => {
  const debit: RawTransaction = {
    id: "debit-1",
    date: { transactionDate: "2026-08-16" },
    amount: {
      originalAmount: { amount: -1300, currency: "ILS" },
      chargedAmount: { amount: -1300, currency: "ILS" },
    },
    merchantName: "credit card debit",
    category: { main: "INCOMES_EXPENSES", sub: "CREDIT_CARD_CHECKING" },
    status: "BOOKED",
  };

  const normalized = normalizeOpenFinanceTransactions(
    [debit],
    [
      baseCardTransaction({ status: "BOOKED" }),
      baseCardTransaction({ status: "BOOKED" }),
    ]
  );
  const normalizedDebit = normalized.find((tx) => tx.id === "bank:debit-1");

  assert.equal(normalizedDebit?.detailTransactions?.length, 1);
  assert.equal(normalizedDebit?.detailTransactions?.[0].id, "card:tx-1");
});

test("keeps legitimate identical booked purchases and attaches their full total to the bank debit", () => {
  const debit: RawTransaction = {
    id: "debit-2",
    date: { transactionDate: "2026-08-16" },
    amount: {
      originalAmount: { amount: -2600, currency: "ILS" },
      chargedAmount: { amount: -2600, currency: "ILS" },
    },
    merchantName: "credit card debit",
    category: { main: "INCOMES_EXPENSES", sub: "CREDIT_CARD_CHECKING" },
    status: "BOOKED",
  };

  const normalized = normalizeOpenFinanceTransactions(
    [debit],
    [
      baseCardTransaction({ id: "first-booked", status: "BOOKED" }),
      baseCardTransaction({ id: "second-booked", status: "BOOKED" }),
    ]
  );
  const normalizedDebit = normalized.find((tx) => tx.id === "bank:debit-2");
  const cardTransactions = normalized.filter((tx) => tx.source === "card");

  assert.equal(cardTransactions.length, 2);
  assert.equal(cardTransactions.reduce((total, tx) => total + tx.amount, 0), 2600);
  assert.equal(normalizedDebit?.detailTransactions?.length, 2);
  assert.equal(
    normalizedDebit?.detailTransactions?.reduce((total, tx) => total + tx.amount, 0),
    2600
  );
});

test("keeps later installment cycles separate while attaching the booked cycle to its debit", () => {
  const debit: RawTransaction = {
    id: "august-debit",
    date: { transactionDate: "2026-08-10" },
    amount: {
      originalAmount: { amount: -108.8, currency: "ILS" },
      chargedAmount: { amount: -108.8, currency: "ILS" },
    },
    merchantName: "credit card debit",
    category: { main: "INCOMES_EXPENSES", sub: "CREDIT_CARD_CHECKING" },
    status: "BOOKED",
  };
  const installment = (id: string, valueDate: string): RawTransaction =>
    baseCardTransaction({
      id,
      accountNumber: "5653",
      date: { transactionDate: "2026-08-05", valueDate },
      amount: {
        originalAmount: { amount: -108.8, currency: "ILS" },
        chargedAmount: { amount: -108.8, currency: "ILS" },
      },
      merchantName: "installment merchant",
      status: "BOOKED",
    });

  const normalized = normalizeOpenFinanceTransactions(
    [debit],
    [installment("august-installment", "2026-08-10"), installment("september-installment", "2026-09-10")]
  );
  const normalizedDebit = normalized.find((tx) => tx.id === "bank:august-debit");
  const pending = selectPendingCardTransactions(normalized, cardDebitCutoffs(normalized));

  assert.deepEqual(normalizedDebit?.detailTransactions?.map(({ id }) => id), ["card:august-installment"]);
  assert.deepEqual(pending.map(({ id }) => id), ["card:september-installment"]);
});

test("attaches only the booked amount when pending purchases share the debit date and card", () => {
  const debit: RawTransaction = {
    id: "debit-with-new-pending-purchase",
    date: { valueDate: "2026-08-11", bookingDate: "2026-08-11" },
    amount: {
      originalAmount: { amount: -101.3, currency: "ILS" },
      chargedAmount: { amount: -101.3, currency: "ILS" },
    },
    merchantName: "card debit without card identifier",
    category: { main: "INCOMES_EXPENSES", sub: "CREDIT_CARD_CHECKING" },
    status: "BOOKED",
  };
  const bookedPurchase = baseCardTransaction({
    id: "booked-paypal",
    accountNumber: "5653",
    date: { transactionDate: "2026-08-06", valueDate: "2026-08-11" },
    amount: {
      originalAmount: { amount: -101.3, currency: "ILS" },
      chargedAmount: { amount: -101.3, currency: "ILS" },
    },
    merchantName: "PAYPAL",
    status: "BOOKED",
  });
  const pendingPurchase = baseCardTransaction({
    id: "pending-spotify",
    accountNumber: "5653",
    date: { transactionDate: "2026-08-11", valueDate: "2026-08-11" },
    amount: {
      originalAmount: { amount: -23.9, currency: "ILS" },
      chargedAmount: { amount: -23.9, currency: "ILS" },
    },
    merchantName: "Spotify",
    status: "PENDING",
  });

  const normalized = normalizeOpenFinanceTransactions([debit], [bookedPurchase, pendingPurchase]);
  const normalizedDebit = normalized.find((tx) => tx.id === "bank:debit-with-new-pending-purchase");
  const pending = selectPendingCardTransactions(normalized, cardDebitCutoffs(normalized));

  assert.deepEqual(normalizedDebit?.detailTransactions?.map(({ id }) => id), ["card:booked-paypal"]);
  assert.equal(normalizedDebit?.detailTransactions?.reduce((total, tx) => total + tx.amount, 0), 101.3);
  assert.deepEqual(pending.map(({ id }) => id), ["card:pending-spotify"]);
});

test("keeps a waived card fee in debit details without inflating the booked debit", () => {
  const debit: RawTransaction = {
    id: "debit-with-waived-fee",
    date: { transactionDate: "2026-08-10" },
    amount: {
      originalAmount: { amount: -100, currency: "ILS" },
      chargedAmount: { amount: -100, currency: "ILS" },
    },
    merchantName: "credit card debit",
    category: { main: "INCOMES_EXPENSES", sub: "CREDIT_CARD_CHECKING" },
    status: "BOOKED",
  };
  const purchase = baseCardTransaction({
    id: "charged-purchase",
    accountNumber: "5961",
    date: { transactionDate: "2026-08-09", valueDate: "2026-08-10" },
    amount: {
      originalAmount: { amount: -100, currency: "ILS" },
      chargedAmount: { amount: -100, currency: "ILS" },
    },
    status: "BOOKED",
  });
  const waivedFee = baseCardTransaction({
    id: "waived-fee",
    accountNumber: "5961",
    date: { transactionDate: "2026-07-22", valueDate: "2026-08-10" },
    amount: {
      originalAmount: { amount: -17.9, currency: "ILS" },
      chargedAmount: { amount: "", currency: "ILS" },
    },
    merchantName: "card issuance fee",
    status: "BOOKED",
  });

  const normalized = normalizeOpenFinanceTransactions([debit], [purchase, waivedFee]);
  const normalizedDebit = normalized.find((tx) => tx.id === "bank:debit-with-waived-fee");

  assert.equal(normalizedDebit?.detailTransactions?.length, 2);
  assert.equal(
    normalizedDebit?.detailTransactions?.reduce((total, tx) => total + tx.amount, 0),
    100
  );
  assert.equal(normalizedDebit?.detailTransactions?.find((tx) => tx.id === "card:waived-fee")?.amount, 0);
  const normalizedFee = normalizedDebit?.detailTransactions?.find((tx) => tx.id === "card:waived-fee");
  assert.equal(normalizedFee?.notCharged, true);
  assert.equal(normalizedFee?.originalAmount, 17.9);
  assert.equal(normalizedFee?.categoryMain, "INCOMES_EXPENSES");
  assert.equal(normalizedFee?.categorySub, "CARD_FEES");
});

test("client fallback removes a fee-less pending investment returned by an older API", () => {
  const transaction = (id: string, amount: number): Transaction => ({
    id,
    source: "bank",
    date: "2026-08-06",
    merchant: "ני”ע-קניה",
    amount,
    status: "PENDING",
    type: "expense",
    categoryMain: "INCOMES_EXPENSES",
    categorySub: "OTHER",
  });

  const transactions = dedupePendingInvestmentTransactions([
    transaction("bank:principal", 21_999),
    transaction("bank:with-fee", 22_001.11),
  ]);

  assert.deepEqual(transactions.map((tx) => [tx.id, tx.amount]), [["bank:with-fee", 22_001.11]]);
});
