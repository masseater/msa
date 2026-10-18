import { awaited, runTest, currentTimeMillis, abortController } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import type {
  ExtensionAPI,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
} from "../src/core/extensions/index.ts";

vi.mock("@msa/coding-agent", () => ({
  convertToLlm: (messages: unknown) => messages,
  serializeConversation: () => "conversation",
}));

const { default: customCompactionExtension } =
  await import("../examples/extensions/custom-compaction.ts");

describe("Documentation example", () => {
  it("custom compaction example should type-check correctly", () => {
    const exampleExtension = (msa: ExtensionAPI) => {
      msa.on("session_before_compact", (event: SessionBeforeCompactEvent, ctx) =>
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
                summary: `User requests:\n${summary}`,
                firstKeptEntryId,
                tokensBefore,
              },
            });
          }),
        ),
      );
    };

    expect(typeof exampleExtension).toBe("function");
  });

  it("custom compaction example dispatches through modelRegistry.complete", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        let handler: ((event: any, ctx: any) => Promise<any>) | undefined;
        customCompactionExtension({
          on(event, fn) {
            if (event === "session_before_compact") handler = fn as typeof handler;
          },
        } as ExtensionAPI);

        expect(handler).toBeDefined();

        const complete = vi.fn(() =>
          effectRunPromise(
            awaited({
              role: "assistant",
              content: [{ type: "text" as const, text: "custom provider summary" }],
              provider: "example-custom",
              api: "example-custom-api" as const,
              model: "summary-model",
              stopReason: "stop",
              usage: {
                input: 1,
                output: 2,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 3,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              timestamp: currentTimeMillis(),
            }),
          ),
        );
        const model = {
          provider: "example-custom",
          api: "example-custom-api" as const,
          id: "summary-model",
          name: "Summary Model",
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1000,
          maxTokens: 100,
        };

        const result = yield* awaited(
          handler!(
            {
              preparation: {
                messagesToSummarize: [
                  {
                    role: "user",
                    content: [{ type: "text" as const, text: "please remember this" }],
                    timestamp: currentTimeMillis(),
                  },
                ],
                turnPrefixMessages: [],
                tokensBefore: 42,
                firstKeptEntryId: "entry-1",
              },
              branchEntries: [],
              signal: abortController().signal,
            },
            {
              ui: { notify: vi.fn() },
              modelRegistry: {
                find: vi.fn(() => model),
                complete,
              },
            },
          ),
        );

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
            summary: "custom provider summary",
            firstKeptEntryId: "entry-1",
            tokensBefore: 42,
          },
        });
      }),
    ));

  it("compact event should have correct fields", () => {
    const checkCompactEvent = (msa: ExtensionAPI) => {
      msa.on("session_compact", (event: SessionCompactEvent) =>
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
  });
});
