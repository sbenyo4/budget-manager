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
  theme: "light" | "dark";
}

export interface ServiceSettings {
  openFinanceClientId: string;
  openFinanceClientSecret: string;
  openFinanceUserId: string;
  openFinanceApiPrefix: string;
}

export const emptyPreferences: BudgetPreferences = {
  sectionOverrides: {},
  oneTimeExpenses: [],
  fixedExpenses: [],
  highAmountThreshold: 5000,
  theme: "light",
};

export const emptyServiceSettings: ServiceSettings = {
  openFinanceClientId: "",
  openFinanceClientSecret: "",
  openFinanceUserId: "",
  openFinanceApiPrefix: "api",
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

export function loadServiceSettings(): Promise<ServiceSettings> {
  return apiJson("/api/service-settings");
}

export function saveServiceSettings(settings: ServiceSettings): Promise<ServiceSettings> {
  return apiJson("/api/service-settings", {
    method: "PUT",
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
