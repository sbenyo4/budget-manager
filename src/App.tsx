import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchCheckingBalance, fetchTransactions } from "./api/openFinance";
import {
  emptyPreferences,
  getAuthConfig,
  getCurrentUser,
  loadPreferences,
  loginWithGoogle,
  logout,
  savePreferences,
  type AuthUser,
  type BudgetPreferences,
} from "./api/preferences";
import { classifyAll } from "./logic/classify";
import { buildPeriods, tagSalaries } from "./logic/periods";
import { isConsumption } from "./logic/flows";
import { applyCategoryOverrides, hasLegacyPreferences, readLegacyPreferences } from "./logic/categoryOverrides";
import type { Transaction } from "./types";
import { Calendar } from "./components/Calendar";
import { StatTiles } from "./components/StatTiles";
import { DayDetail } from "./components/DayDetail";
import { TransactionsTable } from "./components/TransactionsTable";
import { MonthlyView } from "./components/MonthlyView";
import { TrendsView } from "./components/TrendsView";

const YEAR = 2026;
const MONTH = 7; // July

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string | number | boolean>) => void;
        };
      };
    };
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <div className="error-box">
            שגיאת תצוגה: {this.state.error.message}
            <br />
            <button className="table-toggle" onClick={() => window.location.reload()}>
              רענון
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <BudgetApp />
    </AppErrorBoundary>
  );
}

function BudgetApp() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [googleClientId, setGoogleClientId] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [preferences, setPreferences] = useState<BudgetPreferences>(emptyPreferences);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [bankBalance, setBankBalance] = useState<{ balance: number; date: string } | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"calendar" | "monthly" | "trends">(() => {
    if (window.location.hash === "#monthly") return "monthly";
    if (window.location.hash === "#trends") return "trends";
    return "calendar";
  });

  useEffect(() => {
    window.location.hash = view === "calendar" ? "" : view;
  }, [view]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    Promise.all([getAuthConfig(), getCurrentUser()])
      .then(([config, auth]) => {
        setGoogleClientId(config.googleClientId);
        setUser(auth.user);
        if (!auth.user) {
          setPreferencesLoading(false);
          return;
        }
        return loadPreferences().then(migratePreferencesIfNeeded).then(setPreferences);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setAuthLoading(false);
        setPreferencesLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    // One wide fetch feeds both views: ~13 months back for salary-period history
    fetchTransactions(isoDaysAgo(400), `${YEAR}-12-31`)
      .then(({ transactions: txs, demo }) => {
        setAllTransactions(txs);
        setIsDemoMode(demo);
        if (!demo) fetchCheckingBalance().then(setBankBalance);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [user]);

  const updatePreferences = useCallback((next: BudgetPreferences) => {
    setPreferences(next);
    setSaveState("saving");
    savePreferences(next)
      .then((saved) => {
        setPreferences(saved);
        setSaveState("saved");
      })
      .catch((err: unknown) => {
        setSaveState("error");
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const migratePreferencesIfNeeded = useCallback((loaded: BudgetPreferences): Promise<BudgetPreferences> => {
    const legacy = readLegacyPreferences();
    const loadedIsEmpty =
      Object.keys(loaded.sectionOverrides).length === 0 &&
      loaded.oneTimeExpenses.length === 0 &&
      loaded.fixedExpenses.length === 0;
    if (!loadedIsEmpty || !hasLegacyPreferences(legacy)) return Promise.resolve(loaded);
    return savePreferences({
      sectionOverrides: legacy.sectionOverrides,
      oneTimeExpenses: legacy.oneTimeExpenses,
      fixedExpenses: legacy.fixedExpenses,
    });
  }, []);

  const handleLogin = useCallback((nextUser: AuthUser, nextPrefs: BudgetPreferences) => {
    setUser(nextUser);
    setPreferencesLoading(false);
    migratePreferencesIfNeeded(nextPrefs)
      .then(setPreferences)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [migratePreferencesIfNeeded]);

  const handleAuthError = useCallback((message: string) => {
    setError(message);
  }, []);

  const learnedTransactions = useMemo(
    () => applyCategoryOverrides(allTransactions, preferences.sectionOverrides),
    [allTransactions, preferences.sectionOverrides]
  );

  const julyExpenses = useMemo(
    () =>
      classifyAll(
        learnedTransactions.filter(
          (tx) =>
            tx.type !== "income" &&
            isConsumption(tx) &&
            tx.date >= `${YEAR}-07-01` &&
            tx.date <= `${YEAR}-07-31`
        )
      ),
    [learnedTransactions]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, ReturnType<typeof classifyAll>>();
    for (const tx of julyExpenses) {
      const list = map.get(tx.date) ?? [];
      list.push(tx);
      map.set(tx.date, list);
    }
    return map;
  }, [julyExpenses]);

  const periods = useMemo(() => buildPeriods(learnedTransactions), [learnedTransactions]);
  const displayTransactions = useMemo(() => tagSalaries(learnedTransactions), [learnedTransactions]);

  if (authLoading || preferencesLoading) {
    return <div className="app"><div className="loading">טוען התחברות…</div></div>;
  }

  if (!user) {
    return (
      <div className="app">
        <section className="login-panel">
          <h1>Budget Manager</h1>
          <p className="subtitle">התחברות לחשבון מאפשרת לשמור סיווגים והעדפות בין ביקורים.</p>
          <p className="auth-origin-hint">
            יש להוסיף ב-Google OAuth את ה-origin הזה: <code>{window.location.origin}</code>
          </p>
          <GoogleLoginButton
            clientId={googleClientId}
            onLogin={handleLogin}
            onError={handleAuthError}
          />
          {error && <div className="error-box">שגיאה: {error}</div>}
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="title-block">
          <h1>
            {view === "calendar" && `No Buy July ${YEAR}`}
            {view === "monthly" && "תקציב חודשי"}
            {view === "trends" && "מגמות וממוצעים"}
          </h1>
          {view === "calendar" && (
            <p className="subtitle">
              הוצאות <strong className="must-ink">חובה</strong> משולמות כרגיל · הוצאות{" "}
              <strong className="avoid-ink">מותרות</strong> מסומנות — מהן נמנעים החודש
            </p>
          )}
          {view === "monthly" && (
            <p className="subtitle">הכנסות מול הוצאות, ממשכורת עד המשכורת הבאה</p>
          )}
          {view === "trends" && (
            <p className="subtitle">צבירה וממוצעים על פני תקופות — הכנסות, הוצאות וחיסכון בני״ע</p>
          )}
        </div>
        <div className="header-actions">
          <div className="utility-row" aria-label="מצב חשבון">
            {isDemoMode && (
              <span className="demo-badge" title="הגדירו את פרטי ה-API בקובץ .env כדי לטעון נתונים אמיתיים">
                מצב הדגמה
              </span>
            )}
            <span className={`save-state ${saveState}`}>
              {saveState === "saving" ? "מסנכרן…" : saveState === "error" ? "שגיאת שמירה" : "העדפות מסונכרנות"}
            </span>
            <button
              className="logout-button"
              onClick={() =>
                logout().then(() => {
                  setUser(null);
                  setAllTransactions([]);
                  setPreferences(emptyPreferences);
                })
              }
            >
              התנתקות
            </button>
          </div>
          <nav className="tabs" aria-label="תצוגות">
            <button className={`tab ${view === "calendar" ? "active" : ""}`} onClick={() => setView("calendar")}>
              לוח No-Buy
            </button>
            <button className={`tab ${view === "monthly" ? "active" : ""}`} onClick={() => setView("monthly")}>
              תצוגה חודשית
            </button>
            <button className={`tab ${view === "trends" ? "active" : ""}`} onClick={() => setView("trends")}>
              מגמות
            </button>
          </nav>
        </div>
      </header>

      {error && <div className="error-box">שגיאה בטעינת הנתונים: {error}</div>}
      {loading && <div className="loading">טוען עסקאות…</div>}

      {!loading && !error && view === "calendar" && (
        <>
          <StatTiles transactions={julyExpenses} year={YEAR} month={MONTH} />
          <Calendar
            year={YEAR}
            month={MONTH}
            byDate={byDate}
            selectedDate={selectedDate}
            onSelectDate={(d) => setSelectedDate(d === selectedDate ? null : d)}
          />
          {selectedDate && (
            <DayDetail date={selectedDate} transactions={byDate.get(selectedDate) ?? []} />
          )}
          <div className="table-toggle-row">
            <button className="table-toggle" onClick={() => setShowTable((v) => !v)}>
              {showTable ? "הסתרת טבלת עסקאות" : "הצגת כל העסקאות בטבלה"}
            </button>
          </div>
          {showTable && <TransactionsTable transactions={julyExpenses} />}
        </>
      )}

      {!loading && !error && view === "monthly" && (
        <MonthlyView
          transactions={displayTransactions}
          periods={periods}
          bankBalance={bankBalance}
          preferences={preferences}
          onPreferencesChange={updatePreferences}
        />
      )}

      {!loading && !error && view === "trends" && (
        <TrendsView
          transactions={displayTransactions}
          periods={periods}
          bankBalance={bankBalance}
          preferences={preferences}
          onPreferencesChange={updatePreferences}
        />
      )}
    </div>
  );
}

function GoogleLoginButton({
  clientId,
  onLogin,
  onError,
}: {
  clientId: string;
  onLogin: (user: AuthUser, preferences: BudgetPreferences) => void;
  onError: (message: string) => void;
}) {
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clientId) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!buttonRef.current || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (!response.credential) {
            onError("Google did not return a credential");
            return;
          }
          loginWithGoogle(response.credential)
            .then(({ user }) => loadPreferences().then((preferences) => onLogin(user, preferences)))
            .catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)));
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
      });
    };
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [clientId, onError, onLogin]);

  if (!clientId) {
    return <div className="error-box">חסר GOOGLE_CLIENT_ID בקובץ .env</div>;
  }
  return <div ref={buttonRef} />;
}
