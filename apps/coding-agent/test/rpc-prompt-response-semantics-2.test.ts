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

  it.each(["steer", "follow_up"] as const)(
    "reports %s as handled even when an extension queues another message",
    (type) =>
      runTest(
        Effect.gen(function* () {
          const extensionsResult = yield* awaited(
            createTestExtensionsResult([
              (msa) => {
                msa.on("input", (event) => {
                  if (event.text === "A" && event.source === "rpc") {
                    msa.sendUserMessage("B", {
                      deliverAs: type === "steer" ? "steer" : "followUp",
                    });
                    return { action: "handled" };
                  }
                  return undefined;
                });
              },
            ]),
          );
          const { lineHandler, cleanup } = yield* startRpcMode({
            io: rpcIo,
            withAuth: true,
            responseDelayMs: 500,
            extensionsResult,
          });

          try {
            lineHandler(yield* toJsonText({ id: "start", type: "prompt", message: "Start" }));
            yield* awaited(vi.waitFor(() => expect(promptResponses("start")).toHaveLength(1)));

            lineHandler(yield* toJsonText({ id: "A", type, message: "A" }));
            yield* awaited(
              vi.waitFor(() => {
                expect(parseOutputLines(rpcIo.outputLines)).toContainEqual({
                  id: "A",
                  type: "response",
                  command: type,
                  success: true,
                  data: { disposition: "handled" },
                });
                expect(parseOutputLines(rpcIo.outputLines)).toContainEqual({
                  type: "queue_update",
                  steering: type === "steer" ? ["B"] : [],
                  followUp: type === "follow_up" ? ["B"] : [],
                });
              }),
            );
            yield* awaited(
              vi.waitFor(() => {
                expect(
                  parseOutputLines(rpcIo.outputLines).filter(
                    (line) => line["type"] === "response" && line["id"] === "A",
                  ),
                ).toHaveLength(1);
              }),
            );
          } finally {
            yield* cleanup;
          }
        }),
      ),
  );

  it.each(["steer", "follow_up"] as const)(
    "reports %s as queued after input transformation",
    (type) =>
      runTest(
        Effect.gen(function* () {
          const extensionsResult = yield* awaited(
            createTestExtensionsResult([
              (msa) => {
                msa.on("input", (event) => {
                  if (event.text === "A") return { action: "transform", text: "B" };
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
            lineHandler(yield* toJsonText({ id: "A", type, message: "A" }));
            yield* awaited(
              vi.waitFor(() => {
                expect(parseOutputLines(rpcIo.outputLines)).toContainEqual({
                  id: "A",
                  type: "response",
                  command: type,
                  success: true,
                  data: { disposition: "queued" },
                });
                expect(parseOutputLines(rpcIo.outputLines)).toContainEqual({
                  type: "queue_update",
                  steering: type === "steer" ? ["B"] : [],
                  followUp: type === "follow_up" ? ["B"] : [],
                });
              }),
            );
          } finally {
            yield* cleanup;
          }
        }),
      ),
  );

  it("returns and clears queued steering and follow-up messages", () =>
    runTest(
      Effect.gen(function* () {
        const { lineHandler, cleanup } = yield* startRpcMode({
          io: rpcIo,
          withAuth: true,
          responseDelayMs: 500,
        });

        try {
          lineHandler(yield* toJsonText({ id: "clear-start", type: "prompt", message: "Start" }));
          yield* awaited(
            vi.waitFor(() => {
              expect(promptResponses("clear-start")).toHaveLength(1);
            }),
          );

          lineHandler(
            yield* toJsonText({
              id: "clear-steering",
              type: "prompt",
              message: "Change direction",
              streamingBehavior: "steer",
            }),
          );
          yield* awaited(
            vi.waitFor(() => {
              expect(promptResponses("clear-steering")).toMatchObject([
                { data: { disposition: "queued" } },
              ]);
            }),
          );

          lineHandler(
            yield* toJsonText({
              id: "clear-follow-up",
              type: "prompt",
              message: "Summarize when finished",
              streamingBehavior: "followUp",
            }),
          );
          yield* awaited(
            vi.waitFor(() => {
              expect(promptResponses("clear-follow-up")).toHaveLength(1);
            }),
          );

          lineHandler(yield* toJsonText({ id: "clear", type: "clear_queue" }));
          yield* awaited(
            vi.waitFor(() => {
              expect(parseOutputLines(rpcIo.outputLines)).toContainEqual({
                id: "clear",
                type: "response",
                command: "clear_queue",
                success: true,
                data: {
                  steering: ["Change direction"],
                  followUp: ["Summarize when finished"],
                },
              });
            }),
          );

          yield* Effect.sleep(600);
          expect(
            parseOutputLines(rpcIo.outputLines).filter(
              (record) => record["type"] === "agent_start",
            ),
          ).toHaveLength(1);
        } finally {
          yield* cleanup;
        }
      }),
    ));
});
