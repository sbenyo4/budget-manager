import { useEffect } from "react";

const MINUTE_MS = 60_000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

export function useAutoLogout(enabled: boolean, minutes: number, onLogout: () => void): void {
  useEffect(() => {
    if (!enabled) return;

    const safeMinutes = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440 ? minutes : 5;
    const timeoutMs = safeMinutes * MINUTE_MS;
    let lastActivityAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let loggingOut = false;

    const checkInactivity = () => {
      if (timer) clearTimeout(timer);
      const remaining = timeoutMs - (Date.now() - lastActivityAt);
      if (remaining <= 0) {
        if (!loggingOut) {
          loggingOut = true;
          onLogout();
        }
        return;
      }
      timer = setTimeout(checkInactivity, remaining);
    };

    const recordActivity = () => {
      lastActivityAt = Date.now();
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") checkInactivity();
    };

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, recordActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", checkWhenVisible);
    checkInactivity();

    return () => {
      if (timer) clearTimeout(timer);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, recordActivity);
      }
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [enabled, minutes, onLogout]);
}
