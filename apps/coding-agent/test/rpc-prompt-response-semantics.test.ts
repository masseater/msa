import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import rpcPromptResponseSupport from "./rpc-prompt-response-support.ts";
import type rpcPromptResponseSupportTypes from "./rpc-prompt-response-support.types.ts";
import utilities from "./utilities.ts";

const { parseOutputLines, startRpcMode } = rpcPromptResponseSupport;
const { createTestExtensionsResult } = utilities;

const { awaited, runTest, toJsonText } = testing;

const rpcIo = vi.hoisted((): rpcPromptResponseSupportTypes.RpcIo => ({
  lineHandler: undefined,
  outputLines: [],
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

const emitsOneFailureResponseWhenPromptPreflight = () =>
  runTest(
    Effect.gen(function* () {
      const { lineHandler, cleanup } = yield* startRpcMode({
        io: rpcIo,
        model: {
          api: "openai-completions",
          baseUrl: "https://example.invalid",
          contextWindow: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
          id: "fake-model",
          input: [],
          maxTokens: 0,
          name: "Fake Model",
          provider: "fake-provider",
          reasoning: false,
        },
        responseDelayMs: 0,
        withAuth: false,
      });

      try {
        lineHandler(yield* toJsonText({ id: "b1", message: "Hello", type: "prompt" }));

        yield* awaited(
          vi.waitFor(() => {
            const responses = promptResponses("b1");
            expect(responses).toHaveLength(1);
            expect(responses[0]).toMatchObject({
              command: "prompt",
              error: expect.stringContaining(
                "No API key found for fake-provider.\n\nUse /login to log into a provider via OAuth or API key. See:",
              ),
              id: "b1",
              success: false,
              type: "response",
            });
          }),
        );
      } finally {
        yield* cleanup;
      }
    }),
  );

const emitsOneStartedResponseWhenPromptPreflight = () =>
  runTest(
    Effect.gen(function* () {
      const { lineHandler, cleanup } = yield* startRpcMode({
        io: rpcIo,
        responseDelayMs: 0,
        withAuth: true,
      });

      try {
        lineHandler(yield* toJsonText({ id: "b2", message: "Hello", type: "prompt" }));

        yield* awaited(
          vi.waitFor(() => {
            const responses = promptResponses("b2");
            expect(responses).toHaveLength(1);
            expect(responses[0]).toMatchObject({
              command: "prompt",
              data: { disposition: "started" },
              id: "b2",
              success: true,
              type: "response",
            });
          }),
        );
      } finally {
        yield* cleanup;
      }
    }),
  );

const reportsExtensionCommandsAndInterceptedInputAs = () =>
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
        extensionsResult,
        io: rpcIo,
        responseDelayMs: 0,
        withAuth: false,
      });

      try {
        for (const [id, message] of [
          ["command", "/handled"],
          ["input", "handled input"],
        ] as const) {
          lineHandler(yield* toJsonText({ id, message, type: "prompt" }));
          yield* awaited(
            vi.waitFor(() => {
              expect(promptResponses(id)).toEqual([
                {
                  command: "prompt",
                  data: { disposition: "handled" },
                  id,
                  success: true,
                  type: "response",
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
  );

const emitsOneSuccessResponseWhenPromptIs = () =>
  runTest(
    Effect.gen(function* () {
      const { lineHandler, cleanup } = yield* startRpcMode({
        io: rpcIo,
        responseDelayMs: 100,
        withAuth: true,
      });

      try {
        lineHandler(yield* toJsonText({ id: "b3-start", message: "Start", type: "prompt" }));
        yield* awaited(
          vi.waitFor(() => {
            expect(promptResponses("b3-start")).toHaveLength(1);
          }),
        );

        rpcIo.outputLines = [];
        lineHandler(
          yield* toJsonText({
            id: "b3",
            message: "Queue this",
            streamingBehavior: "followUp",
            type: "prompt",
          }),
        );

        yield* awaited(
          vi.waitFor(() => {
            const responses = promptResponses("b3");
            expect(responses).toHaveLength(1);
            expect(responses[0]).toMatchObject({
              command: "prompt",
              data: { disposition: "queued" },
              id: "b3",
              success: true,
              type: "response",
            });
          }),
        );

        yield* Effect.sleep(150);
      } finally {
        yield* cleanup;
      }
    }),
  );

describe("RPC prompt response semantics", () => {
  afterEach(() => {
    rpcIo.outputLines = [];
    rpcIo.lineHandler = undefined;
  });

  it(
    "emits one failure response when prompt preflight rejects",
    emitsOneFailureResponseWhenPromptPreflight,
  );

  it(
    "emits one started response when prompt preflight succeeds",
    emitsOneStartedResponseWhenPromptPreflight,
  );

  it(
    "reports extension commands and intercepted input as handled without starting a run",
    reportsExtensionCommandsAndInterceptedInputAs,
  );

  it(
    "emits one success response when prompt is queued during streaming",
    emitsOneSuccessResponseWhenPromptIs,
  );
});
