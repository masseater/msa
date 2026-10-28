import testing from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import type bashTypes from "../../src/core/tools/bash.types.ts";
import agentSessionBashPersistenceCases1 from "./agent-session-bash-persistence-cases-1.ts";
import type agentSessionBashPersistenceCases1Types from "./agent-session-bash-persistence-cases-1.types.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { createHarness } = harnessModule;
const { createControlledBashOperations, harnesses } = agentSessionBashPersistenceCases1;

const { deferredPromise } = testing;

const executesBashCommandsAndRecordsThe = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  const result = yield* Effect.promise(() =>
    harness.session.context.bash.executeBash("printf 'hello'"),
  );

  expect(result.output).toContain("hello");
  expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("bashExecution");
});
const cancelsRunningBashCommandsWithAbortbash = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const operations: bashTypes.BashOperations = {
    exec: (_command, _cwd, options) => {
      const execution = deferredPromise<{ exitCode: number | null }>();
      options.signal?.addEventListener(
        "abort",
        () => {
          execution.reject(new Error("aborted"));
        },
        { once: true },
      );
      return execution.promise;
    },
  };

  const bashPromise = harness.session.context.bash.executeBash("sleep", undefined, { operations });
  yield* Effect.yieldNow;
  expect(harness.session.context.bash.isBashRunning).toBe(true);
  harness.session.context.bash.abortBash();

  const result = yield* Effect.promise(() => bashPromise);
  expect(result.cancelled).toBe(true);
  expect(harness.session.context.bash.isBashRunning).toBe(false);
});
const keepsNewerBashExecutionTrackedWhen = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const invocations: agentSessionBashPersistenceCases1Types.ControlledBashInvocation[] = [];
  const operations = createControlledBashOperations(invocations);

  const firstBash = harness.session.context.bash.executeBash("first", undefined, { operations });
  const secondBash = harness.session.context.bash.executeBash("second", undefined, { operations });

  const firstInvocation = invocations[0];
  if (firstInvocation === undefined) throw new Error("expected the first bash invocation");
  firstInvocation.finish();
  const firstResult = yield* Effect.promise(() => firstBash);
  const runningAfterFirstSettles = harness.session.context.bash.isBashRunning;

  harness.session.context.bash.abortBash();
  const secondInvocation = invocations[1];
  if (secondInvocation === undefined) throw new Error("expected the second bash invocation");
  const secondWasAborted = secondInvocation.signal?.aborted;
  secondInvocation.finish();
  const secondResult = yield* Effect.promise(() => secondBash);

  expect(firstResult.cancelled).toBe(false);
  expect(runningAfterFirstSettles).toBe(true);
  expect(secondWasAborted).toBe(true);
  expect(secondResult.cancelled).toBe(true);
  expect(harness.session.context.bash.isBashRunning).toBe(false);
});
const abortsAllActiveBashExecutions = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const invocations: agentSessionBashPersistenceCases1Types.ControlledBashInvocation[] = [];
  const operations = createControlledBashOperations(invocations);

  const firstBash = harness.session.context.bash.executeBash("first", undefined, { operations });
  const secondBash = harness.session.context.bash.executeBash("second", undefined, { operations });

  harness.session.context.bash.abortBash();
  const abortedSignals = invocations.map((invocation) => invocation.signal?.aborted);
  for (const invocation of invocations) {
    invocation.finish();
  }
  const results = yield* Effect.promise(() => Promise.all([firstBash, secondBash]));

  expect(abortedSignals).toEqual([true, true]);
  expect(results.map((result) => result.cancelled)).toEqual([true, true]);
  expect(harness.session.context.bash.isBashRunning).toBe(false);
});
const expectPersistedEntryOrder = (harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      harness.session.run.prompting.sendCustomMessage({
        content: "hello",
        customType: "note",
        details: { a: 1 },
        display: true,
      }),
    );
    yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));
    const entries = harness.sessionManager.getEntries();
    expect(entries.map((entry) => entry.type)).toEqual([
      "custom_message",
      "message",
      "message",
      "message",
      "message",
      "message",
    ]);
    expect(harness.session.messages.map((message) => message.role)).toEqual([
      "custom",
      "system",
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
  });

const agentSessionBashPersistenceCases3 = {
  abortsAllActiveBashExecutions,
  cancelsRunningBashCommandsWithAbortbash,
  executesBashCommandsAndRecordsThe,
  expectPersistedEntryOrder,
  keepsNewerBashExecutionTrackedWhen,
};

export default agentSessionBashPersistenceCases3;
