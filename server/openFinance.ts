import type { ServiceSettings } from "./db.js";

const TOKEN_URL = "https://api.open-finance.ai/oauth/token";

interface RawBalance {
  balanceType?: string;
  creditLimitIncluded?: boolean;
  balanceAmount?: { currency?: string; amount?: string | number };
  referenceDate?: string;
}

interface RawAccount {
  id?: string;
  providerId?: string;
  accountType?: string;
  accountName?: string;
  accountNumber?: string;
  product?: string;
  balances?: RawBalance[];
}

interface RawTransaction {
  id?: string;
  date?: { valueDate?: string; bookingDate?: string; transactionDate?: string };
  amount?: {
    originalAmount?: { amount?: number; currency?: string };
    chargedAmount?: { amount?: number; currency?: string };
  };
  description?: { description?: string; additionalInfo?: string };
  merchantName?: string;
  category?: { main?: string; sub?: string };
  status?: string;
}

interface NormalizedTransaction {
  id: string;
  duplicateKey?: string;
  source: "bank" | "card";
  date: string;
  merchant: string;
  amount: number;
  type: "income" | "expense";
  categoryMain: string;
  categorySub: string;
}

type PublicTransaction = Omit<NormalizedTransaction, "duplicateKey">;

const tokens = new Map<string, { value: string; expiresAt: number }>();

export function isOpenFinanceConfigured(settings: ServiceSettings): boolean {
  return Boolean(settings.openFinanceClientId && settings.openFinanceClientSecret && settings.openFinanceUserId);
}

function tokenCacheKey(settings: ServiceSettings): string {
  return `${settings.openFinanceApiPrefix}:${settings.openFinanceUserId}:${settings.openFinanceClientId}`;
}

async function getToken(settings: ServiceSettings): Promise<string> {
  const cacheKey = tokenCacheKey(settings);
  const cached = tokens.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.value;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: settings.openFinanceUserId,
      clientId: settings.openFinanceClientId,
      clientSecret: settings.openFinanceClientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string; expiresIn?: number };
  const token = { value: body.accessToken, expiresAt: Date.now() + (body.expiresIn ?? 3_600_000) };
  tokens.set(cacheKey, token);
  return token.value;
}

async function fetchTransactions(
  settings: ServiceSettings,
  from: string,
  to: string,
  providerType: "BANK" | "CARD"
): Promise<RawTransaction[]> {
  const accessToken = await getToken(settings);
  const items: RawTransaction[] = [];
  let nextPage: string | undefined;
  do {
    const url = new URL(`https://${settings.openFinanceApiPrefix}.open-finance.ai/v2/data/transactions`);
    url.searchParams.set("dateFrom", from);
    url.searchParams.set("dateTo", to);
    url.searchParams.set("sort", "1");
    url.searchParams.set("type", providerType);
    if (nextPage) url.searchParams.set("nextPage", nextPage);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      throw new Error(`Transactions request failed (${res.status}): ${await res.text()}`);
    }
    const body = (await res.json()) as { nextPage?: string | null; items?: RawTransaction[] };
    items.push(...(body.items ?? []));
    nextPage = body.nextPage ?? undefined;
  } while (nextPage);
  return items;
}

function rawAmount(raw: RawTransaction): number {
  return raw.amount?.chargedAmount?.amount ?? raw.amount?.originalAmount?.amount ?? 0;
}

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function dedupeTransactions(transactions: NormalizedTransaction[]): PublicTransaction[] {
  const seen = new Set<string>();
  const unique: PublicTransaction[] = [];
  for (const tx of transactions) {
    if (tx.duplicateKey) {
      if (seen.has(tx.duplicateKey)) continue;
      seen.add(tx.duplicateKey);
    }
    const { duplicateKey: _duplicateKey, ...publicTx } = tx;
    unique.push(publicTx);
  }
  return unique;
}

function normalize(raw: RawTransaction, index: number, source: "bank" | "card"): NormalizedTransaction {
  const rawDate =
    source === "card"
      ? raw.date?.transactionDate ?? raw.date?.valueDate ?? raw.date?.bookingDate ?? ""
      : raw.date?.transactionDate ?? raw.date?.valueDate ?? raw.date?.bookingDate ?? "";
  const amount = rawAmount(raw);

  return {
    id: raw.id ? `${source}:${raw.id}` : `${source}-tx-${index}`,
    duplicateKey: raw.id ? `${source}:${raw.id}` : undefined,
    source,
    date: normalizeDate(rawDate),
    merchant: raw.merchantName || raw.description?.description || "לא ידוע",
    amount: Math.abs(amount),
    type: amount > 0 ? "income" : "expense",
    categoryMain: raw.category?.main ?? "OTHER",
    categorySub: raw.category?.sub ?? "UNCATEGORIZED",
  };
}

function pickBalance(balances: RawBalance[] = []): RawBalance | undefined {
  const preference = ["expected", "closingBooked", "interimAvailable", "forwardAvailable"];
  for (const type of preference) {
    const found = balances.find((b) => b.balanceType === type && b.creditLimitIncluded === false);
    if (found) return found;
  }
  return balances[0];
}

export async function getTransactions(settings: ServiceSettings, from: string, to: string) {
  const [bank, card] = await Promise.all([
    fetchTransactions(settings, from, to, "BANK"),
    fetchTransactions(settings, from, to, "CARD"),
  ]);
  const normalized = [
    ...bank.map((raw, i) => normalize(raw, i, "bank")),
    ...card.map((raw, i) => normalize(raw, i, "card")),
  ].filter((tx) => tx.date && tx.amount > 0);
  return dedupeTransactions(normalized);
}

export async function getAccounts(settings: ServiceSettings) {
  const accessToken = await getToken(settings);
  const items: RawAccount[] = [];
  let nextPage: string | undefined;
  do {
    const url = new URL(`https://${settings.openFinanceApiPrefix}.open-finance.ai/v2/data/accounts`);
    if (nextPage) url.searchParams.set("nextPage", nextPage);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      throw new Error(`Accounts request failed (${res.status}): ${await res.text()}`);
    }
    const body = (await res.json()) as { nextPage?: string | null; items?: RawAccount[] };
    items.push(...(body.items ?? []));
    nextPage = body.nextPage ?? undefined;
  } while (nextPage);

  return items.map((raw, i) => {
    const balance = pickBalance(raw.balances);
    return {
      id: raw.id ?? `acc-${i}`,
      providerId: raw.providerId ?? "",
      accountType: raw.accountType ?? "",
      accountName: raw.product ?? raw.accountName ?? raw.accountNumber ?? "",
      currency: balance?.balanceAmount?.currency ?? "ILS",
      balance: Number(balance?.balanceAmount?.amount ?? 0),
      balanceDate: balance?.referenceDate ?? "",
    };
  });
}
