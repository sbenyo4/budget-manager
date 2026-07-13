import { useCallback, useMemo, useState } from "react";
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

function sliceByMain(txs: Transaction[]): DonutSlice[] {
  const totals = new Map<string, number>();
  for (const tx of txs) {
    totals.set(tx.categoryMain, (totals.get(tx.categoryMain) ?? 0) + tx.amount);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([main, value]) => ({ key: main, label: categoryLabel(main), value, color: mainColor(main) }));
}

const sum = (txs: Transaction[]) => txs.reduce((s, t) => s + t.amount, 0);

export function MonthlyView({
  transactions,
  periods,
  bankBalance,
  preferences,
  onPreferencesChange,
}: Props) {
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const sectionOverrides = preferences.sectionOverrides;
  const oneTimeExpenses = useMemo(() => new Set(preferences.oneTimeExpenses), [preferences.oneTimeExpenses]);
  const highAmountThreshold = preferences.highAmountThreshold;
  const categorizedTransactions = transactions;

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

  const isPending = (tx: Transaction) => tx.source === "card" && tx.date > lastDebitDate;

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

  // Category breakdown: replace the aggregate card debits with the card's
  // own transactions (incl. pending ones — they're real consumption)
  const breakdownExpenses = useMemo(
    () => [
      ...bankTxs.filter((t) => t.type !== "income" && !isCardDebit(t)),
      ...cardTxs.filter((t) => t.type !== "income"),
    ],
    [bankTxs, cardTxs]
  );
  const breakdownIncomes = useMemo(() => inPeriod.filter((t) => t.type === "income"), [inPeriod]);
  const categoryOptions = useMemo(
    () => [...new Set([...breakdownExpenses, ...breakdownIncomes].map((t) => t.categoryMain))],
    [breakdownExpenses, breakdownIncomes]
  );
  const categoryEditorOptions = useMemo(
    () => categoryChoices(categoryOptions, sectionOverrides),
    [categoryOptions, sectionOverrides]
  );
  const expenseSlices = useMemo(() => sliceByMain(breakdownExpenses), [breakdownExpenses]);
  const incomeSlices = useMemo(() => sliceByMain(breakdownIncomes), [breakdownIncomes]);
  const expenseSummaryByCategory = useMemo(() => {
    const summary = new Map<string, { count: number; total: number }>();
    for (const tx of breakdownExpenses) {
      const current = summary.get(tx.categoryMain) ?? { count: 0, total: 0 };
      current.count += 1;
      current.total += tx.amount;
      summary.set(tx.categoryMain, current);
    }
    return summary;
  }, [breakdownExpenses]);
  const incomeSummaryByCategory = useMemo(() => {
    const summary = new Map<string, { count: number; total: number }>();
    for (const tx of breakdownIncomes) {
      const current = summary.get(tx.categoryMain) ?? { count: 0, total: 0 };
      current.count += 1;
      current.total += tx.amount;
      summary.set(tx.categoryMain, current);
    }
    return summary;
  }, [breakdownIncomes]);
  const allExpenseTotal = useMemo(() => sum(breakdownExpenses), [breakdownExpenses]);
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

  const sortedInPeriod = useMemo(() => [...inPeriod].sort((a, b) => b.date.localeCompare(a.date)), [inPeriod]);
  const listedByCategory = useMemo(() => {
    const byCategory = new Map<string, Transaction[]>();
    for (const tx of sortedInPeriod) {
      const group = byCategory.get(tx.categoryMain);
      if (group) group.push(tx);
      else byCategory.set(tx.categoryMain, [tx]);
    }
    return byCategory;
  }, [sortedInPeriod]);
  const listed = useMemo(
    () => (categoryFilter ? listedByCategory.get(categoryFilter) ?? [] : sortedInPeriod),
    [categoryFilter, listedByCategory, sortedInPeriod]
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
        <span className="period-hint">
          {period.salaryBased ? "ממשכורת עד המשכורת הבאה" : "חודש קלנדרי (לא זוהתה משכורת)"}
        </span>
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
        <div className="stat-tile">
          <span className="stat-label">אשראי שטרם חויב ⏳</span>
          <span className="stat-value">{formatILSWhole(pendingTotal)}</span>
          <span className="stat-hint">
            {lastDebitDate
              ? `עסקאות כרטיס מאז החיוב האחרון (${lastDebitDate.slice(8, 10)}.${lastDebitDate.slice(5, 7)}) — יירדו בחיוב הבא`
              : "לא נמצאו חיובי אשראי בחשבון"}
          </span>
        </div>
      </div>

      <div className="donut-grid">
        <Donut
          title="הוצאות לפי קטגוריה — כולל פירוט האשראי"
          slices={expenseSlices}
          selectedKey={categoryFilter}
          onSelect={setCategoryFilter}
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
            פירוט תנועות
            {categoryFilter && <span className="filter-tag"> · {categoryLabel(categoryFilter)}</span>}
          </h2>
          {categoryFilter && (
            <button className="table-toggle" onClick={() => setCategoryFilter(null)}>
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
                const categorySubLabel = displaySubLabel(tx.categorySub);
                return (
                <tr
                  key={tx.id}
                  className={`${isCardDebit(tx) ? "aggregate-row" : ""} ${transactionHighlightClass(tx, highAmountThreshold)}`.trim()}
                >
                  <td>{new Date(`${tx.date}T00:00:00`).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })}</td>
                  <td>
                    {tx.merchant}
                    {tx.recurring && <span className="recurring-tag"> · מנוי / קבוע</span>}
                    {isCardDebit(tx) && <span className="sub-label"> (מפורט בשורות האשראי)</span>}
                  </td>
                  <td>
                    <span className="cat-cell">
                      <span className="cat-current">
                        <span className="swatch" style={{ background: mainColor(tx.categoryMain) }} aria-hidden />
                        <span className="cat-main-label">{categoryLabel(tx.categoryMain)}</span>
                        {categorySubLabel && <span className="sub-label">{categorySubLabel}</span>}
                      </span>
                      {tx.type !== "income" && isConsumption(tx) && (
                        <button
                          type="button"
                          className={`legend-state-action ${oneTimeExpenses.has(oneTimeKey(tx)) ? "active" : ""}`}
                          onClick={() => toggleOneTime(tx)}
                          aria-pressed={oneTimeExpenses.has(oneTimeKey(tx))}
                          title="סימון העסקה כחד פעמית"
                        >
                          חד פעמי
                        </button>
                      )}
                      {!isCardDebit(tx) && (
                        <MonthlyCategoryPicker
                          value={sectionOverrides[overrideKey(tx.categoryMain, merchantKey(tx))] ?? tx.categoryMain}
                          options={categoryEditorOptions}
                          onChange={(nextCategory) => categorizeMerchant(tx, nextCategory)}
                        />
                      )}
                    </span>
                  </td>
                  <td>
                    <span className={`source-chip ${tx.source === "card" ? "card" : "bank"}`}>
                      {tx.source === "card" ? "אשראי" : "בנק"}
                    </span>
                    {isPending(tx) && <span className="pending-chip">⏳ טרם חויב</span>}
                  </td>
                  <td className={`num ${tx.type === "income" ? "net-positive" : ""}`}>
                    {tx.type === "income" ? "+" : "−"}{formatILS(tx.amount)}
                  </td>
                </tr>
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
    <span className="monthly-category-picker">
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
