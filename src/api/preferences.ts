export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export interface BudgetPreferences {
  sectionOverrides: Record<string, string>;
  oneTimeExpenses: string[];
  fixedExpenses: string[];
  highAmountThreshold: number;
  householdBirthDate: string | null;
  householdAge: number | null;
  householdSize: number | null;
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
  oneTimeExpenses: [],
  fixedExpenses: [],
  highAmountThreshold: 5000,
  householdBirthDate: null,
  householdAge: null,
  householdSize: null,
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

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
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

export function loginWithGoogle(credential: string): Promise<{ user: AuthUser }> {
  return apiJson("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return apiJson("/api/auth/logout", { method: "POST", body: "{}" });
}

export function loadPreferences(): Promise<BudgetPreferences> {
  return apiJson("/api/preferences");
}

export function savePreferences(preferences: BudgetPreferences): Promise<BudgetPreferences> {
  return apiJson("/api/preferences", {
    method: "PUT",
    body: JSON.stringify(preferences),
  });
}

export function patchPreferences(preferences: Partial<BudgetPreferences>): Promise<BudgetPreferences> {
  return apiJson("/api/preferences", {
    method: "PATCH",
    body: JSON.stringify(preferences),
  });
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
  bankBalance: { balance: number; date: string } | null;
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
