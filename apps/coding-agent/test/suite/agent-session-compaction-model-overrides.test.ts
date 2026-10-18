import { fauxAssistantMessage } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { SessionBeforeCompactEvent } from "../../src/core/extensions/index.ts";
import { nowMillis } from "../test-time.ts";
import { createHarness, type Harness } from "./harness.ts";

function seedHistory(harness: Harness, totalTokens = 650): string {
  const model = harness.session.model!;
  let recentUserId = "";
  for (const label of ["old", "recent"]) {
    recentUserId = harness.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: label.padEnd(400, "x") }],
      timestamp: nowMillis() - 2000,
    });
    const assistant = fauxAssistantMessage(label.padEnd(400, "y"), {
      timestamp: nowMillis() - 1000,
    });
    harness.sessionManager.appendMessage({
      ...assistant,
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { ...assistant.usage, input: totalTokens, totalTokens },
    });
  }
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
  return recentUserId;
}

const harnesses: Harness[] = [];

const usesTheNewlySelectedModelWithout = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [
        { id: "small", contextWindow: 4000 },
        { id: "big", contextWindow: 10000 },
      ],
      tools: [],
      settings: {
        compaction: {
          reserveTokens: 10,
          modelOverrides: { "faux/big": { reserveTokens: 8000, keepRecentTokens: 150 } },
        },
      },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) => ({
            compaction: {
              summary: "big model summary",
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
    }),
  );
  harnesses.push(harness);
  seedHistory(harness, 2500);
  return yield* usesTheNewlySelectedModelWithoutPart2(harness);
});

const usesTheNewlySelectedModelWithoutPart2 = (harness: Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("small response"),
      fauxAssistantMessage("big response"),
    ]);
    yield* Effect.promise(() => harness.session.prompt("continue on small"));
    expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
    seedHistory(harness, 2500);
    yield* Effect.promise(() => harness.session.setModel(harness.getModel("big")!));
    yield* Effect.promise(() => harness.session.prompt("continue on big"));
    expect(harness.eventsOfType("compaction_end")).toHaveLength(1);
    expect(harness.eventsOfType("compaction_end")[0]?.result?.summary).toBe("big model summary");
    expect(harness.settingsManager.getCompactionReserveTokens()).toBe(10);
    yield* Effect.promise(() => harness.session.setModel(harness.getModel("small")!));
    expect(harness.settingsManager.getCompactionReserveTokens(harness.session.model)).toBe(10);
  });

const capturesModelIdentityBeforeAwaitingSummarization = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "first" }, { id: "second" }],
      settings: {
        compaction: {
          modelOverrides: {
            "faux/first": { reserveTokens: 2000, keepRecentTokens: 150 },
            "faux/second": { reserveTokens: 4000, keepRecentTokens: 20000 },
          },
        },
      },
    }),
  );
  harnesses.push(harness);
  seedHistory(harness);
  const getAuth = harness.session.modelRuntime.getAuth.bind(harness.session.modelRuntime);
  vi.spyOn(harness.session.modelRuntime, "getAuth").mockImplementation((model, ...args) =>
    runPromise(
      Effect.promise(() => {
        harness.session.agent.state.model = harness.getModel("second")!;
        return getAuth(model, ...args);
      }),
    ),
  );
  const requests: Array<{ id: string; maxTokens: number | undefined }> = [];
  harness.setResponses([
    (_context, options, _state, model) => {
      requests.push({ id: model.id, maxTokens: options?.maxTokens });
      return fauxAssistantMessage("summary");
    },
  ]);
  yield* Effect.promise(() => harness.session.compact());
  expect(requests).toEqual([{ id: "first", maxTokens: 1600 }]);
});

describe("AgentSession compaction model overrides", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    while (harnesses.length !== 0) harnesses.pop()?.cleanup();
  });
  it.each(["manual", "pre-prompt", "post-run", "overflow"] as const)(
    "uses model token settings for %s compaction and extension preparation",
    (path) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const preparations: SessionBeforeCompactEvent[] = [];
          const harness = yield* Effect.promise(() =>
            createHarness({
              models: [{ id: "faux-1", contextWindow: 4000 }],
              tools: [],
              settings: {
                compaction: {
                  enabled: path !== "manual",
                  reserveTokens: 10,
                  keepRecentTokens: 20000,
                  modelOverrides: { "faux/faux-1": { reserveTokens: 2000, keepRecentTokens: 150 } },
                },
              },
              extensionFactories: [
                (msa) => {
                  msa.on("session_before_compact", (event) => {
                    preparations.push(event);
                    return {
                      compaction: {
                        summary: "compacted history",
                        firstKeptEntryId: event.preparation.firstKeptEntryId,
                        tokensBefore: event.preparation.tokensBefore,
                      },
                    };
                  });
                },
              ],
            }),
          );
          harnesses.push(harness);
          const recentUserId = seedHistory(harness, path === "pre-prompt" ? 2500 : 650);

          if (path === "manual") {
            yield* Effect.promise(() => harness.session.compact());
          } else {
            harness.setResponses(
              path === "overflow"
                ? [
                    fauxAssistantMessage("", {
                      stopReason: "error",
                      errorMessage: "prompt is too long",
                    }),
                    fauxAssistantMessage("recovered"),
                  ]
                : [fauxAssistantMessage(path === "post-run" ? "z".repeat(8000) : "done")],
            );
            yield* Effect.promise(() => harness.session.prompt("continue"));
          }

          expect(preparations).toHaveLength(1);
          expect(preparations[0]?.preparation.settings).toEqual({
            enabled: path !== "manual",
            reserveTokens: 2000,
            keepRecentTokens: 150,
          });
          expect(preparations[0]?.reason).toBe(
            path === "manual" ? "manual" : path === "overflow" ? "overflow" : "threshold",
          );
          if (path === "manual" || path === "pre-prompt") {
            expect(preparations[0]?.preparation.firstKeptEntryId).toBe(recentUserId);
          }
          expect(harness.eventsOfType("compaction_end")).toHaveLength(1);
          expect(harness.eventsOfType("compaction_end")[0]).toMatchObject({
            aborted: false,
            willRetry: path === "overflow",
            result: { summary: "compacted history" },
          });
          expect(harness.getPendingResponseCount()).toBe(0);
        }),
      ),
  );
  it.each(["manual", "automatic"] as const)(
    "passes resolved budgets to built-in %s summarization",
    (path) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const harness = yield* Effect.promise(() =>
            createHarness({
              models: [{ id: "faux-1", contextWindow: 4000, maxTokens: 3000 }],
              tools: [],
              settings: {
                compaction: {
                  reserveTokens: 10,
                  modelOverrides: { "faux/faux-1": { reserveTokens: 2000, keepRecentTokens: 150 } },
                },
              },
            }),
          );
          harnesses.push(harness);
          const recentUserId = seedHistory(harness, 2500);
          const budgets: Array<number | undefined> = [];
          harness.setResponses([
            (_context, options) => {
              budgets.push(options?.maxTokens);
              return fauxAssistantMessage("built-in summary");
            },
            ...(path === "automatic" ? [fauxAssistantMessage("done")] : []),
          ]);
          if (path === "manual") yield* Effect.promise(() => harness.session.compact());
          else yield* Effect.promise(() => harness.session.prompt("continue"));
          expect(budgets).toEqual([1600]);
          expect(
            harness.sessionManager.getEntries().find((entry) => entry.type === "compaction"),
          ).toMatchObject({
            firstKeptEntryId: recentUserId,
            summary: "built-in summary",
          });
          expect(harness.getPendingResponseCount()).toBe(0);
        }),
      ),
  );
  it("uses the newly selected model without changing ordinary settings", () =>
    Effect.runPromise(usesTheNewlySelectedModelWithout));
  it("captures model identity before awaiting summarization auth", () =>
    Effect.runPromise(capturesModelIdentityBeforeAwaitingSummarization));
});
