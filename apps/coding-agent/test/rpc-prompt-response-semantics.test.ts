import { awaited, runTest, toJsonText } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { parseOutputLines, type RpcIo, startRpcMode } from "./rpc-prompt-response-support.ts";
import { createTestExtensionsResult } from "./utilities.ts";

const rpcIo = vi.hoisted((): RpcIo => ({
  outputLines: [],
  lineHandler: undefined,
}));

vi.mock("../src/core/output-guard.js", () => ({
  flushRawStdout: vi.fn(() => Promise.resolve()),
  takeOverStdout: vi.fn(),
  waitForRawStdoutBackpressure: vi.fn(() => Promise.resolve()),
  writeRawStdout: (line: string) => {
    rpcIo.outputLines.push(line);
  },
}));

vi.mock("../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));

vi.mock("../src/modes/rpc/jsonl.js", () => ({
  attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
    rpcIo.lineHandler = onLine;
    return () => {};
  }),
  serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

const promptResponses = (id: string) =>
  parseOutputLines(rpcIo.outputLines).filter(
    (record) =>
      record["id"] === id && record["type"] === "response" && record["command"] === "prompt",
  );

describe("RPC prompt response semantics", () => {
  afterEach(() => {
    rpcIo.outputLines = [];
    rpcIo.lineHandler = undefined;
  });

  it("emits one failure response when prompt preflight rejects", () =>
    runTest(
      Effect.gen(function* () {
        const { lineHandler, cleanup } = yield* startRpcMode({
          io: rpcIo,
          withAuth: false,
          responseDelayMs: 0,
          model: {
            id: "fake-model",
            name: "Fake Model",
            api: "openai-completions",
            provider: "fake-provider",
            baseUrl: "https://example.invalid",
            reasoning: false,
            input: [],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 0,
            maxTokens: 0,
          },
        });

        try {
          lineHandler(yield* toJsonText({ id: "b1", type: "prompt", message: "Hello" }));

          yield* awaited(
            vi.waitFor(() => {
              const responses = promptResponses("b1");
              expect(responses).toHaveLength(1);
              expect(responses[0]).toMatchObject({
                id: "b1",
                type: "response",
                command: "prompt",
                success: false,
                error: expect.stringContaining(
                  "No API key found for fake-provider.\n\nUse /login to log into a provider via OAuth or API key. See:",
                ),
              });
            }),
          );
        } finally {
          yield* cleanup;
        }
      }),
    ));

  it("emits one started response when prompt preflight succeeds", () =>
    runTest(
      Effect.gen(function* () {
        const { lineHandler, cleanup } = yield* startRpcMode({
          io: rpcIo,
          withAuth: true,
          responseDelayMs: 0,
        });

        try {
          lineHandler(yield* toJsonText({ id: "b2", type: "prompt", message: "Hello" }));

          yield* awaited(
            vi.waitFor(() => {
              const responses = promptResponses("b2");
              expect(responses).toHaveLength(1);
              expect(responses[0]).toMatchObject({
                id: "b2",
                type: "response",
                command: "prompt",
                success: true,
                data: { disposition: "started" },
              });
            }),
          );
        } finally {
          yield* cleanup;
        }
      }),
    ));

  it("reports extension commands and intercepted input as handled without starting a run", () =>
    runTest(
      Effect.gen(function* () {
        const extensionsResult = yield* awaited(
          createTestExtensionsResult([
            (msa) => {
              msa.registerCommand("handled", { handler: () => Promise.resolve() });
              msa.on("input", (event) => {
                if (event.text === "handled input") return { action: "handled" };
                return undefined;
              });
            },
          ]),
        );
        const { lineHandler, cleanup } = yield* startRpcMode({
          io: rpcIo,
          withAuth: false,
          responseDelayMs: 0,
          extensionsResult,
        });

        try {
          for (const [id, message] of [
            ["command", "/handled"],
            ["input", "handled input"],
          ] as const) {
            lineHandler(yield* toJsonText({ id, type: "prompt", message }));
            yield* awaited(
              vi.waitFor(() => {
                expect(promptResponses(id)).toEqual([
                  {
                    id,
                    type: "response",
                    command: "prompt",
                    success: true,
                    data: { disposition: "handled" },
                  },
                ]);
              }),
            );
          }
          expect(
            parseOutputLines(rpcIo.outputLines).filter((line) => line["type"] === "agent_start"),
          ).toHaveLength(0);
        } finally {
          yield* cleanup;
        }
      }),
    ));

  it("emits one success response when prompt is queued during streaming", () =>
    runTest(
      Effect.gen(function* () {
        const { lineHandler, cleanup } = yield* startRpcMode({
          io: rpcIo,
          withAuth: true,
          responseDelayMs: 100,
        });

        try {
          lineHandler(yield* toJsonText({ id: "b3-start", type: "prompt", message: "Start" }));
          yield* awaited(
            vi.waitFor(() => {
              expect(promptResponses("b3-start")).toHaveLength(1);
            }),
          );

          rpcIo.outputLines = [];
          lineHandler(
            yield* toJsonText({
              id: "b3",
              type: "prompt",
              message: "Queue this",
              streamingBehavior: "followUp",
            }),
          );

          yield* awaited(
            vi.waitFor(() => {
              const responses = promptResponses("b3");
              expect(responses).toHaveLength(1);
              expect(responses[0]).toMatchObject({
                id: "b3",
                type: "response",
                command: "prompt",
                success: true,
                data: { disposition: "queued" },
              });
            }),
          );

          yield* Effect.sleep(150);
        } finally {
          yield* cleanup;
        }
      }),
    ));
});
