import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionBoundariesSupport from "./agent-session-boundaries-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage } = ai;

const { harnesses } = agentSessionBoundariesSupport;

const { createHarness } = harnessModule;

const refreshesCanonicalContextBeforePublishingBoundary = Effect.gen(function* () {
  let handled = false;
  const snapshots: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", () => {
            if (handled) return;
            handled = true;
            return {
              entries: [
                { customType: "metadata", data: true, type: "custom" },
                {
                  content: "committed context",
                  customType: "visible-context",
                  display: true,
                  type: "custom_message",
                },
              ],
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.session.subscribe((event) => {
    if (event.type === "entry_appended") snapshots.push(JSON.stringify(harness.session.messages));
  });
  harness.setResponses([fauxAssistantMessage("done")]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(snapshots).toHaveLength(2);
  expect(snapshots.every((snapshot) => snapshot.includes("committed context"))).toBe(true);
});

const continuesFromAnAgentBeforeSettle = Effect.gen(function* () {
  let requested = false;
  const requests: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_before_settle", () => {
            if (requested) return;
            requested = true;
            return {
              continue: true,
              entries: [
                {
                  content: "continue now",
                  customType: "test-continuation",
                  display: false,
                  type: "custom_message",
                },
              ],
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  return yield* continuesFromAnAgentBeforeSettleStep1(requests, harness);
});

const continuesFromAnAgentBeforeSettleStep1 = (requests: string[], harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("first"),
      (context) => {
        requests.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("second");
      },
    ]);
    yield* Effect.promise(() => harness.session.prompt("start"));
    expect(requests[0]).toContain("continue now");
    expect(harness.sessionManager.getEntries()).toContainEqual(
      expect.objectContaining({
        customType: "test-continuation",
        display: false,
        type: "custom_message",
      }),
    );
    expect(harness.eventsOfType("agent_start")).toHaveLength(2);
    expect(harness.eventsOfType("agent_settled")).toHaveLength(1);
  });

const persistsCustomContextQueuedByAgentPart1 = () =>
  Effect.gen(function* () {
    let firstRun = true;
    let continued = false;
    const requests: string[] = [];
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("agent_end", () => {
              if (!firstRun) return;
              firstRun = false;
              msa.sendMessage(
                {
                  content: "queued after agent end",
                  customType: "agent-end-context",
                  display: false,
                },
                { triggerTurn: false },
              );
            });
            msa.on("agent_before_settle", (event) => {
              if (continued) return;
              continued = true;
              expect(JSON.stringify(event.context.pendingMessages)).toContain(
                "queued after agent end",
              );
              expect(JSON.stringify(event.context.contextMessages)).not.toContain(
                "queued after agent end",
              );
              return { continue: true };
            });
          },
        ],
      }),
    );
    return { harness, requests };
  });

const persistsCustomContextQueuedByAgent = Effect.gen(function* () {
  const { harness, requests } = yield* persistsCustomContextQueuedByAgentPart1();
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("first"),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("second");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(requests[0]).toContain("queued after agent end");
  expect(harness.sessionManager.getEntries()).toContainEqual(
    expect.objectContaining({ customType: "agent-end-context", type: "custom_message" }),
  );
});

const keepsAPreSettlementFollowUp = Effect.gen(function* () {
  let handled = false;
  const requests: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_before_settle", () => {
            if (handled) return;
            handled = true;
            msa.sendUserMessage("queued follow-up", { deliverAs: "followUp" });
            return {
              continue: true,
              entries: [
                {
                  content: "boundary context",
                  customType: "boundary",
                  display: false,
                  type: "custom_message",
                },
              ],
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  return yield* keepsAPreSettlementFollowUpStep1(requests, harness);
});

const keepsAPreSettlementFollowUpStep1 = (requests: string[], harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("first"),
      (context) => {
        requests.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("second");
      },
      (context) => {
        requests.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("follow-up response");
      },
    ]);
    yield* Effect.promise(() => harness.session.prompt("start"));
    expect(harness.faux.state.callCount).toBe(3);
    expect(requests[0]).toContain("boundary context");
    expect(requests[0]).not.toContain("queued follow-up");
    expect(requests[1]).toContain("queued follow-up");
  });

const refreshesCanonicalContextBeforePublishingBoundaryEntry = () =>
  Effect.runPromise(refreshesCanonicalContextBeforePublishingBoundary);

const continuesFromAnAgentBeforeSettleCustom = () =>
  Effect.runPromise(continuesFromAnAgentBeforeSettle);

const persistsCustomContextQueuedByAgentEnd = () =>
  Effect.runPromise(persistsCustomContextQueuedByAgent);

const keepsAPreSettlementFollowUpDeferred = () => Effect.runPromise(keepsAPreSettlementFollowUp);

describe("AgentSession actionable boundaries", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "refreshes canonical context before publishing boundary entry notifications",
    refreshesCanonicalContextBeforePublishingBoundaryEntry,
  );

  it(
    "continues from an agent_before_settle custom message before final settlement",
    continuesFromAnAgentBeforeSettleCustom,
  );
});

describe("AgentSession actionable boundaries", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "persists custom context queued by agent_end before pre-settlement continuation",
    persistsCustomContextQueuedByAgentEnd,
  );

  it(
    "keeps a pre-settlement follow-up deferred until the explicit continuation would stop",
    keepsAPreSettlementFollowUpDeferred,
  );
});
