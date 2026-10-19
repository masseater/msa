import { deferredPromise } from "@msa/testing";
import { Effect } from "effect";
import { expect } from "vite-plus/test";
import type { BashOperations } from "../../src/core/tools/bash.ts";
import { createHarness, type Harness } from "./harness.ts";
import { type ControlledBashInvocation, createControlledBashOperations, harnesses } from "./agent-session-bash-persistence-cases-1.ts";

export const executesBashCommandsAndRecordsThe = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  const result = yield* Effect.promise(() => harness.session.executeBash("printf 'hello'"));

  expect(result.output).toContain("hello");
  expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("bashExecution");
});
export const cancelsRunningBashCommandsWithAbortbash = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const operations: BashOperations = {
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

  const bashPromise = harness.session.executeBash("sleep", undefined, { operations });
  yield* Effect.sleep(0);
  expect(harness.session.isBashRunning).toBe(true);
  harness.session.abortBash();

  const result = yield* Effect.promise(() => bashPromise);
  expect(result.cancelled).toBe(true);
  expect(harness.session.isBashRunning).toBe(false);
});
export const keepsNewerBashExecutionTrackedWhen = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const invocations: ControlledBashInvocation[] = [];
  const operations = createControlledBashOperations(invocations);

  const firstBash = harness.session.executeBash("first", undefined, { operations });
  const secondBash = harness.session.executeBash("second", undefined, { operations });

  const firstInvocation = invocations[0];
  if (firstInvocation === undefined) throw new Error("expected the first bash invocation");
  firstInvocation.finish();
  const firstResult = yield* Effect.promise(() => firstBash);
  const runningAfterFirstSettles = harness.session.isBashRunning;

  harness.session.abortBash();
  const secondInvocation = invocations[1];
  if (secondInvocation === undefined) throw new Error("expected the second bash invocation");
  const secondWasAborted = secondInvocation.signal?.aborted;
  secondInvocation.finish();
  const secondResult = yield* Effect.promise(() => secondBash);

  expect(firstResult.cancelled).toBe(false);
  expect(runningAfterFirstSettles).toBe(true);
  expect(secondWasAborted).toBe(true);
  expect(secondResult.cancelled).toBe(true);
  expect(harness.session.isBashRunning).toBe(false);
});
export const abortsAllActiveBashExecutions = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const invocations: ControlledBashInvocation[] = [];
  const operations = createControlledBashOperations(invocations);

  const firstBash = harness.session.executeBash("first", undefined, { operations });
  const secondBash = harness.session.executeBash("second", undefined, { operations });

  harness.session.abortBash();
  const abortedSignals = invocations.map((invocation) => invocation.signal?.aborted);
  for (const invocation of invocations) {
    invocation.finish();
  }
  const results = yield* Effect.promise(() => Promise.all([firstBash, secondBash]));

  expect(abortedSignals).toEqual([true, true]);
  expect(results.map((result) => result.cancelled)).toEqual([true, true]);
  expect(harness.session.isBashRunning).toBe(false);
});
export const persistsUserAssistantToolresultAndCustomPart2 = (harness: Harness) =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      harness.session.sendCustomMessage({
        customType: "note",
        content: "hello",
        display: true,
        details: { a: 1 },
      }),
    );
    yield* Effect.promise(() => harness.session.prompt("start"));
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
