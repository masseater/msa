import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type srcTypes from "../../src/index.types.ts";
import agentSessionBoundaries5Support from "./agent-session-boundaries-5-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage } = ai;

const { harnesses3 } = agentSessionBoundaries5Support;

const { createHarness, getMessageText } = harnessModule;

const { currentTimeMillis } = testing;

const omitsARecoverableProjectedReplacementBy = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", () => ({ cancel: true }));
        },
      ],
      models: [{ contextWindow: 1_000, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
    }),
  );
  harnesses3.push(harness);
  harness.sessionManager.appendMessage({
    content: "x".repeat(5_000),
    role: "user",
    timestamp: currentTimeMillis() - 2,
  });
  const partial = fauxAssistantMessage("original partial", {
    stopReason: "length",
    timestamp: currentTimeMillis() - 1,
  });
  const partialId = harness.sessionManager.appendMessage(partial);
  harness.sessionManager.appendContextEdit(partialId, {
    content: [{ text: "edited partial", type: "text" }],
  });
  harness.session.refreshContext();
  harness.setResponses([fauxAssistantMessage("new answer")]);

  yield* Effect.promise(() => harness.session.prompt("next prompt"));

  const edits = harness.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "context_edit");
  expect(edits.filter((entry) => entry.targetId === partialId).at(-1)?.replacement).toBeNull();
  expect(
    harness.sessionManager
      .buildSessionProjection()
      .messages.some((message) => getMessageText(message) === "edited partial"),
  ).toBe(false);
});

const overflowRecoveryExtension =
  (state: { replaced: boolean; overflowId?: string | undefined }): srcTypes.ExtensionFactory =>
  (msa) => {
    msa.on("turn_end", (event) => {
      if (state.replaced || event.outcome !== "error") return;
      state.replaced = true;
      state.overflowId = event.messageEntryId;
      return {
        entries: [
          {
            replacement: { content: [{ text: "retained error", type: "text" }] },
            targetId: event.messageEntryId,
            type: "context_edit",
          },
        ],
      };
    });
    msa.on("session_before_compact", (event) => ({
      compaction: {
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        summary: "recovered overflow",
        tokensBefore: event.preparation.tokensBefore,
      },
    }));
  };

const recoversAnExplicitOverflowErrorAfter = Effect.gen(function* () {
  const state: { replaced: boolean; overflowId?: string | undefined } = { replaced: false };
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [overflowRecoveryExtension(state)],
      models: [{ contextWindow: 1_000, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
    }),
  );
  harnesses3.push(harness);
  harness.setResponses([
    fauxAssistantMessage("retained error", {
      errorMessage: "prompt is too long",
      stopReason: "error",
    }),
    fauxAssistantMessage("recovered"),
  ]);
  yield* Effect.promise(() => harness.session.prompt("x".repeat(5_000)));
  expect(harness.faux.state.callCount).toBe(2);
  expect(state.overflowId).toBeDefined();
  const edits = harness.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "context_edit");
  expect(
    edits.filter((entry) => entry.targetId === state.overflowId).at(-1)?.replacement,
  ).toBeNull();
});

const keepsFollowUpWorkBehindAn = Effect.gen(function* () {
  let queued = false;
  const requests: string[] = [];
  const lifecycle: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", (event) => {
            if (queued || event.outcome !== "error") return;
            queued = true;
            msa.sendUserMessage("queued follow-up", { deliverAs: "followUp" });
          });
        },
      ],
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 2 } },
    }),
  );
  harnesses3.push(harness);
  harness.session.subscribe((event) => {
    if (event.type === "agent_end" || event.type === "auto_retry_start") lifecycle.push(event.type);
  });
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("retry recovered");
    },
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("follow-up completed");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.faux.state.callCount).toBe(3);
  expect(requests[0]).not.toContain("queued follow-up");
  expect(requests[1]).toContain("queued follow-up");
  expect(lifecycle.slice(0, 2)).toEqual(["agent_end", "auto_retry_start"]);
});

const marksTheExhaustedRetryRunAs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 1 } },
    }),
  );
  harnesses3.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
    fauxAssistantMessage("", { errorMessage: "overloaded_error", stopReason: "error" }),
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(harness.eventsOfType("agent_end").map((event) => event.willRetry)).toEqual([true, false]);
  expect(harness.eventsOfType("auto_retry_end")).toContainEqual(
    expect.objectContaining({ attempt: 1, success: false }),
  );
});

const keepsOmissionsAndDoesNotRetry = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ contextWindow: 1000, id: "faux-1", maxTokens: 100 }],
      settings: {
        compaction: { keepRecentTokens: 1, reserveTokens: 0 },
        retry: { baseDelayMs: 1, enabled: false, maxRetries: 0 },
      },
    }),
  );
  harnesses3.push(harness);
  harness.setResponses([
    fauxAssistantMessage("partial response", { stopReason: "length" }),
    fauxAssistantMessage("summary failed", {
      errorMessage: "summary failed",
      stopReason: "error",
    }),
    fauxAssistantMessage("must not retry"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("x".repeat(5000)));

  const entries = harness.sessionManager.getEntries();
  expect(entries.some((entry) => entry.type === "context_edit")).toBe(true);
  expect(entries.some((entry) => entry.type === "compaction")).toBe(false);
  expect(
    entries.some(
      (entry) => entry.type === "message" && getMessageText(entry.message) === "partial response",
    ),
  ).toBe(true);
  expect(
    harness.sessionManager
      .buildSessionProjection()
      .messages.some((message) => getMessageText(message) === "partial response"),
  ).toBe(false);
  expect(harness.faux.state.callCount).toBe(2);
});

const omitsARecoverableProjectedReplacementByIts = () =>
  Effect.runPromise(omitsARecoverableProjectedReplacementBy);

const recoversAnExplicitOverflowErrorAfterA = () =>
  Effect.runPromise(recoversAnExplicitOverflowErrorAfter);

const keepsFollowUpWorkBehindAnAutomatic = () => Effect.runPromise(keepsFollowUpWorkBehindAn);

const marksTheExhaustedRetryRunAsFinal = () => Effect.runPromise(marksTheExhaustedRetryRunAs);

const keepsOmissionsAndDoesNotRetryWhen = () => Effect.runPromise(keepsOmissionsAndDoesNotRetry);

describe("durable length recovery", () => {
  afterEach(() => {
    while (harnesses3.length > 0) harnesses3.pop()?.cleanup();
  });

  it(
    "omits a recoverable projected replacement by its source entry ID",
    omitsARecoverableProjectedReplacementByIts,
  );

  it(
    "recovers an explicit overflow error after a retained boundary replacement",
    recoversAnExplicitOverflowErrorAfterA,
  );

  it("keeps follow-up work behind an automatic error retry", keepsFollowUpWorkBehindAnAutomatic);

  it("marks the exhausted retry run as final", marksTheExhaustedRetryRunAsFinal);
});

describe("durable length recovery", () => {
  afterEach(() => {
    while (harnesses3.length > 0) harnesses3.pop()?.cleanup();
  });

  it(
    "keeps omissions and does not retry when recovery compaction fails",
    keepsOmissionsAndDoesNotRetryWhen,
  );
});
