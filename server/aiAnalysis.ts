import type { ServiceSettings } from "./db.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

export interface AIAnalysisPayload {
  analysisMode?: "month" | "trend";
  periodLabel: string;
  transactions: Array<{
    date?: string;
    billingDate?: string;
    merchant?: string;
    amount?: number;
    type?: "income" | "expense";
    source?: "bank" | "card";
    categoryMain?: string;
    categorySub?: string;
    cardLast4?: string;
    cardProvider?: string;
    installment?: { number?: number; total?: number };
    detailTransactions?: AIAnalysisPayload["transactions"];
  }>;
  analytics?: unknown;
  userProfile?: {
    householdAge: number | null;
    householdSize: number | null;
  };
  bankBalance: { balance: number; date: string } | null;
}

export interface AIAnalysisResult {
  score: number;
  summary: string;
  strengths: string[];
  risks: string[];
  recommendations: string[];
}

interface CompactTransaction {
  date?: string;
  merchant?: string;
  amount?: number;
  type: "income" | "expense";
  source: "bank" | "card";
  categoryMain?: string;
  categorySub?: string;
  cardLast4?: string;
  cardProvider?: string;
  installment?: { number?: number; total?: number };
}

const MODEL_FALLBACKS = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-2.0-flash",
} as const;

const PROVIDER_NAMES = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
} as const;

function monthKey(date?: string): string {
  return date?.slice(0, 7) || "unknown";
}

function addAmount(map: Record<string, number>, key: string | undefined, amount: number) {
  const safeKey = key || "לא מסווג";
  map[safeKey] = (map[safeKey] ?? 0) + amount;
}

function topEntries(map: Record<string, number>, limit: number) {
  return Object.entries(map)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit)
    .map(([name, amount]) => ({ name, amount: Number(amount.toFixed(2)) }));
}

function isCardDebit(tx: CompactTransaction): boolean {
  return tx.categoryMain === "INCOMES_EXPENSES" && tx.categorySub === "CREDIT_CARD_CHECKING";
}

function isSavingsTx(tx: CompactTransaction): boolean {
  if (tx.categoryMain === "TRADING" || tx.categoryMain === "ASSETS") return true;
  if (tx.categoryMain === "TRANSFER" && Number(tx.amount ?? 0) >= 1000) return true;
  return false;
}

function isConsumptionTx(tx: CompactTransaction): boolean {
  return !isCardDebit(tx) && !isSavingsTx(tx);
}

function isBudgetIncomeTx(tx: CompactTransaction): boolean {
  return tx.type === "income" && tx.source !== "card" && !["TRADING", "TRANSFER", "ASSETS", "DEPOSIT"].includes(tx.categoryMain ?? "");
}

function compactTransactionKey(tx: CompactTransaction): string {
  return [
    tx.date ?? "",
    tx.source ?? "",
    tx.cardProvider ?? "",
    tx.cardLast4 ?? "",
    tx.merchant ?? "",
    tx.categoryMain ?? "",
    tx.categorySub ?? "",
    Number(tx.amount ?? 0).toFixed(2),
  ].join("|");
}

function mergeAttachedTransactions(
  transactions: CompactTransaction[],
  attachedTransactions: CompactTransaction[]
): CompactTransaction[] {
  const unmatchedOriginals = new Map<string, number>();
  for (const tx of transactions) {
    const key = compactTransactionKey(tx);
    unmatchedOriginals.set(key, (unmatchedOriginals.get(key) ?? 0) + 1);
  }
  const merged = [...transactions];
  for (const tx of attachedTransactions) {
    const key = compactTransactionKey(tx);
    const originalCount = unmatchedOriginals.get(key) ?? 0;
    if (originalCount > 0) {
      unmatchedOriginals.set(key, originalCount - 1);
    } else {
      merged.push(tx);
    }
  }
  return merged;
}

function compactPayload(payload: AIAnalysisPayload) {
  const hasProfileContext = Boolean(payload.userProfile?.householdAge || payload.userProfile?.householdSize);
  const mappedTransactions: CompactTransaction[] = payload.transactions.map((tx) => ({
      date: tx.billingDate ?? tx.date,
      merchant: tx.merchant?.slice(0, 80),
      amount: tx.amount,
      type: tx.type ?? "expense",
      source: tx.source ?? "bank",
      categoryMain: tx.categoryMain,
      categorySub: tx.categorySub,
      cardLast4: tx.cardLast4,
      cardProvider: tx.cardProvider,
      installment: tx.installment,
  }));
  const attachedCardDetails: CompactTransaction[] = payload.transactions.flatMap((tx) =>
    (tx.detailTransactions ?? []).map((detail) => ({
      date: detail.billingDate ?? detail.date,
      merchant: detail.merchant?.slice(0, 80),
      amount: detail.amount,
      type: detail.type ?? "expense",
      source: "card" as const,
      categoryMain: detail.categoryMain,
      categorySub: detail.categorySub,
      cardLast4: detail.cardLast4 ?? tx.cardLast4,
      cardProvider: detail.cardProvider ?? tx.cardProvider,
      installment: detail.installment,
    }))
  );
  const creditCardDetails = mergeAttachedTransactions(mappedTransactions, attachedCardDetails)
    .filter((tx) => tx.source === "card" && tx.type !== "income")
    .sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
    .slice(0, 160);

  const representativeLimit = payload.analysisMode === "trend" ? 180 : 240;
  const transactions = [...mappedTransactions]
    .sort((a, b) => Math.abs(Number(b.amount ?? 0)) - Math.abs(Number(a.amount ?? 0)))
    .slice(0, representativeLimit);

  const totals = mappedTransactions.reduce(
    (acc, tx) => {
      const amount = Number(tx.amount ?? 0);
      if (isBudgetIncomeTx(tx)) acc.income += amount;
      else if (tx.type !== "income" && isConsumptionTx(tx)) {
        acc.consumptionExpenses += amount;
        const key = tx.categoryMain || "OTHER";
        acc.categories[key] = (acc.categories[key] ?? 0) + amount;
      } else if (isSavingsTx(tx)) {
        acc.savingsAndInvestments += tx.type === "income" ? -amount : amount;
      }
      acc.leftover = acc.income - acc.consumptionExpenses - acc.savingsAndInvestments;
      return acc;
    },
    { income: 0, consumptionExpenses: 0, savingsAndInvestments: 0, leftover: 0, categories: {} as Record<string, number> }
  );

  const monthly = mappedTransactions.reduce(
    (acc, tx) => {
      const key = monthKey(tx.date);
      const row = (acc[key] ??= { income: 0, consumptionExpenses: 0, savingsAndInvestments: 0, leftover: 0, transactionCount: 0 });
      row.transactionCount += 1;
      const amount = Number(tx.amount ?? 0);
      if (isBudgetIncomeTx(tx)) row.income += amount;
      else if (tx.type !== "income" && isConsumptionTx(tx)) row.consumptionExpenses += amount;
      else if (isSavingsTx(tx)) row.savingsAndInvestments += tx.type === "income" ? -amount : amount;
      row.leftover = row.income - row.consumptionExpenses - row.savingsAndInvestments;
      return acc;
    },
    {} as Record<string, { income: number; consumptionExpenses: number; savingsAndInvestments: number; leftover: number; transactionCount: number }>
  );

  const categoryTotals: Record<string, number> = {};
  const merchantTotals: Record<string, number> = {};
  mappedTransactions.forEach((tx) => {
    if (tx.type === "income" || !isConsumptionTx(tx)) return;
    const amount = Number(tx.amount ?? 0);
    addAmount(categoryTotals, tx.categoryMain, amount);
    addAmount(merchantTotals, tx.merchant, amount);
  });

  return {
    analysisMode: payload.analysisMode ?? "month",
    periodLabel: payload.periodLabel,
    userProfile: payload.userProfile,
    profileGuidance: hasProfileContext
      ? "Use userProfile as context when judging whether spending is reasonable for the household age and householdSize. If householdSize is provided, explicitly adjust the assessment for that number of household members and mention that context in the response. Do not assume marital status, children, medical needs, or lifestyle details that were not provided."
      : undefined,
    bankBalance: payload.bankBalance,
    analytics: payload.analytics,
    transactionCount: mappedTransactions.length,
    creditCardDetails,
    totals,
    monthly,
    topCategories: topEntries(categoryTotals, 14),
    topMerchants: topEntries(merchantTotals, 18),
    transactions,
  };
}

function promptFor(payload: AIAnalysisPayload): string {
  const profileInstruction = payload.userProfile?.householdAge || payload.userProfile?.householdSize
    ? `\nProfile context: the user's household profile is age=${payload.userProfile.householdAge ?? "not provided"}, householdSize=${payload.userProfile.householdSize ?? "not provided"}. Explicitly take householdSize into account when judging whether grocery, health, household, transport, leisure and recurring spending are reasonable. If householdSize is provided, mention in the summary or one recommendation that the assessment is adjusted for ${payload.userProfile.householdSize} household member(s). Do not invent family composition or needs beyond the supplied age and household size.\n`
    : "";
  return `נתח את תקציב המשתמש בעברית. החזר JSON בלבד, בלי Markdown, במבנה:
{
  "score": number בין 0 ל-100,
  "summary": "משפט עד שניים",
  "strengths": ["..."],
  "risks": ["..."],
  "recommendations": ["..."]
}

הנחיות:
- התייחס להכנסות, הוצאות, קטגוריות, עסקאות חריגות, תשלומים, אשראי ויתרת בנק אם קיימת.
- אם קיים analytics, הוא מקור האמת לחישובים. אל תסכם מחדש את העסקאות הגולמיות באופן שסותר אותו.
- אם analytics.categoryFocus.filteredAnalysis הוא true, מדובר בניתוח ממוקד של קטגוריה אחת בלבד. התמקד בקטגוריה הזו, במגמות/חריגות/סוחרים בתוך הקטגוריה, השתמש ב-analytics.categoryFocus.total/averagePerPeriod/monthlyRunRate, ואל תציג מסקנות כאילו נותח כל התקציב. אל תשתמש ב-leftover כמדד מרכזי בניתוח קטגוריה.
- במצב חודשי, אם קיים analytics.creditCardBreakdown או creditCardDetails, השתמש בפירוט עסקאות האשראי כדי להסביר מה מרכיב את חיובי הכרטיס. אל תנתח רק את שורת חיוב הכרטיס הכוללת מהבנק.
- עסקאות אשראי משויכות לתקופה לפי billingDate כאשר קיים. purchaseDate הוא תאריך הקנייה, billingDate הוא מועד החיוב התקציבי.
- במצב חודשי, אשראי מחושב על בסיס charged_only: כלול רק עסקאות שכבר חויבו בפועל עד lastDebitDate. אל תכלול עסקאות טרם חויבו בהוצאות או בקטגוריות התקופה.
- קטגוריות שמגיעות בנתונים כבר כוללות תיקונים ידניים של המשתמש. התייחס אליהן כקטגוריות התקפות לניתוח.
- consumptionExpenses הן הוצאות תקציב/צריכה. savingsAndInvestments הן חיסכון, השקעות, פיקדונות והעברות להשקעה - לא הוצאות צריכה.
- savingsAndInvestments הוא בדרך כלל סימן חיובי ליכולת חיסכון. אל תציג השקעה/פיקדון כסיכון רק בגלל הסכום. ציין סיכון רק אם יש אינדיקציה מפורשת לחוסר נזילות, תזרים שלילי חריג, או יתרת בנק נמוכה.
- חיסכון יכול להיות שמרני ונזיל (למשל פיקדון/קרן כספית/השקעה סולידית). אם אין נתון על רמת נזילות, אל תניח שהוא לא נזיל.
- אם analytics.period.partialPeriod הוא true, הדגש שמדובר בתקופה חלקית ולא בחודש מלא. השתמש ב-monthlyRunRate בזהירות כקצב משוער בלבד, ואל תוריד ציון בגלל חריגה שנובעת מתקופה קצרה.
- בניתוח מגמות השתמש ב-averages כדי לדבר על ממוצע לתקופה, ולא רק בסכומים מצטברים.
- אם הכנסות גבוהות מהוצאות צריכה, אל תכתוב שההוצאות עולות על ההכנסות רק בגלל חיסכון/השקעות גבוהים.
- אל תמציא נתונים שלא קיימים.
- תן המלצות מעשיות וקצרות.
- אם analysisMode הוא trend, התמקד במגמות, שינויים בהרגלים ודפוסים חוזרים לאורך התקופה.
- אם analysisMode הוא month, התמקד בביצועי החודש, חריגות והמלצות לחודש הבא.
- אם יש מעט נתונים, ציין שהביטחון נמוך.
${profileInstruction}

נתונים:
${JSON.stringify(compactPayload(payload))}`;
}

function parseResult(text: string): AIAnalysisResult {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  const parsed = JSON.parse(jsonText) as Partial<AIAnalysisResult>;
  const parsedScore = Number(parsed.score ?? 0);
  return {
    score: Number.isFinite(parsedScore) ? Math.max(0, Math.min(100, parsedScore)) : 0,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 6) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.map(String).slice(0, 6) : [],
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String).slice(0, 8) : [],
  };
}

async function callOpenAI(settings: ServiceSettings, prompt: string): Promise<string> {
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.aiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.aiModel || MODEL_FALLBACKS.openai,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(await aiProviderErrorMessage("openai", res));
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(settings: ServiceSettings, prompt: string): Promise<string> {
  const model =
    settings.aiModel && !settings.aiModel.startsWith("claude-3-")
      ? settings.aiModel
      : MODEL_FALLBACKS.anthropic;
  const request = (selectedModel: string) =>
    fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": settings.aiApiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: 1200,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  let res = await request(model);
  if (res.status === 404 && model !== MODEL_FALLBACKS.anthropic) {
    res = await request(MODEL_FALLBACKS.anthropic);
  }
  if (!res.ok) throw new Error(await aiProviderErrorMessage("anthropic", res));
  const body = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  return body.content?.find((part) => part.type === "text")?.text ?? "";
}

async function callGemini(settings: ServiceSettings, prompt: string): Promise<string> {
  const model = (settings.aiModel || MODEL_FALLBACKS.gemini).replace(/^models\//, "");
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.aiApiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    }
  );
  if (!res.ok) throw new Error(await aiProviderErrorMessage("gemini", res));
  const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
}

async function aiProviderErrorMessage(provider: keyof typeof PROVIDER_NAMES, res: Response): Promise<string> {
  const raw = await res.text();
  let apiMessage = "";
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string } | string };
    apiMessage =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.error?.message === "string"
          ? parsed.error.message
          : "";
  } catch {
    apiMessage = raw;
  }

  const providerName = PROVIDER_NAMES[provider];
  if (res.status === 401 || res.status === 403) {
    return `${providerName}: מפתח ה-API לא תקין או שאין לו הרשאות. בדוק את המפתח בהגדרות ספקי AI.`;
  }
  if (res.status === 404) {
    return `${providerName}: המודל שנבחר לא זמין לחשבון או לא מתאים לפעולת ניתוח. טען מחדש את רשימת המודלים ובחר מודל אחר.`;
  }
  if (res.status === 429) {
    const retryMatch = apiMessage.match(/retry in ([\d.]+)s/i);
    const retryText = retryMatch ? ` נסה שוב בעוד כ-${Math.ceil(Number(retryMatch[1]))} שניות.` : "";
    return `${providerName}: המכסה של הספק נוצלה או שהחשבון לא כולל מכסה למודל הזה.${retryText} אפשר לבחור ספק/מודל אחר או לעדכן Billing אצל הספק.`;
  }
  if (res.status >= 500) {
    return `${providerName}: השירות של הספק לא זמין כרגע. נסה שוב מאוחר יותר.`;
  }
  return `${providerName}: הבקשה נכשלה (${res.status}). ${apiMessage.slice(0, 240)}`;
}

export async function analyzeBudget(settings: ServiceSettings, payload: AIAnalysisPayload): Promise<AIAnalysisResult> {
  if (!settings.aiApiKey) throw new Error("AI_API_KEY_REQUIRED");
  const prompt = promptFor(payload);
  const text =
    settings.aiProvider === "anthropic"
      ? await callAnthropic(settings, prompt)
      : settings.aiProvider === "gemini"
        ? await callGemini(settings, prompt)
        : await callOpenAI(settings, prompt);
  return parseResult(text);
}
