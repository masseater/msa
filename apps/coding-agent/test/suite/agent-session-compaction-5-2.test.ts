import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import agentSessionCompaction5Support from "./agent-session-compaction-5-support.ts";
import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";
import type agentSessionCompactionSupportTypes from "./agent-session-compaction-support.types.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { afterEachHook5 } = agentSessionCompaction5Support;

const { createAssistant, harnesses } = agentSessionCompactionSupport;

const { createHarness } = harnessModule;

const { currentTimeMillis } = testing;

const ignoresStalePreCompactionAssistantUsage = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const sessionInternals =
    harness.session as unknown as agentSessionCompactionSupportTypes.SessionWithCompactionInternals;
  const staleTimestamp = currentTimeMillis() - 10_000;
  const staleAssistant = createAssistant(harness, {
    stopReason: "stop",
    timestamp: staleTimestamp,
    totalTokens: 610_000,
  });

  harness.sessionManager.appendMessage({
    content: [{ text: "before compaction", type: "text" }],
    role: "user",
    timestamp: staleTimestamp - 1000,
  });
  harness.sessionManager.appendMessage(staleAssistant);
  const firstKeptEntryId = harness.sessionManager.getEntries()[0]!.id;
  harness.sessionManager.appendCompaction(
    "summary",
    firstKeptEntryId,
    staleAssistant.usage.totalTokens,
    undefined,
    false,
  );
  harness.sessionManager.appendMessage({
    content: [{ text: "after compaction", type: "text" }],
    role: "user",
    timestamp: currentTimeMillis(),
  });

  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "runAutoCompaction")
    .mockResolvedValue(false);

  yield* Effect.promise(() => sessionInternals["checkCompaction"](staleAssistant, false));

  expect(runAutoCompactionSpy).not.toHaveBeenCalled();
});

const triggersThresholdCompactionForErrorMessages = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const sessionInternals =
    harness.session as unknown as agentSessionCompactionSupportTypes.SessionWithCompactionInternals;
  const successfulAssistant = createAssistant(harness, {
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    totalTokens: 190_000,
  });
  const errorAssistant = createAssistant(harness, {
    errorMessage: "529 overloaded",
    stopReason: "error",
    timestamp: currentTimeMillis() + 1000,
  });
  harness.session.agent.state.messages = [
    {
      content: [{ text: "hello", type: "text" }],
      role: "user",
      timestamp: currentTimeMillis() - 1000,
    },
    successfulAssistant,
    {
      content: [{ text: "retry", type: "text" }],
      role: "user",
      timestamp: currentTimeMillis() + 500,
    },
    errorAssistant,
  ];

  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "runAutoCompaction")
    .mockResolvedValue(false);

  yield* Effect.promise(() => sessionInternals["checkCompaction"](errorAssistant));

  expect(runAutoCompactionSpy).toHaveBeenCalledWith("threshold", false);
});

const doesNotTriggerThresholdCompactionFor = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const sessionInternals =
    harness.session as unknown as agentSessionCompactionSupportTypes.SessionWithCompactionInternals;
  const errorAssistant = createAssistant(harness, {
    errorMessage: "529 overloaded",
    stopReason: "error",
    timestamp: currentTimeMillis(),
  });
  harness.session.agent.state.messages = [
    {
      content: [{ text: "hello", type: "text" }],
      role: "user",
      timestamp: currentTimeMillis() - 1000,
    },
    errorAssistant,
  ];

  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "runAutoCompaction")
    .mockResolvedValue(false);

  yield* Effect.promise(() => sessionInternals["checkCompaction"](errorAssistant));

  expect(runAutoCompactionSpy).not.toHaveBeenCalled();
});

const doesNotTriggerThresholdCompactionWhen = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const sessionInternals =
    harness.session as unknown as agentSessionCompactionSupportTypes.SessionWithCompactionInternals;
  const preCompactionTimestamp = currentTimeMillis() - 10_000;
  const keptAssistant = createAssistant(harness, {
    stopReason: "stop",
    timestamp: preCompactionTimestamp,
    totalTokens: 190_000,
  });
  harness.sessionManager.appendMessage({
    content: [{ text: "before compaction", type: "text" }],
    role: "user",
    timestamp: preCompactionTimestamp - 1000,
  });
  harness.sessionManager.appendMessage(keptAssistant);
  const firstKeptEntryId = harness.sessionManager.getEntries()[0]!.id;
  harness.sessionManager.appendCompaction(
    "summary",
    firstKeptEntryId,
    keptAssistant.usage.totalTokens,
    undefined,
    false,
  );
  const errorAssistant = createAssistant(harness, {
    errorMessage: "529 overloaded",
    stopReason: "error",
    timestamp: currentTimeMillis(),
  });
  return yield* doesNotTriggerThresholdCompactionWhenStep1(
    harness,
    sessionInternals,
    preCompactionTimestamp,
    keptAssistant,
    errorAssistant,
  );
});

const doesNotTriggerThresholdCompactionWhenStep1 = (
  harness: harnessTypes.Harness,
  sessionInternals: agentSessionCompactionSupportTypes.SessionWithCompactionInternals,
  preCompactionTimestamp: number,
  keptAssistant: aiTypes.AssistantMessage,
  errorAssistant: aiTypes.AssistantMessage,
) =>
  Effect.gen(function* () {
    harness.session.agent.state.messages = [
      {
        content: [{ text: "kept user", type: "text" }],
        role: "user",
        timestamp: preCompactionTimestamp - 1000,
      },
      keptAssistant,
      {
        content: [{ text: "new prompt", type: "text" }],
        role: "user",
        timestamp: currentTimeMillis() - 500,
      },
      errorAssistant,
    ];
    const runAutoCompactionSpy = vi
      .spyOn(sessionInternals, "runAutoCompaction")
      .mockResolvedValue(false);
    yield* Effect.promise(() => sessionInternals["checkCompaction"](errorAssistant));
    expect(runAutoCompactionSpy).not.toHaveBeenCalled();
  });

const ignoresStalePreCompactionAssistantUsageOn = () =>
  Effect.runPromise(ignoresStalePreCompactionAssistantUsage);

const triggersThresholdCompactionForErrorMessagesUsing = () =>
  Effect.runPromise(triggersThresholdCompactionForErrorMessages);

const doesNotTriggerThresholdCompactionForError = () =>
  Effect.runPromise(doesNotTriggerThresholdCompactionFor);

const doesNotTriggerThresholdCompactionWhenOnly = () =>
  Effect.runPromise(doesNotTriggerThresholdCompactionWhen);

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook5);

  it(
    "ignores stale pre-compaction assistant usage on pre-prompt checks",
    ignoresStalePreCompactionAssistantUsageOn,
  );

  it(
    "triggers threshold compaction for error messages using the last successful usage",
    triggersThresholdCompactionForErrorMessagesUsing,
  );

  it(
    "does not trigger threshold compaction for error messages when no prior usage exists",
    doesNotTriggerThresholdCompactionForError,
  );
});

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook5);

  it(
    "does not trigger threshold compaction when only kept pre-compaction usage exists",
    doesNotTriggerThresholdCompactionWhenOnly,
  );
});
