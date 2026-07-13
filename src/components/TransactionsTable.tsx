import type { ClassifiedTransaction } from "../types";
import { formatILS } from "./format";
import { transactionHighlightClass } from "./transactionHighlight";

interface Props {
  transactions: ClassifiedTransaction[];
}

export function TransactionsTable({ transactions }: Props) {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="table-wrap">
      <table className="tx-table">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>בית עסק</th>
            <th>סיווג</th>
            <th>סיבה</th>
            <th className="num">סכום</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((tx) => (
            <tr key={tx.id} className={transactionHighlightClass(tx, 5000)}>
              <td>{tx.date.slice(8, 10)}.07</td>
              <td>{tx.merchant}</td>
              <td>
                <span className={`chip ${tx.classification}`}>
                  <span className="chip-icon" aria-hidden>
                    {tx.classification === "discretionary" ? "✕" : "✓"}
                  </span>
                  {tx.classification === "discretionary" ? "מותרת — להימנע" : "חובה"}
                </span>
              </td>
              <td className="reason-cell">{tx.reason}</td>
              <td className="num">{formatILS(tx.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
