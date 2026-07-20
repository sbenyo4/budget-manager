import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Transaction } from "../types";
import type { Period } from "../logic/periods";
import { budgetDate, cardDebitCutoffs, isCardDebit, isCardTransactionCharged, isConsumption } from "../logic/flows";
import { isRepeatedExpenseGroup } from "../logic/expenseRecurrence";
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
import { PowerIcon } from "./PowerIcon";
import { transactionHighlightClass } from "./transactionHighlight";

function OneTimeIcon() {
  return (
    <svg className="one-time-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M5 9h14" />
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M12 13v4" />
      <path d="M10.5 14.5 12 13l1.5 1.5" />
    </svg>
  );
}

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
const MAX_INFERRED_BILLING_DAYS = 45;
type ExpenseScope = "all" | "fixed" | "variable";
type CategoryViewMode = "transactions" | "summary" | "statistics";

interface CategoryExpenseGroup {
  key: string;
  merchant: string;
  transactions: Transaction[];
  total: number;
  average: number;
  firstDate: string;
  lastDate: string;
  recurring: boolean;
}

interface WeeklyExpenseBucket {
  key: string;
  label: string;
  total: number;
  count: number;
}

interface AmountDistributionBin {
  key: string;
  label: string;
  total: number;
  count: number;
}

function fixedExpenseKey(tx: Transaction): string {
  return `${tx.categoryMain}::${merchantKey(tx)}`;
}

function expenseScopeLabel(expenseScope: ExpenseScope): string {
  if (expenseScope === "fixed") return "קבועות בלבד";
  if (expenseScope === "variable") return "חד פעמיות / לא קבועות";
  return "כל ההוצאות";
}

function periodKeyFor(date: string, periods: Period[]): string | null {
  return periods.find((p) => date >= p.from && date <= p.to)?.key ?? null;
}

function isRepeatExpenseGroup(group: { count: number; periodKeys: Set<string> }): boolean {
  return isRepeatedExpenseGroup(group.count, group.periodKeys.size);
}

function fixedExpenseKeysFor(
  transactions: Transaction[],
  periods: Period[],
  oneTimeKeys: Set<string>,
  forcedFixedKeys: Set<string>
): Set<string> {
  const groups = new Map<string, { tx: Transaction; count: number; periodKeys: Set<string>; recurring: boolean }>();

  for (const tx of transactions) {
    if (tx.type === "income" || !isConsumption(tx)) continue;
    const key = fixedExpenseKey(tx);
    const periodKey = periodKeyFor(budgetDate(tx), periods);
    const group = groups.get(key) ?? { tx, count: 0, periodKeys: new Set<string>(), recurring: false };
    group.count += 1;
    group.recurring = group.recurring || Boolean(tx.recurring);
    if (periodKey) group.periodKeys.add(periodKey);
    groups.set(key, group);
  }

  const fixedKeys = new Set<string>();
  for (const [key, group] of groups) {
    const detailKey = overrideKey(group.tx.categoryMain, merchantKey(group.tx));
    if (forcedFixedKeys.has(detailKey)) {
      fixedKeys.add(key);
      continue;
    }
    if (oneTimeKeys.has(detailKey)) continue;
    if (group.recurring || isRepeatExpenseGroup(group)) fixedKeys.add(key);
  }
  return fixedKeys;
}

function isInExpenseScope(tx: Transaction, expenseScope: ExpenseScope, fixedExpenseKeys: Set<string>): boolean {
  if (expenseScope === "all") return true;
  if (tx.type === "income" || !isConsumption(tx)) return false;
  const isFixed = fixedExpenseKeys.has(fixedExpenseKey(tx));
  return expenseScope === "fixed" ? isFixed : !isFixed;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatShortDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
}

function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weeklyExpenseBuckets(expenses: Transaction[], throughDate: string): WeeklyExpenseBucket[] {
  if (expenses.length === 0) return [];

  const dates = expenses.map((tx) => tx.date).sort();
  const firstDate = dates[0];
  const lastDate = throughDate > dates[dates.length - 1] ? throughDate : dates[dates.length - 1];
  const buckets: WeeklyExpenseBucket[] = [];
  for (let weekStart = firstDate; weekStart <= lastDate; weekStart = addIsoDays(weekStart, 7)) {
    const weekEnd = addIsoDays(weekStart, 6);
    const visibleTo = weekEnd > lastDate ? lastDate : weekEnd;
    buckets.push({
      key: weekStart,
      label: `${formatShortDate(weekStart)}–${formatShortDate(visibleTo)}`,
      total: 0,
      count: 0,
    });
  }

  const firstTimestamp = Date.parse(`${firstDate}T00:00:00Z`);
  for (const tx of expenses) {
    const transactionTimestamp = Date.parse(`${tx.date}T00:00:00Z`);
    const bucketIndex = Math.floor((transactionTimestamp - firstTimestamp) / (7 * 24 * 60 * 60 * 1000));
    const bucket = buckets[bucketIndex];
    if (!bucket) continue;
    bucket.total += tx.amount;
    bucket.count += 1;
  }

  return buckets;
}

const AMOUNT_DISTRIBUTION_RANGES = [
  { key: "under-50", label: "עד 50 ₪", min: 0, max: 50 },
  { key: "50-100", label: "50–100 ₪", min: 50, max: 100 },
  { key: "100-250", label: "100–250 ₪", min: 100, max: 250 },
  { key: "250-500", label: "250–500 ₪", min: 250, max: 500 },
  { key: "500-1000", label: "500–1,000 ₪", min: 500, max: 1000 },
  { key: "over-1000", label: "מעל 1,000 ₪", min: 1000, max: Number.POSITIVE_INFINITY },
] as const;

function amountDistribution(expenses: Transaction[]): AmountDistributionBin[] {
  const bins = AMOUNT_DISTRIBUTION_RANGES.map(({ key, label }) => ({ key, label, total: 0, count: 0 }));
  for (const tx of expenses) {
    const index = AMOUNT_DISTRIBUTION_RANGES.findIndex((range) => tx.amount >= range.min && tx.amount < range.max);
    if (index < 0) continue;
    bins[index].total += tx.amount;
    bins[index].count += 1;
  }
  return bins;
}

function inferredBillingDates(transactions: Transaction[]): Map<string, string> {
  const knownDatesByCard = new Map<string, Set<string>>();
  for (const tx of transactions) {
    if (!tx.cardLast4 || !tx.billingDate) continue;
    const dates = knownDatesByCard.get(tx.cardLast4) ?? new Set<string>();
    dates.add(tx.billingDate);
    knownDatesByCard.set(tx.cardLast4, dates);
  }

  const inferred = new Map<string, string>();
  for (const tx of transactions) {
    if (tx.billingDate || !tx.cardLast4) continue;
    const candidates = [...(knownDatesByCard.get(tx.cardLast4) ?? [])].sort();
    const purchaseTime = Date.parse(`${tx.date}T00:00:00Z`);
    const match = candidates.find((candidate) => {
      const daysAhead = (Date.parse(`${candidate}T00:00:00Z`) - purchaseTime) / (24 * 60 * 60 * 1000);
      return daysAhead >= 0 && daysAhead <= MAX_INFERRED_BILLING_DAYS;
    });
    if (match) inferred.set(tx.id, match);
  }
  return inferred;
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

function validInstallmentTotal(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 120;
}

function installmentMonthlyAmount(tx: Transaction, manualTotal?: number): number | null {
  if (!tx.installment?.monthlyAmountPending || !validInstallmentTotal(manualTotal)) return null;
  return (tx.originalAmount ?? tx.amount) / manualTotal;
}

function installmentText(tx: Transaction, manualTotal?: number): string | null {
  if (tx.installment?.monthlyAmountPending) {
    const monthlyAmount = installmentMonthlyAmount(tx, manualTotal);
    if (monthlyAmount !== null) {
      return `${manualTotal} תשלומים · חודשי ${formatILS(monthlyAmount)} · מקור: ${formatILS(tx.originalAmount ?? tx.amount)}`;
    }
    return "עסקת תשלומים · החיוב החודשי טרם דווח";
  }
  if (!tx.installment?.total || tx.installment.total <= 1) return null;
  const number = tx.installment.number ? `${tx.installment.number}/` : "";
  const original = tx.originalAmount ? ` · מקור: ${formatILS(tx.originalAmount)}` : "";
  return `תשלום ${number}${tx.installment.total}${original}`;
}

function hasPendingMonthlyInstallmentAmount(tx: Transaction, manualTotal?: number): boolean {
  return tx.installment?.monthlyAmountPending === true && !validInstallmentTotal(manualTotal);
}

function InstallmentOverrideControl({
  value,
  onSave,
}: {
  value?: number;
  onSave: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  useEffect(() => setDraft(value ? String(value) : ""), [value]);
  const parsed = Number(draft);
  const canSave = validInstallmentTotal(parsed) && parsed !== value;

  return (
    <form
      className="installment-override-control"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        if (validInstallmentTotal(parsed)) onSave(parsed);
      }}
    >
      <label>
        מספר תשלומים
        <input
          type="number"
          min="2"
          max="120"
          step="1"
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="מספר תשלומים לעסקה"
        />
      </label>
      <button type="submit" disabled={!canSave}>שמור</button>
      {value && <button type="button" onClick={() => onSave(null)}>נקה</button>}
    </form>
  );
}

function cardDigitsText(tx: Transaction): string | null {
  return tx.cardLast4 ? tx.cardLast4 : null;
}

function cardDigitsSummary(tx: Transaction, details: Transaction[]): string | null {
  if (tx.cardLast4) return cardDigitsText(tx);
  const last4s = [...new Set(details.map((detail) => detail.cardLast4).filter((last4): last4 is string => Boolean(last4)))];
  if (last4s.length === 0) return null;
  if (last4s.length === 1) return last4s[0];
  return last4s.join(", ");
}

function matchesCardFilter(tx: Transaction, cardFilter: string, details: Transaction[] = []): boolean {
  if (!cardFilter) return true;
  return tx.cardLast4 === cardFilter || details.some((detail) => detail.cardLast4 === cardFilter);
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
  const [cardFilter, setCardFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDebitId, setExpandedDebitId] = useState<string | null>(null);
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(() => new Set());
  const [excludedTransactionIds, setExcludedTransactionIds] = useState<Set<string>>(() => new Set());
  const [pendingDetailsOpen, setPendingDetailsOpen] = useState(false);
  const [expenseScope, setExpenseScope] = useState<ExpenseScope>("all");
  const [categoryViewMode, setCategoryViewMode] = useState<CategoryViewMode>("transactions");
  const sectionOverrides = preferences.sectionOverrides;
  const installmentOverrides = preferences.installmentOverrides;
  const oneTimeExpenses = useMemo(() => new Set(preferences.oneTimeExpenses), [preferences.oneTimeExpenses]);
  const fixedExpenses = useMemo(() => new Set(preferences.fixedExpenses), [preferences.fixedExpenses]);
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
  const debitCutoffs = useMemo(() => cardDebitCutoffs(categorizedTransactions), [categorizedTransactions]);

  const inPeriod = useMemo(
    () => categorizedTransactions.filter((tx) => tx.date >= periodFrom && tx.date <= periodTo),
    [categorizedTransactions, periodFrom, periodTo]
  );
  const bankTxs = useMemo(() => inPeriod.filter((tx) => tx.source !== "card"), [inPeriod]);
  const cardTxs = useMemo(() => inPeriod.filter((tx) => tx.source === "card"), [inPeriod]);
  const cardTxsByBillingPeriod = useMemo(
    () =>
      categorizedTransactions.filter((tx) => {
        if (tx.source !== "card") return false;
        const cardPeriodDate = tx.billingDate ?? tx.date;
        return cardPeriodDate >= periodFrom && cardPeriodDate <= periodTo;
      }),
    [categorizedTransactions, periodFrom, periodTo]
  );
  const filteredCardTxs = useMemo(
    () => (cardFilter ? cardTxsByBillingPeriod : cardTxs).filter((tx) => matchesCardFilter(tx, cardFilter)),
    [cardFilter, cardTxs, cardTxsByBillingPeriod]
  );
  const flowTxs = cardFilter ? filteredCardTxs : bankTxs;
  const cardOptions = useMemo(() => {
    const last4s = new Set<string>();
    for (const tx of cardTxsByBillingPeriod) {
      if (tx.cardLast4) last4s.add(tx.cardLast4);
    }
    return [...last4s].sort();
  }, [cardTxsByBillingPeriod]);

  const isPending = useCallback(
    (tx: Transaction) => tx.source === "card" && !isCardTransactionCharged(tx, debitCutoffs),
    [debitCutoffs]
  );
  const chargedCardTxsByBillingPeriod = useMemo(
    () => cardTxsByBillingPeriod.filter((tx) => !isPending(tx)),
    [cardTxsByBillingPeriod, isPending]
  );

  // Account state: what actually moved through the bank account
  const bankIncome = useMemo(() => sum(flowTxs.filter((t) => t.type === "income")), [flowTxs]);
  const bankExpense = useMemo(() => sum(flowTxs.filter((t) => t.type !== "income")), [flowTxs]);
  const net = bankIncome - bankExpense;
  const accountNet = useMemo(
    () => sum(bankTxs.filter((t) => t.type === "income")) - sum(bankTxs.filter((t) => t.type !== "income")),
    [bankTxs]
  );
  const signedBankMovement = (tx: Transaction) => (tx.type === "income" ? tx.amount : -tx.amount);
  const bankNetAfterPeriod = useMemo(
    () =>
      categorizedTransactions
        .filter(
          (tx) =>
            tx.source !== "card" &&
            tx.status !== "PENDING" &&
            tx.date > periodTo &&
            (!bankBalance?.date || tx.date <= bankBalance.date)
        )
        .reduce((total, tx) => total + signedBankMovement(tx), 0),
    [bankBalance?.date, categorizedTransactions, periodTo]
  );
  const balanceAtPeriodEnd = bankBalance ? bankBalance.balance - bankNetAfterPeriod : null;
  const balanceAtPeriodStart = balanceAtPeriodEnd === null ? null : balanceAtPeriodEnd - accountNet;

  // Upcoming bill: card activity not yet debited
  const pendingCard = useMemo(() => filteredCardTxs.filter(isPending), [filteredCardTxs, isPending]);
  const pendingInstallmentDetails = useMemo(
    () => pendingCard.filter((tx) => hasPendingMonthlyInstallmentAmount(tx, installmentOverrides[tx.id])),
    [installmentOverrides, pendingCard]
  );
  const pendingTotal = useMemo(
    () => {
      return pendingCard.reduce((total, tx) => {
        if (hasPendingMonthlyInstallmentAmount(tx, installmentOverrides[tx.id])) return total;
        const amount = installmentMonthlyAmount(tx, installmentOverrides[tx.id]) ?? tx.amount;
        return total + (tx.type === "income" ? -amount : amount);
      }, 0);
    },
    [installmentOverrides, pendingCard]
  );
  const inferredPendingBillingDates = useMemo(() => inferredBillingDates(pendingCard), [pendingCard]);
  const pendingGroups = useMemo(() => {
    const groups = new Map<string, {
      billingDate?: string;
      cardLast4?: string;
      total: number;
      transactions: Transaction[];
      inferredCount: number;
      pendingInstallmentCount: number;
    }>();
    for (const tx of pendingCard) {
      const inferredBillingDate = inferredPendingBillingDates.get(tx.id);
      const billingDate = tx.billingDate ?? inferredBillingDate;
      const key = `${billingDate ?? "next"}::${tx.cardLast4 ?? ""}`;
      const group = groups.get(key) ?? {
        billingDate,
        cardLast4: tx.cardLast4,
        total: 0,
        transactions: [],
        inferredCount: 0,
        pendingInstallmentCount: 0,
      };
      const manualInstallmentAmount = installmentMonthlyAmount(tx, installmentOverrides[tx.id]);
      if (hasPendingMonthlyInstallmentAmount(tx, installmentOverrides[tx.id])) {
        group.pendingInstallmentCount += 1;
      } else {
        const amount = manualInstallmentAmount ?? tx.amount;
        group.total += tx.type === "income" ? -amount : amount;
      }
      group.transactions.push(tx);
      if (inferredBillingDate) group.inferredCount += 1;
      groups.set(key, group);
    }
    return [...groups.values()]
      .map((group) => ({ ...group, transactions: [...group.transactions].sort((a, b) => b.date.localeCompare(a.date)) }))
      .sort((a, b) => (a.billingDate ?? "9999-99-99").localeCompare(b.billingDate ?? "9999-99-99"));
  }, [inferredPendingBillingDates, installmentOverrides, pendingCard]);
  const pendingBillingSummaries = useMemo(() => {
    const summaries = new Map<string, { billingDate?: string; total: number; count: number; pendingInstallmentCount: number }>();
    for (const group of pendingGroups) {
      const key = group.billingDate ?? "next";
      const summary = summaries.get(key) ?? {
        billingDate: group.billingDate,
        total: 0,
        count: 0,
        pendingInstallmentCount: 0,
      };
      summary.total += group.total;
      summary.count += group.transactions.length;
      summary.pendingInstallmentCount += group.pendingInstallmentCount;
      summaries.set(key, summary);
    }
    return [...summaries.values()].sort((a, b) => (a.billingDate ?? "9999-99-99").localeCompare(b.billingDate ?? "9999-99-99"));
  }, [pendingGroups]);
  const currentMonthKey = todayIso().slice(0, 7);
  const selectedPendingMonth = useMemo(() => {
    const dated = pendingBillingSummaries.filter((summary) => summary.billingDate);
    const currentMonth = dated.filter((summary) => summary.billingDate?.slice(0, 7) === currentMonthKey);
    const selectedMonthKey = currentMonth.length > 0
      ? currentMonthKey
      : dated.find((summary) => (summary.billingDate?.slice(0, 7) ?? "") > currentMonthKey)?.billingDate?.slice(0, 7);
    const selected = selectedMonthKey
      ? dated.filter((summary) => summary.billingDate?.slice(0, 7) === selectedMonthKey)
      : pendingBillingSummaries.filter((summary) => !summary.billingDate);
    return {
      monthKey: selectedMonthKey,
      billingDates: selected.flatMap((summary) => summary.billingDate ? [summary.billingDate] : []),
      total: selected.reduce((total, summary) => total + summary.total, 0),
      count: selected.reduce((count, summary) => count + summary.count, 0),
      pendingInstallmentCount: selected.reduce(
        (count, summary) => count + summary.pendingInstallmentCount,
        0
      ),
    };
  }, [currentMonthKey, pendingBillingSummaries]);
  const selectedPendingChargeTotal = selectedPendingMonth.total;
  const pendingTotalDiffersFromSelected = Math.abs(pendingTotal - selectedPendingChargeTotal) >= 0.005;
  const selectedPendingMonthIsCurrent = selectedPendingMonth.monthKey === currentMonthKey;

  // Category breakdown: replace the aggregate card debits with the card's
  // own transactions (incl. pending ones — they're real consumption)
  const breakdownExpenses = useMemo(
    () =>
      cardFilter
        ? filteredCardTxs.filter((t) => t.type !== "income" && !isPending(t))
        : [
            ...bankTxs.filter((t) => t.type !== "income" && !isCardDebit(t)),
            ...chargedCardTxsByBillingPeriod.filter((t) => t.type !== "income"),
          ],
    [bankTxs, cardFilter, chargedCardTxsByBillingPeriod, filteredCardTxs, isPending]
  );
  const fixedExpenseKeys = useMemo(
    () => fixedExpenseKeysFor(categorizedTransactions, periods, oneTimeExpenses, fixedExpenses),
    [categorizedTransactions, fixedExpenses, oneTimeExpenses, periods]
  );
  const scopedBreakdownExpenses = useMemo(
    () => breakdownExpenses.filter((tx) => isInExpenseScope(tx, expenseScope, fixedExpenseKeys)),
    [breakdownExpenses, expenseScope, fixedExpenseKeys]
  );
  const calculatedBreakdownExpenses = useMemo(
    () => scopedBreakdownExpenses.filter((tx) => !excludedTransactionIds.has(tx.id)),
    [excludedTransactionIds, scopedBreakdownExpenses]
  );
  const activeBreakdownExpenses = useMemo(
    () => calculatedBreakdownExpenses.filter((tx) => !excludedCategories.has(effectiveCategoryMain(tx))),
    [calculatedBreakdownExpenses, effectiveCategoryMain, excludedCategories]
  );
  const breakdownIncomes = useMemo(
    () =>
      cardFilter
        ? filteredCardTxs.filter((t) => t.type === "income" && !isPending(t))
        : [
            ...inPeriod.filter((t) => t.type === "income" && t.source !== "card"),
            ...chargedCardTxsByBillingPeriod.filter((t) => t.type === "income"),
          ],
    [cardFilter, chargedCardTxsByBillingPeriod, filteredCardTxs, inPeriod, isPending]
  );
  const calculatedBreakdownIncomes = useMemo(
    () => breakdownIncomes.filter((tx) => !excludedTransactionIds.has(tx.id)),
    [breakdownIncomes, excludedTransactionIds]
  );
  const categoryOptions = useMemo(
    () => [...new Set([...scopedBreakdownExpenses, ...breakdownIncomes].map(effectiveCategoryMain))],
    [scopedBreakdownExpenses, breakdownIncomes, effectiveCategoryMain]
  );
  const categoryEditorOptions = useMemo(
    () => categoryChoices(categoryOptions, sectionOverrides),
    [categoryOptions, sectionOverrides]
  );
  const expenseSlices = useMemo(() => sliceByMain(calculatedBreakdownExpenses, effectiveCategoryMain), [calculatedBreakdownExpenses, effectiveCategoryMain]);
  const incomeSlices = useMemo(() => sliceByMain(calculatedBreakdownIncomes, effectiveCategoryMain), [calculatedBreakdownIncomes, effectiveCategoryMain]);
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
    for (const tx of calculatedBreakdownIncomes) {
      const category = effectiveCategoryMain(tx);
      const current = summary.get(category) ?? { count: 0, total: 0 };
      current.count += 1;
      current.total += tx.amount;
      summary.set(category, current);
    }
    return summary;
  }, [calculatedBreakdownIncomes, effectiveCategoryMain]);
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

  const txSortDate = useCallback((tx: Transaction) => tx.source === "card" ? tx.billingDate ?? tx.date : tx.date, []);
  const sortedAccountMovements = useMemo(() => [...flowTxs].sort((a, b) => b.date.localeCompare(a.date)), [flowTxs]);
  const sortedCategoryMovements = useMemo(
    () =>
      [...scopedBreakdownExpenses, ...(expenseScope === "all" ? breakdownIncomes : [])]
        .filter((tx) => !categoryFilter || effectiveCategoryMain(tx) === categoryFilter)
        .sort((a, b) => txSortDate(b).localeCompare(txSortDate(a)) || b.date.localeCompare(a.date)),
    [breakdownIncomes, categoryFilter, effectiveCategoryMain, expenseScope, scopedBreakdownExpenses, txSortDate]
  );
  const categoryListed = useMemo(
    () => (categoryFilter || expenseScope !== "all" ? sortedCategoryMovements : sortedAccountMovements),
    [categoryFilter, expenseScope, sortedAccountMovements, sortedCategoryMovements]
  );
  const normalizedSearchQuery = useMemo(() => activeSearchQuery(searchQuery), [searchQuery]);
  const visibleSearchQuery = visibleSearchTerm(searchQuery);
  const hasActiveSearch = Boolean(normalizedSearchQuery);
  const txMatchesVisibleSearch = useCallback(
    (tx: Transaction) => {
      if (!normalizedSearchQuery) return true;
      const debitDetails = tx.detailTransactions?.length ? tx.detailTransactions : fallbackDebitDetails.get(tx.id) ?? [];
      return (
        txSelfMatchesSearch(tx, normalizedSearchQuery, effectiveCategoryMain(tx)) ||
        Boolean(
          debitDetails.some((detail) =>
            detailSelfMatchesSearch(detail, normalizedSearchQuery, effectiveCategoryMain(detail))
          )
        )
      );
    },
    [effectiveCategoryMain, fallbackDebitDetails, normalizedSearchQuery]
  );
  const toggleCategoryInCalculation = useCallback((key: string) => {
    setExcludedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const toggleTransactionInCalculation = useCallback((id: string) => {
    setExcludedTransactionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectCategoryFilter = useCallback((key: string) => {
    setCategoryFilter((current) => (current === key ? null : key));
  }, []);
  const listed = useMemo(
    () =>
      categoryListed
        .filter(txMatchesVisibleSearch),
    [categoryListed, txMatchesVisibleSearch]
  );
  const categoryExpenseGroups = useMemo<CategoryExpenseGroup[]>(() => {
    if (!categoryFilter) return [];

    const groups = new Map<string, { merchant: string; transactions: Transaction[]; total: number; recurring: boolean }>();
    for (const tx of listed) {
      const category = effectiveCategoryMain(tx);
      if (
        tx.type === "income" ||
        excludedTransactionIds.has(tx.id) ||
        excludedCategories.has(category)
      ) {
        continue;
      }

      const merchant = merchantKey(tx);
      const key = merchant.toLocaleLowerCase("he-IL");
      const group = groups.get(key) ?? { merchant, transactions: [], total: 0, recurring: false };
      group.transactions.push(tx);
      group.total += tx.amount;
      group.recurring = group.recurring || Boolean(tx.recurring) || fixedExpenseKeys.has(fixedExpenseKey(tx));
      groups.set(key, group);
    }

    return [...groups.entries()]
      .map(([key, group]) => {
        const transactions = [...group.transactions].sort((a, b) => b.date.localeCompare(a.date));
        const dates = transactions.map((tx) => tx.date).sort();
        return {
          key,
          merchant: group.merchant,
          transactions,
          total: group.total,
          average: group.total / transactions.length,
          firstDate: dates[0],
          lastDate: dates[dates.length - 1],
          recurring: group.recurring,
        };
      })
      .sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant, "he"));
  }, [categoryFilter, effectiveCategoryMain, excludedCategories, excludedTransactionIds, fixedExpenseKeys, listed]);
  const categoryChartExpenses = useMemo(
    () => categoryExpenseGroups.flatMap((group) => group.transactions),
    [categoryExpenseGroups]
  );
  const weeklyCategoryExpenses = useMemo(
    () => weeklyExpenseBuckets(categoryChartExpenses, periodTo),
    [categoryChartExpenses, periodTo]
  );
  const categoryAmountDistribution = useMemo(
    () => amountDistribution(categoryChartExpenses),
    [categoryChartExpenses]
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

  const setInstallmentOverride = useCallback((tx: Transaction, total: number | null) => {
    const next = { ...installmentOverrides };
    if (total === null) delete next[tx.id];
    else next[tx.id] = total;
    onPreferencesChange({ ...preferences, installmentOverrides: next });
  }, [installmentOverrides, onPreferencesChange, preferences]);

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
            setCategoryViewMode("transactions");
            setCardFilter("");
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
        <label htmlFor="card-select">כרטיס:</label>
        <select
          id="card-select"
          className="card-select"
          value={cardFilter}
          onChange={(e) => setCardFilter(e.target.value)}
        >
          <option value="">הכל</option>
          {cardOptions.map((last4) => (
            <option key={last4} value={last4}>
              כרטיס {last4}
            </option>
          ))}
        </select>
        <span className="search-control">
          <label htmlFor="monthly-search">חיפוש:</label>
          <input
            id="monthly-search"
            className="monthly-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="חיפוש חופשי"
          />
        </span>
        <div className="scope-toggle" role="group" aria-label="סינון הוצאות">
          <button type="button" className={expenseScope === "all" ? "active" : ""} onClick={() => setExpenseScope("all")}>
            הכל
          </button>
          <button type="button" className={expenseScope === "fixed" ? "active" : ""} onClick={() => setExpenseScope("fixed")}>
            קבועות
          </button>
          <button type="button" className={expenseScope === "variable" ? "active" : ""} onClick={() => setExpenseScope("variable")}>
            חד פעמי
          </button>
        </div>
        <span className="period-hint">{expenseScopeLabel(expenseScope)}</span>
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
          <span className="stat-label">{cardFilter ? "זיכויים בכרטיס" : "הכנסות לחשבון"}</span>
          <span className="stat-value">{formatILSWhole(bankIncome)}</span>
          <span className="stat-hint">{cardFilter ? `כרטיס ${cardFilter}` : "כל מה שנכנס לעו״ש"}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">{cardFilter ? "הוצאות בכרטיס" : "יצא מהחשבון"}</span>
          <span className="stat-value">{formatILSWhole(bankExpense)}</span>
          <span className="stat-hint">{cardFilter ? "כל עסקאות הכרטיס בתקופה" : "כולל חיובי אשראי, ני״ע והעברות"}</span>
        </div>
        <div className="stat-tile highlight">
          <span className="stat-label">{cardFilter ? "נטו בכרטיס" : "תזרים בתקופה"}</span>
          <span className={`stat-value ${net >= 0 ? "net-positive" : "net-negative"}`}>
            {net >= 0 ? "▲" : "▼"} {formatILSWhole(Math.abs(net))}
          </span>
          <span className="stat-hint">{cardFilter ? "זיכויים פחות עסקאות בכרטיס" : "הכנסות לעו״ש פחות יציאות אמיתיות מהעו״ש"}</span>
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
          <span className="stat-label">
            {selectedPendingMonthIsCurrent ? "חיובים עתידיים החודש ⏳" : "חיובים עתידיים בחודש הבא ⏳"}
          </span>
          <span className="stat-value">{formatILSWhole(selectedPendingChargeTotal)}</span>
          <span className="stat-hint">
            {pendingCard.length === 0
              ? "אין עסקאות"
              : selectedPendingMonth.billingDates.length > 0
                ? `ירד ב-${selectedPendingMonth.billingDates.map(formatShortDate).join(", ")}`
                : "בחיוב הבא"}
          </span>
          {pendingCard.length > 0 && pendingTotalDiffersFromSelected && (
            <span className="stat-hint pending-next-charge">
              <span>
                סה"כ כל החיובים העתידיים: {formatILS(pendingTotal)} · {pendingCard.length} עסקאות
              </span>
            </span>
          )}
          {pendingInstallmentDetails.length > 0 && (
            <span className="stat-hint">
              {pendingInstallmentDetails.length} עסקאות תשלומים ממתינות לפירוט חודשי
            </span>
          )}
          <span className="stat-action-icon" aria-hidden>{pendingDetailsOpen ? "▴" : "▾"}</span>
        </button>
      </div>

      {pendingDetailsOpen && (
        <section className="pending-card-detail" aria-label="פירוט אשראי שטרם חויב">
          <div className="pending-card-detail-header">
            <h3>פירוט אשראי שטרם חויב</h3>
            <span>
              {pendingCard.length > 0
                ? `${pendingCard.length} עסקאות · חיובים ידועים ${formatILS(pendingTotal)}${pendingInstallmentDetails.length > 0 ? ` · ${pendingInstallmentDetails.length} ממתינות לפירוט תשלומים` : ""}`
                : "אין עסקאות להצגה"}
            </span>
          </div>
          {pendingGroups.length > 0 ? (
            <div className="pending-card-groups">
              {pendingGroups.map((group) => (
                <div key={`${group.billingDate ?? "next"}-${group.cardLast4 ?? "card"}`} className="pending-card-group">
                  <div className="pending-card-group-head">
                    <span>
                      {group.billingDate ? `יחויב ב-${formatShortDate(group.billingDate)}` : "בחיוב הבא"}
                      {group.cardLast4 && <span className="sub-label"> · כרטיס {group.cardLast4}</span>}
                      {group.inferredCount > 0 && (
                        <span className="sub-label"> · כולל {group.inferredCount} {group.inferredCount === 1 ? "שיוך משוער" : "שיוכים משוערים"}</span>
                      )}
                    </span>
                    <strong>
                      {formatILS(group.total)}
                      {group.pendingInstallmentCount > 0 && (
                        <span className="sub-label"> + {group.pendingInstallmentCount} עסקאות תשלומים ללא סכום חודשי</span>
                      )}
                    </strong>
                  </div>
                  <ul className="pending-card-list">
                    {group.transactions.map((tx) => {
                      const categoryMain = effectiveCategoryMain(tx);
                      const manualInstallmentTotal = installmentOverrides[tx.id];
                      const manualInstallmentAmount = installmentMonthlyAmount(tx, manualInstallmentTotal);
                      const installment = installmentText(tx, manualInstallmentTotal);
                      return (
                        <li key={tx.id} className="pending-card-item">
                          <span className="pending-card-date">{formatShortDate(tx.date)}</span>
                          <span className="pending-card-merchant">
                            {tx.merchant}
                            {installment && <span className="sub-label"> · {installment}</span>}
                            {tx.installment?.monthlyAmountPending && (
                              <InstallmentOverrideControl
                                value={manualInstallmentTotal}
                                onSave={(total) => setInstallmentOverride(tx, total)}
                              />
                            )}
                          </span>
                          <span className="pending-card-category">
                            <span className="swatch" style={{ background: mainColor(categoryMain) }} aria-hidden />
                            {categoryLabel(categoryMain)}
                          </span>
                          <strong className="pending-card-amount">
                            {hasPendingMonthlyInstallmentAmount(tx, manualInstallmentTotal)
                              ? `סה״כ עסקה ${formatILS(tx.originalAmount ?? tx.amount)}`
                              : `${tx.type === "income" ? "+" : "−"}${formatILS(manualInstallmentAmount ?? tx.amount)}`}
                          </strong>
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
            {categoryFilter ? "תנועות בקטגוריה" : cardFilter ? "עסקאות בכרטיס" : "תנועות חשבון בפועל"}
            {categoryFilter && <span className="filter-tag"> · {categoryLabel(categoryFilter)}</span>}
            {cardFilter && <span className="filter-tag"> · כרטיס {cardFilter}</span>}
            {hasActiveSearch && <span className="filter-tag"> · "{visibleSearchQuery}"</span>}
            {expenseScope !== "all" && <span className="filter-tag"> · {expenseScopeLabel(expenseScope)}</span>}
          </h2>
          {(categoryFilter || cardFilter || hasActiveSearch || expenseScope !== "all") && (
            <button
              className="table-toggle"
              onClick={() => {
                setCategoryFilter(null);
                setCategoryViewMode("transactions");
                setCardFilter("");
                setSearchQuery("");
                setExpenseScope("all");
              }}
            >
              ניקוי סינון ✕
            </button>
          )}
        </div>
        {categoryFilter && (
          <div className="category-view-tabs" role="tablist" aria-label="אופן הצגת הקטגוריה">
            <button
              type="button"
              role="tab"
              aria-selected={categoryViewMode === "transactions"}
              className={categoryViewMode === "transactions" ? "active" : ""}
              onClick={() => setCategoryViewMode("transactions")}
            >
              תנועות
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={categoryViewMode === "summary"}
              className={categoryViewMode === "summary" ? "active" : ""}
              onClick={() => setCategoryViewMode("summary")}
            >
              תצוגה מרוכזת
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={categoryViewMode === "statistics"}
              className={categoryViewMode === "statistics" ? "active" : ""}
              onClick={() => setCategoryViewMode("statistics")}
            >
              סטטיסטיקות
            </button>
          </div>
        )}
        {categoryFilter && categoryViewMode === "summary" ? (
          <div className="category-grouped-view" role="tabpanel" aria-label="תצוגה מרוכזת לפי בית עסק">
            {categoryExpenseGroups.map((group) => (
              <details key={group.key} className="category-expense-group">
                <summary>
                  <span className="category-group-expander" aria-hidden>›</span>
                  <span className="category-group-identity">
                    <strong>{highlightSearchText(group.merchant, visibleSearchQuery)}</strong>
                    <span className="category-group-meta">
                      {group.transactions.length} תנועות
                      {group.firstDate !== group.lastDate && ` · ${formatShortDate(group.firstDate)}–${formatShortDate(group.lastDate)}`}
                      {group.recurring && <span className="recurring-tag"> · קבועה / חוזרת</span>}
                    </span>
                  </span>
                  <span className="category-group-average">
                    ממוצע {formatILSWhole(group.average)}
                  </span>
                  <strong className="category-group-total">{formatILS(group.total)}</strong>
                </summary>
                <ul className="category-group-transactions">
                  {group.transactions.map((tx) => (
                    <li key={tx.id}>
                      <span className="category-group-transaction-date">{formatShortDate(tx.date)}</span>
                      <span className="category-group-transaction-merchant">
                        {highlightSearchText(tx.merchant, visibleSearchQuery)}
                        {installmentText(tx, installmentOverrides[tx.id]) && (
                          <span className="sub-label"> · {installmentText(tx, installmentOverrides[tx.id])}</span>
                        )}
                      </span>
                      <span className="category-group-transaction-source">
                        {tx.source === "card" ? (tx.cardLast4 ? `כרטיס ${tx.cardLast4}` : "אשראי") : "בנק"}
                      </span>
                      <strong>{formatILS(tx.amount)}</strong>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {categoryExpenseGroups.length === 0 && (
              <p className="empty-row">אין הוצאות תואמות להצגה מרוכזת</p>
            )}
          </div>
        ) : categoryFilter && categoryViewMode === "statistics" ? (
          <CategoryExpenseStatistics
            weeklyBuckets={weeklyCategoryExpenses}
            distribution={categoryAmountDistribution}
            expenses={categoryChartExpenses}
            color={mainColor(categoryFilter)}
            throughDate={periodTo}
          />
        ) : (
        <div className="table-wrap" role={categoryFilter ? "tabpanel" : undefined} aria-label={categoryFilter ? "תנועות בקטגוריה" : undefined}>
          <table className="tx-table">
            <colgroup>
              <col className="tx-col-date" />
              <col className="tx-col-merchant" />
              <col className="tx-col-category" />
              <col className="tx-col-source" />
              <col className="tx-col-amount" />
            </colgroup>
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
                const allDebitDetails = tx.detailTransactions?.length ? tx.detailTransactions : fallbackDebitDetails.get(tx.id) ?? [];
                const debitDetails = allDebitDetails.filter((detail) => {
                  if (categoryFilter && effectiveCategoryMain(detail) !== categoryFilter) return false;
                  if (!isInExpenseScope(detail, expenseScope, fixedExpenseKeys)) return false;
                  if (cardFilter && !matchesCardFilter(detail, cardFilter)) return false;
                  if (normalizedSearchQuery && !detailSelfMatchesSearch(detail, normalizedSearchQuery, effectiveCategoryMain(detail))) {
                    return false;
                  }
                  return true;
                });
                const singleDebitDetail = isCardDebit(tx) && debitDetails.length === 1 ? debitDetails[0] : null;
                const displayTx = singleDebitDetail ?? tx;
                const displayCategoryMain = effectiveCategoryMain(displayTx);
                const categoryMainLabel = categoryLabel(displayCategoryMain);
                const categorySubLabel = displaySubLabel(displayTx.categorySub);
                const isCategoryExcluded = excludedCategories.has(displayCategoryMain);
                const canToggleTransaction = !isCardDebit(tx) || Boolean(singleDebitDetail);
                const isTransactionExcluded = canToggleTransaction && excludedTransactionIds.has(displayTx.id);
                const displayDate = new Date(`${tx.date}T00:00:00`).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
                const canExpandDebit = isCardDebit(tx) && debitDetails.length > 1;
                const isExpandedBySearch = canExpandDebit && detailMatchesSearch(debitDetails, normalizedSearchQuery, effectiveCategoryMain);
                const isExpanded = expandedDebitId === tx.id || isExpandedBySearch;
                const toggleDebitDetails = () => setExpandedDebitId(isExpanded ? null : tx.id);
                const cardSummary =
                  isCardDebit(tx) || displayTx.source === "card" ? cardDigitsSummary(displayTx, debitDetails) : null;
                const sourceLabel = cardSummary ?? (tx.source === "card" ? "אשראי" : "");
                const sourceClass = cardSummary ? "card-digits" : tx.source === "card" ? "card" : "bank";
                const isReportedPending = tx.status === "PENDING";
                return (
                <Fragment key={tx.id}>
                <tr
                  className={`${isCardDebit(tx) ? "aggregate-row" : ""} ${canExpandDebit ? "expandable-row" : ""} ${isTransactionExcluded ? "excluded-transaction" : ""} ${transactionHighlightClass(tx, highAmountThreshold)}`.trim()}
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
                  <td className="merchant-cell">
                    <span className="merchant-inline">
                    {canToggleTransaction && (
                      <button
                        type="button"
                        className={`category-power transaction-power row-transaction-power ${isTransactionExcluded ? "excluded" : ""}`}
                        title={isTransactionExcluded ? "החזרת התנועה לחישוב" : "הוצאת התנועה מהחישוב"}
                        aria-label={isTransactionExcluded ? "החזרת התנועה לחישוב" : "הוצאת התנועה מהחישוב"}
                        aria-pressed={!isTransactionExcluded}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleTransactionInCalculation(displayTx.id);
                        }}
                      >
                        <PowerIcon />
                      </button>
                    )}
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
                    <span className="merchant-text">{highlightSearchText(displayTx.merchant, visibleSearchQuery)}
                    {singleDebitDetail && <span className="sub-label"> · עסקת אשראי יחידה</span>}
                    {canExpandDebit && <span className="sub-label"> · {debitDetails.length} עסקאות בכרטיס</span>}
                    {installmentText(displayTx, installmentOverrides[displayTx.id]) && (
                      <span className="sub-label"> · {installmentText(displayTx, installmentOverrides[displayTx.id])}</span>
                    )}
                    {displayTx.recurring && <span className="recurring-tag"> · מנוי / קבוע</span>}
                    {isCardDebit(tx) && allDebitDetails.length === 0 && isReportedPending && (
                      <span className="sub-label"> · החיוב דווח בסטטוס זמני והפירוט עשוי להתעדכן</span>
                    )}
                    {isCardDebit(tx) && allDebitDetails.length === 0 && !isReportedPending && (
                      <span className="sub-label"> · לא נמצא פירוט תואם בדיווח חברת האשראי</span>
                    )}
                      </span>
                    {isReportedPending && (
                      <span className="pending-chip" title="ספק הנתונים החזיר סטטוס PENDING; אין בכך ודאות שהחיוב טרם בוצע">
                        ⏳ טרם סופי
                      </span>
                    )}
                    {!isReportedPending && isPending(tx) && (
                      <span className="pending-chip" title="עסקת אשראי שטרם חויבה בחשבון">
                        ⏳ טרם חויב
                      </span>
                    )}
                    </span>
                  </td>
                  <td>
                      <span className="cat-cell">
                      <span className="cat-current">
                        <button
                          type="button"
                          style={{ display: categoryFilter ? "none" : undefined }}
                          className={`category-power row-category-power ${isCategoryExcluded ? "excluded" : ""}`}
                          title={isCategoryExcluded ? `החזרת ${categoryMainLabel} לחישוב` : `הוצאת ${categoryMainLabel} מהחישוב`}
                          aria-label={isCategoryExcluded ? `החזרת ${categoryMainLabel} לחישוב` : `הוצאת ${categoryMainLabel} מהחישוב`}
                          aria-pressed={!isCategoryExcluded}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleCategoryInCalculation(displayCategoryMain);
                          }}
                        >
                          <PowerIcon />
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
                          className={`legend-state-action one-time-action ${oneTimeExpenses.has(oneTimeKey(displayTx)) ? "active" : ""}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleOneTime(displayTx);
                          }}
                          aria-pressed={oneTimeExpenses.has(oneTimeKey(displayTx))}
                          title="סימון העסקה כחד פעמית"
                          aria-label="סימון העסקה כחד פעמית"
                        >
                          <OneTimeIcon />
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
                    {sourceLabel && <span className={`source-chip ${sourceClass}`}>{highlightSearchText(sourceLabel, visibleSearchQuery)}</span>}
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
                          const detailInstallment = installmentText(detail, installmentOverrides[detail.id]);
                          const detailDate = new Date(`${detail.date}T00:00:00`).toLocaleDateString("he-IL", {
                            day: "numeric",
                            month: "numeric",
                          });
                          const detailCategoryMain = effectiveCategoryMain(detail);
                          const detailCategoryMainLabel = categoryLabel(detailCategoryMain);
                          const isDetailCategoryExcluded = excludedCategories.has(detailCategoryMain);
                          const isDetailTransactionExcluded = excludedTransactionIds.has(detail.id);
                          const detailCard = cardDigitsText(detail);
                          const detailSubLabel = displaySubLabel(detail.categorySub);
                          const detailAmount = formatILS(detail.amount);
                          return (
                            <li key={detail.id} className={`debit-detail-item ${isDetailTransactionExcluded ? "excluded-transaction" : ""}`}>
                              <span className="debit-detail-date">
                                {highlightSearchText(detailDate, visibleSearchQuery)}
                                {detailCard && (
                                  <span className="debit-detail-card">{highlightSearchText(detailCard, visibleSearchQuery)}</span>
                                )}
                              </span>
                              <span className="debit-detail-merchant">
                                <button
                                  type="button"
                                  className={`category-power transaction-power row-transaction-power ${isDetailTransactionExcluded ? "excluded" : ""}`}
                                  title={isDetailTransactionExcluded ? "החזרת התנועה לחישוב" : "הוצאת התנועה מהחישוב"}
                                  aria-label={isDetailTransactionExcluded ? "החזרת התנועה לחישוב" : "הוצאת התנועה מהחישוב"}
                                  aria-pressed={!isDetailTransactionExcluded}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleTransactionInCalculation(detail.id);
                                  }}
                                >
                                  <PowerIcon />
                                </button>
                                <span className="debit-detail-merchant-text">{highlightSearchText(detail.merchant, visibleSearchQuery)}</span>
                              </span>
                              <span className="debit-detail-category">
                                <span className="cat-current compact">
                                  <button
                                    type="button"
                                    style={{ display: categoryFilter ? "none" : undefined }}
                                    className={`category-power row-category-power ${isDetailCategoryExcluded ? "excluded" : ""}`}
                                    title={isDetailCategoryExcluded ? `החזרת ${detailCategoryMainLabel} לחישוב` : `הוצאת ${detailCategoryMainLabel} מהחישוב`}
                                    aria-label={isDetailCategoryExcluded ? `החזרת ${detailCategoryMainLabel} לחישוב` : `הוצאת ${detailCategoryMainLabel} מהחישוב`}
                                    aria-pressed={!isDetailCategoryExcluded}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleCategoryInCalculation(detailCategoryMain);
                                    }}
                                  >
                                    <PowerIcon />
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
                                    className={`legend-state-action one-time-action ${oneTimeExpenses.has(oneTimeKey(detail)) ? "active" : ""}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleOneTime(detail);
                                    }}
                                    aria-pressed={oneTimeExpenses.has(oneTimeKey(detail))}
                                    title="סימון העסקה כחד פעמית"
                                    aria-label="סימון העסקה כחד פעמית"
                                  >
                                    <OneTimeIcon />
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
        )}
      </section>
    </div>
  );
}

function CategoryExpenseStatistics({
  weeklyBuckets,
  distribution,
  expenses,
  color,
  throughDate,
}: {
  weeklyBuckets: WeeklyExpenseBucket[];
  distribution: AmountDistributionBin[];
  expenses: Transaction[];
  color: string;
  throughDate: string;
}) {
  if (expenses.length === 0) {
    return (
      <div className="category-charts empty-row" role="tabpanel">
        אין הוצאות תואמות להצגה בסטטיסטיקות
      </div>
    );
  }

  const total = expenses.reduce((sum, tx) => sum + tx.amount, 0);
  const sortedAmounts = expenses.map((tx) => tx.amount).sort((a, b) => a - b);
  const middle = Math.floor(sortedAmounts.length / 2);
  const median = sortedAmounts.length % 2
    ? sortedAmounts[middle]
    : (sortedAmounts[middle - 1] + sortedAmounts[middle]) / 2;
  const averageTransaction = total / expenses.length;
  const firstExpenseDate = expenses.reduce((earliest, tx) => tx.date < earliest ? tx.date : earliest, expenses[0].date);
  const lastAnalysisDate = throughDate > firstExpenseDate ? throughDate : firstExpenseDate;
  const analysisDays = Math.max(
    Math.floor((Date.parse(`${lastAnalysisDate}T00:00:00Z`) - Date.parse(`${firstExpenseDate}T00:00:00Z`)) / 86_400_000) + 1,
    1
  );
  const averageDay = total / analysisDays;
  const averageWeek = averageDay * 7;
  const averageWeeklyCount = (expenses.length / analysisDays) * 7;
  const maxWeeklyTotal = Math.max(...weeklyBuckets.map((bucket) => bucket.total), 1);
  const maxWeeklyCount = Math.max(...weeklyBuckets.map((bucket) => bucket.count), 1);
  const maxBinCount = Math.max(...distribution.map((bin) => bin.count), 1);

  return (
    <div className="category-charts" role="tabpanel" aria-label="סטטיסטיקות של הוצאות הקטגוריה">
      <section className="category-statistics-summary" aria-label="ממוצעי הוצאה">
        <div className="category-statistic-card">
          <span>ממוצע הוצאה ליום</span>
          <strong>{formatILS(averageDay)}</strong>
          <small>לפי {analysisDays} ימים מההוצאה הראשונה</small>
        </div>
        <div className="category-statistic-card">
          <span>ממוצע הוצאה לשבוע</span>
          <strong>{formatILS(averageWeek)}</strong>
          <small>קצב שבועי מנורמל ל־7 ימים</small>
        </div>
      </section>
      <section className="category-chart-section">
        <div className="category-chart-heading">
          <h3>הוצאות לפי שבוע</h3>
          <span>ממוצע שבועי {formatILSWhole(averageWeek)}</span>
        </div>
        <div
          className="weekly-expense-chart"
          role="img"
          aria-label={`הוצאות שבועיות, ממוצע ${formatILSWhole(averageWeek)}`}
          style={{ gridTemplateColumns: `repeat(${weeklyBuckets.length}, minmax(0, 1fr))` }}
        >
          {weeklyBuckets.map((bucket) => {
            const height = bucket.total > 0 ? Math.max((bucket.total / maxWeeklyTotal) * 100, 3) : 0;
            return (
              <div
                key={bucket.key}
                className="weekly-expense-column"
                aria-label={`${bucket.label}: ${formatILS(bucket.total)}, ${bucket.count} עסקאות`}
              >
                <strong>{formatILSWhole(bucket.total)}</strong>
                <div className="weekly-expense-track" aria-hidden>
                  <span style={{ height: `${height}%`, backgroundColor: color }} />
                </div>
                <span className="weekly-expense-label">{bucket.label}</span>
                <span className="weekly-expense-count">{bucket.count} עסקאות</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="category-chart-section">
        <div className="category-chart-heading">
          <h3>כמות הוצאות לפי שבוע</h3>
          <span>ממוצע {averageWeeklyCount.toFixed(1)} עסקאות בשבוע</span>
        </div>
        <div
          className="weekly-expense-chart weekly-count-chart"
          role="img"
          aria-label={`כמות עסקאות לפי שבוע, ממוצע ${averageWeeklyCount.toFixed(1)}`}
          style={{ gridTemplateColumns: `repeat(${weeklyBuckets.length}, minmax(0, 1fr))` }}
        >
          {weeklyBuckets.map((bucket) => {
            const height = bucket.count > 0 ? Math.max((bucket.count / maxWeeklyCount) * 100, 3) : 0;
            return (
              <div
                key={bucket.key}
                className="weekly-expense-column"
                aria-label={`${bucket.label}: ${bucket.count} עסקאות בסך ${formatILS(bucket.total)}`}
              >
                <strong>{bucket.count}</strong>
                <div className="weekly-expense-track" aria-hidden>
                  <span style={{ height: `${height}%`, backgroundColor: color }} />
                </div>
                <span className="weekly-expense-label">{bucket.label}</span>
                <span className="weekly-expense-count">{formatILSWhole(bucket.total)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="category-chart-section amount-distribution-section">
        <div className="category-chart-heading">
          <h3>התפלגות סכומי העסקאות</h3>
          <span>חציון {formatILSWhole(median)} · ממוצע {formatILSWhole(averageTransaction)}</span>
        </div>
        <div
          className="amount-distribution-chart"
          role="img"
          aria-label={`התפלגות של ${expenses.length} עסקאות, חציון ${formatILSWhole(median)}`}
        >
          {distribution.map((bin) => (
            <div key={bin.key} className="amount-distribution-row">
              <span className="amount-distribution-label">{bin.label}</span>
              <span className="amount-distribution-track" aria-hidden>
                <span style={{ width: `${(bin.count / maxBinCount) * 100}%`, backgroundColor: color }} />
              </span>
              <span className="amount-distribution-count">
                {bin.count} · {Math.round((bin.count / expenses.length) * 100)}%
              </span>
              <strong>{formatILSWhole(bin.total)}</strong>
            </div>
          ))}
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
