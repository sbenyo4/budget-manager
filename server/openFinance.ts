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
  accountNumber?: string;
  providerId?: string;
  date?: { valueDate?: string; bookingDate?: string; transactionDate?: string };
  amount?: {
    originalAmount?: { amount?: number; currency?: string };
    chargedAmount?: { amount?: number; currency?: string };
  };
  description?: { description?: string; additionalInfo?: string };
  merchantName?: string;
  category?: { main?: string; sub?: string };
  status?: string;
  installments?: { number?: number; total?: number };
  isCreditCardInstallment?: boolean;
}

interface NormalizedTransaction {
  id: string;
  duplicateKey?: string;
  source: "bank" | "card";
  date: string;
  billingDate?: string;
  cardLast4?: string;
  cardProvider?: string;
  merchant: string;
  amount: number;
  originalAmount?: number;
  installment?: {
    number?: number;
    total?: number;
  };
  type: "income" | "expense";
  categoryMain: string;
  categorySub: string;
  detailTransactions?: PublicTransaction[];
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

function finiteAmount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rawAmount(raw: RawTransaction): number {
  const charged = finiteAmount(raw.amount?.chargedAmount?.amount);
  if (charged !== undefined) return charged;

  const original = finiteAmount(raw.amount?.originalAmount?.amount);
  const installmentTotal = raw.installments?.total;
  if (original !== undefined && installmentTotal && installmentTotal > 1) {
    return original / installmentTotal;
  }
  return original ?? 0;
}

function rawOriginalAmount(raw: RawTransaction): number | undefined {
  return finiteAmount(raw.amount?.originalAmount?.amount);
}

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function parseAdditionalInfo(raw: RawTransaction): Record<string, unknown> | null {
  const info = raw.description?.additionalInfo;
  if (!info) return null;
  try {
    const parsed = JSON.parse(info) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function cardDebitDuplicateKey(raw: RawTransaction, source: "bank" | "card", date: string, amount: number): string | undefined {
  if (
    source !== "bank" ||
    raw.category?.main !== "INCOMES_EXPENSES" ||
    raw.category?.sub !== "CREDIT_CARD_CHECKING"
  ) {
    return undefined;
  }
  const info = parseAdditionalInfo(raw);
  const accountNo = typeof info?.accountNo === "string" ? info.accountNo : raw.accountNumber ?? "";
  const description =
    typeof info?.transactionDescription === "string"
      ? info.transactionDescription
      : raw.merchantName || raw.description?.description || "";
  if (!accountNo || !description) return undefined;
  return [
    "bank-card-debit",
    raw.providerId ?? "",
    date,
    Math.abs(amount).toFixed(2),
    accountNo,
    description,
  ].join(":");
}

function cardLast4(raw: RawTransaction, source: "bank" | "card"): string | undefined {
  if (source === "card") {
    const digits = raw.accountNumber?.replace(/\D/g, "") ?? "";
    return digits.length >= 4 ? digits.slice(-4) : undefined;
  }

  const isBankCardDebit =
    raw.category?.main === "INCOMES_EXPENSES" && raw.category?.sub === "CREDIT_CARD_CHECKING";
  if (!isBankCardDebit) return undefined;

  const info = raw.description?.additionalInfo ?? "";
  const idMatch = info.match(/מזהה\s*(\d{4,})/);
  return idMatch ? idMatch[1].slice(-4) : undefined;
}

function isCardInstallment(raw: RawTransaction): boolean {
  return Boolean(raw.isCreditCardInstallment || raw.installments);
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
      ? raw.date?.transactionDate ?? raw.date?.bookingDate ?? raw.date?.valueDate ?? ""
      : raw.date?.transactionDate ?? raw.date?.valueDate ?? raw.date?.bookingDate ?? "";
  const date = normalizeDate(rawDate);
  const billingDate = source === "card" && raw.date?.valueDate ? normalizeDate(raw.date.valueDate) : undefined;
  const amount = rawAmount(raw);
  const originalAmount = rawOriginalAmount(raw);
  const last4 = cardLast4(raw, source);
  const installment = isCardInstallment(raw)
    ? { number: raw.installments?.number, total: raw.installments?.total }
    : undefined;

  return {
    id: raw.id ? `${source}:${raw.id}` : `${source}-tx-${index}`,
    duplicateKey: cardDebitDuplicateKey(raw, source, date, amount) ?? (raw.id ? `${source}:${raw.id}` : undefined),
    source,
    date,
    ...(billingDate ? { billingDate } : {}),
    ...(last4 ? { cardLast4: last4 } : {}),
    ...(raw.providerId ? { cardProvider: raw.providerId } : {}),
    merchant: raw.merchantName || raw.description?.description || "לא ידוע",
    amount: Math.abs(amount),
    ...(originalAmount !== undefined && Math.abs(originalAmount) !== Math.abs(amount)
      ? { originalAmount: Math.abs(originalAmount) }
      : {}),
    ...(installment ? { installment } : {}),
    type: amount > 0 ? "income" : "expense",
    categoryMain: raw.category?.main ?? "OTHER",
    categorySub: raw.category?.sub ?? "UNCATEGORIZED",
  };
}

function isCardDebit(tx: NormalizedTransaction): boolean {
  return tx.source === "bank" && tx.categoryMain === "INCOMES_EXPENSES" && tx.categorySub === "CREDIT_CARD_CHECKING";
}

function amountCents(value: number): number {
  return Math.round(value * 100);
}

function assignDebitDetailsForDate(
  debits: NormalizedTransaction[],
  groups: Array<{ totalCents: number; details: PublicTransaction[] }>
): Map<string, PublicTransaction[]> {
  const assignments = new Map<string, PublicTransaction[]>();
  const usedGroupIndexes = new Set<number>();

  for (const tx of debits) {
    if (!tx.cardLast4) continue;
    const groupIndex = groups.findIndex(
      (group, index) => !usedGroupIndexes.has(index) && group.details.some((detail) => detail.cardLast4 === tx.cardLast4)
    );
    if (groupIndex >= 0) {
      usedGroupIndexes.add(groupIndex);
      assignments.set(tx.id, groups[groupIndex].details);
    }
  }

  for (const tx of debits) {
    if (assignments.has(tx.id)) continue;
    const txAmountCents = amountCents(tx.amount);
    const groupIndex = groups.findIndex(
      (group, index) =>
        !usedGroupIndexes.has(index) &&
        group.totalCents === txAmountCents &&
        (!tx.cardLast4 || group.details.some((detail) => detail.cardLast4 === tx.cardLast4))
    );
    if (groupIndex >= 0) {
      usedGroupIndexes.add(groupIndex);
      assignments.set(tx.id, groups[groupIndex].details);
    }
  }

  const unmatchedDebits = debits.filter((tx) => !assignments.has(tx.id));
  const unusedGroups = groups
    .map((group, index) => ({ ...group, index }))
    .filter((group) => !usedGroupIndexes.has(group.index));

  if (unmatchedDebits.length === 1 && unusedGroups.length > 1) {
    const totalCents = unusedGroups.reduce((total, group) => total + group.totalCents, 0);
    if (Math.abs(totalCents - amountCents(unmatchedDebits[0].amount)) <= 1) {
      assignments.set(unmatchedDebits[0].id, unusedGroups.flatMap((group) => group.details));
      return assignments;
    }
  }

  if (unmatchedDebits.length === unusedGroups.length) {
    for (const tx of unmatchedDebits) {
      const txAmountCents = amountCents(tx.amount);
      const best = unusedGroups
        .filter((group) => !usedGroupIndexes.has(group.index))
        .map((group) => ({ ...group, delta: Math.abs(group.totalCents - txAmountCents) }))
        .sort((a, b) => a.delta - b.delta)[0];
      if (best && best.delta <= 1) {
        usedGroupIndexes.add(best.index);
        assignments.set(tx.id, best.details);
      }
    }
  }

  return assignments;
}

function attachCardDebitDetails(transactions: NormalizedTransaction[]): NormalizedTransaction[] {
  const cardGroupsByBillingDate = new Map<string, Array<{ totalCents: number; details: PublicTransaction[] }>>();
  const debitDetailsById = new Map<string, PublicTransaction[]>();

  for (const tx of transactions) {
    if (tx.source !== "card" || !tx.billingDate) continue;
    const { duplicateKey: _duplicateKey, ...publicTx } = tx;
    const groups = cardGroupsByBillingDate.get(tx.billingDate) ?? [];
    const key = `${tx.cardProvider ?? ""}:${tx.cardLast4 ?? ""}`;
    const existing = groups.find((group) => group.details[0] && `${group.details[0].cardProvider ?? ""}:${group.details[0].cardLast4 ?? ""}` === key);
    if (existing) {
      existing.totalCents += amountCents(tx.amount);
      existing.details.push(publicTx);
    } else {
      groups.push({ totalCents: amountCents(tx.amount), details: [publicTx] });
    }
    cardGroupsByBillingDate.set(tx.billingDate, groups);
  }

  const debitsByDate = new Map<string, NormalizedTransaction[]>();
  for (const tx of transactions) {
    if (!isCardDebit(tx)) continue;
    const debits = debitsByDate.get(tx.date) ?? [];
    debits.push(tx);
    debitsByDate.set(tx.date, debits);
  }

  for (const [date, debits] of debitsByDate) {
    const assignments = assignDebitDetailsForDate(debits, cardGroupsByBillingDate.get(date) ?? []);
    for (const [id, details] of assignments) {
      debitDetailsById.set(id, details);
    }
  }

  return transactions.map((tx) => {
    if (!isCardDebit(tx)) return tx;
    const details = debitDetailsById.get(tx.id);
    if (!details?.length) return tx;
    return {
      ...tx,
      detailTransactions: [...details].sort((a, b) => b.date.localeCompare(a.date)),
    };
  });
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
  const normalized = attachCardDebitDetails([
    ...bank.map((raw, i) => normalize(raw, i, "bank")),
    ...card.map((raw, i) => normalize(raw, i, "card")),
  ]).filter((tx) => tx.date && tx.date >= from && tx.date <= to && tx.amount > 0);
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
