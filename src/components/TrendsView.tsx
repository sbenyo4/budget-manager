import { useCallback, useMemo, useState } from "react";
import type { Transaction } from "../types";
import type { Period } from "../logic/periods";
import { isConsumption, isSavings } from "../logic/flows";
import type { BudgetPreferences } from "../api/preferences";
import { mainColor, subLabel } from "../logic/categoryNames";
import {
  categoryChoices,
  categoryLabel,
  customCategoryKey,
  defaultCategoryForMerchant,
  merchantKey,
  overrideKey,
  type SectionOverrides,
} from "../logic/categoryOverrides";
import { Donut, type CategoryChoice, type DonutSlice, type DonutSliceDetail } from "./Donut";
import { formatILS, formatILSWhole } from "./format";

interface Props {
  transactions: Transaction[];
  periods: Period[];
  /** Real current checking balance (null in demo mode → relative sums shown) */
  bankBalance: { balance: number; date: string } | null;
  preferences: BudgetPreferences;
  onPreferencesChange: (preferences: BudgetPreferences) => void;
}

interface PeriodMetrics {
  period: Period;
  /** month-only label, e.g. "יולי 2026" */
  shortLabel: string;
  income: number;
  expense: number;
  securities: number;
  leftover: number;
  /** total + count for the selected category (0 when no category chosen) */
  catExpense: number;
  catCount: number;
}

interface FixedBreakdownRow {
  key: string;
  label: string;
  total: number;
  count: number;
  periodCount: number;
  average: number;
  share: number;
  transactions: Transaction[];
  isOther?: boolean;
  oneTime?: boolean;
  oneTimeAuto?: boolean;
  fixedOverride?: boolean;
  children?: FixedBreakdownRow[];
}

type ExpenseScope = "all" | "fixed" | "variable";

/** Money movements that are neither earnings nor consumption. */
const NON_FLOW_MAINS = new Set(["TRADING", "TRANSFER", "ASSETS", "DEPOSIT"]);
function fixedExpenseKey(tx: Transaction): string {
  return `${tx.categoryMain}::${merchantKey(tx)}`;
}

function isInExpenseScope(tx: Transaction, expenseScope: ExpenseScope, fixedExpenseKeys: Set<string>): boolean {
  if (expenseScope === "all") return true;
  const isFixed = fixedExpenseKeys.has(fixedExpenseKey(tx));
  return expenseScope === "fixed" ? isFixed : !isFixed;
}

function expenseScopeLabel(expenseScope: ExpenseScope): string {
  if (expenseScope === "fixed") return "קבועות בלבד";
  if (expenseScope === "variable") return "לא קבועות בלבד";
  return "כולל קבועות וחד פעמיות";
}

function isRepeatVariableGroup(group: { count: number; periodKeys: Set<string> }): boolean {
  return group.periodKeys.size >= 2 || group.count >= 2;
}

function isFixedGroup(group: { count: number; periodKeys: Set<string>; recurring: boolean }): boolean {
  return group.recurring || isRepeatVariableGroup(group);
}

function metricsFor(
  transactions: Transaction[],
  period: Period,
  category: string | null,
  excludedCategories: Set<string>,
  expenseScope: ExpenseScope,
  fixedExpenseKeys: Set<string>
): PeriodMetrics {
  const inP = transactions.filter((tx) => tx.date >= period.from && tx.date <= period.to);

  // earnings: money into the bank account, excluding securities sales /
  // deposit withdrawals / transfers (those move savings, they don't earn)
  const income = inP
    .filter((t) => t.type === "income" && t.source !== "card" && !NON_FLOW_MAINS.has(t.categoryMain))
    .reduce((s, t) => s + t.amount, 0);

  // consumption: bank spending (minus aggregate card debits) + card detail
  const consumption = inP.filter(
    (t) =>
      t.type !== "income" &&
      isConsumption(t) &&
      !excludedCategories.has(t.categoryMain) &&
      isInExpenseScope(t, expenseScope, fixedExpenseKeys)
  );
  const expense = consumption.reduce((s, t) => s + t.amount, 0);

  // net saved/invested: securities, deposits and investment transfers,
  // minus withdrawals and sales
  const securities =
    inP.filter((t) => isSavings(t) && t.type !== "income").reduce((s, t) => s + t.amount, 0) -
    inP.filter((t) => isSavings(t) && t.type === "income").reduce((s, t) => s + t.amount, 0);

  const catTxs = category ? consumption.filter((t) => t.categoryMain === category) : [];

  return {
    period,
    shortLabel: period.label.split(" · ")[0],
    income,
    expense,
    securities,
    leftover: income - expense - securities,
    catExpense: catTxs.reduce((s, t) => s + t.amount, 0),
    catCount: catTxs.length,
  };
}

const ALL_SERIES = [
  { key: "income", label: "הכנסות", color: "var(--cat-1)" },
  { key: "expense", label: "הוצאות", color: "var(--cat-8)" },
  { key: "securities", label: "חיסכון והשקעות", color: "var(--cat-7)" },
] as const;

type SeriesKey = (typeof ALL_SERIES)[number]["key"] | "catExpense";

function periodKeyFor(date: string, periods: Period[]): string | null {
  return periods.find((p) => date >= p.from && date <= p.to)?.key ?? null;
}

function fixedBreakdownFor(
  transactions: Transaction[],
  periods: Period[],
  category: string,
  from: string,
  to: string,
  sectionOverrides: SectionOverrides = {},
  oneTimeKeys: Set<string> = new Set(),
  fixedKeys: Set<string> = new Set()
): FixedBreakdownRow[] {
  const groups = new Map<
    string,
    { label: string; total: number; count: number; periodKeys: Set<string>; recurring: boolean; transactions: Transaction[] }
  >();

  for (const tx of transactions) {
    if (tx.type === "income" || !isConsumption(tx) || tx.categoryMain !== category) continue;
    if (tx.date < from || tx.date > to) continue;
    const merchant = merchantKey(tx);
    const customSection = sectionOverrides[overrideKey(category, merchant)];
    const key = customSection ? `section:${customSection}` : merchant;
    const periodKey = periodKeyFor(tx.date, periods);
    const group = groups.get(key) ?? {
      label: customSection || merchant || subLabel(tx.categorySub),
      total: 0,
      count: 0,
      periodKeys: new Set<string>(),
      recurring: Boolean(customSection),
      transactions: [],
    };
    group.total += tx.amount;
    group.count += 1;
    group.recurring = group.recurring || Boolean(tx.recurring);
    group.transactions.push(tx);
    if (periodKey) group.periodKeys.add(periodKey);
    groups.set(key, group);
  }

  const periodCount = Math.max(1, periods.length);
  const total = [...groups.values()].reduce((sum, group) => sum + group.total, 0);
  const fixed: FixedBreakdownRow[] = [];
  let oneTimeTotal = 0;
  let oneTimeCount = 0;
  const oneTimeChildren: FixedBreakdownRow[] = [];

  for (const [key, group] of groups) {
    const detailKey = overrideKey(category, key);
    const isForcedFixed = fixedKeys.has(detailKey);
    const isOneTime = oneTimeKeys.has(detailKey) && !isForcedFixed;
    const isFixed = isForcedFixed || (!isOneTime && isFixedGroup(group));
    if (!isFixed) {
      const isRepeatVariable = !isOneTime && isRepeatVariableGroup(group);
      const child: FixedBreakdownRow = {
        key: detailKey,
        label: group.label,
        total: group.total,
        count: group.count,
        periodCount: group.periodKeys.size,
        average: group.total / periodCount,
        share: total > 0 ? group.total / total : 0,
        transactions: group.transactions,
        oneTime: !isRepeatVariable,
        oneTimeAuto: !isRepeatVariable && !isOneTime,
        fixedOverride: false,
      };
      if (isRepeatVariable) {
        fixed.push(child);
      } else {
        oneTimeTotal += group.total;
        oneTimeCount += group.count;
        oneTimeChildren.push(child);
      }
      continue;
    }
    fixed.push({
      key: customSectionKey(category, key, group.label),
      label: group.label,
      total: group.total,
      count: group.count,
      periodCount: group.periodKeys.size,
      average: group.total / periodCount,
      share: total > 0 ? group.total / total : 0,
      transactions: group.transactions,
      oneTime: isOneTime,
      oneTimeAuto: false,
      fixedOverride: isForcedFixed,
    });
  }

  if (oneTimeTotal > 0) {
    fixed.push({
      key: "__other",
      label: "רכישות חד פעמיות",
      total: oneTimeTotal,
      count: oneTimeCount,
      periodCount: 0,
      average: oneTimeTotal / periodCount,
      share: total > 0 ? oneTimeTotal / total : 0,
      transactions: oneTimeChildren.flatMap((child) => child.transactions),
      isOther: true,
      oneTime: true,
      oneTimeAuto: true,
      children: oneTimeChildren.sort((a, b) => b.total - a.total),
    });
  }

  return fixed.sort((a, b) => {
    if (a.isOther !== b.isOther) return a.isOther ? -1 : 1;
    return b.total - a.total;
  });
}

function fixedExpenseKeysFor(
  transactions: Transaction[],
  periods: Period[],
  from: string,
  to: string,
  oneTimeKeys: Set<string>,
  forcedFixedKeys: Set<string>
): Set<string> {
  const groups = new Map<string, { tx: Transaction; count: number; periodKeys: Set<string>; recurring: boolean; transactions: Transaction[] }>();

  for (const tx of transactions) {
    if (tx.type === "income" || !isConsumption(tx)) continue;
    if (tx.date < from || tx.date > to) continue;
    const key = fixedExpenseKey(tx);
    const periodKey = periodKeyFor(tx.date, periods);
    const group = groups.get(key) ?? { tx, count: 0, periodKeys: new Set<string>(), recurring: false, transactions: [] };
    group.count += 1;
    group.recurring = group.recurring || Boolean(tx.recurring);
    group.transactions.push(tx);
    if (periodKey) group.periodKeys.add(periodKey);
    groups.set(key, group);
  }

  const fixedKeys = new Set<string>();
  for (const [key, group] of groups) {
    const oneTimeKey = overrideKey(group.tx.categoryMain, merchantKey(group.tx));
    if (forcedFixedKeys.has(oneTimeKey)) {
      fixedKeys.add(key);
      continue;
    }
    if (oneTimeKeys.has(oneTimeKey)) continue;
    if (isFixedGroup(group)) fixedKeys.add(key);
  }
  return fixedKeys;
}

function customSectionKey(category: string, key: string, label: string): string {
  return key.startsWith("section:") ? `section:${category}::${label}` : overrideKey(category, key);
}

function detailTransactions(txs: Transaction[]) {
  return [...txs]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((tx) => ({
      id: tx.id,
      date: tx.date,
      merchant: tx.merchant,
      amount: tx.amount,
      source: tx.source,
      type: tx.type,
      categoryMain: tx.categoryMain,
      categorySub: tx.categorySub,
    }));
}

export function detailForBreakdownItem(
  item: FixedBreakdownRow,
  allItems: FixedBreakdownRow[],
  sectionOverrides: SectionOverrides
): DonutSliceDetail {
  const categoryOptions = allItems
    .filter((candidate) => !candidate.isOther)
    .map((candidate) => candidate.label)
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .sort((a, b) => a.localeCompare(b, "he"));

  return {
    key: item.key,
    label: item.label,
    value: item.average,
    transactions: detailTransactions(item.transactions),
    meta: `${Math.round(item.share * 100)}% · ${item.count} עסקאות${
      item.isOther ? " · לא קבוע" : ` · ${item.periodCount} תקופות`
    }`,
    oneTime: item.oneTime,
    oneTimeAuto: item.oneTimeAuto,
    fixedOverride: item.fixedOverride,
    categoryOptions,
    categoryValue: sectionOverrides[item.key] ?? "",
    children: item.children?.map((child) => ({
      key: child.key,
      label: child.label,
      value: child.average,
      transactions: detailTransactions(child.transactions),
      meta: `${Math.round(child.share * 100)}% · ${child.count} עסקאות${
        child.periodCount > 0 ? ` · ${child.periodCount} תקופות` : ""
      }`,
      oneTime: child.oneTime,
      oneTimeAuto: child.oneTimeAuto,
      fixedOverride: child.fixedOverride,
      categoryOptions,
      categoryValue: sectionOverrides[child.key] ?? "",
    })),
  };
}

export function TrendsView({
  transactions,
  periods,
  bankBalance,
  preferences,
  onPreferencesChange,
}: Props) {
  const [range, setRange] = useState<number | "all">(6);
  const [category, setCategory] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(() => new Set());
  const sectionOverrides = preferences.sectionOverrides;
  const oneTimeExpenses = useMemo(() => new Set(preferences.oneTimeExpenses), [preferences.oneTimeExpenses]);
  const fixedExpenses = useMemo(() => new Set(preferences.fixedExpenses), [preferences.fixedExpenses]);
  const highAmountThreshold = preferences.highAmountThreshold;
  const [expenseScope, setExpenseScope] = useState<ExpenseScope>("all");

  // periods[0] is the running (partial) one — averages use complete periods only
  const completePeriods = useMemo(() => periods.slice(1), [periods]);
  const rangeOptions = useMemo(
    () => Array.from({ length: completePeriods.length }, (_, index) => index + 1),
    [completePeriods.length]
  );
  const effectiveRange = range === "all" ? "all" : Math.min(range, completePeriods.length);
  const chosen = useMemo(
    () => (effectiveRange === "all" ? completePeriods : completePeriods.slice(0, effectiveRange)),
    [completePeriods, effectiveRange]
  );
  const categorizedTransactions = transactions;

  // category options: consumption mains seen in the chosen span, largest first
  const rangeFrom = chosen[chosen.length - 1]?.from ?? "";
  const rangeTo = chosen[0]?.to ?? "";
  const fixedExpenseKeys = useMemo(
    () => fixedExpenseKeysFor(categorizedTransactions, chosen, rangeFrom, rangeTo, oneTimeExpenses, fixedExpenses),
    [categorizedTransactions, chosen, fixedExpenses, oneTimeExpenses, rangeFrom, rangeTo]
  );
  const rows = useMemo(
    () =>
      chosen
        .map((p) => metricsFor(categorizedTransactions, p, category, excludedCategories, expenseScope, fixedExpenseKeys))
        .reverse(),
    [categorizedTransactions, category, chosen, excludedCategories, expenseScope, fixedExpenseKeys]
  ); // oldest → newest
  const allCatTotals = useMemo(() => {
    const totalsByCategory = new Map<string, number>();
    for (const t of categorizedTransactions) {
      if (t.type === "income" || !isConsumption(t)) continue;
      if (t.date < rangeFrom || t.date > rangeTo) continue;
      if (!isInExpenseScope(t, expenseScope, fixedExpenseKeys)) continue;
      totalsByCategory.set(t.categoryMain, (totalsByCategory.get(t.categoryMain) ?? 0) + t.amount);
    }
    return totalsByCategory;
  }, [categorizedTransactions, expenseScope, fixedExpenseKeys, rangeFrom, rangeTo]);
  const sortedCategoryTotals = useMemo(
    () => [...allCatTotals.entries()].sort((a, b) => b[1] - a[1]),
    [allCatTotals]
  );
  const categoryOptions = useMemo(() => sortedCategoryTotals.map(([m]) => m), [sortedCategoryTotals]);
  const categoryEditorOptions: CategoryChoice[] = useMemo(
    () => categoryChoices(categoryOptions, sectionOverrides),
    [categoryOptions, sectionOverrides]
  );
  const n = rows.length;
  const expandedBreakdown = useMemo(() => {
    if (!expandedCategory) return null;
    const breakdown = fixedBreakdownFor(
      categorizedTransactions,
      chosen,
      expandedCategory,
      rangeFrom,
      rangeTo,
      {},
      oneTimeExpenses,
      fixedExpenses
    );
    return expenseScope === "fixed"
      ? breakdown.filter((item) => !item.isOther)
      : expenseScope === "variable"
        ? breakdown.filter((item) => item.isOther)
        : breakdown;
  }, [categorizedTransactions, chosen, expandedCategory, expenseScope, fixedExpenses, oneTimeExpenses, rangeFrom, rangeTo]);
  const categoryAverageSlices: DonutSlice[] = useMemo(
    () =>
      sortedCategoryTotals.map(([key, total]) => ({
        key,
        label: categoryLabel(key),
        value: total / n,
        color: mainColor(key),
        details:
          key === expandedCategory
            ? expandedBreakdown?.map((item) => ({
                key: item.key,
                label: item.label,
                value: item.average,
                transactions: detailTransactions(item.transactions),
                meta: `${Math.round(item.share * 100)}% · ${item.count} עסקאות${
                  item.isOther ? " · לא קבוע" : ` · ${item.periodCount} תקופות`
                }`,
                oneTime: item.oneTime,
                oneTimeAuto: item.oneTimeAuto,
                fixedOverride: item.fixedOverride,
                categoryValue: sectionOverrides[item.key] ?? defaultCategoryForMerchant(item.label) ?? key,
                children: item.children?.map((child) => ({
                  key: child.key,
                  label: child.label,
                  value: child.average,
                  transactions: detailTransactions(child.transactions),
                  meta: `${Math.round(child.share * 100)}% · ${child.count} עסקאות${
                    child.periodCount > 0 ? ` · ${child.periodCount} תקופות` : ""
                  }`,
                  oneTime: child.oneTime,
                  oneTimeAuto: child.oneTimeAuto,
                  fixedOverride: child.fixedOverride,
                  categoryValue: sectionOverrides[child.key] ?? defaultCategoryForMerchant(child.label) ?? key,
                })),
              }))
            : undefined,
      })),
    [expandedBreakdown, expandedCategory, n, sectionOverrides, sortedCategoryTotals]
  );
  const excludedTotal = useMemo(
    () =>
      sortedCategoryTotals
        .filter(([key]) => excludedCategories.has(key))
        .reduce((sum, [, total]) => sum + total, 0),
    [excludedCategories, sortedCategoryTotals]
  );
  const totals = useMemo(
    () => ({
      income: rows.reduce((s, r) => s + r.income, 0),
      expense: rows.reduce((s, r) => s + r.expense, 0),
      securities: rows.reduce((s, r) => s + r.securities, 0),
      catExpense: rows.reduce((s, r) => s + r.catExpense, 0),
      catCount: rows.reduce((s, r) => s + r.catCount, 0),
    }),
    [rows]
  );
  const leftoverTotal = totals.income - totals.expense - totals.securities;
  const grossExpenseTotal = totals.expense + excludedTotal;
  const selectedCategoryExcluded = category ? excludedCategories.has(category) : false;

  const toggleCategoryInCalculation = useCallback((key: string) => {
    setExcludedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // running total of the leftovers — a negative single-period flow just means
  // money saved up earlier was used (e.g. a bonus funding a big investment)
  const categorizeDetail = useCallback((detailKey: string, section: string) => {
    const raw = section.trim();
    const value = raw && categoryOptions.includes(raw) ? raw : raw ? customCategoryKey(raw) : "";
    const next = { ...sectionOverrides };
    if (value) next[detailKey] = value;
    else delete next[detailKey];
    onPreferencesChange({ ...preferences, sectionOverrides: next });
  }, [categoryOptions, onPreferencesChange, preferences, sectionOverrides]);

  const toggleOneTimeDetail = useCallback((detailKey: string) => {
    const nextFixed = new Set(fixedExpenses);
    nextFixed.delete(detailKey);
    const nextOneTime = new Set(oneTimeExpenses);
    if (nextOneTime.has(detailKey)) nextOneTime.delete(detailKey);
    else nextOneTime.add(detailKey);
    onPreferencesChange({
      ...preferences,
      fixedExpenses: [...nextFixed],
      oneTimeExpenses: [...nextOneTime],
    });
  }, [fixedExpenses, oneTimeExpenses, onPreferencesChange, preferences]);

  const toggleFixedDetail = useCallback((detailKey: string) => {
    const nextOneTime = new Set(oneTimeExpenses);
    nextOneTime.delete(detailKey);
    const nextFixed = new Set(fixedExpenses);
    if (nextFixed.has(detailKey)) nextFixed.delete(detailKey);
    else nextFixed.add(detailKey);
    onPreferencesChange({
      ...preferences,
      fixedExpenses: [...nextFixed],
      oneTimeExpenses: [...nextOneTime],
    });
  }, [fixedExpenses, oneTimeExpenses, onPreferencesChange, preferences]);

  const cumulative = useMemo(() => {
    let total = 0;
    return rows.map((r) => (total += r.leftover));
  }, [rows]);

  // With the real balance known, reconstruct the actual checking balance at
  // each period's end: today's balance minus every raw bank movement (all
  // categories, signed — no analytics filtering) that happened after it.
  // This is exact regardless of card-billing timing.
  const balanceByPeriodEnd = useMemo(() => {
    if (!bankBalance) return new Map<string, number>();
    const bankTxs = categorizedTransactions
      .filter((t) => t.source !== "card")
      .sort((a, b) => b.date.localeCompare(a.date));
    const balances = new Map<string, number>();
    const ends = [...chosen].sort((a, b) => b.to.localeCompare(a.to));
    let txIndex = 0;
    let netAfter = 0;
    for (const period of ends) {
      while (txIndex < bankTxs.length && bankTxs[txIndex].date > period.to) {
        const tx = bankTxs[txIndex];
        netAfter += tx.type === "income" ? tx.amount : -tx.amount;
        txIndex += 1;
      }
      balances.set(period.to, bankBalance.balance - netAfter);
    }
    return balances;
  }, [bankBalance, categorizedTransactions, chosen]);

  if (chosen.length === 0) {
    return <p className="loading">אין תקופות שלמות להצגה עדיין.</p>;
  }

  const series: Array<{ key: SeriesKey; label: string; color: string }> = category
    ? [{ key: "catExpense", label: categoryLabel(category), color: mainColor(category) }]
    : [...ALL_SERIES];

  // — bar chart geometry —
  const W = 760;
  const H = 300;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 34;
  const PAD_SIDE = 8;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const maxValue = Math.max(
    1,
    ...rows.flatMap((r) => series.map((s) => Math.max(r[s.key], 0)))
  );
  const groupW = (W - PAD_SIDE * 2) / n;
  const barW = Math.min(category ? 40 : 26, (groupW - 16) / series.length);
  const y = (v: number) => PAD_TOP + plotH * (1 - v / maxValue);
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => maxValue * f);

  return (
    <div className="trends-view">
      <div className="period-row">
        <label htmlFor="range-select">טווח:</label>
        <select
          id="range-select"
          value={String(effectiveRange)}
          onChange={(e) => setRange(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          {rangeOptions.map((r) => (
            <option key={r} value={r}>
              {r} תקופות אחרונות
            </option>
          ))}
          <option value="all">כל התקופות ({completePeriods.length})</option>
        </select>
        <label htmlFor="trend-category-select">קטגוריה:</label>
        <select
          id="trend-category-select"
          value={category ?? ""}
          onChange={(e) => setCategory(e.target.value || null)}
        >
          <option value="">הכל — תמונה כללית</option>
          {categoryOptions.map((m) => (
            <option key={m} value={m}>
              {categoryLabel(m)}
            </option>
          ))}
        </select>
        <div className="scope-toggle" role="group" aria-label="סינון הוצאות">
          <button
            type="button"
            className={expenseScope === "all" ? "active" : ""}
            onClick={() => setExpenseScope("all")}
          >
            הכל
          </button>
          <button
            type="button"
            className={expenseScope === "fixed" ? "active" : ""}
            onClick={() => setExpenseScope("fixed")}
          >
            קבועות בלבד
          </button>
          <button
            type="button"
            className={expenseScope === "variable" ? "active" : ""}
            onClick={() => setExpenseScope("variable")}
          >
            לא קבועות
          </button>
        </div>
        <span className="period-hint">
          {n} תקופות שלמות · {expenseScopeLabel(expenseScope)}
        </span>
      </div>

      {category ? (
        <div className="stat-tiles">
          <div className="stat-tile highlight">
            <span className="stat-label">
              <span className="swatch" style={{ background: mainColor(category) }} aria-hidden />{" "}
              סה״כ {categoryLabel(category)}
            </span>
            <span className="stat-value">{formatILSWhole(totals.catExpense)}</span>
            <span className="stat-hint">
              {selectedCategoryExcluded
                ? "כבויה מהחישוב"
                : `${expenseScopeLabel(expenseScope)} · על פני ${n} תקופות`}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">ממוצע לתקופה</span>
            <span className="stat-value">{formatILSWhole(totals.catExpense / n)}</span>
            <span className="stat-hint">בקטגוריה זו</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">חלק מסך ההוצאות</span>
            <span className="stat-value">
              {totals.expense > 0 ? Math.round((totals.catExpense / totals.expense) * 100) : 0}%
            </span>
            <span className="stat-hint">מתוך {formatILS(totals.expense)}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">עסקאות</span>
            <span className="stat-value">{totals.catCount}</span>
            <span className="stat-hint">
              ממוצע {formatILS(totals.catCount > 0 ? totals.catExpense / totals.catCount : 0)} לעסקה
            </span>
          </div>
        </div>
      ) : (
        <div className="stat-tiles">
          <div className="stat-tile">
            <span className="stat-label">סה״כ הכנסות</span>
            <span className="stat-value">{formatILSWhole(totals.income)}</span>
            <span className="stat-hint">ממוצע {formatILS(totals.income / n)} לתקופה</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">
              {expenseScope === "fixed"
                ? "סה״כ הוצאות קבועות"
                : expenseScope === "variable"
                  ? "סה״כ הוצאות לא קבועות"
                  : "סה״כ הוצאות מחושב"}
            </span>
            <span className="stat-value">{formatILSWhole(totals.expense)}</span>
            <span className="stat-hint">
              {excludedTotal > 0
                ? `ממוצע ${formatILS(totals.expense / n)} אחרי כיבוי · לפני: ${formatILS(grossExpenseTotal / n)}`
                : `ממוצע ${formatILS(totals.expense / n)} לתקופה`}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">חיסכון והשקעות 📈</span>
            <span className="stat-value">{formatILSWhole(totals.securities)}</span>
            <span className="stat-hint">
              ממוצע {formatILS(totals.securities / n)} לתקופה · ני״ע, פיקדונות והעברות להשקעה, בניכוי משיכות
            </span>
          </div>
          {bankBalance ? (
            <div className="stat-tile highlight">
              <span className="stat-label">יתרת עו״ש בפועל 🏦</span>
              <span className={`stat-value ${bankBalance.balance >= 0 ? "net-positive" : "net-negative"}`}>
                {formatILSWhole(bankBalance.balance)}
              </span>
              <span className="stat-hint">
                מהבנק, נכון ל-{bankBalance.date.slice(8, 10)}.{bankBalance.date.slice(5, 7)} · תזרים בטווח:{" "}
                {leftoverTotal >= 0 ? "▲" : "▼"}{formatILS(Math.abs(leftoverTotal))}
              </span>
            </div>
          ) : (
            <div className="stat-tile highlight">
              <span className="stat-label">נשאר בעו״ש (מצטבר)</span>
              <span className={`stat-value ${leftoverTotal >= 0 ? "net-positive" : "net-negative"}`}>
                {leftoverTotal >= 0 ? "▲" : "▼"} {formatILSWhole(Math.abs(leftoverTotal))}
              </span>
              <span className="stat-hint">הכנסות − הוצאות − חיסכון, על פני כל הטווח</span>
            </div>
          )}
        </div>
      )}

      <div className="donut-grid">
        <Donut
          title={`הוצאות לפי קטגוריה — ממוצע לתקופה${
            expenseScope === "all" ? "" : ` · ${expenseScopeLabel(expenseScope)}`
          }`}
          slices={categoryAverageSlices}
          selectedKey={category}
          onSelect={setCategory}
          expandedKey={expandedCategory}
          onExpand={setExpandedCategory}
          excludedKeys={excludedCategories}
          onToggleKey={toggleCategoryInCalculation}
          detailCategoryValues={sectionOverrides}
          categoryOptions={categoryEditorOptions}
          onCategorizeDetail={categorizeDetail}
          onToggleOneTimeDetail={toggleOneTimeDetail}
          onToggleFixedDetail={toggleFixedDetail}
          highAmountThreshold={highAmountThreshold}
        />
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <h3>
            {category ? `${categoryLabel(category)} לפי תקופה` : "לפי תקופה"}
            {expenseScope === "all" ? "" : ` · ${expenseScopeLabel(expenseScope)}`}
          </h3>
          <div className="chart-legend">
            {series.map((s) => (
              <span key={s.key} className="legend-item">
                <span className="swatch" style={{ background: s.color }} aria-hidden /> {s.label}
              </span>
            ))}
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="bar-chart" role="img" aria-label="סכומים לפי תקופה">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_SIDE} x2={W - PAD_SIDE} y1={y(t)} y2={y(t)} className="gridline" />
              <text x={W - PAD_SIDE} y={y(t) - 3} textAnchor="end" className="tick-label">
                {t >= 1000 ? `${Math.round(t / 1000)}K` : Math.round(t)}
              </text>
            </g>
          ))}
          <line x1={PAD_SIDE} x2={W - PAD_SIDE} y1={y(0)} y2={y(0)} className="baseline" />
          {rows.map((r, gi) => {
            const groupX = PAD_SIDE + gi * groupW + groupW / 2;
            const totalBars = series.length * barW + (series.length - 1) * 3;
            return (
              <g key={r.period.key}>
                {series.map((s, si) => {
                  const v = Math.max(0, r[s.key]);
                  const x = groupX - totalBars / 2 + si * (barW + 3);
                  const barY = y(v);
                  const h = Math.max(0, y(0) - barY);
                  return (
                    <rect
                      key={s.key}
                      x={x}
                      y={barY}
                      width={barW}
                      height={h}
                      rx={h > 4 ? 4 : 0}
                      fill={s.color}
                      className="bar"
                    >
                      <title>{`${r.shortLabel} · ${s.label}: ${formatILS(r[s.key])}`}</title>
                    </rect>
                  );
                })}
                <text x={groupX} y={H - 12} textAnchor="middle" className="x-label">
                  {r.shortLabel.replace(/ \d{4}$/, "")}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <section className="period-detail">
        <h2>פירוט לפי תקופה{category && ` — ${categoryLabel(category)}`}</h2>
        <div className="table-wrap">
          {category ? (
            <table className="tx-table">
              <thead>
                <tr>
                  <th>תקופה</th>
                  <th className="num">
                    {categoryLabel(category)}
                    {expenseScope === "fixed" ? " קבועות" : expenseScope === "variable" ? " לא קבועות" : ""}
                  </th>
                  <th className="num">עסקאות</th>
                  <th className="num">% מהוצאות התקופה</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.period.key}>
                    <td>{r.period.label}</td>
                    <td className="num">{formatILS(r.catExpense)}</td>
                    <td className="num">{r.catCount}</td>
                    <td className="num">
                      {r.expense > 0 ? Math.round((r.catExpense / r.expense) * 100) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="avg-row">
                  <td>ממוצע לתקופה</td>
                  <td className="num">{formatILS(totals.catExpense / n)}</td>
                  <td className="num">{Math.round(totals.catCount / n)}</td>
                  <td className="num">
                    {totals.expense > 0 ? Math.round((totals.catExpense / totals.expense) * 100) : 0}%
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <table className="tx-table">
              <thead>
                <tr>
                  <th>תקופה</th>
                  <th className="num">הכנסות</th>
                  <th className="num">
                    {expenseScope === "fixed"
                      ? "הוצאות קבועות"
                      : expenseScope === "variable"
                        ? "הוצאות לא קבועות"
                        : "הוצאות"}
                  </th>
                  <th className="num">חיסכון והשקעות</th>
                  <th className="num">תזרים בתקופה</th>
                  <th className="num">{bankBalance ? "יתרת עו״ש בסוף התקופה" : "מצטבר"}</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r, ri) => {
                  const anchor = bankBalance
                    ? balanceByPeriodEnd.get(r.period.to) ?? 0
                    : cumulative[rows.length - 1 - ri];
                  return (
                    <tr key={r.period.key}>
                      <td>{r.period.label}</td>
                      <td className="num">{formatILS(r.income)}</td>
                      <td className="num">{formatILS(r.expense)}</td>
                      <td className="num">{formatILS(r.securities)}</td>
                      <td className={`num ${r.leftover >= 0 ? "net-positive" : "net-negative"}`}>
                        {formatILS(r.leftover)}
                      </td>
                      <td className={`num ${anchor >= 0 ? "net-positive" : "net-negative"}`}>
                        {formatILS(anchor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="avg-row">
                  <td>ממוצע לתקופה</td>
                  <td className="num">{formatILS(totals.income / n)}</td>
                  <td className="num">{formatILS(totals.expense / n)}</td>
                  <td className="num">{formatILS(totals.securities / n)}</td>
                  <td className={`num ${leftoverTotal >= 0 ? "net-positive" : "net-negative"}`}>
                    {formatILS(leftoverTotal / n)}
                  </td>
                  <td className="num" />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
        {!category && (
          <p className="table-note">
            {bankBalance
              ? "תזרים שלילי בתקופה אין פירושו מינוס בבנק — הוא אומר שקנייה או השקעה גדולה מומנה מכסף שנצבר קודם. עמודת \"יתרת עו״ש בסוף התקופה\" משוחזרת מהיתרה האמיתית של הבנק לפי כל תנועות החשבון, ומראה שהיתרה נשארה חיובית."
              : "תזרים שלילי בתקופה אין פירושו מינוס בבנק — הוא אומר שקנייה או השקעה גדולה מומנה מכסף שנצבר בתקופות קודמות (למשל בונוס). עמודת \"מצטבר\" מראה את התמונה המלאה."}
          </p>
        )}
      </section>
    </div>
  );
}
