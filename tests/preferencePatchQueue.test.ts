import assert from "node:assert/strict";
import test from "node:test";
import { createPreferencePatchQueue } from "../src/api/preferencePatchQueue.ts";

test("queued preference writes converge to the latest desired state after an earlier request fails", async () => {
  const calls: Array<Record<string, unknown>> = [];
  let rejectFirst: ((error: Error) => void) | undefined;
  const firstAttempt = new Promise<never>((_resolve, reject) => {
    rejectFirst = reject;
  });
  const queue = createPreferencePatchQueue<Record<string, unknown>, Record<string, unknown>>(async (patch) => {
    calls.push(patch);
    if (calls.length === 1) return firstAttempt;
    return patch;
  });

  const first = queue.enqueue({ theme: "dark" });
  const second = queue.enqueue({ highAmountThreshold: 2_000 });
  await Promise.resolve();
  rejectFirst?.(new Error("temporary failure"));

  await assert.rejects(first, new Error("temporary failure"));
  assert.deepEqual(await second, { theme: "dark", highAmountThreshold: 2_000 });
  assert.deepEqual(calls, [
    { theme: "dark" },
    { theme: "dark", highAmountThreshold: 2_000 },
  ]);
});
