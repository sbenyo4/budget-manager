import { useState } from "react";
import type { TransactionAlert, TransactionAlertKind } from "../logic/transactionAlerts";
import { formatILS } from "./format";

interface AlertsViewProps {
  alerts: TransactionAlert[];
  onApprove: (alerts: TransactionAlert[]) => Promise<void>;
  title?: string;
  description?: string;
  showSummary?: boolean;
}

const KIND_LABELS: Record<TransactionAlertKind, string> = {
  price_increase: "שינוי מחיר",
  monthly_spike: "שירות קבוע",
  high_amount: "סכום גבוה",
  high_balance: "יתרת עו״ש",
  unusual_amount: "חריגה מהרגיל",
  strange_merchant: "עסקה לא ברורה",
};

function formatAlertDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

function alertMarker(alert: TransactionAlert): string {
  if (alert.severity === "critical") return "!";
  if (alert.kind === "price_increase") return "↗";
  if (alert.kind === "high_balance") return "₪";
  return "?";
}

export function AlertsView({
  alerts,
  onApprove,
  title = "אירועים שדורשים תשומת לב",
  description = "אישור מלמד את המערכת שהעסקה, המחיר או היתרה תקינים.",
  showSummary = true,
}: AlertsViewProps) {
  const [keptAlerts, setKeptAlerts] = useState<Set<string>>(new Set());
  const [selectedAlerts, setSelectedAlerts] = useState<Set<string>>(new Set());
  const [approvingAlerts, setApprovingAlerts] = useState<Set<string>>(new Set());
  const [approvalErrors, setApprovalErrors] = useState<Set<string>>(new Set());
  const criticalCount = alerts.filter((alert) => alert.severity === "critical").length;
  const priceCount = alerts.filter(
    (alert) => alert.kind === "price_increase" || alert.kind === "monthly_spike"
  ).length;
  const selected = alerts.filter((alert) => selectedAlerts.has(alert.id));

  function approve(alertsToApprove: TransactionAlert[]): void {
    const ids = alertsToApprove.map((alert) => alert.id);
    setApprovingAlerts((current) => new Set([...current, ...ids]));
    setApprovalErrors((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    void onApprove(alertsToApprove)
      .then(() => {
        setSelectedAlerts((current) => {
          const next = new Set(current);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      })
      .catch(() => {
        setApprovalErrors((current) => new Set([...current, ...ids]));
      })
      .finally(() => {
        setApprovingAlerts((current) => {
          const next = new Set(current);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      });
  }

  if (!alerts.length) {
    return (
      <section className="alerts-view">
        <div className="alerts-empty">
          <span className="alerts-empty-icon" aria-hidden>✓</span>
          <h2>{title}</h2>
          <p>לא זוהו עליות מחיר, יתרות או עסקאות חריגות שדורשות בדיקה.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="alerts-view" aria-labelledby="alerts-heading">
      {showSummary && (
        <div className="alerts-summary">
          <div>
            <span>התראות פעילות</span>
            <strong>{alerts.length}</strong>
          </div>
          <div>
            <span>שינויי מחיר</span>
            <strong>{priceCount}</strong>
          </div>
          <div>
            <span>דחופות לבדיקה</span>
            <strong>{criticalCount}</strong>
          </div>
        </div>
      )}

      <div className="alerts-heading-row">
        <div>
          <h2 id="alerts-heading">{title}</h2>
          <p>{description}</p>
        </div>
        {alerts.length > 1 && (
          <div className="alerts-bulk-actions" aria-label="אישור מרוכז">
            <button
              type="button"
              className="alert-keep-button"
              onClick={() =>
                setSelectedAlerts(
                  selected.length === alerts.length
                    ? new Set()
                    : new Set(alerts.map((alert) => alert.id))
                )
              }
            >
              {selected.length === alerts.length ? "ביטול בחירת הכל" : "בחירת הכל"}
            </button>
            <button
              type="button"
              className="alert-approve-button"
              disabled={!selected.length || selected.some((alert) => approvingAlerts.has(alert.id))}
              onClick={() => approve(selected)}
            >
              {selected.some((alert) => approvingAlerts.has(alert.id))
                ? "שומר בשרת…"
                : `אישור נבחרות (${selected.length})`}
            </button>
          </div>
        )}
      </div>

      <div className="alerts-list">
        {alerts.map((alert) => {
          const kept = keptAlerts.has(alert.id);
          const approving = approvingAlerts.has(alert.id);
          const approvalFailed = approvalErrors.has(alert.id);
          const isBalanceAlert = alert.kind === "high_balance";
          return (
            <article className={`alert-card ${alert.severity}`} key={alert.id}>
              <div className="alert-card-marker" aria-hidden>
                {alertMarker(alert)}
              </div>
              <div className="alert-card-body">
                <div className="alert-card-topline">
                  {alerts.length > 1 && (
                    <label className="alert-select">
                      <input
                        type="checkbox"
                        checked={selectedAlerts.has(alert.id)}
                        onChange={(event) =>
                          setSelectedAlerts((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(alert.id);
                            else next.delete(alert.id);
                            return next;
                          })
                        }
                      />
                      <span>לבחירה מרוכזת</span>
                    </label>
                  )}
                  <span className={`alert-kind ${alert.kind}`}>{KIND_LABELS[alert.kind]}</span>
                  <time dateTime={alert.date}>{formatAlertDate(alert.date)}</time>
                </div>
                <h3>{alert.title}</h3>
                <div className="alert-merchant-row">
                  <strong>{alert.merchant}</strong>
                  <span>{formatILS(alert.amount)}</span>
                </div>
                <p>{alert.description}</p>
                {alert.previousAmount !== undefined && (
                  <div className="alert-comparison" aria-label="השוואת סכומים">
                    <span>
                      {isBalanceAlert ? "סף שהוגדר" : "בסיס קודם"}: {formatILS(alert.previousAmount)}
                    </span>
                    <span aria-hidden>←</span>
                    <strong>
                      {isBalanceAlert ? "יתרה נוכחית" : "חיוב נוכחי"}: {formatILS(alert.amount)}
                    </strong>
                    {alert.increasePercent !== undefined && <em>+{alert.increasePercent}%</em>}
                  </div>
                )}
              </div>
              <div className="alert-card-actions">
                <button
                  type="button"
                  className={`alert-keep-button ${kept ? "active" : ""}`}
                  onClick={() =>
                    setKeptAlerts((current) => {
                      const next = new Set(current);
                      next.add(alert.id);
                      return next;
                    })
                  }
                  disabled={kept}
                >
                  {kept ? "נשארה לבדיקה" : "להשאיר"}
                </button>
                <button
                  type="button"
                  className="alert-approve-button"
                  onClick={() => approve([alert])}
                  disabled={approving}
                >
                  {approving ? "שומר בשרת…" : approvalFailed ? "נסה לשמור שוב" : "אישור — זה תקין"}
                </button>
                {approvalFailed && <span className="alert-approval-error">האישור לא נשמר</span>}
              </div>
            </article>
          );
        })}
      </div>
      <p className="alerts-learning-note">
        לאחר אישור עליית מחיר, המחיר החדש הופך לקו הבסיס. עלייה נוספת תיצור התראה חדשה.
      </p>
    </section>
  );
}
