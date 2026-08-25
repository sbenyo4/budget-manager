import { DatabaseSync } from "node:sqlite";
import { normalizeOpenFinanceTransactions, type RawTransaction } from "../server/openFinance";
import { openFinanceApiUrl } from "../server/openFinanceEndpoint";
import { cardDebitCutoffs } from "../src/logic/flows";
import { partitionOpenCardTransactions, selectPendingCardTransactions } from "../src/logic/pendingBilling";
import type { Transaction } from "../src/types";

interface StoredSettings {
  openFinanceUserId: string;
  openFinanceClientId: string;
  openFinanceClientSecret: string;
  openFinanceApiPrefix?: string;
}

const dbPath = process.env.BUDGET_DB_PATH || ".data/budget.sqlite";
const from = process.argv[2] || "2025-07-01";
const to = process.argv[3] || "2028-02-29";
const db = new DatabaseSync(dbPath, { readOnly: true });
const row = db.prepare("SELECT data FROM service_settings LIMIT 1").get() as { data?: string } | undefined;
if (!row?.data) throw new Error("No locally stored Open Finance service settings were found");
const settings = JSON.parse(row.data) as StoredSettings;

const tokenResponse = await fetch("https://api.open-finance.ai/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: settings.openFinanceUserId,
    clientId: settings.openFinanceClientId,
    clientSecret: settings.openFinanceClientSecret,
  }),
});
if (!tokenResponse.ok) throw new Error(`Token request failed (${tokenResponse.status})`);
const { accessToken } = await tokenResponse.json() as { accessToken: string };

async function fetchRows(type: "BANK" | "CARD"): Promise<RawTransaction[]> {
  const rows: RawTransaction[] = [];
  const seenPages = new Set<string>();
  let nextPage: string | undefined;
  do {
    if (nextPage && seenPages.has(nextPage)) throw new Error(`${type} pagination repeated a cursor`);
    if (nextPage) seenPages.add(nextPage);
    const url = openFinanceApiUrl(settings.openFinanceApiPrefix, "/v2/data/transactions");
    url.searchParams.set("dateFrom", from);
    url.searchParams.set("dateTo", to);
    url.searchParams.set("sort", "1");
    url.searchParams.set("type", type);
    if (nextPage) url.searchParams.set("nextPage", nextPage);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`${type} transactions request failed (${response.status})`);
    const body = await response.json() as { items?: RawTransaction[]; nextPage?: string | null };
    rows.push(...(body.items ?? []));
    nextPage = body.nextPage ?? undefined;
  } while (nextPage);
  return rows;
}

const [rawBank, rawCard] = await Promise.all([fetchRows("BANK"), fetchRows("CARD")]);
const normalized = normalizeOpenFinanceTransactions(rawBank, rawCard);
const normalizedTransactions = normalized as Transaction[];
const pending = selectPendingCardTransactions(normalizedTransactions, cardDebitCutoffs(normalizedTransactions));
const { confirmed, providerPending } = partitionOpenCardTransactions(pending);
const futureChargesByMonth = new Map<string, { total: number; count: number }>();
for (const transaction of confirmed) {
  if (transaction.installment?.monthlyAmountPending) continue;
  const month = transaction.billingDate?.slice(0, 7) ?? "unknown";
  const summary = futureChargesByMonth.get(month) ?? { total: 0, count: 0 };
  summary.total += transaction.type === "income" ? -transaction.amount : transaction.amount;
  summary.count += 1;
  futureChargesByMonth.set(month, summary);
}
const attachedDebits = normalized
  .filter((transaction) => transaction.source === "bank" && transaction.detailTransactions?.length)
  .map((transaction) => {
    const detailTotal = transaction.detailTransactions!.reduce((total, detail) => total + detail.amount, 0);
    return {
      date: transaction.date,
      amount: transaction.amount,
      detailCount: transaction.detailTransactions!.length,
      detailTotal: Math.round(detailTotal * 100) / 100,
      exactMatch: Math.abs(detailTotal - transaction.amount) < 0.005,
    };
  });
const referenceAmounts = [2115.51, 1714.82].map((amount) => ({
  amount,
  matches: attachedDebits.filter((debit) => Math.abs(debit.amount - amount) < 0.005),
}));

console.log(JSON.stringify({
  range: { from, to },
  rawProviderRows: { bank: rawBank.length, card: rawCard.length },
  normalizedRows: {
    total: normalized.length,
    bank: normalized.filter((transaction) => transaction.source === "bank").length,
    card: normalized.filter((transaction) => transaction.source === "card").length,
  },
  futureCharges: {
    confirmedCount: confirmed.length,
    providerPendingCount: providerPending.length,
    byMonth: [...futureChargesByMonth.entries()].map(([month, summary]) => ({
      month,
      count: summary.count,
      total: Math.round(summary.total * 100) / 100,
    })),
  },
  attachedDebitCount: attachedDebits.length,
  attachedDebitMismatches: attachedDebits.filter((debit) => !debit.exactMatch),
  referenceAmounts,
}, null, 2));
