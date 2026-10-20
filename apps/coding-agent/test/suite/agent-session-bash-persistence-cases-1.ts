import testing from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import type { BashOperations } from "../../src/core/tools/bash.ts";
import type agentSessionBashPersistenceCases1Types from "./agent-session-bash-persistence-cases-1.types.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { createHarness } = harnessModule;

const { deferredPromise } = testing;

function getEntryTypes(harness: harnessTypes.Harness): string[] {
  return harness.sessionManager.getEntries().map((entry) => entry.type);
}
function createControlledBashOperations(
  invocations: agentSessionBashPersistenceCases1Types.ControlledBashInvocation[],
): BashOperations {
  return {
    exec: (_command, _cwd, options) => {
      const execution = deferredPromise<{ exitCode: number | null }>();
      invocations.push({
        finish: () => execution.resolve({ exitCode: 0 }),
        signal: options.signal,
      });
      return execution.promise;
    },
  };
}
const harnesses: harnessTypes.Harness[] = [];
const recordsBashResultsImmediatelyWhileIdle = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  harness.session.recordBashResult("echo hi", {
    cancelled: false,
    exitCode: 0,
    output: "hi",
    truncated: false,
  });

  expect(harness.session.hasPendingBashMessages).toBe(false);
  expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("bashExecution");
  expect(getEntryTypes(harness)).toContain("message");
});

const agentSessionBashPersistenceCases1 = {
  createControlledBashOperations,
  getEntryTypes,
  harnesses,
  recordsBashResultsImmediatelyWhileIdle,
};

export default agentSessionBashPersistenceCases1;
