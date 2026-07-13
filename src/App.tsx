import { Component, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  savePreferences,
  saveServiceSettings,
  type AuthUser,
  type BudgetPreferences,
  type ServiceSettings,
} from "./api/preferences";
import { buildPeriods, tagSalaries } from "./logic/periods";
import { applyCategoryOverrides, hasLegacyPreferences, readLegacyPreferences } from "./logic/categoryOverrides";
import type { Transaction } from "./types";
import { MonthlyView } from "./components/MonthlyView";
import { TrendsView } from "./components/TrendsView";

const YEAR = 2026;
type ThemeMode = "light" | "dark";
const THEME_STORAGE_KEY = "budget-manager-theme";

function readInitialTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
  const d = new Date(Date.now() - days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface StoredPin {
  salt: string;
  hash: string;
}

const PIN_STORAGE_PREFIX = "budget-manager-pin:";

function pinStorageKey(userId: string): string {
  return `${PIN_STORAGE_PREFIX}${userId}`;
}

function normalizePin(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

function readStoredPin(userId: string): StoredPin | null {
  const raw = localStorage.getItem(pinStorageKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPin>;
    return typeof parsed.salt === "string" && typeof parsed.hash === "string"
      ? { salt: parsed.salt, hash: parsed.hash }
      : null;
  } catch {
    return null;
  }
}

async function saveStoredPin(userId: string, pin: string): Promise<void> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  localStorage.setItem(pinStorageKey(userId), JSON.stringify({ salt, hash: await hashPin(pin, salt) }));
}

async function verifyStoredPin(userId: string, pin: string): Promise<boolean> {
  const stored = readStoredPin(userId);
  return stored ? (await hashPin(pin, stored.salt)) === stored.hash : false;
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
  const [pinGate, setPinGate] = useState<"checking" | "setup" | "locked" | "unlocked">("checking");
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [bankBalance, setBankBalance] = useState<{ balance: number; date: string } | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [serviceSettingsRequired, setServiceSettingsRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"monthly" | "trends">("monthly");
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.location.hash = view;
  }, [view]);

  useEffect(() => {
    if (!user) {
      setPinGate("checking");
      return;
    }
    setPinGate(readStoredPin(user.id) ? "locked" : "setup");
  }, [user]);

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
    if (!user || pinGate !== "unlocked") {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setServiceSettingsRequired(false);
    // One wide fetch feeds both views: ~13 months back for salary-period history
    fetchTransactions(isoDaysAgo(400), `${YEAR}-12-31`)
      .then(({ transactions: txs, demo }) => {
        setAllTransactions(txs);
        setIsDemoMode(demo);
        if (!demo) fetchCheckingBalance().then(setBankBalance);
      })
      .catch((err: unknown) => {
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
      .finally(() => setLoading(false));
  }, [dataReloadKey, pinGate, user]);

  useEffect(() => {
    if (!user || pinGate !== "unlocked") return;
    loadServiceSettings()
      .then(setServiceSettings)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [pinGate, user]);

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
      highAmountThreshold: loaded.highAmountThreshold,
    });
  }, []);

  const handleLogin = useCallback((nextUser: AuthUser, nextPrefs: BudgetPreferences) => {
    setPinGate("checking");
    setUser(nextUser);
    setPreferencesLoading(false);
    migratePreferencesIfNeeded(nextPrefs)
      .then(setPreferences)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [migratePreferencesIfNeeded]);

  const handleAuthError = useCallback((message: string) => {
    setError(message);
  }, []);

  const handleLogout = useCallback(() => {
    logout().then(() => {
      setUser(null);
      setPinGate("checking");
      setAllTransactions([]);
      setBankBalance(null);
      setPreferences(emptyPreferences);
      setServiceSettings(emptyServiceSettings);
    });
  }, []);

  const handleServiceSettingsSave = useCallback((settings: ServiceSettings, highAmountThreshold: number) => {
    setSaveState("saving");
    const nextPreferences = { ...preferences, highAmountThreshold };
    return Promise.all([saveServiceSettings(settings), savePreferences(nextPreferences)])
      .then(([savedSettings, savedPreferences]) => {
        setServiceSettings(savedSettings);
        setPreferences(savedPreferences);
        setSettingsOpen(false);
        setAllTransactions([]);
        setBankBalance(null);
        setServiceSettingsRequired(false);
        setDataReloadKey((key) => key + 1);
        setSaveState("saved");
      })
      .catch((err: unknown) => {
        setSaveState("error");
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [preferences]);

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
          </h1>
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
              className="icon-button theme-toggle"
              type="button"
              aria-label={theme === "dark" ? "מעבר למצב בהיר" : "מעבר למצב כהה"}
              title={theme === "dark" ? "מצב בהיר" : "מצב כהה"}
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
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
  onSave: (settings: ServiceSettings, highAmountThreshold: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ServiceSettings>(settings);
  const [highAmountThreshold, setHighAmountThreshold] = useState(String(preferences.highAmountThreshold));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    setHighAmountThreshold(String(preferences.highAmountThreshold));
  }, [preferences.highAmountThreshold]);

  const updateField = (key: keyof ServiceSettings, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const threshold = Number(highAmountThreshold);
    onSave(draft, Number.isFinite(threshold) && threshold >= 0 ? threshold : 5000)
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
  mode: "checking" | "setup" | "locked" | "unlocked";
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
    const action = isSetup ? saveStoredPin(user.id, pin).then(() => true) : verifyStoredPin(user.id, pin);
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
  }, [confirmPin, isSetup, mode, onUnlock, pin, user.id]);

  if (mode === "checking") {
    return <div className="app"><div className="loading">בודק PIN…</div></div>;
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
