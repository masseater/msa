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
  default: {
    flushRawStdout: vi.fn(() => Promise.resolve()),
    takeOverStdout: vi.fn(),
    waitForRawStdoutBackpressure: vi.fn(() => Promise.resolve()),
    writeRawStdout: (line: string) => {
      rpcIo.outputLines.push(line);
    },
  },
}));

vi.mock("../src/modes/interactive/theme/theme.js", () => ({ default: { theme: {} } }));

vi.mock("../src/modes/rpc/jsonl.js", () => ({
  default: {
    attachJsonlLineReader: vi.fn(
      (_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
        rpcIo.lineHandler = onLine;
        return () => {};
      },
    ),
    serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
  },
}));

const promptResponses = (id: string) =>
  parseOutputLines(rpcIo.outputLines).filter(
    (record) =>
      record["id"] === id && record["type"] === "response" && record["command"] === "prompt",
  );

type QueueType = "steer" | "follow_up";

const send = (lineHandler: (line: string) => void, payload: Record<string, unknown>) =>
  Effect.map(toJsonText(payload), lineHandler);

const waitUntil = (assertion: () => void) => awaited(vi.waitFor(assertion));

const outputs = () => parseOutputLines(rpcIo.outputLines);

const expectDisposition = (type: QueueType, disposition: string) => {
  expect(outputs()).toContainEqual({
    command: type,
    data: { disposition },
    id: "A",
    success: true,
    type: "response",
  });
  expect(outputs()).toContainEqual({
    followUp: type === "follow_up" ? ["B"] : [],
    steering: type === "steer" ? ["B"] : [],
    type: "queue_update",
  });
};

const withRpc = <A>(
  options: Parameters<typeof startRpcMode>[0],
  use: (lineHandler: (line: string) => void) => Effect.Effect<A>,
) =>
  Effect.acquireUseRelease(
    startRpcMode(options),
    ({ lineHandler }) => use(lineHandler),
    ({ cleanup }) => cleanup,
  );

const queueSteeringAndFollowUp = Effect.fn("queueSteeringAndFollowUp")(function* (
  lineHandler: (line: string) => void,
) {
  yield* send(lineHandler, { id: "clear-start", message: "Start", type: "prompt" });
  yield* waitUntil(() => expect(promptResponses("clear-start")).toHaveLength(1));
  yield* send(lineHandler, {
    id: "clear-steering",
    message: "Change direction",
    streamingBehavior: "steer",
    type: "prompt",
  });
  yield* waitUntil(() =>
    expect(promptResponses("clear-steering")).toMatchObject([{ data: { disposition: "queued" } }]),
  );
  yield* send(lineHandler, {
    id: "clear-follow-up",
    message: "Summarize when finished",
    streamingBehavior: "followUp",
    type: "prompt",
  });
  yield* waitUntil(() => expect(promptResponses("clear-follow-up")).toHaveLength(1));
});

const returnsAndClearsQueuedSteeringAndFollow = withRpc(
  { io: rpcIo, responseDelayMs: 500, withAuth: true },
  (lineHandler) =>
    Effect.gen(function* () {
      yield* queueSteeringAndFollowUp(lineHandler);
      yield* send(lineHandler, { id: "clear", type: "clear_queue" });
      yield* waitUntil(() =>
        expect(outputs()).toContainEqual({
          command: "clear_queue",
          data: { followUp: ["Summarize when finished"], steering: ["Change direction"] },
          id: "clear",
          success: true,
          type: "response",
        }),
      );
      yield* Effect.sleep(600);
      expect(outputs().filter((record) => record["type"] === "agent_start")).toHaveLength(1);
    }),
);

const queueingExtension = (type: QueueType) =>
  awaited(
    createTestExtensionsResult([
      (msa) => {
        msa.on("input", (event) => {
          if (event.text !== "A" || event.source !== "rpc") return undefined;
          msa.sendUserMessage("B", { deliverAs: type === "steer" ? "steer" : "followUp" });
          return { action: "handled" };
        });
      },
    ]),
  );

const transformingExtension = () =>
  awaited(
    createTestExtensionsResult([
      (msa) => {
        msa.on("input", (event) =>
          event.text === "A" ? { action: "transform", text: "B" } : undefined,
        );
      },
    ]),
  );

const reportsHandledWhenQueued = (type: QueueType) =>
  Effect.gen(function* () {
    const extensionsResult = yield* queueingExtension(type);
    yield* withRpc(
      { extensionsResult, io: rpcIo, responseDelayMs: 500, withAuth: true },
      (lineHandler) =>
        Effect.gen(function* () {
          yield* send(lineHandler, { id: "start", message: "Start", type: "prompt" });
          yield* waitUntil(() => expect(promptResponses("start")).toHaveLength(1));
          yield* send(lineHandler, { id: "A", message: "A", type });
          yield* waitUntil(() => expectDisposition(type, "handled"));
          yield* waitUntil(() =>
            expect(
              outputs().filter((line) => line["type"] === "response" && line["id"] === "A"),
            ).toHaveLength(1),
          );
        }),
    );
  });

const reportsQueuedAfterTransformation = (type: QueueType) =>
  Effect.gen(function* () {
    const extensionsResult = yield* transformingExtension();
    yield* withRpc(
      { extensionsResult, io: rpcIo, responseDelayMs: 0, withAuth: false },
      (lineHandler) =>
        Effect.gen(function* () {
          yield* send(lineHandler, { id: "A", message: "A", type });
          yield* waitUntil(() => expectDisposition(type, "queued"));
        }),
    );
  });

const resetIo = () => {
  rpcIo.outputLines = [];
  rpcIo.lineHandler = undefined;
};

describe("RPC prompt response semantics", () => {
  afterEach(resetIo);

  it.each(["steer", "follow_up"] as const)(
    "reports %s as handled even when an extension queues another message",
    (type) => runTest(reportsHandledWhenQueued(type)),
  );

  it.each(["steer", "follow_up"] as const)(
    "reports %s as queued after input transformation",
    (type) => runTest(reportsQueuedAfterTransformation(type)),
  );

  it("returns and clears queued steering and follow-up messages", () =>
    runTest(returnsAndClearsQueuedSteeringAndFollow));
});
