import { Component, useCallback, useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { fetchCheckingBalance, fetchTransactions } from "./api/openFinance";
import {
  emptyServiceSettings,
  emptyPreferences,
  getAuthConfig,
  getCurrentUser,
  loadPreferences,
  loadServiceSettings,
  loginWithGoogle,
  logout,
  patchPreferences,
  patchServiceSettings,
  getPinStatus,
  loadAIModels,
  setupPin,
  verifyPin,
  type AuthUser,
  type BudgetPreferences,
  type ServiceSettings,
} from "./api/preferences";
import { buildPeriods, tagSalaries } from "./logic/periods";
import { applyCategoryOverrides } from "./logic/categoryOverrides";
import type { Transaction } from "./types";
import { MonthlyView } from "./components/MonthlyView";
import { TrendsView } from "./components/TrendsView";
import { AIAnalysisView } from "./components/AIAnalysisView";
import { useAutoLogout } from "./hooks/useAutoLogout";

type ThemeMode = "light" | "dark";
type PinGateMode = "checking" | "setup" | "locked" | "unlocked" | "unavailable";
type AppView = "monthly" | "trends" | "ai";
type SettingsPreferences = Pick<
  BudgetPreferences,
  "highAmountThreshold" | "householdBirthDate" | "householdAge" | "householdSize" | "autoLogoutMinutes"
>;

function readInitialTheme(): ThemeMode {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function isMissingServiceSettingsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === "SERVICE_SETTINGS_REQUIRED" ||
    message === "NOT_CONFIGURED" ||
    message === "AUTH_REQUIRED" ||
    message.includes("NOT_FOUND") ||
    message.includes("page could not be found") ||
    message.includes("/api/service-settings")
  );
}

function serviceSettingsSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message === "AUTH_REQUIRED" ||
    message.includes("AUTH_REQUIRED") ||
    message.includes("NOT_FOUND") ||
    message.includes("page could not be found") ||
    message.includes("/api/service-settings")
  ) {
    return "לא ניתן לשמור הגדרות. יש להתחבר שוב עם Google ולוודא שהפריסה האחרונה ב-Vercel כוללת את נתיב ההגדרות.";
  }
  return message;
}

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
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function endOfCurrentYear(): string {
  const year = new Date().getFullYear();
  return `${year}-12-31`;
}

function normalizePin(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function calculateAgeFromBirthDate(birthDate: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [year, month, day] = birthDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getTime() > now.getTime()
  ) {
    return null;
  }
  let age = now.getFullYear() - year;
  const birthdayThisYear = new Date(now.getFullYear(), month - 1, day);
  if (now < birthdayThisYear) age -= 1;
  return age > 0 ? age : null;
}

function changedPreferences(previous: BudgetPreferences, next: BudgetPreferences): Partial<BudgetPreferences> {
  const patch: Partial<BudgetPreferences> = {};
  if (previous.highAmountThreshold !== next.highAmountThreshold) patch.highAmountThreshold = next.highAmountThreshold;
  if (previous.householdBirthDate !== next.householdBirthDate) patch.householdBirthDate = next.householdBirthDate;
  if (previous.householdAge !== next.householdAge) patch.householdAge = next.householdAge;
  if (previous.householdSize !== next.householdSize) patch.householdSize = next.householdSize;
  if (previous.autoLogoutMinutes !== next.autoLogoutMinutes) patch.autoLogoutMinutes = next.autoLogoutMinutes;
  if (previous.theme !== next.theme) patch.theme = next.theme;
  if (JSON.stringify(previous.sectionOverrides) !== JSON.stringify(next.sectionOverrides)) {
    patch.sectionOverrides = next.sectionOverrides;
  }
  if (JSON.stringify(previous.oneTimeExpenses) !== JSON.stringify(next.oneTimeExpenses)) {
    patch.oneTimeExpenses = next.oneTimeExpenses;
  }
  if (JSON.stringify(previous.fixedExpenses) !== JSON.stringify(next.fixedExpenses)) {
    patch.fixedExpenses = next.fixedExpenses;
  }
  return patch;
}

function changedServiceSettings(previous: ServiceSettings, next: ServiceSettings): Partial<ServiceSettings> {
  const patch: Partial<ServiceSettings> = {};
  if (previous.openFinanceClientId !== next.openFinanceClientId) patch.openFinanceClientId = next.openFinanceClientId;
  if (previous.openFinanceClientSecret !== next.openFinanceClientSecret) patch.openFinanceClientSecret = next.openFinanceClientSecret;
  if (previous.openFinanceUserId !== next.openFinanceUserId) patch.openFinanceUserId = next.openFinanceUserId;
  if (previous.openFinanceApiPrefix !== next.openFinanceApiPrefix) patch.openFinanceApiPrefix = next.openFinanceApiPrefix;
  if (previous.aiProvider !== next.aiProvider) patch.aiProvider = next.aiProvider;
  if (previous.aiApiKey !== next.aiApiKey) patch.aiApiKey = next.aiApiKey;
  if (previous.aiModel !== next.aiModel) patch.aiModel = next.aiModel;
  return patch;
}

function hasPatchValue(patch: object): boolean {
  return Object.keys(patch).length > 0;
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
  const [serviceSettings, setServiceSettings] = useState<ServiceSettings>(emptyServiceSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataReloadKey, setDataReloadKey] = useState(0);
  const [pinGate, setPinGate] = useState<PinGateMode>("checking");
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [bankBalance, setBankBalance] = useState<{ balance: number; date: string } | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [serviceSettingsRequired, setServiceSettingsRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const preferencesSaveSeq = useRef(0);
  const preferencesSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preferencesSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingPreferencesPatchRef = useRef<Partial<BudgetPreferences>>({});
  const preferencesRef = useRef<BudgetPreferences>(emptyPreferences);
  const [, startPreferencesTransition] = useTransition();
  const [view, setView] = useState<AppView>("monthly");
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    return () => {
      if (preferencesSaveTimerRef.current) clearTimeout(preferencesSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    window.location.hash = view;
  }, [view]);

  useEffect(() => {
    if (!user) {
      setPinGate("checking");
      return;
    }
    setPinGate("checking");
    getPinStatus()
      .then(({ hasPin }) => setPinGate(hasPin ? "locked" : "setup"))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setPinGate("unavailable");
      });
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAuthConfig(), getCurrentUser()])
      .then(async ([config, session]) => {
        if (cancelled) return;
        setGoogleClientId(config.googleClientId);
        if (!session.user) {
          setUser(null);
          setPinGate("checking");
          setPreferences(emptyPreferences);
          setServiceSettings(emptyServiceSettings);
          setAllTransactions([]);
          setBankBalance(null);
          setPreferencesLoading(false);
          return;
        }
        const savedPreferences = await loadPreferences();
        if (cancelled) return;
        setUser(session.user);
        setPinGate("checking");
        preferencesRef.current = savedPreferences;
        setPreferences(savedPreferences);
        setTheme(savedPreferences.theme);
        setPreferencesLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setPreferencesLoading(false);
      })
      .finally(() => {
        if (cancelled) return;
        setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user || pinGate !== "unlocked") {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    setServiceSettingsRequired(false);
    // One wide fetch feeds both views: ~13 months back for salary-period history
    fetchTransactions(isoDaysAgo(400), endOfCurrentYear())
      .then(({ transactions: txs, demo }) => {
        if (cancelled) return;
        setAllTransactions(txs);
        setIsDemoMode(demo);
        if (!demo) {
          return fetchCheckingBalance().then((balance) => {
            if (!cancelled) setBankBalance(balance);
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        if (message === "SERVICE_SETTINGS_REQUIRED") {
          setAllTransactions([]);
          setBankBalance(null);
          setIsDemoMode(false);
          setServiceSettingsRequired(true);
          return;
        }
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataReloadKey, pinGate, user]);

  useEffect(() => {
    if (!user || pinGate !== "unlocked") return;
    let cancelled = false;
    loadServiceSettings()
      .then((settings) => {
        if (!cancelled) setServiceSettings(settings);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isMissingServiceSettingsError(err)) {
          setServiceSettings(emptyServiceSettings);
          setServiceSettingsRequired(true);
          setSettingsOpen(true);
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [pinGate, user]);

  const updatePreferences = useCallback((next: BudgetPreferences) => {
    const patch = changedPreferences(preferencesRef.current, next);
    preferencesRef.current = next;
    const saveSeq = preferencesSaveSeq.current + 1;
    preferencesSaveSeq.current = saveSeq;
    startPreferencesTransition(() => setPreferences(next));
    if (!hasPatchValue(patch)) {
      setSaveState("saved");
      return;
    }
    pendingPreferencesPatchRef.current = { ...pendingPreferencesPatchRef.current, ...patch };
    setSaveState("saving");
    if (preferencesSaveTimerRef.current) clearTimeout(preferencesSaveTimerRef.current);
    preferencesSaveTimerRef.current = setTimeout(() => {
      preferencesSaveTimerRef.current = null;
      const patchToSave = pendingPreferencesPatchRef.current;
      pendingPreferencesPatchRef.current = {};
      const saveRequest = preferencesSaveQueueRef.current.then(() => patchPreferences(patchToSave));
      preferencesSaveQueueRef.current = saveRequest.then(() => undefined, () => undefined);
      saveRequest
        .then((saved) => {
          if (preferencesSaveSeq.current !== saveSeq) return;
          preferencesRef.current = saved;
          if (JSON.stringify(saved) !== JSON.stringify(next)) {
            startPreferencesTransition(() => setPreferences(saved));
          }
          setSaveState("saved");
        })
        .catch((err: unknown) => {
          if (preferencesSaveSeq.current !== saveSeq) return;
          setSaveState("error");
          setError(err instanceof Error ? err.message : String(err));
        });
    }, 350);
  }, []);

  const migratePreferencesIfNeeded = useCallback((loaded: BudgetPreferences): Promise<BudgetPreferences> => {
    return Promise.resolve(loaded);
  }, []);

  const handleLogin = useCallback((nextUser: AuthUser, nextPrefs: BudgetPreferences) => {
    setPinGate("checking");
    setUser(nextUser);
    setPreferencesLoading(false);
    migratePreferencesIfNeeded(nextPrefs)
      .then((saved) => {
        preferencesRef.current = saved;
        setPreferences(saved);
        setTheme(saved.theme);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [migratePreferencesIfNeeded]);

  const handleAuthError = useCallback((message: string) => {
    setError(message);
  }, []);

  const handleLogout = useCallback(() => {
    const request = logout();
    setUser(null);
    setPinGate("checking");
    setAllTransactions([]);
    setBankBalance(null);
    setPreferences(emptyPreferences);
    setServiceSettings(emptyServiceSettings);
    request.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useAutoLogout(Boolean(user), preferences.autoLogoutMinutes, handleLogout);

  const handleServiceSettingsSave = useCallback((
    settings: ServiceSettings,
    profile: SettingsPreferences
  ) => {
    const currentPreferences = preferencesRef.current;
    const nextPreferences = { ...currentPreferences, ...profile };
    const servicePatch = changedServiceSettings(serviceSettings, settings);
    const preferencesPatch = changedPreferences(currentPreferences, nextPreferences);
    const combinedPreferencesPatch = { ...pendingPreferencesPatchRef.current, ...preferencesPatch };
    const shouldSaveService = hasPatchValue(servicePatch);
    const shouldSavePreferences = hasPatchValue(combinedPreferencesPatch);
    const shouldReloadOpenFinance =
      "openFinanceClientId" in servicePatch ||
      "openFinanceClientSecret" in servicePatch ||
      "openFinanceUserId" in servicePatch ||
      "openFinanceApiPrefix" in servicePatch;

    if (!shouldSaveService && !shouldSavePreferences) {
      setSettingsOpen(false);
      setSaveState("saved");
      return Promise.resolve();
    }

    setSaveState("saving");
    if (shouldSavePreferences) {
      preferencesSaveSeq.current += 1;
      pendingPreferencesPatchRef.current = {};
      if (preferencesSaveTimerRef.current) {
        clearTimeout(preferencesSaveTimerRef.current);
        preferencesSaveTimerRef.current = null;
      }
    }
    const preferencesSaveRequest = shouldSavePreferences
      ? preferencesSaveQueueRef.current.then(() => patchPreferences(combinedPreferencesPatch))
      : Promise.resolve(currentPreferences);
    if (shouldSavePreferences) {
      preferencesSaveQueueRef.current = preferencesSaveRequest.then(() => undefined, () => undefined);
    }
    return Promise.all([
      shouldSaveService ? patchServiceSettings(servicePatch) : Promise.resolve(serviceSettings),
      preferencesSaveRequest,
    ])
      .then(([savedSettings, savedPreferences]) => {
        setServiceSettings(savedSettings);
        preferencesRef.current = savedPreferences;
        setPreferences(savedPreferences);
        setSettingsOpen(false);
        const shouldReloadData = shouldSaveService && (serviceSettingsRequired || shouldReloadOpenFinance);
        if (shouldReloadData) {
          setAllTransactions([]);
          setBankBalance(null);
          setDataReloadKey((key) => key + 1);
        }
        setServiceSettingsRequired(false);
        setSaveState("saved");
      })
      .catch((err: unknown) => {
        setSaveState("error");
        const message = serviceSettingsSaveErrorMessage(err);
        setError(message);
        throw new Error(message);
      });
  }, [serviceSettings, serviceSettingsRequired]);

  const handleManualDataReload = useCallback(() => {
    setError(null);
    setServiceSettingsRequired(false);
    setAllTransactions([]);
    setBankBalance(null);
    setDataReloadKey((key) => key + 1);
  }, []);

  const learnedTransactions = useMemo(
    () => applyCategoryOverrides(allTransactions, preferences.sectionOverrides),
    [allTransactions, preferences.sectionOverrides]
  );

  const periods = useMemo(() => buildPeriods(learnedTransactions), [learnedTransactions]);
  const displayTransactions = useMemo(() => tagSalaries(learnedTransactions), [learnedTransactions]);

  if (authLoading || preferencesLoading) {
    return <div className="app"><div className="loading">טוען התחברות…</div></div>;
  }

  if (!user) {
    return (
      <div className="app">
        <section className="login-panel">
          <div className="login-brand">
            <span className="login-mark" aria-hidden>
              <svg viewBox="0 0 24 24" role="img">
                <path d="M5 8.5h11.5A3.5 3.5 0 0 1 20 12v4.5A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-7A1.5 1.5 0 0 1 5.5 8H17" />
                <path d="M4.8 8.2 12 5l3.4 3" />
                <path d="M16 13.5h4" />
              </svg>
            </span>
            <span className="login-kicker">Budget Manager</span>
          </div>
          <h1>כניסה לתקציב שלך</h1>
          <p className="subtitle">ניהול הכנסות, הוצאות, מגמות והגדרות אישיות בחשבון מאובטח אחד.</p>
          <div className="login-card-actions">
            <GoogleLoginButton
              clientId={googleClientId}
              onLogin={handleLogin}
              onError={handleAuthError}
            />
          </div>
          <div className="login-assurance" aria-label="אבטחה ושמירה">
            <span>Google Login</span>
            <span>PIN אישי</span>
            <span>שמירה ב-DB</span>
          </div>
          {error && <div className="error-box">שגיאה: {error}</div>}
        </section>
      </div>
    );
  }

  if (pinGate !== "unlocked") {
    return (
      <PinGate
        user={user}
        mode={pinGate}
        onUnlock={() => {
          setError(null);
          setView("monthly");
          setPinGate("unlocked");
        }}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="title-block">
          <h1>
            {view === "monthly" && "תקציב חודשי"}
            {view === "trends" && "מגמות וממוצעים"}
            {view === "ai" && "ניתוח AI"}
          </h1>
          {view === "monthly" && (
            <p className="subtitle">הכנסות מול הוצאות, ממשכורת עד המשכורת הבאה</p>
          )}
          {view === "trends" && (
            <p className="subtitle">צבירה וממוצעים על פני תקופות — הכנסות, הוצאות וחיסכון בני״ע</p>
          )}
          {view === "ai" && (
            <p className="subtitle">ציון תקציבי והמלצות פעולה על בסיס הנתונים בתקופה</p>
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
              className="icon-button"
              type="button"
              aria-label="טעינה מחדש של נתוני Open Finance"
              title="טעינה מחדש של נתוני Open Finance"
              onClick={handleManualDataReload}
              disabled={loading}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
                <path
                  d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.76-4.24L13 11h8V3l-3.3 3.3Z"
                  fill="currentColor"
                />
              </svg>
            </button>
            <button
              className="icon-button theme-toggle"
              type="button"
              aria-label={theme === "dark" ? "מעבר למצב בהיר" : "מעבר למצב כהה"}
              title={theme === "dark" ? "מצב בהיר" : "מצב כהה"}
              onClick={() => {
                const nextTheme = theme === "dark" ? "light" : "dark";
                setTheme(nextTheme);
                updatePreferences({ ...preferences, theme: nextTheme });
              }}
            >
              {theme === "dark" ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
                  <path
                    d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0 4a1 1 0 0 1-1-1v-1.05a1 1 0 1 1 2 0V21a1 1 0 0 1-1 1Zm0-18.95a1 1 0 0 1-1-1V1a1 1 0 1 1 2 0v1.05a1 1 0 0 1-1 1ZM21 13h-1.05a1 1 0 1 1 0-2H21a1 1 0 1 1 0 2ZM4.05 13H3a1 1 0 1 1 0-2h1.05a1 1 0 1 1 0 2Zm13.39 5.85a1 1 0 0 1 0-1.41 1 1 0 0 1 1.41 0l.74.74a1 1 0 0 1-1.41 1.41l-.74-.74ZM4.41 5.82a1 1 0 0 1 1.41-1.41l.74.74a1 1 0 1 1-1.41 1.41l-.74-.74Zm14.18.74a1 1 0 0 1-1.41-1.41l.74-.74a1 1 0 1 1 1.41 1.41l-.74.74ZM5.15 19.59a1 1 0 0 1-.74-1.71l.74-.74a1 1 0 1 1 1.41 1.41l-.74.74a1 1 0 0 1-.67.3Z"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
                  <path
                    d="M21 14.4A8.2 8.2 0 0 1 9.6 3a.8.8 0 0 0-.72-1.34A10 10 0 1 0 22.34 15.1.8.8 0 0 0 21 14.4Z"
                    fill="currentColor"
                  />
                </svg>
              )}
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="הגדרות שירותים"
              title="הגדרות שירותים"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙
            </button>
            <button
              className="logout-button"
              type="button"
              aria-label="התנתקות"
              title="התנתקות"
              onClick={handleLogout}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
                <path
                  d="M10 17l1.4-1.4L8.8 13H20v-2H8.8l2.6-2.6L10 7l-5 5 5 5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
          <nav className="tabs" aria-label="תצוגות">
            <button className={`tab ${view === "monthly" ? "active" : ""}`} onClick={() => setView("monthly")}>
              תצוגה חודשית
            </button>
            <button className={`tab ${view === "trends" ? "active" : ""}`} onClick={() => setView("trends")}>
              מגמות
            </button>
            <button className={`tab ${view === "ai" ? "active" : ""}`} onClick={() => setView("ai")}>
              ניתוח AI
            </button>
          </nav>
        </div>
      </header>

      {error && <div className="error-box">שגיאה בטעינת הנתונים: {error}</div>}
      {settingsOpen && (
        <ServiceSettingsModal
          settings={serviceSettings}
          preferences={preferences}
          onClose={() => setSettingsOpen(false)}
          onSave={handleServiceSettingsSave}
        />
      )}
      {loading && <div className="loading">טוען עסקאות…</div>}
      {!loading && serviceSettingsRequired && (
        <section className="settings-required">
          <h2>חסרות הגדרות שירות</h2>
          <p>כדי להציג נתוני תקציב אמיתיים צריך להזין את מפתחות Open Finance למשתמש המחובר.</p>
          <button className="table-toggle primary-action" type="button" onClick={() => setSettingsOpen(true)}>
            פתיחת הגדרות
          </button>
        </section>
      )}

      {!loading && !error && !serviceSettingsRequired && view === "monthly" && (
        <MonthlyView
          transactions={displayTransactions}
          periods={periods}
          bankBalance={bankBalance}
          preferences={preferences}
          onPreferencesChange={updatePreferences}
        />
      )}

      {!loading && !error && !serviceSettingsRequired && view === "trends" && (
        <TrendsView
          transactions={displayTransactions}
          periods={periods}
          bankBalance={bankBalance}
          preferences={preferences}
          onPreferencesChange={updatePreferences}
        />
      )}

      {!loading && !error && !serviceSettingsRequired && view === "ai" && (
        <AIAnalysisView
          transactions={displayTransactions}
          periods={periods}
          bankBalance={bankBalance}
          preferences={preferences}
        />
      )}
    </div>
  );
}

function ServiceSettingsModal({
  settings,
  preferences,
  onClose,
  onSave,
}: {
  settings: ServiceSettings;
  preferences: BudgetPreferences;
  onClose: () => void;
  onSave: (
    settings: ServiceSettings,
    profile: SettingsPreferences
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ServiceSettings>(settings);
  const [highAmountThreshold, setHighAmountThreshold] = useState(String(preferences.highAmountThreshold));
  const [householdBirthDate, setHouseholdBirthDate] = useState(preferences.householdBirthDate ?? "");
  const [householdSize, setHouseholdSize] = useState(preferences.householdSize ? String(preferences.householdSize) : "");
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState(String(preferences.autoLogoutMinutes));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    setHighAmountThreshold(String(preferences.highAmountThreshold));
    setHouseholdBirthDate(preferences.householdBirthDate ?? "");
    setHouseholdSize(preferences.householdSize ? String(preferences.householdSize) : "");
    setAutoLogoutMinutes(String(preferences.autoLogoutMinutes));
  }, [
    preferences.autoLogoutMinutes,
    preferences.highAmountThreshold,
    preferences.householdBirthDate,
    preferences.householdSize,
  ]);

  const updateField = (key: keyof ServiceSettings, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const providerModelOptions: Record<ServiceSettings["aiProvider"], string[]> = {
    openai: [
      "gpt-5.6",
      "gpt-5.6-mini",
      "gpt-5.6-nano",
      "gpt-5",
      "gpt-5-mini",
      "gpt-5-nano",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "gpt-4o",
      "gpt-4o-mini",
      "o4-mini",
      "o3",
      "o3-mini",
    ],
    anthropic: [
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-opus-4-1",
      "claude-opus-4-0",
      "claude-sonnet-4-0",
    ],
    gemini: [
      "gemini-3.5-flash",
      "gemini-3.1-pro",
      "gemini-3-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
    ],
  };
  const modelOptions = aiModels.length > 0 ? aiModels : providerModelOptions[draft.aiProvider];

  useEffect(() => {
    if (modelOptions.length > 0 && !modelOptions.includes(draft.aiModel)) {
      setDraft((current) => ({ ...current, aiModel: modelOptions[0] }));
    }
  }, [draft.aiModel, modelOptions]);

  const refreshAIModels = useCallback(() => {
    setModelsLoading(true);
    setMessage("");
    loadAIModels({ aiProvider: draft.aiProvider, aiApiKey: draft.aiApiKey })
      .then(({ models }) => {
        setAiModels(models);
        if (models.length > 0 && !models.includes(draft.aiModel)) {
          setDraft((current) => ({ ...current, aiModel: models[0] }));
        }
      })
      .catch((err: unknown) => setMessage(err instanceof Error ? err.message : String(err)))
      .finally(() => setModelsLoading(false));
  }, [draft.aiApiKey, draft.aiModel, draft.aiProvider]);

  const calculatedHouseholdAge = householdBirthDate
    ? calculateAgeFromBirthDate(householdBirthDate)
    : preferences.householdAge;
  const householdAgeDisplay = calculatedHouseholdAge ? String(calculatedHouseholdAge) : "";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const threshold = Number(highAmountThreshold);
    const size = Number(householdSize);
    const logoutMinutes = Number(autoLogoutMinutes);
    const birthDate = householdBirthDate || null;
    const age = birthDate ? calculateAgeFromBirthDate(birthDate) : preferences.householdAge;
    onSave(draft, {
      highAmountThreshold: Number.isFinite(threshold) && threshold >= 0 ? threshold : 5000,
      householdBirthDate: birthDate,
      householdAge: age,
      householdSize: Number.isFinite(size) && size > 0 ? size : null,
      autoLogoutMinutes:
        Number.isInteger(logoutMinutes) && logoutMinutes >= 1 && logoutMinutes <= 1_440 ? logoutMinutes : 5,
    })
      .catch((err: unknown) => setMessage(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="service-settings-title">
        <div className="settings-header">
          <h2 id="service-settings-title">הגדרות שירותים</h2>
          <button className="icon-button" type="button" aria-label="סגירה" onClick={onClose}>
            ×
          </button>
        </div>
        <form className="settings-form" onSubmit={handleSubmit}>
          <fieldset>
            <legend>Open Finance</legend>
            <label>
              Client ID
              <input
                dir="ltr"
                value={draft.openFinanceClientId}
                onChange={(event) => updateField("openFinanceClientId", event.target.value)}
              />
            </label>
            <label>
              <span className="secret-input-wrap">
                <span className="secret-label-row">
                  <span>Client Secret</span>
                  <button
                    className={`secret-toggle ${showSecret ? "active" : ""}`}
                    type="button"
                    aria-label={showSecret ? "הסתרת Client Secret" : "הצגת Client Secret"}
                    title={showSecret ? "הסתרה" : "הצגה"}
                    onClick={() => setShowSecret((value) => !value)}
                  >
                    👁
                  </button>
                </span>
                <input
                  dir="ltr"
                  type={showSecret ? "text" : "password"}
                  value={draft.openFinanceClientSecret}
                  onChange={(event) => updateField("openFinanceClientSecret", event.target.value)}
                />
              </span>
            </label>
            <label>
              User ID
              <input
                dir="ltr"
                value={draft.openFinanceUserId}
                onChange={(event) => updateField("openFinanceUserId", event.target.value)}
              />
            </label>
            <label>
              API Prefix
              <input
                dir="ltr"
                placeholder="api"
                value={draft.openFinanceApiPrefix}
                onChange={(event) => updateField("openFinanceApiPrefix", event.target.value)}
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>AI</legend>
            <label>
              ספק
              <select
                value={draft.aiProvider}
                onChange={(event) => {
                  const provider = event.target.value as ServiceSettings["aiProvider"];
                  setDraft((current) => ({
                    ...current,
                    aiProvider: provider,
                    aiModel: providerModelOptions[provider][0],
                  }));
                  setAiModels([]);
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </label>
            <label>
              מודל
              <select
                dir="ltr"
                value={draft.aiModel}
                onChange={(event) => updateField("aiModel", event.target.value)}
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <label>
              API Key
              <input
                dir="ltr"
                type="password"
                value={draft.aiApiKey}
                onChange={(event) => {
                  updateField("aiApiKey", event.target.value);
                  setAiModels([]);
                }}
                placeholder="sk-..."
              />
            </label>
            <button className="table-toggle" type="button" onClick={refreshAIModels} disabled={modelsLoading}>
              {modelsLoading ? "טוען מודלים..." : "טעינת כל המודלים מהספק"}
            </button>
          </fieldset>
          <fieldset>
            <legend>תצוגה וסימונים</legend>
            <label>
              סימון סכום גבוה מ-
              <input
                dir="ltr"
                type="number"
                min="0"
                step="100"
                value={highAmountThreshold}
                onChange={(event) => setHighAmountThreshold(event.target.value)}
              />
            </label>
            <label>
              תאריך לידה
              <input
                dir="ltr"
                type="date"
                value={householdBirthDate}
                onChange={(event) => setHouseholdBirthDate(event.target.value)}
                placeholder="לא חובה"
              />
            </label>
            <label>
              גיל מחושב
              <input
                dir="ltr"
                type="text"
                value={householdAgeDisplay}
                readOnly
                placeholder="יחושב מתאריך הלידה"
              />
            </label>
            <label>
              מספר נפשות
              <input
                dir="ltr"
                type="number"
                min="1"
                step="1"
                value={householdSize}
                onChange={(event) => setHouseholdSize(event.target.value)}
                placeholder="לא חובה"
              />
            </label>
            <label>
              התנתקות אוטומטית לאחר חוסר פעילות (דקות)
              <input
                dir="ltr"
                type="number"
                min="1"
                max="1440"
                step="1"
                value={autoLogoutMinutes}
                onChange={(event) => setAutoLogoutMinutes(event.target.value)}
              />
            </label>
          </fieldset>
          {message && <div className="error-box">{message}</div>}
          <div className="settings-actions">
            <button className="table-toggle" type="button" onClick={onClose}>
              ביטול
            </button>
            <button className="table-toggle primary-action" type="submit" disabled={saving}>
              {saving ? "שומר…" : "שמירה"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function PinGate({
  user,
  mode,
  onUnlock,
  onLogout,
}: {
  user: AuthUser;
  mode: PinGateMode;
  onUnlock: () => void;
  onLogout: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const lastAttemptRef = useRef("");
  const isSetup = mode === "setup";

  useEffect(() => {
    const attemptKey = `${mode}:${pin}:${confirmPin}`;
    if (submitting || pin.length < 4 || (isSetup && confirmPin.length < 4) || lastAttemptRef.current === attemptKey) {
      if (pin.length < 4 || (isSetup && confirmPin.length < 4)) setMessage("");
      return;
    }
    lastAttemptRef.current = attemptKey;
    if (isSetup && pin !== confirmPin) {
      setMessage("ה-PIN והאימות לא זהים");
      return;
    }

    let cancelled = false;
    setSubmitting(true);
    setMessage("");
    const action = isSetup ? setupPin(pin).then(() => true) : verifyPin(pin).then(({ ok }) => ok);
    action
      .then((ok) => {
        if (cancelled) return;
        if (ok) onUnlock();
        else {
          setMessage("PIN שגוי");
          setPin("");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMessage(err instanceof Error ? err.message : String(err));
        setConfirmPin("");
      })
      .finally(() => {
        if (!cancelled) setSubmitting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [confirmPin, isSetup, mode, onUnlock, pin]);

  if (mode === "checking") {
    return <div className="app"><div className="loading">בודק PIN…</div></div>;
  }

  if (mode === "unavailable") {
    return (
      <div className="app">
        <section className="login-panel pin-panel">
          <h1>לא ניתן לבדוק PIN</h1>
          <p className="subtitle">לא ניצור PIN חדש כל עוד אי אפשר לוודא אם כבר קיים PIN למשתמש הזה.</p>
          <p className="pin-user">{user.email}</p>
          <div className="pin-form">
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>
              רענון
            </button>
            <button className="table-toggle pin-switch-user" onClick={onLogout}>
              החלפת משתמש
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <section className="login-panel pin-panel">
        <h1>{isSetup ? "בחירת PIN" : "כניסה עם PIN"}</h1>
        <p className="subtitle">
          {isSetup
            ? "בחר PIN בן 4 ספרות. מהפעם הבאה נבקש אותו אחרי ההתחברות."
            : "הזן PIN בן 4 ספרות כדי לפתוח את התקציב."}
        </p>
        <p className="pin-user">{user.email}</p>
        <div className="pin-form">
          <label>
            PIN
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete={isSetup ? "new-password" : "current-password"}
              pattern="\d{4}"
              maxLength={4}
              value={pin}
              onChange={(event) => setPin(normalizePin(event.target.value))}
            />
          </label>
          {isSetup && (
            <label>
              אימות PIN
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="\d{4}"
                maxLength={4}
                value={confirmPin}
                onChange={(event) => setConfirmPin(normalizePin(event.target.value))}
              />
            </label>
          )}
          {message && <div className="error-box">{message}</div>}
          {submitting && <div className="pin-status">בודק…</div>}
        </div>
        <button className="table-toggle pin-switch-user" onClick={onLogout}>
          החלפת משתמש
        </button>
      </section>
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
    script.src = "https://accounts.google.com/gsi/client?hl=he";
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
        locale: "he",
        logo_alignment: "right",
        width: 280,
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
  return <div className="google-login-button" dir="rtl" ref={buttonRef} />;
}
