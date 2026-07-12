import { useState } from "react";
import type { Transaction } from "../types";
import type { Period } from "../logic/periods";
import { isCardDebit, isConsumption } from "../logic/flows";
import type { BudgetPreferences } from "../api/preferences";
import { displaySubLabel, mainColor } from "../logic/categoryNames";
import {
  applyCategoryOverrides,
  categoryChoices,
  categoryLabel,
  customCategoryKey,
  merchantKey,
  overrideKey,
} from "../logic/categoryOverrides";
import { Donut, type DonutSlice } from "./Donut";
import { formatILS } from "./format";

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

export function MonthlyView({ transactions, periods, bankBalance, preferences, onPreferencesChange }: Props) {
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const sectionOverrides = preferences.sectionOverrides;
  const oneTimeExpenses = new Set(preferences.oneTimeExpenses);
  const categorizedTransactions = applyCategoryOverrides(transactions, sectionOverrides);

  const period = periods.find((p) => p.key === periodKey) ?? periods[0];

  if (!period) {
    return <p className="loading">אין נתונים להצגה.</p>;
  }

  // Card purchases after the last aggregate card debit haven't been charged
  // to the account yet — they're the upcoming bill
  const lastDebitDate = categorizedTransactions
    .filter((t) => isCardDebit(t) && t.type !== "income")
    .reduce((max, t) => (t.date > max ? t.date : max), "");

  const inPeriod = categorizedTransactions.filter((tx) => tx.date >= period.from && tx.date <= period.to);
  const bankTxs = inPeriod.filter((tx) => tx.source !== "card");
  const cardTxs = inPeriod.filter((tx) => tx.source === "card");

  const isPending = (tx: Transaction) => tx.source === "card" && tx.date > lastDebitDate;

  // Account state: what actually moved through the bank account
  const bankIncome = sum(bankTxs.filter((t) => t.type === "income"));
  const bankExpense = sum(bankTxs.filter((t) => t.type !== "income"));
  const net = bankIncome - bankExpense;
  const signedBankMovement = (tx: Transaction) => (tx.type === "income" ? tx.amount : -tx.amount);
  const bankNetAfterPeriod = categorizedTransactions
    .filter((tx) => tx.source !== "card" && tx.date > period.to)
    .reduce((total, tx) => total + signedBankMovement(tx), 0);
  const balanceAtPeriodEnd = bankBalance ? bankBalance.balance - bankNetAfterPeriod : null;
  const balanceAtPeriodStart = balanceAtPeriodEnd === null ? null : balanceAtPeriodEnd - net;

  // Upcoming bill: card activity not yet debited
  const pendingCard = cardTxs.filter(isPending);
  const pendingTotal =
    sum(pendingCard.filter((t) => t.type !== "income")) -
    sum(pendingCard.filter((t) => t.type === "income"));

  // Category breakdown: replace the aggregate card debits with the card's
  // own transactions (incl. pending ones — they're real consumption)
  const breakdownExpenses = [
    ...bankTxs.filter((t) => t.type !== "income" && !isCardDebit(t)),
    ...cardTxs.filter((t) => t.type !== "income"),
  ];
  const breakdownIncomes = inPeriod.filter((t) => t.type === "income");
  const categoryOptions = [...new Set([...breakdownExpenses, ...breakdownIncomes].map((t) => t.categoryMain))];
  const categoryEditorOptions = categoryChoices(categoryOptions, sectionOverrides);

  const listed = [...inPeriod]
    .filter((tx) => !categoryFilter || tx.categoryMain === categoryFilter)
    .sort((a, b) => b.date.localeCompare(a.date));

  function categorizeMerchant(tx: Transaction, category: string) {
    const merchant = merchantKey(tx);
    const raw = category.trim();
    const isKnownCategory = categoryEditorOptions.some((option) => option.value === raw);
    const value = raw && isKnownCategory ? raw : raw ? customCategoryKey(raw) : "";
    const next = { ...sectionOverrides };
    const key = overrideKey(tx.categoryMain, merchant);
    if (value) next[key] = value;
    else delete next[key];
    onPreferencesChange({ ...preferences, sectionOverrides: next });
  }

  function oneTimeKey(tx: Transaction): string {
    return overrideKey(tx.categoryMain, merchantKey(tx));
  }

  function toggleOneTime(tx: Transaction) {
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
              {formatILS(
                breakdownExpenses
                  .filter((t) => t.categoryMain === categoryFilter)
                  .reduce((s, t) => s + t.amount, 0)
              )}
            </span>
            <span className="stat-hint">
              {breakdownExpenses.filter((t) => t.categoryMain === categoryFilter).length} עסקאות הוצאה
              {breakdownIncomes.some((t) => t.categoryMain === categoryFilter) &&
                ` · הכנסות: ${formatILS(
                  breakdownIncomes
                    .filter((t) => t.categoryMain === categoryFilter)
                    .reduce((s, t) => s + t.amount, 0)
                )}`}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">חלק מהוצאות התקופה</span>
            <span className="stat-value">
              {(() => {
                const catTotal = breakdownExpenses
                  .filter((t) => t.categoryMain === categoryFilter)
                  .reduce((s, t) => s + t.amount, 0);
                const all = breakdownExpenses.reduce((s, t) => s + t.amount, 0);
                return all > 0 ? `${Math.round((catTotal / all) * 100)}%` : "—";
              })()}
            </span>
            <span className="stat-hint">מסך ההוצאות כולל פירוט אשראי</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">ממוצע לעסקה</span>
            <span className="stat-value">
              {(() => {
                const cat = breakdownExpenses.filter((t) => t.categoryMain === categoryFilter);
                return cat.length > 0
                  ? formatILS(cat.reduce((s, t) => s + t.amount, 0) / cat.length)
                  : "—";
              })()}
            </span>
            <span className="stat-hint">בקטגוריה זו</span>
          </div>
        </div>
      )}

      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-label">הכנסות לחשבון</span>
          <span className="stat-value">{formatILS(bankIncome)}</span>
          <span className="stat-hint">כל מה שנכנס לעו״ש</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">יצא מהחשבון</span>
          <span className="stat-value">{formatILS(bankExpense)}</span>
          <span className="stat-hint">כולל חיובי אשראי, ני״ע והעברות</span>
        </div>
        <div className="stat-tile highlight">
          <span className="stat-label">תזרים בתקופה</span>
          <span className={`stat-value ${net >= 0 ? "net-positive" : "net-negative"}`}>
            {net >= 0 ? "▲" : "▼"} {formatILS(Math.abs(net))}
          </span>
          <span className="stat-hint">הכנסות לעו״ש פחות יציאות אמיתיות מהעו״ש</span>
        </div>
        <div className={bankBalance ? "stat-tile highlight" : "stat-tile"}>
          <span className="stat-label">{bankBalance ? "יתרת עו״ש בפועל" : "יתרת עו״ש בפועל"}</span>
          <span className={`stat-value ${bankBalance && bankBalance.balance < 0 ? "net-negative" : "net-positive"}`}>
            {bankBalance ? formatILS(bankBalance.balance) : "—"}
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
            {balanceAtPeriodEnd !== null ? formatILS(balanceAtPeriodEnd) : "—"}
          </span>
          <span className="stat-hint">
            {balanceAtPeriodStart !== null
              ? `תחילת תקופה: ${formatILS(balanceAtPeriodStart)}`
              : "מחושבת מהיתרה הנוכחית ותנועות הבנק"}
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">אשראי שטרם חויב ⏳</span>
          <span className="stat-value">{formatILS(pendingTotal)}</span>
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
          slices={sliceByMain(breakdownExpenses)}
          selectedKey={categoryFilter}
          onSelect={setCategoryFilter}
        />
        <Donut
          title="הכנסות לפי קטגוריה"
          slices={sliceByMain(breakdownIncomes)}
          selectedKey={categoryFilter}
          onSelect={setCategoryFilter}
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
                <tr key={tx.id} className={isCardDebit(tx) ? "aggregate-row" : ""}>
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
