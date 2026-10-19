import { deferredPromise } from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import type { BashOperations } from "../../src/core/tools/bash.ts";
import { createHarness, type Harness } from "./harness.ts";

export function getEntryTypes(harness: Harness): string[] {
  return harness.sessionManager.getEntries().map((entry) => entry.type);
}
export interface ControlledBashInvocation {
  signal: AbortSignal | undefined;
  finish: () => void;
}
export function createControlledBashOperations(
  invocations: ControlledBashInvocation[],
): BashOperations {
  return {
    exec: (_command, _cwd, options) => {
      const execution = deferredPromise<{ exitCode: number | null }>();
      invocations.push({
        signal: options.signal,
        finish: () => execution.resolve({ exitCode: 0 }),
      });
      return execution.promise;
    },
  };
}
export const harnesses: Harness[] = [];
export const recordsBashResultsImmediatelyWhileIdle = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  harness.session.recordBashResult("echo hi", {
    output: "hi",
    exitCode: 0,
    cancelled: false,
    truncated: false,
  });

  expect(harness.session.hasPendingBashMessages).toBe(false);
  expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("bashExecution");
  expect(getEntryTypes(harness)).toContain("message");
});
