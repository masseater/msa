import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type extensionsTypes from "../../src/core/extensions/index.types.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage } = ai;

const { createHarness } = harnessModule;

const { currentTimeMillis } = testing;

function seedHistory(harness: harnessTypes.Harness, totalTokens = 650): string {
  const model = harness.session.model!;
  let recentUserId = "";
  for (const label of ["old", "recent"]) {
    recentUserId = harness.sessionManager.appendMessage({
      content: [{ text: label.padEnd(400, "x"), type: "text" }],
      role: "user",
      timestamp: currentTimeMillis() - 2000,
    });
    const assistant = fauxAssistantMessage(label.padEnd(400, "y"), {
      timestamp: currentTimeMillis() - 1000,
    });
    harness.sessionManager.appendMessage({
      ...assistant,
      api: model.api,
      model: model.id,
      provider: model.provider,
      usage: { ...assistant.usage, input: totalTokens, totalTokens },
    });
  }
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
  return recentUserId;
}

const harnesses: harnessTypes.Harness[] = [];

const usesTheNewlySelectedModelWithout = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) => ({
            compaction: {
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              summary: "big model summary",
              tokensBefore: event.preparation.tokensBefore,
            },
          }));
        },
      ],
      models: [
        { contextWindow: 4000, id: "small" },
        { contextWindow: 10000, id: "big" },
      ],
      settings: {
        compaction: {
          modelOverrides: { "faux/big": { keepRecentTokens: 150, reserveTokens: 8000 } },
          reserveTokens: 10,
        },
      },
      tools: [],
    }),
  );
  harnesses.push(harness);
  seedHistory(harness, 2500);
  return yield* usesTheNewlySelectedModelWithoutStep1(harness);
});

const usesTheNewlySelectedModelWithoutStep1 = (harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("small response"),
      fauxAssistantMessage("big response"),
    ]);
    yield* Effect.promise(() => harness.session.run.prompting.prompt("continue on small"));
    expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
    seedHistory(harness, 2500);
    yield* Effect.promise(() =>
      harness.session.models.selection.setModel(harness.getModel("big")!),
    );
    yield* Effect.promise(() => harness.session.run.prompting.prompt("continue on big"));
    expect(harness.eventsOfType("compaction_end")).toHaveLength(1);
    expect(harness.eventsOfType("compaction_end")[0]?.result?.summary).toBe("big model summary");
    expect(harness.settingsManager.context.getCompactionReserveTokens()).toBe(10);
    yield* Effect.promise(() =>
      harness.session.models.selection.setModel(harness.getModel("small")!),
    );
    expect(harness.settingsManager.context.getCompactionReserveTokens(harness.session.model)).toBe(
      10,
    );
  });

const capturesModelIdentityBeforeAwaitingSummarization = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "first" }, { id: "second" }],
      settings: {
        compaction: {
          modelOverrides: {
            "faux/first": { keepRecentTokens: 150, reserveTokens: 2000 },
            "faux/second": { keepRecentTokens: 20000, reserveTokens: 4000 },
          },
        },
      },
    }),
  );
  harnesses.push(harness);
  seedHistory(harness);
  const getAuth = harness.session.models.selection.modelRuntime.getAuth.bind(
    harness.session.models.selection.modelRuntime,
  );
  vi.spyOn(harness.session.models.selection.modelRuntime, "getAuth").mockImplementation(
    (model, ...args) =>
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
  yield* Effect.promise(() => harness.session.compaction.manual.compact());
  expect(requests).toEqual([{ id: "first", maxTokens: 1600 }]);
});

const usesTheNewlySelectedModelWithoutChanging = () =>
  Effect.runPromise(usesTheNewlySelectedModelWithout);

const capturesModelIdentityBeforeAwaitingSummarizationAuth = () =>
  Effect.runPromise(capturesModelIdentityBeforeAwaitingSummarization);

const harnessRecordingPreparations = (input: {
  readonly path: "manual" | "pre-prompt" | "post-run" | "overflow";
}) =>
  Effect.gen(function* () {
    const { path } = input;
    const preparations: extensionsTypes.SessionBeforeCompactEvent[] = [];
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("session_before_compact", (event) => {
              preparations.push(event);
              return {
                compaction: {
                  firstKeptEntryId: event.preparation.firstKeptEntryId,
                  summary: "compacted history",
                  tokensBefore: event.preparation.tokensBefore,
                },
              };
            });
          },
        ],
        models: [{ contextWindow: 4000, id: "faux-1" }],
        settings: {
          compaction: {
            enabled: path !== "manual",
            keepRecentTokens: 20000,
            modelOverrides: { "faux/faux-1": { keepRecentTokens: 150, reserveTokens: 2000 } },
            reserveTokens: 10,
          },
        },
        tools: [],
      }),
    );
    return { harness, preparations };
  });

type CompactionPath = "manual" | "pre-prompt" | "post-run" | "overflow";

const triggerCompaction = (harness: harnessTypes.Harness, path: CompactionPath) =>
  Effect.gen(function* () {
    if (path === "manual") {
      yield* Effect.promise(() => harness.session.compaction.manual.compact());
      return;
    }
    harness.setResponses(
      path === "overflow"
        ? [
            fauxAssistantMessage("", { errorMessage: "prompt is too long", stopReason: "error" }),
            fauxAssistantMessage("recovered"),
          ]
        : [fauxAssistantMessage(path === "post-run" ? "z".repeat(8000) : "done")],
    );
    yield* Effect.promise(() => harness.session.run.prompting.prompt("continue"));
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
          const { harness, preparations } = yield* harnessRecordingPreparations({ path });
          harnesses.push(harness);
          const recentUserId = seedHistory(harness, path === "pre-prompt" ? 2500 : 650);

          yield* triggerCompaction(harness, path);

          expect(preparations).toHaveLength(1);
          expect(preparations[0]?.preparation.settings).toEqual({
            enabled: path !== "manual",
            keepRecentTokens: 150,
            reserveTokens: 2000,
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
            result: { summary: "compacted history" },
            willRetry: path === "overflow",
          });
          expect(harness.getPendingResponseCount()).toBe(0);
        }),
      ),
  );
});

describe("AgentSession compaction model overrides", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    while (harnesses.length !== 0) harnesses.pop()?.cleanup();
  });

  it.each(["manual", "automatic"] as const)(
    "passes resolved budgets to built-in %s summarization",
    (path) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const harness = yield* Effect.promise(() =>
            createHarness({
              models: [{ contextWindow: 4000, id: "faux-1", maxTokens: 3000 }],
              settings: {
                compaction: {
                  modelOverrides: { "faux/faux-1": { keepRecentTokens: 150, reserveTokens: 2000 } },
                  reserveTokens: 10,
                },
              },
              tools: [],
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
          if (path === "manual")
            yield* Effect.promise(() => harness.session.compaction.manual.compact());
          else yield* Effect.promise(() => harness.session.run.prompting.prompt("continue"));
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
});

describe("AgentSession compaction model overrides", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    while (harnesses.length !== 0) harnesses.pop()?.cleanup();
  });

  it(
    "uses the newly selected model without changing ordinary settings",
    usesTheNewlySelectedModelWithoutChanging,
  );

  it(
    "captures model identity before awaiting summarization auth",
    capturesModelIdentityBeforeAwaitingSummarizationAuth,
  );
});
