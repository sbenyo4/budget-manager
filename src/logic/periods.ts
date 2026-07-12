import type { Transaction } from "../types";

/** A salary-to-salary (or fallback calendar-month) reporting period. */
export interface Period {
  key: string;
  label: string;
  /** inclusive ISO dates */
  from: string;
  to: string;
  salaryBased: boolean;
}

const DAY_MS = 86_400_000;

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso: string, n: number): string {
  return toIso(new Date(new Date(`${iso}T00:00:00`).getTime() + n * DAY_MS));
}

function daysBetween(a: string, b: string): number {
  return (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / DAY_MS;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
}

function monthName(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("he-IL", { month: "long", year: "numeric" });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export interface SalaryDetection {
  /** Dates a full salary landed — the period boundaries */
  paydays: string[];
  /** All deposits from the employer, incl. small side-payments — for labeling */
  employerTxIds: Set<string>;
}

/**
 * Find salary deposits. Prefers SALARY-tagged transactions; the live
 * provider tags salaries as generic INCOMES_EXPENSES/OTHER, so fall back to
 * a heuristic: the payer with large deposits recurring in ≥3 distinct months
 * is the employer, and only its deposits near the typical amount (≥50% of
 * median, skipping small side-payments like reimbursements) count as paydays.
 */
const NON_SALARY_MAINS = new Set(["TRADING", "TRANSFER", "ASSETS", "RETURN", "DEPOSIT"]);

export function detectSalary(transactions: Transaction[]): SalaryDetection {
  // securities sales / deposit withdrawals can dwarf the salary — never
  // candidates for the employer heuristic
  const incomes = transactions.filter(
    (t) => t.type === "income" && !NON_SALARY_MAINS.has(t.categoryMain)
  );

  const tagged = incomes.filter((t) => t.categoryMain === "SALARY");
  if (tagged.length > 0) {
    return {
      paydays: [...new Set(tagged.map((t) => t.date))].sort(),
      employerTxIds: new Set(tagged.map((t) => t.id)),
    };
  }

  const byMerchant = new Map<string, Transaction[]>();
  for (const t of incomes) {
    const list = byMerchant.get(t.merchant) ?? [];
    list.push(t);
    byMerchant.set(t.merchant, list);
  }

  let best: { txs: Transaction[]; median: number } | null = null;
  for (const txs of byMerchant.values()) {
    const months = new Set(txs.map((t) => t.date.slice(0, 7)));
    if (months.size < 3) continue;
    const med = median(txs.map((t) => t.amount));
    if (!best || med > best.median) best = { txs, median: med };
  }
  if (!best) return { paydays: [], employerTxIds: new Set() };

  const threshold = best.median * 0.5;
  return {
    paydays: [...new Set(best.txs.filter((t) => t.amount >= threshold).map((t) => t.date))].sort(),
    employerTxIds: new Set(best.txs.map((t) => t.id)),
  };
}

/**
 * Re-tag detected employer deposits as SALARY so the income breakdown shows
 * "משכורת" instead of the provider's generic bank category. Run this on
 * display data only — buildPeriods must get the raw list, otherwise small
 * side-payments would masquerade as paydays.
 */
export function tagSalaries(transactions: Transaction[]): Transaction[] {
  const { employerTxIds } = detectSalary(transactions);
  if (employerTxIds.size === 0) return transactions;
  return transactions.map((t) =>
    employerTxIds.has(t.id) ? { ...t, categoryMain: "SALARY", categorySub: "SALARY_OTHER" } : t
  );
}

/**
 * Build salary-to-salary periods: each period starts on a salary deposit day
 * (inclusive) and ends the day before the next one. Salary deposits landing
 * within 15 days of a period start are treated as the same salary (split
 * deposits), not a new period. Falls back to calendar months when no salary
 * can be detected in the data.
 */
export function buildPeriods(transactions: Transaction[]): Period[] {
  const today = toIso(new Date());
  const salaryDates = detectSalary(transactions).paydays;

  const starts: string[] = [];
  for (const d of salaryDates) {
    const last = starts[starts.length - 1];
    if (!last || daysBetween(last, d) > 15) starts.push(d);
  }

  if (starts.length === 0) return calendarMonthPeriods(transactions, today);

  const periods = starts.map((from, i): Period => {
    const isLast = i === starts.length - 1;
    const to = isLast ? (today >= from ? today : from) : addDays(starts[i + 1], -1);
    // A salary landing at the end of a month is the NEXT month's salary, so
    // name the period after the month its midpoint falls in, not the payday's
    return {
      key: from,
      label: `${monthName(addDays(from, 15))} · ${shortDate(from)}–${shortDate(to)}`,
      from,
      to,
      salaryBased: true,
    };
  });
  return periods.reverse(); // latest first
}

function calendarMonthPeriods(transactions: Transaction[], today: string): Period[] {
  const months = [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort().reverse();
  return months.map((ym) => {
    const from = `${ym}-01`;
    const [y, m] = ym.split("-").map(Number);
    const endOfMonth = toIso(new Date(y, m, 0));
    return {
      key: ym,
      label: monthName(from),
      from,
      to: endOfMonth < today ? endOfMonth : today,
      salaryBased: false,
    };
  });
}
