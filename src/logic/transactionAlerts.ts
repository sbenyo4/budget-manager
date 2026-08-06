import type { Transaction } from "../types";
import { budgetDate, isConsumption } from "./flows";
import { merchantKey } from "./categoryOverrides";

export type TransactionAlertKind =
  | "price_increase"
  | "monthly_spike"
  | "high_amount"
  | "high_balance"
  | "unusual_amount"
  | "strange_merchant";

export type TransactionAlertSeverity = "attention" | "warning" | "critical";

export interface TransactionAlert {
  id: string;
  approvalKey: string;
  approvalValue: number;
  kind: TransactionAlertKind;
  severity: TransactionAlertSeverity;
  merchant: string;
  date: string;
  amount: number;
  previousAmount?: number;
  increasePercent?: number;
  title: string;
  description: string;
  transactionIds: string[];
}

export function mergeAlertApprovals(
  current: Record<string, number>,
  alerts: TransactionAlert[]
): Record<string, number> {
  const merged = { ...current };
  for (const alert of alerts) {
    merged[alert.approvalKey] = Math.max(
      merged[alert.approvalKey] ?? 0,
      alert.approvalValue
    );
  }
  return merged;
}

export function detectHighCheckingBalanceAlert(
  checkingBalance: { balance: number; date: string } | null,
  threshold: number,
  approvals: Record<string, number> = {}
): TransactionAlert | null {
  if (!checkingBalance || !Number.isFinite(checkingBalance.balance)) return null;
  const normalizedThreshold = Math.max(0, threshold);
  const toleratedThreshold = normalizedThreshold * 1.03;
  if (checkingBalance.balance <= toleratedThreshold) return null;

  const roundedThreshold = roundAmount(normalizedThreshold);
  const roundedBalance = roundAmount(checkingBalance.balance);
  const approvalKey = `checking-balance:high:${roundedThreshold}`;
  if (isApprovedAtCurrentBaseline(approvals, approvalKey, roundedBalance)) return null;

  return {
    id: `checking-balance:${checkingBalance.date}:${roundedBalance}:${roundedThreshold}`,
    approvalKey,
    approvalValue: roundedBalance,
    kind: "high_balance",
    severity: "warning",
    merchant: "חשבון העו״ש",
    date: checkingBalance.date,
    amount: roundedBalance,
    previousAmount: roundedThreshold,
    title: "יתרת עו״ש גבוהה",
    description: `היתרה גבוהה ביותר מ־3% מסף ההתראה שהוגדר (${roundedThreshold} ₪). כדאי לבדוק אם יש כסף שאינו נדרש לשימוש השוטף.`,
    transactionIds: [],
  };
}

interface DetectTransactionAlertsOptions {
  highAmountThreshold: number;
  fixedExpenses?: string[];
  approvals?: Record<string, number>;
  alertFrom?: string;
  alertTo?: string;
  includeHistoricalPriceChanges?: boolean;
}

interface MerchantGroup {
  key: string;
  merchant: string;
  transactions: Transaction[];
}

const SERVICE_SUBCATEGORIES = new Set([
  "UTILITIES",
  "COMMUNICATIONS",
  "INSURANCE_&_FEES",
  "RENT",
  "FEES",
  "LOANS",
  "HEALTHCARE",
]);
const VARIABLE_SERVICE_SUBCATEGORIES = new Set(["UTILITIES"]);
const DAY_MS = 86_400_000;

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function canonicalMerchant(value: string): string {
  return value
    .toLocaleLowerCase("he")
    .replace(/\b\d{5,}\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function approvalKeyPart(value: string): string {
  return (canonicalMerchant(value) || value.trim().toLocaleLowerCase("he")).slice(0, 160);
}

function monthKey(tx: Transaction): string {
  return budgetDate(tx).slice(0, 7);
}

function isoDateMinusDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return new Date(parsed.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

function isApprovedAtCurrentBaseline(
  approvals: Record<string, number>,
  approvalKey: string,
  currentAmount: number,
  tolerance = 1.05
): boolean {
  const approvedAmount = approvals[approvalKey];
  return Number.isFinite(approvedAmount) && currentAmount <= approvedAmount * tolerance;
}

function suspiciousMerchantReason(merchant: string): string | null {
  const trimmed = merchant.trim();
  const letters = trimmed.match(/\p{L}/gu)?.length ?? 0;
  const digits = trimmed.match(/\p{N}/gu)?.length ?? 0;
  const compactLength = trimmed.replace(/\s/g, "").length;
  if (!trimmed || letters === 0) return "שם בית העסק אינו מכיל שם מזוהה";
  if (/(unknown|לא\s*ידוע|ללא\s*שם|merchant|בית\s*עסק\s*כללי)/iu.test(trimmed)) {
    return "שם בית העסק כללי או לא מזוהה";
  }
  if (compactLength >= 8 && digits > letters * 1.5) return "שם בית העסק מורכב ברובו ממספרים";
  if (letters < 3 && compactLength >= 8) return "שם בית העסק קצר ולא ברור";
  return null;
}

function severityForIncrease(percent: number, delta: number): TransactionAlertSeverity {
  if (percent >= 75 || delta >= 1_000) return "critical";
  if (percent >= 35 || delta >= 300) return "warning";
  return "attention";
}

function latestDate(transactions: Transaction[]): string {
  return transactions.reduce((latest, tx) => (budgetDate(tx) > latest ? budgetDate(tx) : latest), "");
}

function groupByMerchant(transactions: Transaction[]): MerchantGroup[] {
  const groups = new Map<string, MerchantGroup>();
  for (const tx of transactions) {
    const merchant = merchantKey(tx);
    const key = canonicalMerchant(merchant) || merchant.trim().toLocaleLowerCase("he");
    if (!key) continue;
    const group = groups.get(key) ?? { key, merchant, transactions: [] };
    group.transactions.push(tx);
    if (merchant.length > group.merchant.length) group.merchant = merchant;
    groups.set(key, group);
  }
  return [...groups.values()];
}

function recurringAlerts(
  groups: MerchantGroup[],
  alertFrom: string,
  alertTo: string,
  fixedExpenses: Set<string>,
  approvals: Record<string, number>,
  includeHistoricalPriceChanges: boolean
): TransactionAlert[] {
  const alerts: TransactionAlert[] = [];

  for (const group of groups) {
    const monthly = new Map<string, { amount: number; transactions: Transaction[] }>();
    for (const tx of group.transactions) {
      const key = monthKey(tx);
      const entry = monthly.get(key) ?? { amount: 0, transactions: [] };
      entry.amount += tx.amount;
      entry.transactions.push(tx);
      monthly.set(key, entry);
    }
    const months = [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b));
    const explicitlyRecurring =
      group.transactions.some((tx) => tx.recurring || SERVICE_SUBCATEGORIES.has(tx.categorySub)) ||
      fixedExpenses.has(group.merchant);
    if ((!explicitlyRecurring && months.length < 3) || months.length < 2) continue;

    const firstIndex = includeHistoricalPriceChanges ? 1 : months.length - 1;
    for (let index = firstIndex; index < months.length; index += 1) {
      const [currentMonth, current] = months[index];
      const currentDate = current.transactions.reduce(
        (latest, tx) => (budgetDate(tx) > latest ? budgetDate(tx) : latest),
        ""
      );
      if (currentDate < alertFrom || currentDate > alertTo) continue;
      const previousMonthAmount = months[index - 1]?.[1].amount;
      if (
        includeHistoricalPriceChanges &&
        previousMonthAmount > 0 &&
        current.amount <= previousMonthAmount * 1.001
      ) {
        continue;
      }

      const history = months.slice(Math.max(0, index - 6), index).map(([, entry]) => entry.amount);
      if (!explicitlyRecurring && history.length < 2) continue;
      const historicalBaseline = median(history);
      const approvalKey = `price:${approvalKeyPart(group.merchant)}`;
      const approvedBaseline = approvals[approvalKey] ?? 0;
      const baseline = Math.max(historicalBaseline, approvedBaseline);
      if (baseline <= 0 || isApprovedAtCurrentBaseline(approvals, approvalKey, current.amount, 1.001)) continue;

      const variableService = current.transactions.some((tx) =>
        VARIABLE_SERVICE_SUBCATEGORIES.has(tx.categorySub)
      );
      const minPercent = approvedBaseline > 0 ? (variableService ? 5 : 0.1) : variableService ? 25 : explicitlyRecurring ? 10 : 40;
      const minDelta = approvedBaseline > 0 ? (variableService ? 10 : 0.01) : variableService ? 40 : explicitlyRecurring ? 5 : 150;
      const delta = current.amount - baseline;
      const increasePercent = (delta / baseline) * 100;
      if (delta < minDelta || increasePercent < minPercent) continue;

      const roundedAmount = roundAmount(current.amount);
      alerts.push({
        id: `price:${group.key}:${currentMonth}:${roundedAmount}`,
        approvalKey,
        approvalValue: roundedAmount,
        kind: variableService ? "monthly_spike" : "price_increase",
        severity: severityForIncrease(increasePercent, delta),
        merchant: group.merchant,
        date: currentDate,
        amount: roundedAmount,
        previousAmount: roundAmount(baseline),
        increasePercent: Math.round(increasePercent),
        title: variableService ? "עלייה חריגה בשירות קבוע" : "מחיר שירות חוזר עלה",
        description: variableService
          ? `החיוב החודשי גבוה ב-${Math.round(increasePercent)}% מהבסיס הקודם.`
          : `המחיר עלה מ-${roundAmount(baseline)} ₪ ל-${roundedAmount} ₪.`,
        transactionIds: current.transactions.map((tx) => tx.id),
      });
    }
  }
  return alerts;
}

function transactionAlerts(
  groups: MerchantGroup[],
  alertFrom: string,
  alertTo: string,
  threshold: number,
  approvals: Record<string, number>,
  priceAlertTransactionIds: Set<string>
): TransactionAlert[] {
  const alerts: TransactionAlert[] = [];

  for (const group of groups) {
    const sorted = [...group.transactions].sort((a, b) => budgetDate(a).localeCompare(budgetDate(b)));
    for (let index = 0; index < sorted.length; index += 1) {
      const tx = sorted[index];
      const date = budgetDate(tx);
      if (date < alertFrom || date > alertTo || priceAlertTransactionIds.has(tx.id)) continue;

      const transactionApprovalKey = `transaction:${tx.id}`;
      if (transactionApprovalKey in approvals) continue;
      const previousAmounts = sorted.slice(0, index).map((previous) => previous.amount);
      const previousMedian = median(previousAmounts.slice(-8));
      const delta = tx.amount - previousMedian;
      const unusual =
        previousAmounts.length >= 2 &&
        tx.amount >= 300 &&
        previousMedian > 0 &&
        tx.amount >= previousMedian * 2 &&
        delta >= 200;

      if (unusual) {
        const increasePercent = Math.round((delta / previousMedian) * 100);
        alerts.push({
          id: `unusual:${tx.id}`,
          approvalKey: transactionApprovalKey,
          approvalValue: roundAmount(tx.amount),
          kind: "unusual_amount",
          severity: severityForIncrease(increasePercent, delta),
          merchant: tx.merchant,
          date,
          amount: roundAmount(tx.amount),
          previousAmount: roundAmount(previousMedian),
          increasePercent,
          title: "סכום חריג לעסק מוכר",
          description: `העסקה גבוהה משמעותית מהחיובים הקודמים אצל אותו בית עסק.`,
          transactionIds: [tx.id],
        });
        continue;
      }

      if (tx.amount >= threshold) {
        alerts.push({
          id: `high:${tx.id}`,
          approvalKey: transactionApprovalKey,
          approvalValue: roundAmount(tx.amount),
          kind: "high_amount",
          severity: tx.amount >= threshold * 2 ? "critical" : "warning",
          merchant: tx.merchant,
          date,
          amount: roundAmount(tx.amount),
          title: "עסקה בסכום גבוה",
          description: `הסכום עבר את סף ההתראה שלך (${roundAmount(threshold)} ₪).`,
          transactionIds: [tx.id],
        });
        continue;
      }

      const strangeReason = suspiciousMerchantReason(tx.merchant);
      const merchantApprovalKey = `merchant:${approvalKeyPart(tx.merchant)}`;
      const strangeMinimum = Math.max(250, threshold * 0.1);
      if (strangeReason && tx.amount >= strangeMinimum && !(merchantApprovalKey in approvals)) {
        alerts.push({
          id: `merchant:${tx.id}`,
          approvalKey: merchantApprovalKey,
          approvalValue: 1,
          kind: "strange_merchant",
          severity: tx.amount >= threshold ? "critical" : "warning",
          merchant: tx.merchant || "ללא שם",
          date,
          amount: roundAmount(tx.amount),
          title: "שם בית עסק לא ברור",
          description: `${strangeReason}. כדאי לוודא שהעסקה מוכרת לך.`,
          transactionIds: [tx.id],
        });
      }
    }
  }
  return alerts;
}

export function detectTransactionAlerts(
  transactions: Transaction[],
  {
    highAmountThreshold,
    fixedExpenses = [],
    approvals = {},
    alertFrom,
    alertTo,
    includeHistoricalPriceChanges = false,
  }: DetectTransactionAlertsOptions
): TransactionAlert[] {
  const expenses = transactions.filter(
    (tx) => tx.type !== "income" && tx.status !== "PENDING" && isConsumption(tx) && tx.amount > 0
  );
  const newestDate = latestDate(expenses);
  if (!newestDate) return [];
  const priceAlertFrom = alertFrom || isoDateMinusDays(newestDate, 62);
  const transactionAlertFrom = alertFrom || isoDateMinusDays(newestDate, 45);
  const scopedAlertTo = alertTo || newestDate;
  const groups = groupByMerchant(expenses);
  const priceAlerts = recurringAlerts(
    groups,
    priceAlertFrom,
    scopedAlertTo,
    new Set(fixedExpenses),
    approvals,
    includeHistoricalPriceChanges
  );
  const priceAlertTransactionIds = new Set(priceAlerts.flatMap((alert) => alert.transactionIds));
  const individualAlerts = transactionAlerts(
    groups,
    transactionAlertFrom,
    scopedAlertTo,
    Math.max(1, highAmountThreshold),
    approvals,
    priceAlertTransactionIds
  );

  const severityOrder: Record<TransactionAlertSeverity, number> = {
    critical: 0,
    warning: 1,
    attention: 2,
  };
  return [...priceAlerts, ...individualAlerts].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.date.localeCompare(a.date)
  );
}
