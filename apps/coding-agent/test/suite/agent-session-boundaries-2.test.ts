import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionBoundariesSupport from "./agent-session-boundaries-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage } = ai;

const { harnesses } = agentSessionBoundariesSupport;

const { createHarness } = harnessModule;

const { currentTimeMillis } = testing;

const keepsABoundaryReplacementVerbatimThroughPart1 = () =>
  Effect.gen(function* () {
    let handled = false;
    const requests: string[] = [];
    const instruction = "EXACT-REPLACEMENT-INSTRUCTION ".repeat(100);
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("turn_end", (event, ctx) => {
              if (handled) return;
              handled = true;
              const user = [...ctx.sessionManager.getBranch()]
                .reverse()
                .find((entry) => entry.type === "message" && entry.message.role === "user");
              if (user === undefined) throw new Error("missing user entry");
              return {
                continue: true,
                entries: [
                  {
                    replacement: { content: instruction },
                    targetId: user.id,
                    type: "context_edit",
                  },
                  { replacement: null, targetId: event.messageEntryId, type: "context_edit" },
                  { customType: "bookkeeping", data: { source: "test" }, type: "custom" },
                ],
              };
            });
            msa.on("session_before_compact", (event) => ({
              compaction: {
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                summary: "older history summary",
                tokensBefore: event.preparation.tokensBefore,
              },
            }));
          },
        ],
        models: [{ contextWindow: 2_000, id: "faux-1", maxTokens: 100 }],
        settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
      }),
    );
    return { harness, requests };
  });

const keepsABoundaryReplacementVerbatimThrough = Effect.gen(function* () {
  const { harness, requests } = yield* keepsABoundaryReplacementVerbatimThroughPart1();
  harnesses.push(harness);
  harness.sessionManager.appendMessage({
    content: "older input",
    role: "user",
    timestamp: currentTimeMillis() - 2,
  });
  harness.sessionManager.appendMessage(
    fauxAssistantMessage("older answer", { timestamp: currentTimeMillis() - 1 }),
  );
  harness.session.refreshContext();
  harness.setResponses([
    fauxAssistantMessage("answered original input"),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("answered replacement");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("original input"));

  expect(harness.eventsOfType("compaction_start").length).toBeGreaterThan(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("EXACT-REPLACEMENT-INSTRUCTION");
});

const keepsBoundaryInputVerbatimThroughThresholdPart1 = () =>
  Effect.gen(function* () {
    let handled = false;
    const requests: string[] = [];
    const instruction = "EXACT-UNSENT-INSTRUCTION ".repeat(100);
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("turn_end", () => {
              if (handled) return;
              handled = true;
              return {
                continue: true,
                entries: [
                  {
                    content: instruction,
                    customType: "next-work",
                    display: false,
                    type: "custom_message",
                  },
                  { customType: "bookkeeping", data: { source: "test" }, type: "custom" },
                ],
              };
            });
            msa.on("session_before_compact", (event) => ({
              compaction: {
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                summary: "older history summary",
                tokensBefore: event.preparation.tokensBefore,
              },
            }));
          },
        ],
        models: [{ contextWindow: 2_000, id: "faux-1", maxTokens: 100 }],
        settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
      }),
    );
    return { harness, requests };
  });

const keepsBoundaryInputVerbatimThroughThreshold = Effect.gen(function* () {
  const { harness, requests } = yield* keepsBoundaryInputVerbatimThroughThresholdPart1();
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("first"),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("second");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("old input ".repeat(500)));

  expect(harness.eventsOfType("compaction_start").length).toBeGreaterThan(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("EXACT-UNSENT-INSTRUCTION");
});

const keepsABoundaryReplacementVerbatimThroughThreshold = () =>
  Effect.runPromise(keepsABoundaryReplacementVerbatimThrough);

const keepsBoundaryInputVerbatimThroughThresholdCompaction = () =>
  Effect.runPromise(keepsBoundaryInputVerbatimThroughThreshold);

describe("AgentSession actionable boundaries", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "keeps a boundary replacement verbatim through threshold compaction",
    keepsABoundaryReplacementVerbatimThroughThreshold,
  );

  it(
    "keeps boundary input verbatim through threshold compaction when metadata follows it",
    keepsBoundaryInputVerbatimThroughThresholdCompaction,
  );
});
