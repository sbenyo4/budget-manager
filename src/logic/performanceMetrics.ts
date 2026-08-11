export type PerformanceMetric =
  | {
      kind: "react-commit";
      id: string;
      phase: "mount" | "update" | "nested-update";
      actualDuration: number;
      baseDuration: number;
      commitTime: number;
    }
  | { kind: "interaction-to-paint"; name: string; duration: number }
  | { kind: "patch-request"; url: string; bytes: number; timestamp: number };

declare global {
  interface Window {
    __BUDGET_PERFORMANCE_METRICS__?: PerformanceMetric[];
  }
}

const pendingInteractions = new Map<string, number>();

function isDevelopmentBuild(): boolean {
  return typeof import.meta.env !== "undefined" && import.meta.env.DEV;
}

function record(metric: PerformanceMetric) {
  if (!isDevelopmentBuild() || typeof window === "undefined") return;
  const metrics = window.__BUDGET_PERFORMANCE_METRICS__ ?? [];
  metrics.push(metric);
  if (metrics.length > 500) metrics.splice(0, metrics.length - 500);
  window.__BUDGET_PERFORMANCE_METRICS__ = metrics;
}

export function markPerformanceInteraction(name: string) {
  if (!isDevelopmentBuild() || typeof performance === "undefined") return;
  pendingInteractions.set(name, performance.now());
}

export function recordReactCommit(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number,
  commitTime: number
) {
  record({ kind: "react-commit", id, phase, actualDuration, baseDuration, commitTime });
  if (!isDevelopmentBuild() || typeof requestAnimationFrame === "undefined") return;
  for (const [name, startedAt] of pendingInteractions) {
    pendingInteractions.delete(name);
    requestAnimationFrame(() => {
      record({ kind: "interaction-to-paint", name, duration: performance.now() - startedAt });
    });
  }
}

export function recordPatchRequest(url: string, body: BodyInit | null | undefined) {
  if (!isDevelopmentBuild()) return;
  const bytes = typeof body === "string" ? new TextEncoder().encode(body).byteLength : 0;
  record({ kind: "patch-request", url, bytes, timestamp: performance.now() });
}
