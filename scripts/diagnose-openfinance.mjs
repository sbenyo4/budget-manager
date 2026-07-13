import { DatabaseSync } from "node:sqlite";

const dbPath = process.env.BUDGET_DB_PATH || ".data/budget.sqlite";
const merchantPattern = process.argv[2] || "קפה ויזיני";
const from = process.argv[3] || "2026-01-01";
const to = process.argv[4] || "2026-06-30";

const db = new DatabaseSync(dbPath);
const row = db.prepare("SELECT user_id, data FROM service_settings LIMIT 1").get();
if (!row) {
  throw new Error("No service_settings row found in local DB");
}

const settings = JSON.parse(row.data);
const tokenRes = await fetch("https://api.open-finance.ai/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: settings.openFinanceUserId,
    clientId: settings.openFinanceClientId,
    clientSecret: settings.openFinanceClientSecret,
  }),
});
if (!tokenRes.ok) {
  throw new Error(`Token request failed (${tokenRes.status}): ${await tokenRes.text()}`);
}

const { accessToken } = await tokenRes.json();
let nextPage;
let page = 0;
const matches = [];
const seenPages = new Set();

do {
  page += 1;
  const url = new URL(`https://${settings.openFinanceApiPrefix || "api"}.open-finance.ai/v2/data/transactions`);
  url.searchParams.set("dateFrom", from);
  url.searchParams.set("dateTo", to);
  url.searchParams.set("sort", "1");
  url.searchParams.set("type", "CARD");
  if (nextPage) url.searchParams.set("nextPage", nextPage);

  const pageKey = url.searchParams.toString();
  if (seenPages.has(pageKey)) {
    console.log(`STOPPED: repeated page cursor before request: ${nextPage}`);
    break;
  }
  seenPages.add(pageKey);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Transactions request failed (${res.status}): ${await res.text()}`);
  }
  const body = await res.json();
  const items = body.items ?? [];
  for (let index = 0; index < items.length; index += 1) {
    const raw = items[index];
    const merchant = raw.merchantName || raw.description?.description || "";
    if (!merchant.includes(merchantPattern)) continue;
    const amount = raw.amount?.chargedAmount?.amount ?? raw.amount?.originalAmount?.amount ?? 0;
    matches.push({
      page,
      index,
      id: raw.id ?? null,
      merchant,
      valueDate: raw.date?.valueDate ?? null,
      transactionDate: raw.date?.transactionDate ?? null,
      bookingDate: raw.date?.bookingDate ?? null,
      amount,
      status: raw.status ?? null,
      category: raw.category ?? null,
      additionalInfo: raw.description?.additionalInfo ?? null,
      description: raw.description ?? null,
      installment: raw.installment ?? raw.installments ?? raw.payment ?? raw.payments ?? null,
      rawKeys: Object.keys(raw).sort(),
    });
  }
  nextPage = body.nextPage ?? undefined;
} while (nextPage);

console.log(JSON.stringify({ userId: row.user_id, merchantPattern, from, to, count: matches.length, matches }, null, 2));
