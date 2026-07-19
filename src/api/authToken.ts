const AUTH_TOKEN_KEY = "budget-manager:auth-token-v1";
let authToken = "";

// Authentication is intentionally scoped to the current page lifetime. Clear
// tokens left by older versions so reopening or refreshing always requires a
// fresh Google sign-in and no credential remains in browser storage.
try {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
} catch {
  // Storage can be unavailable in privacy-restricted browser contexts.
}

export function getAuthToken(): string {
  return authToken;
}

export function setAuthToken(token: string): void {
  authToken = token;
}

export function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  return fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}
