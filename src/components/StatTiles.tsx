import type { ClassifiedTransaction } from "../types";
import { formatILSWhole } from "./format";

interface Props {
  transactions: ClassifiedTransaction[];
  year: number;
  month: number;
}

export function StatTiles({ transactions, year, month }: Props) {
  const mandatoryTotal = transactions
    .filter((t) => t.classification === "mandatory")
    .reduce((sum, t) => sum + t.amount, 0);
  const discretionaryTotal = transactions
    .filter((t) => t.classification === "discretionary")
    .reduce((sum, t) => sum + t.amount, 0);

  const daysInMonth = new Date(year, month, 0).getDate();
  const avoidDays = new Set(
    transactions.filter((t) => t.classification === "discretionary").map((t) => t.date)
  ).size;
  const cleanDays = daysInMonth - avoidDays;

  return (
    <div className="stat-tiles">
      <div className="stat-tile">
        <span className="stat-label">הוצאות חובה</span>
        <span className="stat-value">{formatILSWhole(mandatoryTotal)}</span>
        <span className="stat-hint">משולמות כרגיל</span>
      </div>
      <div className="stat-tile highlight">
        <span className="stat-label">פוטנציאל חיסכון 💪</span>
        <span className="stat-value avoid-ink">{formatILSWhole(discretionaryTotal)}</span>
        <span className="stat-hint">סך ההוצאות המותרות שמהן נמנעים</span>
      </div>
      <div className="stat-tile">
        <span className="stat-label">ימים נקיים</span>
        <span className="stat-value">
          {cleanDays}<span className="stat-denominator">/{daysInMonth}</span>
        </span>
        <span className="stat-hint">ימים ללא אף הוצאה מותרת</span>
      </div>
    </div>
  );
}
