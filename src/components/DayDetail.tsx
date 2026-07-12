import type { ClassifiedTransaction } from "../types";
import { formatHebrewDate, formatILS } from "./format";

interface Props {
  date: string;
  transactions: ClassifiedTransaction[];
}

export function DayDetail({ date, transactions }: Props) {
  return (
    <section className="day-detail" aria-live="polite">
      <h2>{formatHebrewDate(date)}</h2>
      {transactions.length === 0 ? (
        <p className="clean-day">✓ יום נקי — אין הוצאות ביום זה</p>
      ) : (
        <ul className="detail-list">
          {transactions.map((tx) => (
            <li key={tx.id} className={`detail-row ${tx.classification}`}>
              <span className="chip-icon" aria-hidden>
                {tx.classification === "discretionary" ? "✕" : "✓"}
              </span>
              <span className="detail-merchant">
                {tx.merchant}
                {tx.recurring && <span className="recurring-tag">· מנוי / הוראת קבע</span>}
              </span>
              <span className="detail-reason">{tx.reason}</span>
              <span className="detail-amount">{formatILS(tx.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
