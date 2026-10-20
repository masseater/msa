import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import customCompactionExtension from "../examples/extensions/custom-compaction.ts";
import type extensionsTypes from "../src/core/extensions/index.types.ts";

const { abortController, awaited, currentTimeMillis, runTest } = testing;

vi.mock("@msa/coding-agent", () => ({
  default: {
    convertToLlm: (messages: unknown) => messages,
    serializeConversation: () => "conversation",
  },
}));

const customCompactionExampleShouldTypeCheckCorrectly = () => {
  const exampleExtension = (msa: extensionsTypes.ExtensionAPI) => {
    msa.on("session_before_compact", (event: extensionsTypes.SessionBeforeCompactEvent, ctx) =>
      runTest(
        Effect.gen(function* () {
          const { preparation, branchEntries } = event;

          const { sessionManager, modelRegistry } = ctx;
          const {
            messagesToSummarize,
            turnPrefixMessages,
            tokensBefore,
            firstKeptEntryId,
            isSplitTurn,
          } = preparation;

          expect(Array.isArray(messagesToSummarize)).toBe(true);
          expect(Array.isArray(turnPrefixMessages)).toBe(true);
          expect(typeof isSplitTurn).toBe("boolean");
          expect(typeof tokensBefore).toBe("number");
          expect(typeof sessionManager.getEntries).toBe("function");
          expect(typeof modelRegistry.getApiKeyAndHeaders).toBe("function");
          expect(typeof firstKeptEntryId).toBe("string");
          expect(Array.isArray(branchEntries)).toBe(true);

          const summary = messagesToSummarize
            .filter((m) => m.role === "user")
            .map(
              (m) => `- ${typeof m.content === "string" ? m.content.slice(0, 100) : "[complex]"}`,
            )
            .join("\n");

          return yield* awaited({
            compaction: {
              firstKeptEntryId,
              summary: `User requests:\n${summary}`,
              tokensBefore,
            },
          });
        }),
      ),
    );
  };

  expect(typeof exampleExtension).toBe("function");
};

const summaryModel = {
  api: "example-custom-api" as const,
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "summary-model",
  input: ["text"],
  maxTokens: 100,
  name: "Summary Model",
  provider: "example-custom",
};

const summaryReply = () => ({
  api: "example-custom-api" as const,
  content: [{ text: "custom provider summary", type: "text" as const }],
  model: "summary-model",
  provider: "example-custom",
  role: "assistant",
  stopReason: "stop",
  timestamp: currentTimeMillis(),
  usage: {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 1,
    output: 2,
    totalTokens: 3,
  },
});

const compactionEvent = () => ({
  branchEntries: [],
  preparation: {
    firstKeptEntryId: "entry-1",
    messagesToSummarize: [
      {
        content: [{ text: "please remember this", type: "text" as const }],
        role: "user",
        timestamp: currentTimeMillis(),
      },
    ],
    tokensBefore: 42,
    turnPrefixMessages: [],
  },
  signal: abortController().signal,
});

const registeredCompactionHandler = () => {
  let handler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
  customCompactionExtension({
    on(event: string, fn: unknown) {
      if (event === "session_before_compact") handler = fn as typeof handler;
    },
  } as extensionsTypes.ExtensionAPI);
  expect(handler).toBeDefined();
  return handler!;
};

const customCompactionExampleDispatchesThroughModelregistryCompleteStep1 = () =>
  Effect.gen(function* () {
    const handler = registeredCompactionHandler();
    const complete = vi.fn(() => runTest(Effect.sync(summaryReply)));
    const model = summaryModel;
    const result = yield* awaited(
      handler(compactionEvent(), {
        modelRegistry: { complete, find: vi.fn(() => model) },
        ui: { notify: vi.fn() },
      }),
    );
    return { complete, model, result };
  });

const customCompactionExampleDispatchesThroughModelregistryComplete = () =>
  runTest(
    Effect.gen(function* () {
      const { complete, model, result } =
        yield* customCompactionExampleDispatchesThroughModelregistryCompleteStep1();

      expect(complete).toHaveBeenCalledWith(
        model,
        expect.objectContaining({ messages: expect.any(Array) }),
        expect.objectContaining({ maxTokens: 8192 }),
      );
      expect(complete).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ apiKey: expect.anything() }),
      );
      expect(result).toMatchObject({
        compaction: {
          firstKeptEntryId: "entry-1",
          summary: "custom provider summary",
          tokensBefore: 42,
        },
      });
    }),
  );

const compactEventShouldHaveCorrectFields = () => {
  const checkCompactEvent = (msa: extensionsTypes.ExtensionAPI) => {
    msa.on("session_compact", (event: extensionsTypes.SessionCompactEvent) =>
      runTest(
        Effect.sync(() => {
          const entry = event.compactionEntry;
          const fromExtension = event.fromExtension;

          expect(entry.type).toBe("compaction");
          expect(typeof entry.summary).toBe("string");
          expect(typeof entry.tokensBefore).toBe("number");
          expect(typeof fromExtension).toBe("boolean");
        }),
      ),
    );
  };

  expect(typeof checkCompactEvent).toBe("function");
};

describe("Documentation example", () => {
  it(
    "custom compaction example should type-check correctly",
    customCompactionExampleShouldTypeCheckCorrectly,
  );

  it(
    "custom compaction example dispatches through modelRegistry.complete",
    customCompactionExampleDispatchesThroughModelregistryComplete,
  );

  it("compact event should have correct fields", compactEventShouldHaveCorrectFields);
});
