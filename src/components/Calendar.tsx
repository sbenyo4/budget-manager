import type { ClassifiedTransaction } from "../types";
import { formatILS } from "./format";

const WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

interface Props {
  year: number;
  month: number; // 1-based
  byDate: Map<string, ClassifiedTransaction[]>;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function Calendar({ year, month, byDate, selectedDate, onSelectDate }: Props) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0 = Sunday
  const today = new Date();
  const todayIso = isoDate(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <section aria-label={`לוח שנה יולי ${year}`}>
      <div className="calendar-grid calendar-head">
        {WEEKDAYS.map((d) => (
          <div key={d} className="weekday">
            {d}
          </div>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} className="day-cell empty" />;

          const date = isoDate(year, month, day);
          const txs = byDate.get(date) ?? [];
          const discretionary = txs.filter((t) => t.classification === "discretionary");
          const hasAvoid = discretionary.length > 0;
          const classNames = [
            "day-cell",
            hasAvoid ? "has-avoid" : "",
            date === todayIso ? "today" : "",
            date === selectedDate ? "selected" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={date}
              className={classNames}
              onClick={() => onSelectDate(date)}
              aria-label={`${day} ביולי — ${txs.length} עסקאות, מתוכן ${discretionary.length} מותרות`}
            >
              <div className="day-head">
                <span className="day-number">{day}</span>
                {hasAvoid && <span className="avoid-flag">🚫 להימנע</span>}
              </div>
              <ul className="tx-chips">
                {txs.map((tx) => (
                  <li
                    key={tx.id}
                    className={`chip ${tx.classification}`}
                    title={`${tx.merchant} · ${formatILS(tx.amount)} · ${tx.reason}`}
                  >
                    <span className="chip-icon" aria-hidden>
                      {tx.classification === "discretionary" ? "✕" : "✓"}
                    </span>
                    <span className="chip-merchant">{tx.merchant}</span>
                    <span className="chip-amount">{formatILS(tx.amount)}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
      <div className="legend" role="note">
        <span className="chip mandatory">
          <span className="chip-icon" aria-hidden>✓</span> הוצאת חובה — משולמת כרגיל
        </span>
        <span className="chip discretionary">
          <span className="chip-icon" aria-hidden>✕</span> הוצאה מותרת — להימנע ביולי
        </span>
      </div>
    </section>
  );
}
