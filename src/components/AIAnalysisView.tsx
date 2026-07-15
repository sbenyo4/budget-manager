import { useMemo, useState } from "react";
import type { Transaction } from "../types";
import type { Period } from "../logic/periods";
import { isCardDebit, isConsumption, isSavings } from "../logic/flows";
import { analyzeBudgetWithAI, type AIAnalysisResult } from "../api/preferences";
import { formatILSWhole, todayIso } from "./format";

interface Props {
  transactions: Transaction[];
  periods: Period[];
  bankBalance: { balance: number; date: string } | null;
}

const sum = (txs: Transaction[]) => txs.reduce((total, tx) => total + tx.amount, 0);
type AnalysisMode = "month" | "trend";
const NON_FLOW_MAINS = new Set(["TRADING", "TRANSFER", "ASSETS", "DEPOSIT"]);

function periodDate(tx: Transaction): string {
  return tx.source === "card" ? tx.billingDate ?? tx.date : tx.date;
}

function periodTxDate(tx: Transaction, mode: AnalysisMode): string {
  return mode === "trend" ? tx.date : periodDate(tx);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function addToMap(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function daysInclusive(from: string, to: string): number {
  if (!from || !to) return 0;
  const fromMs = new Date(`${from}T00:00:00`).getTime();
  const toMs = new Date(`${to}T00:00:00`).getTime();
  return Math.max(1, Math.round((toMs - fromMs) / 86_400_000) + 1);
}

function monthlyRate(total: number, days: number): number {
  return days > 0 ? total * (30 / days) : total;
}

function topRows(map: Map<string, number>, limit: number) {
  return [...map.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit)
    .map(([name, amount]) => ({ name, amount: roundMoney(amount) }));
}

function cardGroupKey(tx: Transaction): string {
  return `${tx.billingDate ?? tx.date}::${tx.cardProvider ?? ""}::${tx.cardLast4 ?? "unknown"}`;
}

function budgetIncome(txs: Transaction[]) {
  return txs.filter((tx) => tx.type === "income" && tx.source !== "card" && !NON_FLOW_MAINS.has(tx.categoryMain));
}

function budgetExpenses(txs: Transaction[]) {
  return txs.filter((tx) => tx.type !== "income" && isConsumption(tx));
}

function netSavings(txs: Transaction[]) {
  return (
    sum(txs.filter((tx) => tx.type !== "income" && isSavings(tx))) -
    sum(txs.filter((tx) => tx.type === "income" && isSavings(tx)))
  );
}

export function AIAnalysisView({ transactions, periods, bankBalance }: Props) {
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("month");
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [trendCount, setTrendCount] = useState("6");
  const [result, setResult] = useState<AIAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedPeriod = useMemo(() => {
    if (periodKey) return periods.find((period) => period.key === periodKey) ?? periods[0] ?? null;
    const today = todayIso();
    return periods.find((period) => today >= period.from && today <= period.to) ?? periods[0] ?? null;
  }, [periodKey, periods]);

  const trendPeriods = useMemo(
    () => periods.slice(1).slice(0, Number(trendCount)),
    [periods, trendCount]
  );
  const trendFrom = trendPeriods.length ? trendPeriods.reduce((min, period) => (period.from < min ? period.from : min), trendPeriods[0].from) : "";
  const trendTo = trendPeriods.length ? trendPeriods.reduce((max, period) => (period.to > max ? period.to : max), trendPeriods[0].to) : "";
  const periodCount = analysisMode === "trend" ? Math.max(1, trendPeriods.length) : 1;
  const periodDays = analysisMode === "month"
    ? daysInclusive(selectedPeriod?.from ?? "", selectedPeriod?.to ?? "")
    : trendPeriods.reduce((sumDays, period) => sumDays + daysInclusive(period.from, period.to), 0);
  const monthEquivalent = periodDays > 0 ? periodDays / 30 : periodCount;
  const isPartialSinglePeriod = analysisMode === "month" && periodDays > 0 && periodDays < 24;
  const analysisLabel =
    analysisMode === "month"
      ? selectedPeriod?.label ?? ""
      : `מגמות ${trendPeriods.length} תקופות (${trendFrom} עד ${trendTo})`;
  const lastDebitDate = useMemo(
    () =>
      transactions
        .filter((tx) => isCardDebit(tx) && tx.type !== "income")
        .reduce((max, tx) => (tx.date > max ? tx.date : max), ""),
    [transactions]
  );
  const isChargedCardTx = (tx: Transaction) =>
    tx.source !== "card" || Boolean(lastDebitDate && (tx.billingDate ?? tx.date) <= lastDebitDate);

  const periodTransactions = useMemo(
    () =>
      transactions.filter((tx) => {
        if (!isChargedCardTx(tx)) return false;
        if (analysisMode === "month") {
          if (!selectedPeriod) return false;
          const date = tx.source === "card" ? tx.billingDate ?? tx.date : tx.date;
          return date >= selectedPeriod.from && date <= selectedPeriod.to;
        }
        return Boolean(trendFrom && trendTo && tx.date >= trendFrom && tx.date <= trendTo);
      }),
    [analysisMode, lastDebitDate, selectedPeriod, transactions, trendFrom, trendTo]
  );

  const expenses = useMemo(() => budgetExpenses(periodTransactions), [periodTransactions]);
  const incomes = useMemo(() => budgetIncome(periodTransactions), [periodTransactions]);
  const savingsTotal = useMemo(() => netSavings(periodTransactions), [periodTransactions]);
  const averageHint = (value: number) =>
    isPartialSinglePeriod
      ? `קצב חודשי משוער ${formatILSWhole(monthlyRate(value, periodDays))} לפי ${periodDays} ימים`
      : `ממוצע ${formatILSWhole(value / periodCount)} לתקופה`;
  const analytics = useMemo(() => {
    const categoryTotals = new Map<string, number>();
    const merchantTotals = new Map<string, number>();
    const savingsCategoryTotals = new Map<string, number>();
    const cardMerchantTotals = new Map<string, number>();
    const cardCategoryTotals = new Map<string, number>();
    const cardGroups = new Map<string, { billingDate: string; cardLast4?: string; cardProvider?: string; total: number; count: number }>();
    const monthly = new Map<string, { income: number; expense: number; savings: number; leftover: number; transactionCount: number }>();

    for (const tx of periodTransactions) {
      const key = periodTxDate(tx, analysisMode).slice(0, 7) || "unknown";
      const row = monthly.get(key) ?? { income: 0, expense: 0, savings: 0, leftover: 0, transactionCount: 0 };
      row.transactionCount += 1;
      if (tx.type === "income" && tx.source !== "card" && !NON_FLOW_MAINS.has(tx.categoryMain)) {
        row.income += tx.amount;
      } else if (tx.type !== "income" && isConsumption(tx)) {
        row.expense += tx.amount;
        addToMap(categoryTotals, tx.categoryMain || "OTHER", tx.amount);
        addToMap(merchantTotals, tx.merchant || "OTHER", tx.amount);
      } else if (isSavings(tx)) {
        const signedSavings = tx.type === "income" ? -tx.amount : tx.amount;
        row.savings += signedSavings;
        addToMap(savingsCategoryTotals, tx.categoryMain || "OTHER", signedSavings);
      }
      if (tx.source === "card" && tx.type !== "income") {
        const key = cardGroupKey(tx);
        const group = cardGroups.get(key) ?? {
          billingDate: tx.billingDate ?? tx.date,
          cardLast4: tx.cardLast4,
          cardProvider: tx.cardProvider,
          total: 0,
          count: 0,
        };
        group.total += tx.amount;
        group.count += 1;
        cardGroups.set(key, group);
        addToMap(cardMerchantTotals, tx.merchant || "OTHER", tx.amount);
        addToMap(cardCategoryTotals, tx.categoryMain || "OTHER", tx.amount);
      }
      row.leftover = row.income - row.expense - row.savings;
      monthly.set(key, row);
    }

    const incomeTotal = sum(incomes);
    const expenseTotal = sum(expenses);
    const leftoverTotal = incomeTotal - expenseTotal - savingsTotal;
    return {
      periodLabel: analysisLabel,
      analysisMode,
      periodCount,
      period: {
        from: analysisMode === "month" ? selectedPeriod?.from : trendFrom,
        to: analysisMode === "month" ? selectedPeriod?.to : trendTo,
        days: periodDays,
        monthEquivalent: roundMoney(monthEquivalent),
        partialPeriod: isPartialSinglePeriod,
      },
      creditCardAccounting: {
        basis: "charged_only",
        lastDebitDate,
        excludesPendingCardTransactions: true,
        categoryOverridesAppliedBeforeAnalysis: true,
      },
      totals: {
        income: roundMoney(incomeTotal),
        consumptionExpenses: roundMoney(expenseTotal),
        savingsAndInvestments: roundMoney(savingsTotal),
        leftover: roundMoney(leftoverTotal),
      },
      averages: {
        income: roundMoney(incomeTotal / periodCount),
        consumptionExpenses: roundMoney(expenseTotal / periodCount),
        savingsAndInvestments: roundMoney(savingsTotal / periodCount),
        leftover: roundMoney(leftoverTotal / periodCount),
      },
      monthlyRunRate: {
        income: roundMoney(monthlyRate(incomeTotal, periodDays)),
        consumptionExpenses: roundMoney(monthlyRate(expenseTotal, periodDays)),
        savingsAndInvestments: roundMoney(monthlyRate(savingsTotal, periodDays)),
        leftover: roundMoney(monthlyRate(leftoverTotal, periodDays)),
      },
      counts: {
        allTransactions: periodTransactions.length,
        incomeTransactions: incomes.length,
        consumptionExpenseTransactions: expenses.length,
        savingsTransactions: periodTransactions.filter((tx) => isSavings(tx)).length,
        creditCardTransactions: periodTransactions.filter((tx) => tx.source === "card" && tx.type !== "income").length,
      },
      creditCardBreakdown: {
        total: roundMoney(sum(periodTransactions.filter((tx) => tx.source === "card" && tx.type !== "income"))),
        groups: [...cardGroups.values()]
          .sort((a, b) => b.total - a.total)
          .map((group) => ({ ...group, total: roundMoney(group.total) })),
        topMerchants: topRows(cardMerchantTotals, 18),
        topCategories: topRows(cardCategoryTotals, 14),
        transactions: periodTransactions
          .filter((tx) => tx.source === "card" && tx.type !== "income")
          .sort((a, b) => (b.billingDate ?? b.date).localeCompare(a.billingDate ?? a.date) || b.amount - a.amount)
          .slice(0, 120)
          .map((tx) => ({
            purchaseDate: tx.date,
            billingDate: tx.billingDate ?? tx.date,
            merchant: tx.merchant,
            amount: roundMoney(tx.amount),
            categoryMain: tx.categoryMain,
            categorySub: tx.categorySub,
            cardLast4: tx.cardLast4,
            cardProvider: tx.cardProvider,
            installment: tx.installment,
          })),
      },
      monthly: [...monthly.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, row]) => ({
          month,
          income: roundMoney(row.income),
          consumptionExpenses: roundMoney(row.expense),
          savingsAndInvestments: roundMoney(row.savings),
          leftover: roundMoney(row.leftover),
          transactionCount: row.transactionCount,
        })),
      topConsumptionCategories: topRows(categoryTotals, 14),
      topConsumptionMerchants: topRows(merchantTotals, 18),
      savingsAndInvestmentCategories: topRows(savingsCategoryTotals, 8),
    };
  }, [analysisLabel, analysisMode, expenses, incomes, isPartialSinglePeriod, monthEquivalent, periodCount, periodDays, periodTransactions, savingsTotal, selectedPeriod, trendFrom, trendTo]);

  const runAnalysis = () => {
    if (!analysisLabel) return;
    setLoading(true);
    setError("");
    setResult(null);
    analyzeBudgetWithAI({
      analysisMode,
      periodLabel: analysisLabel,
      transactions: periodTransactions,
      analytics,
      bankBalance,
    })
      .then(setResult)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(message === "AI_API_KEY_REQUIRED" ? "חסר מפתח AI בהגדרות השירותים" : message);
      })
      .finally(() => setLoading(false));
  };

  if (periods.length === 0) {
    return <p className="loading">אין נתונים לניתוח.</p>;
  }

  return (
    <div className="ai-view">
      <div className="period-row">
        <label htmlFor="ai-mode-select">סוג ניתוח:</label>
        <select
          id="ai-mode-select"
          value={analysisMode}
          onChange={(event) => {
            setAnalysisMode(event.target.value as AnalysisMode);
            setResult(null);
            setError("");
          }}
        >
          <option value="month">חודש מסוים</option>
          <option value="trend">תקופה למגמות</option>
        </select>
        {analysisMode === "month" ? (
          <>
            <label htmlFor="ai-month-select">תקופה:</label>
            <select
              id="ai-month-select"
              value={selectedPeriod?.key ?? ""}
              onChange={(event) => {
                setPeriodKey(event.target.value);
                setResult(null);
                setError("");
              }}
            >
              {periods.map((period) => (
                <option key={period.key} value={period.key}>
                  {period.label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <label htmlFor="ai-trend-select">טווח:</label>
            <select
              id="ai-trend-select"
              value={trendCount}
              onChange={(event) => {
                setTrendCount(event.target.value);
                setResult(null);
                setError("");
              }}
            >
              <option value="3">3 תקופות אחרונות</option>
              <option value="6">6 תקופות אחרונות</option>
              <option value="12">12 תקופות אחרונות</option>
            </select>
          </>
        )}
        <button className="table-toggle primary-action" type="button" onClick={runAnalysis} disabled={loading}>
          {loading ? "מנתח..." : "הרצת ניתוח AI"}
        </button>
      </div>

      <div className="stat-tiles ai-stat-tiles">
        <div className="stat-tile">
          <span className="stat-label">עסקאות בניתוח</span>
          <span className="stat-value">{periodTransactions.length}</span>
          <span className="stat-hint">{analysisLabel}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">הוצאות צריכה</span>
          <span className="stat-value">{formatILSWhole(sum(expenses))}</span>
          <span className="stat-hint">{averageHint(sum(expenses))}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">חיסכון והשקעות</span>
          <span className="stat-value">{formatILSWhole(savingsTotal)}</span>
          <span className="stat-hint">{averageHint(savingsTotal)}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">הכנסות</span>
          <span className="stat-value">{formatILSWhole(sum(incomes))}</span>
          <span className="stat-hint">{averageHint(sum(incomes))}</span>
        </div>
      </div>

      {error && <div className="error-box">שגיאת AI: {error}</div>}

      {result ? (
        <section className="ai-analysis-panel">
          <div className="ai-score-card">
            <span className="stat-label">ציון תקציבי</span>
            <strong>{Math.round(result.score)}</strong>
            <span>/100</span>
          </div>
          <div className="ai-summary">
            <h2>ניתוח AI</h2>
            <p>{result.summary}</p>
          </div>
          <AIList title="חוזקות" items={result.strengths} />
          <AIList title="סיכונים" items={result.risks} />
          <AIList title="המלצות" items={result.recommendations} />
        </section>
      ) : (
        <section className="ai-analysis-panel empty-ai-panel">
          <h2>ניתוח AI</h2>
          <p>בחר תקופה והריץ ניתוח כדי לקבל ציון, נקודות סיכון והמלצות פעולה.</p>
        </section>
      )}
    </div>
  );
}

function AIList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="ai-list">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="empty-row">אין נקודות להצגה</p>
      )}
    </div>
  );
}
