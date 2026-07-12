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

let token: { value: string; expiresAt: number } | null = null;

export function isOpenFinanceConfigured(): boolean {
  return Boolean(process.env.OPEN_FINANCE_CLIENT_ID && process.env.OPEN_FINANCE_CLIENT_SECRET && process.env.OPEN_FINANCE_USER_ID);
}

async function getToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const userId = process.env.OPEN_FINANCE_USER_ID ?? "";
  const clientId = process.env.OPEN_FINANCE_CLIENT_ID ?? "";
  const clientSecret = process.env.OPEN_FINANCE_CLIENT_SECRET ?? "";
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, clientId, clientSecret }),
  });
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string; expiresIn?: number };
  token = { value: body.accessToken, expiresAt: Date.now() + (body.expiresIn ?? 3_600_000) };
  return token.value;
}

async function fetchTransactions(from: string, to: string, providerType: "BANK" | "CARD"): Promise<RawTransaction[]> {
  const accessToken = await getToken();
  const apiPrefix = process.env.OPEN_FINANCE_API_PREFIX || "api";
  const items: RawTransaction[] = [];
  let nextPage: string | undefined;
  do {
    const url = new URL(`https://${apiPrefix}.open-finance.ai/v2/data/transactions`);
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

function normalize(raw: RawTransaction, index: number, source: "bank" | "card") {
  const date =
    source === "card"
      ? raw.date?.valueDate ?? raw.date?.transactionDate ?? raw.date?.bookingDate ?? ""
      : raw.date?.transactionDate ?? raw.date?.valueDate ?? raw.date?.bookingDate ?? "";

  return {
    id: raw.id ?? `${source}-tx-${index}`,
    source,
    date,
    merchant: raw.merchantName || raw.description?.description || "לא ידוע",
    amount: Math.abs(rawAmount(raw)),
    type: rawAmount(raw) > 0 ? "income" : "expense",
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

export async function getTransactions(from: string, to: string) {
  const [bank, card] = await Promise.all([
    fetchTransactions(from, to, "BANK"),
    fetchTransactions(from, to, "CARD"),
  ]);
  return [
    ...bank.map((raw, i) => normalize(raw, i, "bank")),
    ...card.map((raw, i) => normalize(raw, i, "card")),
  ].filter((tx) => tx.date && tx.amount > 0);
}

export async function getAccounts() {
  const accessToken = await getToken();
  const apiPrefix = process.env.OPEN_FINANCE_API_PREFIX || "api";
  const items: RawAccount[] = [];
  let nextPage: string | undefined;
  do {
    const url = new URL(`https://${apiPrefix}.open-finance.ai/v2/data/accounts`);
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

