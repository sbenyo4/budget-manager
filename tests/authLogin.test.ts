import assert from "node:assert/strict";
import test from "node:test";
import { loginWithGoogle } from "../src/api/preferences";
import { setAuthToken } from "../src/api/authToken";

test("Google login bootstraps preferences and PIN status in one client request", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({
      user: { id: "user-1", email: "user@example.com", name: "User", picture: "" },
      token: "session-token",
      preferences: { theme: "dark", autoLogoutMinutes: 10 },
      hasPin: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await loginWithGoogle("google-credential");

    assert.deepEqual(requests, ["/api/auth/google"]);
    assert.equal(result.hasPin, true);
    assert.equal(result.preferences.theme, "dark");
    assert.equal(result.preferences.autoLogoutMinutes, 10);
    assert.equal(result.preferences.highAmountThreshold, 5000);
  } finally {
    globalThis.fetch = originalFetch;
    setAuthToken("");
  }
});
