import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { recordReactCommit } from "../logic/performanceMetrics";

const onRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  _startTime,
  commitTime
) => {
  recordReactCommit(id, phase, actualDuration, baseDuration, commitTime);
};

export function PerformanceProfiler({ id, children }: { id: string; children: ReactNode }) {
  if (!import.meta.env.DEV) return children;
  return <Profiler id={id} onRender={onRender}>{children}</Profiler>;
}
