import { authFetch, setAuthToken } from "./authToken";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export interface BudgetPreferences {
  sectionOverrides: Record<string, string>;
  installmentOverrides: Record<string, number>;
  oneTimeExpenses: string[];
  fixedExpenses: string[];
  alertApprovals: Record<string, number>;
  highAmountThreshold: number;
  highCheckingBalanceThreshold: number;
  householdBirthDate: string | null;
  householdAge: number | null;
  householdSize: number | null;
  autoLogoutMinutes: number;
  theme: "light" | "dark";
}

export interface ServiceSettings {
  openFinanceClientId: string;
  openFinanceClientSecret: string;
  openFinanceUserId: string;
  openFinanceApiPrefix: string;
  aiProvider: "openai" | "anthropic" | "gemini";
  aiApiKey: string;
  aiModel: string;
}

export const emptyPreferences: BudgetPreferences = {
  sectionOverrides: {},
  installmentOverrides: {},
  oneTimeExpenses: [],
  fixedExpenses: [],
  alertApprovals: {},
  highAmountThreshold: 5000,
  highCheckingBalanceThreshold: 15000,
  householdBirthDate: null,
  householdAge: null,
  householdSize: null,
  autoLogoutMinutes: 5,
  theme: "light",
};

export const emptyServiceSettings: ServiceSettings = {
  openFinanceClientId: "",
  openFinanceClientSecret: "",
  openFinanceUserId: "",
  openFinanceApiPrefix: "api",
  aiProvider: "openai",
  aiApiKey: "",
  aiModel: "gpt-4o-mini",
};

let lastKnownPreferences = emptyPreferences;

function normalizeClientPreferences(value: Partial<BudgetPreferences>): BudgetPreferences {
  return {
    ...emptyPreferences,
    ...value,
    sectionOverrides:
      value.sectionOverrides && typeof value.sectionOverrides === "object" && !Array.isArray(value.sectionOverrides)
        ? value.sectionOverrides
        : emptyPreferences.sectionOverrides,
    installmentOverrides:
      value.installmentOverrides && typeof value.installmentOverrides === "object" && !Array.isArray(value.installmentOverrides)
        ? value.installmentOverrides
        : emptyPreferences.installmentOverrides,
    oneTimeExpenses: Array.isArray(value.oneTimeExpenses) ? value.oneTimeExpenses : emptyPreferences.oneTimeExpenses,
    fixedExpenses: Array.isArray(value.fixedExpenses) ? value.fixedExpenses : emptyPreferences.fixedExpenses,
    alertApprovals:
      value.alertApprovals && typeof value.alertApprovals === "object" && !Array.isArray(value.alertApprovals)
        ? Object.fromEntries(
            Object.entries(value.alertApprovals).filter(
              ([key, amount]) =>
                key.length <= 300 &&
                typeof amount === "number" &&
                Number.isFinite(amount) &&
                amount >= 0
            )
          )
        : emptyPreferences.alertApprovals,
    highCheckingBalanceThreshold:
      typeof value.highCheckingBalanceThreshold === "number" &&
      Number.isFinite(value.highCheckingBalanceThreshold) &&
      value.highCheckingBalanceThreshold >= 0
        ? value.highCheckingBalanceThreshold
        : emptyPreferences.highCheckingBalanceThreshold,
    autoLogoutMinutes:
      Number.isInteger(value.autoLogoutMinutes) &&
      Number(value.autoLogoutMinutes) >= 1 &&
      Number(value.autoLogoutMinutes) <= 1_440
        ? Number(value.autoLogoutMinutes)
        : emptyPreferences.autoLogoutMinutes,
  };
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || `Request failed (${res.status})`;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Keep the raw response text when the body is not JSON.
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function getAuthConfig(): Promise<{ googleClientId: string }> {
  return apiJson("/api/auth/config");
}

export function getCurrentUser(): Promise<{ user: AuthUser | null }> {
  return apiJson("/api/auth/me");
}

export async function loginWithGoogle(credential: string): Promise<{
  user: AuthUser;
  preferences: BudgetPreferences;
  hasPin: boolean;
}> {
  const result = await apiJson<{
    user: AuthUser;
    token: string;
    preferences?: Partial<BudgetPreferences>;
    hasPin?: boolean;
  }>("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
  setAuthToken(result.token);
  if (result.preferences && typeof result.hasPin === "boolean") {
    lastKnownPreferences = normalizeClientPreferences(result.preferences);
    return { user: result.user, preferences: lastKnownPreferences, hasPin: result.hasPin };
  }

  // Temporary compatibility for a locally running client pointed at an older
  // deployment. These requests run in parallel instead of recreating the old
  // sequential login waterfall.
  const [preferences, { hasPin }] = await Promise.all([loadPreferences(), getPinStatus()]);
  return { user: result.user, preferences, hasPin };
}

export function logout(): Promise<{ ok: true }> {
  const request = apiJson<{ ok: true }>("/api/auth/logout", { method: "POST", body: "{}" });
  setAuthToken("");
  lastKnownPreferences = emptyPreferences;
  return request;
}

export async function loadPreferences(): Promise<BudgetPreferences> {
  lastKnownPreferences = normalizeClientPreferences(await apiJson<Partial<BudgetPreferences>>("/api/preferences"));
  return lastKnownPreferences;
}

export async function savePreferences(preferences: BudgetPreferences): Promise<BudgetPreferences> {
  const saved = await apiJson<Partial<BudgetPreferences>>("/api/preferences", {
    method: "PUT",
    body: JSON.stringify(preferences),
  });
  lastKnownPreferences = normalizeClientPreferences({ ...preferences, ...saved });
  return lastKnownPreferences;
}

export function wereAlertApprovalsPersisted(
  requested: Record<string, number>,
  persisted: unknown
): boolean {
  return (
    Boolean(persisted) &&
    typeof persisted === "object" &&
    !Array.isArray(persisted) &&
    Object.entries(requested).every(
      ([key, value]) => (persisted as Record<string, unknown>)[key] === value
    )
  );
}

export async function patchPreferences(preferences: Partial<BudgetPreferences>): Promise<BudgetPreferences> {
  const saved = await apiJson<Partial<BudgetPreferences>>("/api/preferences", {
    method: "PATCH",
    body: JSON.stringify(preferences),
  });
  if (preferences.alertApprovals) {
    if (!wereAlertApprovalsPersisted(preferences.alertApprovals, saved.alertApprovals)) {
      throw new Error("האישור לא נשמר בשרת. יש לעדכן את שירות ה-API ולנסות שוב.");
    }
  }
  lastKnownPreferences = normalizeClientPreferences({ ...lastKnownPreferences, ...saved, ...preferences });
  return lastKnownPreferences;
}

export function loadServiceSettings(): Promise<ServiceSettings> {
  return apiJson("/api/service-settings");
}

export function saveServiceSettings(settings: ServiceSettings): Promise<ServiceSettings> {
  return apiJson("/api/service-settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function patchServiceSettings(settings: Partial<ServiceSettings>): Promise<ServiceSettings> {
  return apiJson("/api/service-settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export interface AIAnalysisResult {
  score: number;
  summary: string;
  strengths: string[];
  risks: string[];
  recommendations: string[];
}

export interface AIAnalysisResponse {
  result: AIAnalysisResult | null;
  cached: boolean;
  updatedAt: string | null;
}

export function analyzeBudgetWithAI(payload: {
  analysisMode: "month" | "trend";
  periodLabel: string;
  transactions: unknown[];
  analytics?: unknown;
  userProfile?: {
    householdAge: number | null;
    householdSize: number | null;
  };
  forceRefresh?: boolean;
  cacheOnly?: boolean;
}): Promise<AIAnalysisResponse> {
  return apiJson("/api/ai-analysis", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loadAIModels(settings: Pick<ServiceSettings, "aiProvider" | "aiApiKey">): Promise<{ models: string[] }> {
  return apiJson("/api/ai-models", {
    method: "POST",
    body: JSON.stringify(settings),
  });
}

export function getPinStatus(): Promise<{ hasPin: boolean }> {
  return apiJson("/api/pin");
}

export function setupPin(pin: string): Promise<{ ok: true }> {
  return apiJson("/api/pin", {
    method: "PUT",
    body: JSON.stringify({ pin }),
  });
}

export function verifyPin(pin: string): Promise<{ ok: boolean }> {
  return apiJson("/api/pin", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}
