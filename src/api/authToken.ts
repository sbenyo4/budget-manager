const AUTH_TOKEN_KEY = "budget-manager:auth-token-v1";

export function getAuthToken(): string {
  return window.localStorage.getItem(AUTH_TOKEN_KEY) ?? "";
}

export function setAuthToken(token: string): void {
  if (token) window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  else window.localStorage.removeItem(AUTH_TOKEN_KEY);
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
