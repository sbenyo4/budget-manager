import { Fragment, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Transaction } from "../types";
import type { Period } from "../logic/periods";
import { isCardDebit, isConsumption } from "../logic/flows";
import type { BudgetPreferences } from "../api/preferences";
import { displaySubLabel, mainColor } from "../logic/categoryNames";
import {
  categoryChoices,
  categoryLabel,
  customCategoryKey,
  merchantKey,
  overrideKey,
} from "../logic/categoryOverrides";
import { Donut, type DonutSlice } from "./Donut";
import { formatILS, formatILSWhole, todayIso } from "./format";
import { transactionHighlightClass } from "./transactionHighlight";

interface Props {
  /** Full (multi-month) transaction list — needed to find the last card debit */
  transactions: Transaction[];
  periods: Period[];
  /** Real current checking balance (null in demo mode → only period flow shown) */
  bankBalance: { balance: number; date: string } | null;
  preferences: BudgetPreferences;
  onPreferencesChange: (preferences: BudgetPreferences) => void;
}

function sliceByMain(txs: Transaction[], categoryFor: (tx: Transaction) => string = (tx) => tx.categoryMain): DonutSlice[] {
  const totals = new Map<string, number>();
  for (const tx of txs) {
    const category = categoryFor(tx);
    totals.set(category, (totals.get(category) ?? 0) + tx.amount);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([main, value]) => ({ key: main, label: categoryLabel(main), value, color: mainColor(main) }));
}

const sum = (txs: Transaction[]) => txs.reduce((s, t) => s + t.amount, 0);
const amountCents = (value: number) => Math.round(value * 100);
const MIN_SEARCH_CHARS = 2;

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatShortDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
}

function activeSearchQuery(value: string): string {
  const normalized = normalizeSearchText(value);
  return normalized.length >= MIN_SEARCH_CHARS ? normalized : "";
}

function visibleSearchTerm(value: string): string {
  const term = value.trim();
  return term.length >= MIN_SEARCH_CHARS ? term : "";
}

function subscriptionSearchAliases(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized.includes("מנוי") || normalized.includes("מינוי") ? ["מנוי", "מנויים", "מינוי", "מינויים"] : [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightSearchText(value: string | number, query: string): ReactNode {
  const text = String(value);
  const term = query.trim();
  if (!term) return text;

  const regex = new RegExp(`(${escapeRegExp(term)})`, "gi");
  const parts = text.split(regex);
  if (parts.length === 1) {
    const textAliases = subscriptionSearchAliases(text);
    const termAliases = subscriptionSearchAliases(term);
    const hasAliasMatch = textAliases.length > 0 && termAliases.some((alias) => textAliases.includes(alias));
    return hasAliasMatch ? <mark className="search-hit">{text}</mark> : text;
  }

  const normalizedTerm = term.toLowerCase();
  return parts.map((part, index) =>
    part.toLowerCase() === normalizedTerm ? (
      <mark key={`${part}-${index}`} className="search-hit">
        {part}
      </mark>
    ) : (
      <Fragment key={`${part}-${index}`}>{part}</Fragment>
    )
  );
}

function searchValuesFor(tx: Transaction, categoryMain = tx.categoryMain): string[] {
  const date = new Date(`${tx.date}T00:00:00`).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "numeric",
    year: "2-digit",
  });
  const mainLabel = categoryLabel(categoryMain);
  const subLabel = displaySubLabel(tx.categorySub);
  return [
    tx.date,
    date,
    tx.merchant,
    mainLabel,
    subLabel,
    ...subscriptionSearchAliases(mainLabel),
    ...subscriptionSearchAliases(subLabel),
    tx.source === "card" ? "אשראי" : "בנק",
    tx.type === "income" ? "הכנסה" : "הוצאה",
    String(tx.amount),
  ];
}

function detailSearchValuesFor(tx: Transaction, categoryMain = tx.categoryMain, includeCategory = false): string[] {
  const date = new Date(`${tx.date}T00:00:00`).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "numeric",
    year: "2-digit",
  });
  const mainLabel = categoryLabel(categoryMain);
  const subLabel = displaySubLabel(tx.categorySub);
  return [
    tx.date,
    date,
    tx.merchant,
    ...(includeCategory
      ? [
          mainLabel,
          subLabel,
          ...subscriptionSearchAliases(mainLabel),
          ...subscriptionSearchAliases(subLabel),
        ]
      : []),
    tx.cardLast4 ? `כרטיס ${tx.cardLast4}` : "",
    String(tx.amount),
    formatILS(tx.amount),
  ];
}

function valuesMatchSearch(values: string[], query: string): boolean {
  return normalizeSearchText(values.join(" ")).includes(query);
}

function txSelfMatchesSearch(tx: Transaction, query: string, categoryMain = tx.categoryMain): boolean {
  if (!query) return true;
  return valuesMatchSearch(searchValuesFor(tx, categoryMain), query);
}

function shouldSearchDetailCategory(query: string): boolean {
  return query.length >= 4 || subscriptionSearchAliases(query).length > 0;
}

function detailSelfMatchesSearch(tx: Transaction, query: string, categoryMain = tx.categoryMain): boolean {
  if (!query) return true;
  return valuesMatchSearch(detailSearchValuesFor(tx, categoryMain, shouldSearchDetailCategory(query)), query);
}

function detailMatchesSearch(
  details: Transaction[],
  query: string,
  categoryFor: (tx: Transaction) => string = (tx) => tx.categoryMain
): boolean {
  return Boolean(query) && details.some((detail) => detailSelfMatchesSearch(detail, query, categoryFor(detail)));
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("button, select, input, textarea, a, [role='button']"));
}

function installmentText(tx: Transaction): string | null {
  if (!tx.installment?.total || tx.installment.total <= 1) return null;
  const number = tx.installment.number ? `${tx.installment.number}/` : "";
  const original = tx.originalAmount ? ` · מקור: ${formatILS(tx.originalAmount)}` : "";
  return `תשלום ${number}${tx.installment.total}${original}`;
}

function cardDigitsText(tx: Transaction): string | null {
  return tx.cardLast4 ? `כרטיס ${tx.cardLast4}` : null;
}

function cardDigitsSummary(tx: Transaction, details: Transaction[]): string | null {
  if (tx.cardLast4) return cardDigitsText(tx);
  const last4s = [...new Set(details.map((detail) => detail.cardLast4).filter(Boolean))];
  if (last4s.length === 0) return null;
  if (last4s.length === 1) return `כרטיס ${last4s[0]}`;
  return `כרטיסים ${last4s.join(", ")}`;
}

function fallbackCardDebitDetails(transactions: Transaction[]): Map<string, Transaction[]> {
  const cardGroupsByBillingDate = new Map<string, Array<{ totalCents: number; details: Transaction[] }>>();
  const debitsByDate = new Map<string, Transaction[]>();
  const assignments = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    if (isCardDebit(tx)) {
      const debits = debitsByDate.get(tx.date) ?? [];
      debits.push(tx);
      debitsByDate.set(tx.date, debits);
    }

    if (tx.source !== "card" || !tx.billingDate) continue;
    const groups = cardGroupsByBillingDate.get(tx.billingDate) ?? [];
    const key = `${tx.cardProvider ?? ""}:${tx.cardLast4 ?? ""}`;
    const group = groups.find(
      (candidate) => `${candidate.details[0]?.cardProvider ?? ""}:${candidate.details[0]?.cardLast4 ?? ""}` === key
    );
    if (group) {
      group.totalCents += amountCents(tx.amount);
      group.details.push(tx);
    } else {
      groups.push({ totalCents: amountCents(tx.amount), details: [tx] });
    }
    cardGroupsByBillingDate.set(tx.billingDate, groups);
  }

  for (const [date, debits] of debitsByDate) {
    const groups = cardGroupsByBillingDate.get(date) ?? [];
    const used = new Set<number>();

    for (const tx of debits) {
      if (!tx.cardLast4) continue;
      const groupIndex = groups.findIndex(
        (group, index) => !used.has(index) && group.details.some((detail) => detail.cardLast4 === tx.cardLast4)
      );
      if (groupIndex >= 0) {
        used.add(groupIndex);
        assignments.set(tx.id, [...groups[groupIndex].details].sort((a, b) => b.date.localeCompare(a.date)));
      }
    }

    for (const tx of debits) {
      if (assignments.has(tx.id)) continue;
      const groupIndex = groups.findIndex(
        (group, index) =>
          !used.has(index) &&
          Math.abs(group.totalCents - amountCents(tx.amount)) <= 1 &&
          (!tx.cardLast4 || group.details.some((detail) => detail.cardLast4 === tx.cardLast4))
      );
      if (groupIndex >= 0) {
        used.add(groupIndex);
        assignments.set(tx.id, [...groups[groupIndex].details].sort((a, b) => b.date.localeCompare(a.date)));
      }
    }
  }

  return assignments;
}

export function MonthlyView({
  transactions,
  periods,
  bankBalance,
  preferences,
  onPreferencesChange,
}: Props) {
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDebitId, setExpandedDebitId] = useState<string | null>(null);
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(() => new Set());
  const [pendingDetailsOpen, setPendingDetailsOpen] = useState(false);
  const sectionOverrides = preferences.sectionOverrides;
  const oneTimeExpenses = useMemo(() => new Set(preferences.oneTimeExpenses), [preferences.oneTimeExpenses]);
  const highAmountThreshold = preferences.highAmountThreshold;
  const categorizedTransactions = transactions;
  const fallbackDebitDetails = useMemo(() => fallbackCardDebitDetails(categorizedTransactions), [categorizedTransactions]);
  const effectiveCategoryMain = useCallback(
    (tx: Transaction) => sectionOverrides[overrideKey(tx.categoryMain, merchantKey(tx))] ?? tx.categoryMain,
    [sectionOverrides]
  );

  const period = useMemo(() => {
    if (periodKey) return periods.find((p) => p.key === periodKey) ?? periods[0];
    const today = todayIso();
    return periods.find((p) => today >= p.from && today <= p.to) ?? periods[0] ?? null;
  }, [periodKey, periods]);
  const periodFrom = period?.from ?? "";
  const periodTo = period?.to ?? "";

  // Card purchases after the last aggregate card debit haven't been charged
  // to the account yet — they're the upcoming bill
  const lastDebitDate = useMemo(
    () =>
      categorizedTransactions
        .filter((t) => isCardDebit(t) && t.type !== "income")
        .reduce((max, t) => (t.date > max ? t.date : max), ""),
    [categorizedTransactions]
  );

  const inPeriod = useMemo(
    () => categorizedTransactions.filter((tx) => tx.date >= periodFrom && tx.date <= periodTo),
    [categorizedTransactions, periodFrom, periodTo]
  );
  const bankTxs = useMemo(() => inPeriod.filter((tx) => tx.source !== "card"), [inPeriod]);
  const cardTxs = useMemo(() => inPeriod.filter((tx) => tx.source === "card"), [inPeriod]);

  const isPending = (tx: Transaction) => tx.source === "card" && (tx.billingDate ?? tx.date) > lastDebitDate;

  // Account state: what actually moved through the bank account
  const bankIncome = useMemo(() => sum(bankTxs.filter((t) => t.type === "income")), [bankTxs]);
  const bankExpense = useMemo(() => sum(bankTxs.filter((t) => t.type !== "income")), [bankTxs]);
  const net = bankIncome - bankExpense;
  const signedBankMovement = (tx: Transaction) => (tx.type === "income" ? tx.amount : -tx.amount);
  const bankNetAfterPeriod = useMemo(
    () =>
      categorizedTransactions
        .filter((tx) => tx.source !== "card" && tx.date > periodTo)
        .reduce((total, tx) => total + signedBankMovement(tx), 0),
    [categorizedTransactions, periodTo]
  );
  const balanceAtPeriodEnd = bankBalance ? bankBalance.balance - bankNetAfterPeriod : null;
  const balanceAtPeriodStart = balanceAtPeriodEnd === null ? null : balanceAtPeriodEnd - net;

  // Upcoming bill: card activity not yet debited
  const pendingCard = useMemo(() => cardTxs.filter(isPending), [cardTxs, lastDebitDate]);
  const pendingTotal = useMemo(
    () => sum(pendingCard.filter((t) => t.type !== "income")) - sum(pendingCard.filter((t) => t.type === "income")),
    [pendingCard]
  );
  const pendingGroups = useMemo(() => {
    const groups = new Map<string, { billingDate?: string; cardLast4?: string; total: number; transactions: Transaction[] }>();
    for (const tx of pendingCard) {
      const key = `${tx.billingDate ?? "next"}::${tx.cardLast4 ?? ""}`;
      const group = groups.get(key) ?? {
        billingDate: tx.billingDate,
        cardLast4: tx.cardLast4,
        total: 0,
        transactions: [],
      };
      group.total += tx.type === "income" ? -tx.amount : tx.amount;
      group.transactions.push(tx);
      groups.set(key, group);
    }
    return [...groups.values()]
      .map((group) => ({ ...group, transactions: [...group.transactions].sort((a, b) => b.date.localeCompare(a.date)) }))
      .sort((a, b) => (a.billingDate ?? "9999-99-99").localeCompare(b.billingDate ?? "9999-99-99"));
  }, [pendingCard]);
  const pendingBillingSummaries = useMemo(() => {
    const summaries = new Map<string, { billingDate?: string; total: number; count: number }>();
    for (const group of pendingGroups) {
      const key = group.billingDate ?? "next";
      const summary = summaries.get(key) ?? { billingDate: group.billingDate, total: 0, count: 0 };
      summary.total += group.total;
      summary.count += group.transactions.length;
      summaries.set(key, summary);
    }
    return [...summaries.values()].sort((a, b) => (a.billingDate ?? "9999-99-99").localeCompare(b.billingDate ?? "9999-99-99"));
  }, [pendingGroups]);
  const nextPendingCharge = pendingBillingSummaries[0];

  // Category breakdown: replace the aggregate card debits with the card's
  // own transactions (incl. pending ones — they're real consumption)
  const breakdownExpenses = useMemo(
    () => [
      ...bankTxs.filter((t) => t.type !== "income" && !isCardDebit(t)),
      ...cardTxs.filter((t) => t.type !== "income"),
    ],
    [bankTxs, cardTxs]
  );
  const activeBreakdownExpenses = useMemo(
    () => breakdownExpenses.filter((tx) => !excludedCategories.has(effectiveCategoryMain(tx))),
    [breakdownExpenses, effectiveCategoryMain, excludedCategories]
  );
  const breakdownIncomes = useMemo(() => inPeriod.filter((t) => t.type === "income"), [inPeriod]);
  const categoryOptions = useMemo(
    () => [...new Set([...breakdownExpenses, ...breakdownIncomes].map(effectiveCategoryMain))],
    [breakdownExpenses, breakdownIncomes, effectiveCategoryMain]
  );
  const categoryEditorOptions = useMemo(
    () => categoryChoices(categoryOptions, sectionOverrides),
    [categoryOptions, sectionOverrides]
  );
  const expenseSlices = useMemo(() => sliceByMain(breakdownExpenses, effectiveCategoryMain), [breakdownExpenses, effectiveCategoryMain]);
  const incomeSlices = useMemo(() => sliceByMain(breakdownIncomes, effectiveCategoryMain), [breakdownIncomes, effectiveCategoryMain]);
  const expenseSummaryByCategory = useMemo(() => {
    const summary = new Map<string, { count: number; total: number }>();
    for (const tx of activeBreakdownExpenses) {
      const category = effectiveCategoryMain(tx);
      const current = summary.get(category) ?? { count: 0, total: 0 };
      current.count += 1;
      current.total += tx.amount;
      summary.set(category, current);
    }
    return summary;
  }, [activeBreakdownExpenses, effectiveCategoryMain]);
  const incomeSummaryByCategory = useMemo(() => {
    const summary = new Map<string, { count: number; total: number }>();
    for (const tx of breakdownIncomes) {
      const category = effectiveCategoryMain(tx);
      const current = summary.get(category) ?? { count: 0, total: 0 };
      current.count += 1;
      current.total += tx.amount;
      summary.set(category, current);
    }
    return summary;
  }, [breakdownIncomes, effectiveCategoryMain]);
  const allExpenseTotal = useMemo(() => sum(activeBreakdownExpenses), [activeBreakdownExpenses]);
  const categorySummary = useMemo(() => {
    if (!categoryFilter) return null;
    const categoryExpenses = expenseSummaryByCategory.get(categoryFilter) ?? { count: 0, total: 0 };
    const categoryIncomes = incomeSummaryByCategory.get(categoryFilter) ?? { count: 0, total: 0 };
    return {
      expenseCount: categoryExpenses.count,
      expenseTotal: categoryExpenses.total,
      incomeTotal: categoryIncomes.total,
      hasIncome: categoryIncomes.count > 0,
      share: allExpenseTotal > 0 ? Math.round((categoryExpenses.total / allExpenseTotal) * 100) : null,
      average: categoryExpenses.count > 0 ? categoryExpenses.total / categoryExpenses.count : null,
    };
  }, [allExpenseTotal, categoryFilter, expenseSummaryByCategory, incomeSummaryByCategory]);

  const sortedAccountMovements = useMemo(() => [...bankTxs].sort((a, b) => b.date.localeCompare(a.date)), [bankTxs]);
  const categoryListed = useMemo(
    () =>
      sortedAccountMovements.filter(
        (tx) =>
          !categoryFilter ||
          effectiveCategoryMain(tx) === categoryFilter ||
          Boolean(tx.detailTransactions?.some((detail) => effectiveCategoryMain(detail) === categoryFilter))
      ),
    [categoryFilter, effectiveCategoryMain, sortedAccountMovements]
  );
  const normalizedSearchQuery = useMemo(() => activeSearchQuery(searchQuery), [searchQuery]);
  const visibleSearchQuery = visibleSearchTerm(searchQuery);
  const hasActiveSearch = Boolean(normalizedSearchQuery);
  const txMatchesVisibleSearch = useCallback(
    (tx: Transaction) => {
      if (!normalizedSearchQuery) return true;
      return (
        txSelfMatchesSearch(tx, normalizedSearchQuery, effectiveCategoryMain(tx)) ||
        Boolean(
          tx.detailTransactions?.some((detail) =>
            detailSelfMatchesSearch(detail, normalizedSearchQuery, effectiveCategoryMain(detail))
          )
        )
      );
    },
    [effectiveCategoryMain, normalizedSearchQuery]
  );
  const toggleCategoryInCalculation = useCallback((key: string) => {
    setExcludedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const selectCategoryFilter = useCallback((key: string) => {
    setCategoryFilter((current) => (current === key ? null : key));
  }, []);
  const listed = useMemo(
    () => categoryListed.filter(txMatchesVisibleSearch),
    [categoryListed, txMatchesVisibleSearch]
  );

  const categorizeMerchant = useCallback((tx: Transaction, category: string) => {
    const merchant = merchantKey(tx);
    const raw = category.trim();
    const isKnownCategory = categoryEditorOptions.some((option) => option.value === raw);
    const value = raw && isKnownCategory ? raw : raw ? customCategoryKey(raw) : "";
    const next = { ...sectionOverrides };
    const key = overrideKey(tx.categoryMain, merchant);
    if (value) next[key] = value;
    else delete next[key];
    onPreferencesChange({ ...preferences, sectionOverrides: next });
  }, [categoryEditorOptions, onPreferencesChange, preferences, sectionOverrides]);

  function oneTimeKey(tx: Transaction): string {
    return overrideKey(tx.categoryMain, merchantKey(tx));
  }

  const toggleOneTime = useCallback((tx: Transaction) => {
    const key = oneTimeKey(tx);
    const nextFixed = new Set(preferences.fixedExpenses);
    nextFixed.delete(key);
    const nextOneTime = new Set(oneTimeExpenses);
    if (nextOneTime.has(key)) nextOneTime.delete(key);
    else nextOneTime.add(key);
    onPreferencesChange({
      ...preferences,
      fixedExpenses: [...nextFixed],
      oneTimeExpenses: [...nextOneTime],
    });
  }, [oneTimeExpenses, onPreferencesChange, preferences]);

  if (!period) {
    return <p className="loading">אין נתונים להצגה.</p>;
  }

  return (
    <div className="monthly-view">
      <div className="period-row">
        <label htmlFor="period-select">תקופה:</label>
        <select
          id="period-select"
          value={period.key}
          onChange={(e) => {
            setPeriodKey(e.target.value);
            setCategoryFilter(null);
            setSearchQuery("");
            setExpandedDebitId(null);
          }}
        >
          {periods.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <label htmlFor="category-select">קטגוריה:</label>
        <select
          id="category-select"
          value={categoryFilter ?? ""}
          onChange={(e) => setCategoryFilter(e.target.value || null)}
        >
          <option value="">הכל</option>
          {categoryOptions.map((m) => (
            <option key={m} value={m}>
              {categoryLabel(m)}
            </option>
          ))}
        </select>
        <label htmlFor="monthly-search">חיפוש:</label>
        <input
          id="monthly-search"
          className="monthly-search"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="חיפוש חופשי"
        />
      </div>

      {categoryFilter && (
        <div className="stat-tiles category-summary">
          <div className="stat-tile highlight">
            <span className="stat-label">
              <span className="swatch" style={{ background: mainColor(categoryFilter) }} aria-hidden />{" "}
              {categoryLabel(categoryFilter)} בתקופה זו
            </span>
            <span className="stat-value">
              {formatILSWhole(categorySummary?.expenseTotal ?? 0)}
            </span>
            <span className="stat-hint">
              {categorySummary?.expenseCount ?? 0} עסקאות הוצאה
              {categorySummary?.hasIncome && ` · הכנסות: ${formatILS(categorySummary.incomeTotal)}`}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">חלק מהוצאות התקופה</span>
            <span className="stat-value">{(categorySummary?.share ?? null) !== null ? `${categorySummary?.share}%` : "—"}</span>
            <span className="stat-hint">מסך ההוצאות כולל פירוט אשראי</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">ממוצע לעסקה</span>
            <span className="stat-value">{(categorySummary?.average ?? null) !== null ? formatILSWhole(categorySummary?.average ?? 0) : "—"}</span>
            <span className="stat-hint">בקטגוריה זו</span>
          </div>
        </div>
      )}

      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-label">הכנסות לחשבון</span>
          <span className="stat-value">{formatILSWhole(bankIncome)}</span>
          <span className="stat-hint">כל מה שנכנס לעו״ש</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">יצא מהחשבון</span>
          <span className="stat-value">{formatILSWhole(bankExpense)}</span>
          <span className="stat-hint">כולל חיובי אשראי, ני״ע והעברות</span>
        </div>
        <div className="stat-tile highlight">
          <span className="stat-label">תזרים בתקופה</span>
          <span className={`stat-value ${net >= 0 ? "net-positive" : "net-negative"}`}>
            {net >= 0 ? "▲" : "▼"} {formatILSWhole(Math.abs(net))}
          </span>
          <span className="stat-hint">הכנסות לעו״ש פחות יציאות אמיתיות מהעו״ש</span>
        </div>
        <div className={bankBalance ? "stat-tile highlight" : "stat-tile"}>
          <span className="stat-label">{bankBalance ? "יתרת עו״ש בפועל" : "יתרת עו״ש בפועל"}</span>
          <span className={`stat-value ${bankBalance && bankBalance.balance < 0 ? "net-negative" : "net-positive"}`}>
            {bankBalance ? formatILSWhole(bankBalance.balance) : "—"}
          </span>
          <span className="stat-hint">
            {bankBalance
              ? `מהבנק, נכון ל-${bankBalance.date.slice(8, 10)}.${bankBalance.date.slice(5, 7)}`
              : "לא זמין במצב הדגמה"}
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">יתרה בסוף התקופה</span>
          <span className={`stat-value ${balanceAtPeriodEnd !== null && balanceAtPeriodEnd < 0 ? "net-negative" : ""}`}>
            {balanceAtPeriodEnd !== null ? formatILSWhole(balanceAtPeriodEnd) : "—"}
          </span>
          <span className="stat-hint">
            {balanceAtPeriodStart !== null
              ? `תחילת תקופה: ${formatILS(balanceAtPeriodStart)}`
              : "מחושבת מהיתרה הנוכחית ותנועות הבנק"}
          </span>
        </div>
        <button
          type="button"
          className={`stat-tile pending-stat-tile ${pendingDetailsOpen ? "active" : ""}`}
          onClick={() => setPendingDetailsOpen((open) => !open)}
          aria-expanded={pendingDetailsOpen}
        >
          <span className="stat-label">אשראי שטרם חויב ⏳</span>
          <span className="stat-value">{formatILSWhole(pendingTotal)}</span>
          <span className="stat-hint">
            {pendingCard.length === 0
              ? "אין עסקאות"
              : `${pendingCard.length} עסקאות`}
          </span>
          {nextPendingCharge && (
            <span className="stat-hint pending-next-charge">
              <span>
                {nextPendingCharge.billingDate ? `ב-${formatShortDate(nextPendingCharge.billingDate)}` : "בחיוב הבא"} ירדו{" "}
                {formatILS(nextPendingCharge.total)}
              </span>
            </span>
          )}
          <span className="stat-action-icon" aria-hidden>{pendingDetailsOpen ? "▴" : "▾"}</span>
        </button>
      </div>

      {pendingDetailsOpen && (
        <section className="pending-card-detail" aria-label="פירוט אשראי שטרם חויב">
          <div className="pending-card-detail-header">
            <h3>פירוט אשראי שטרם חויב</h3>
            <span>{pendingCard.length > 0 ? `${pendingCard.length} עסקאות · ${formatILS(pendingTotal)}` : "אין עסקאות להצגה"}</span>
          </div>
          {pendingGroups.length > 0 ? (
            <div className="pending-card-groups">
              {pendingGroups.map((group) => (
                <div key={`${group.billingDate ?? "next"}-${group.cardLast4 ?? "card"}`} className="pending-card-group">
                  <div className="pending-card-group-head">
                    <span>
                      {group.billingDate ? `יחויב ב-${formatShortDate(group.billingDate)}` : "בחיוב הבא"}
                      {group.cardLast4 && <span className="sub-label"> · כרטיס {group.cardLast4}</span>}
                    </span>
                    <strong>{formatILS(group.total)}</strong>
                  </div>
                  <ul className="pending-card-list">
                    {group.transactions.map((tx) => {
                      const categoryMain = effectiveCategoryMain(tx);
                      const installment = installmentText(tx);
                      return (
                        <li key={tx.id} className="pending-card-item">
                          <span className="pending-card-date">{formatShortDate(tx.date)}</span>
                          <span className="pending-card-merchant">
                            {tx.merchant}
                            {installment && <span className="sub-label"> · {installment}</span>}
                          </span>
                          <span className="pending-card-category">
                            <span className="swatch" style={{ background: mainColor(categoryMain) }} aria-hidden />
                            {categoryLabel(categoryMain)}
                          </span>
                          <strong className="pending-card-amount">{tx.type === "income" ? "+" : "−"}{formatILS(tx.amount)}</strong>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-row">אין עסקאות אשראי שטרם חויבו בתקופה הזו.</p>
          )}
        </section>
      )}

      <div className="donut-grid">
        <Donut
          title="הוצאות לפי קטגוריה — כולל פירוט האשראי"
          slices={expenseSlices}
          selectedKey={categoryFilter}
          onSelect={setCategoryFilter}
          excludedKeys={excludedCategories}
          onToggleKey={toggleCategoryInCalculation}
          highAmountThreshold={highAmountThreshold}
        />
        <Donut
          title="הכנסות לפי קטגוריה"
          slices={incomeSlices}
          selectedKey={categoryFilter}
          onSelect={setCategoryFilter}
          highAmountThreshold={highAmountThreshold}
        />
      </div>

      <section className="period-detail">
        <div className="detail-header">
          <h2>
            תנועות חשבון בפועל
            {categoryFilter && <span className="filter-tag"> · {categoryLabel(categoryFilter)}</span>}
            {hasActiveSearch && <span className="filter-tag"> · "{visibleSearchQuery}"</span>}
          </h2>
          {(categoryFilter || hasActiveSearch) && (
            <button
              className="table-toggle"
              onClick={() => {
                setCategoryFilter(null);
                setSearchQuery("");
              }}
            >
              ניקוי סינון ✕
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table className="tx-table">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>בית עסק</th>
                <th>קטגוריה</th>
                <th>מקור</th>
                <th className="num">סכום</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((tx) => {
                const debitDetails = tx.detailTransactions?.length ? tx.detailTransactions : fallbackDebitDetails.get(tx.id) ?? [];
                const singleDebitDetail = isCardDebit(tx) && debitDetails.length === 1 ? debitDetails[0] : null;
                const displayTx = singleDebitDetail ?? tx;
                const displayCategoryMain = effectiveCategoryMain(displayTx);
                const categoryMainLabel = categoryLabel(displayCategoryMain);
                const categorySubLabel = displaySubLabel(displayTx.categorySub);
                const isCategoryExcluded = excludedCategories.has(displayCategoryMain);
                const displayDate = new Date(`${tx.date}T00:00:00`).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
                const canExpandDebit = isCardDebit(tx) && debitDetails.length > 1;
                const isExpandedBySearch = canExpandDebit && detailMatchesSearch(debitDetails, normalizedSearchQuery, effectiveCategoryMain);
                const isExpanded = expandedDebitId === tx.id || isExpandedBySearch;
                const toggleDebitDetails = () => setExpandedDebitId(isExpanded ? null : tx.id);
                const cardSummary =
                  isCardDebit(tx) || displayTx.source === "card" ? cardDigitsSummary(displayTx, debitDetails) : null;
                const sourceLabel = cardSummary ?? (tx.source === "card" ? "אשראי" : "בנק");
                const sourceClass = cardSummary ? "card-digits" : tx.source === "card" ? "card" : "bank";
                return (
                <Fragment key={tx.id}>
                <tr
                  className={`${isCardDebit(tx) ? "aggregate-row" : ""} ${canExpandDebit ? "expandable-row" : ""} ${transactionHighlightClass(tx, highAmountThreshold)}`.trim()}
                  onClick={
                    canExpandDebit
                      ? (event) => {
                          if (!isInteractiveTarget(event.target)) toggleDebitDetails();
                        }
                      : undefined
                  }
                  tabIndex={canExpandDebit ? 0 : undefined}
                  onKeyDown={
                    canExpandDebit
                      ? (event) => {
                          if (isInteractiveTarget(event.target)) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleDebitDetails();
                          }
                        }
                      : undefined
                  }
                >
                  <td>{highlightSearchText(displayDate, visibleSearchQuery)}</td>
                  <td>
                    {canExpandDebit && (
                      <button
                        type="button"
                        className="row-expander"
                        aria-label={isExpanded ? "סגירת פירוט חיוב אשראי" : "פתיחת פירוט חיוב אשראי"}
                        aria-expanded={isExpanded}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleDebitDetails();
                        }}
                      >
                        {isExpanded ? "▾" : "▸"}
                      </button>
                    )}
                    {highlightSearchText(displayTx.merchant, visibleSearchQuery)}
                    {singleDebitDetail && <span className="sub-label"> · עסקת אשראי יחידה</span>}
                    {canExpandDebit && <span className="sub-label"> · {debitDetails.length} עסקאות בכרטיס</span>}
                    {installmentText(displayTx) && <span className="sub-label"> · {installmentText(displayTx)}</span>}
                    {displayTx.recurring && <span className="recurring-tag"> · מנוי / קבוע</span>}
                    {isCardDebit(tx) && !singleDebitDetail && <span className="sub-label"> (מפורט בשורות האשראי)</span>}
                  </td>
                  <td>
                    <span className="cat-cell">
                      <span className="cat-current">
                        <button
                          type="button"
                          className={`category-power ${isCategoryExcluded ? "excluded" : ""}`}
                          title={isCategoryExcluded ? `החזרת ${categoryMainLabel} לחישוב` : `הוצאת ${categoryMainLabel} מהחישוב`}
                          aria-label={isCategoryExcluded ? `החזרת ${categoryMainLabel} לחישוב` : `הוצאת ${categoryMainLabel} מהחישוב`}
                          aria-pressed={!isCategoryExcluded}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleCategoryInCalculation(displayCategoryMain);
                          }}
                        >
                          ⏻
                        </button>
                        <button
                          type="button"
                          className={`category-filter-action ${categoryFilter === displayCategoryMain ? "active" : ""}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectCategoryFilter(displayCategoryMain);
                          }}
                        >
                          <span className="swatch" style={{ background: mainColor(displayCategoryMain) }} aria-hidden />
                          <span className="cat-main-label">{highlightSearchText(categoryMainLabel, visibleSearchQuery)}</span>
                        </button>
                        {categorySubLabel && <span className="sub-label">{highlightSearchText(categorySubLabel, visibleSearchQuery)}</span>}
                      </span>
                      {displayTx.type !== "income" && isConsumption(displayTx) && (
                        <button
                          type="button"
                          className={`legend-state-action ${oneTimeExpenses.has(oneTimeKey(displayTx)) ? "active" : ""}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleOneTime(displayTx);
                          }}
                          aria-pressed={oneTimeExpenses.has(oneTimeKey(displayTx))}
                          title="סימון העסקה כחד פעמית"
                        >
                          חד פעמי
                        </button>
                      )}
                      {(!isCardDebit(tx) || singleDebitDetail) && (
                        <MonthlyCategoryPicker
                          value={sectionOverrides[overrideKey(displayTx.categoryMain, merchantKey(displayTx))] ?? displayTx.categoryMain}
                          options={categoryEditorOptions}
                          onChange={(nextCategory) => categorizeMerchant(displayTx, nextCategory)}
                        />
                      )}
                    </span>
                  </td>
                  <td className="source-cell">
                    <span className={`source-chip ${sourceClass}`}>{highlightSearchText(sourceLabel, visibleSearchQuery)}</span>
                    {isPending(tx) && <span className="pending-chip">⏳ טרם חויב</span>}
                  </td>
                  <td className={`num ${tx.type === "income" ? "net-positive" : ""}`}>
                    {tx.type === "income" ? "+" : "−"}{highlightSearchText(formatILS(tx.amount), visibleSearchQuery)}
                  </td>
                </tr>
                {canExpandDebit && isExpanded && (
                  <tr className="debit-detail-row">
                    <td colSpan={5}>
                      <ul className="debit-detail-list" aria-label="פירוט עסקאות חיוב אשראי">
                        {debitDetails.map((detail) => {
                          const detailInstallment = installmentText(detail);
                          const detailDate = new Date(`${detail.date}T00:00:00`).toLocaleDateString("he-IL", {
                            day: "numeric",
                            month: "numeric",
                          });
                          const detailCategoryMain = effectiveCategoryMain(detail);
                          const detailCategoryMainLabel = categoryLabel(detailCategoryMain);
                          const isDetailCategoryExcluded = excludedCategories.has(detailCategoryMain);
                          const detailCard = cardDigitsText(detail);
                          const detailSubLabel = displaySubLabel(detail.categorySub);
                          const detailAmount = formatILS(detail.amount);
                          return (
                            <li key={detail.id} className="debit-detail-item">
                              <span className="debit-detail-date">
                                {highlightSearchText(detailDate, visibleSearchQuery)}
                                {detailCard && (
                                  <span className="debit-detail-card">{highlightSearchText(detailCard, visibleSearchQuery)}</span>
                                )}
                              </span>
                              <span className="debit-detail-merchant">{highlightSearchText(detail.merchant, visibleSearchQuery)}</span>
                              <span className="debit-detail-category">
                                <span className="cat-current compact">
                                  <button
                                    type="button"
                                    className={`category-power ${isDetailCategoryExcluded ? "excluded" : ""}`}
                                    title={isDetailCategoryExcluded ? `החזרת ${detailCategoryMainLabel} לחישוב` : `הוצאת ${detailCategoryMainLabel} מהחישוב`}
                                    aria-label={isDetailCategoryExcluded ? `החזרת ${detailCategoryMainLabel} לחישוב` : `הוצאת ${detailCategoryMainLabel} מהחישוב`}
                                    aria-pressed={!isDetailCategoryExcluded}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleCategoryInCalculation(detailCategoryMain);
                                    }}
                                  >
                                    ⏻
                                  </button>
                                  <button
                                    type="button"
                                    className={`category-filter-action ${categoryFilter === detailCategoryMain ? "active" : ""}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      selectCategoryFilter(detailCategoryMain);
                                    }}
                                  >
                                    <span className="swatch" style={{ background: mainColor(detailCategoryMain) }} aria-hidden />
                                    <span className="cat-main-label">{highlightSearchText(detailCategoryMainLabel, visibleSearchQuery)}</span>
                                  </button>
                                </span>
                                {detailSubLabel && <span className="sub-label">{highlightSearchText(detailSubLabel, visibleSearchQuery)}</span>}
                                {detailInstallment && (
                                  <span className="sub-label"> · {highlightSearchText(detailInstallment, visibleSearchQuery)}</span>
                                )}
                              </span>
                              <span className="debit-detail-actions">
                                {detail.type !== "income" && isConsumption(detail) && (
                                  <button
                                    type="button"
                                    className={`legend-state-action ${oneTimeExpenses.has(oneTimeKey(detail)) ? "active" : ""}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleOneTime(detail);
                                    }}
                                    aria-pressed={oneTimeExpenses.has(oneTimeKey(detail))}
                                    title="סימון העסקה כחד פעמית"
                                  >
                                    חד פעמי
                                  </button>
                                )}
                                <MonthlyCategoryPicker
                                  value={sectionOverrides[overrideKey(detail.categoryMain, merchantKey(detail))] ?? detail.categoryMain}
                                  options={categoryEditorOptions}
                                  onChange={(nextCategory) => categorizeMerchant(detail, nextCategory)}
                                />
                              </span>
                              <span className="debit-detail-amount">{highlightSearchText(detailAmount, visibleSearchQuery)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
              {listed.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-row">אין תנועות תואמות</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MonthlyCategoryPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (category: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const isKnown = !value || options.some((option) => option.value === value);

  return (
    <span
      className="monthly-category-picker"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <select
        value={isCreating || !isKnown ? "__new" : value}
        onChange={(event) => {
          const next = event.target.value;
          if (next === "__new") {
            setDraft("");
            setIsCreating(true);
            return;
          }
          setIsCreating(false);
          onChange(next);
        }}
        aria-label="בחירת קטגוריה לעסקה"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        <option value="__new">קטגוריה חדשה...</option>
      </select>
      {(isCreating || !isKnown) && (
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim()) {
              onChange(draft);
              setIsCreating(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim()) {
              onChange(draft);
              setIsCreating(false);
            }
          }}
          placeholder="שם קטגוריה"
          aria-label="שם קטגוריה חדשה"
        />
      )}
    </span>
  );
}
