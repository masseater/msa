import { once } from "node:events";
import { Worker } from "node:worker_threads";

import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { type MockInstance, afterEach, beforeEach, expect, vi } from "vite-plus/test";

import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { awaited, readBytesFile, removePath, runTest } = testing;

const { getToolResult } = harnessModule;

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const usage = (input: number, cost: number): compatTypes.Usage => ({
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: cost, output: 0, total: cost },
  input,
  output: 0,
  totalTokens: input,
});

const codemodeResult = (harness: harnessTypes.Harness) => getToolResult(harness, "codemode");

const resultText = (message: compatTypes.ToolResultMessage): string => {
  const [header, ...items] = message.content;
  expect(header).toEqual({
    text: expect.stringMatching(
      /^Script (completed|failed)\nWall time \d+\.\d seconds\nOutput:\n$/u,
    ),
    type: "text",
  });
  return items.map((block) => (block.type === "text" ? block.text : `<${block.type}>`)).join("\n");
};

const TINY_PNG_LABEL = /^\[Image saved to (\S+\.png) \(image\/png, \d+B\)\]$/u;

const checkSavedLine = Effect.fn("checkSavedLine")(function* (line: string) {
  const path = TINY_PNG_LABEL.exec(line)?.[1];
  if (path === undefined || path === "") return line;
  expect(Buffer.from(yield* readBytesFile(path)).toString("base64")).toBe(TINY_PNG_BASE64);
  yield* removePath(path);
  return "<saved>";
});

const checkSavedImages = (text: string) =>
  Effect.map(Effect.forEach(text.split("\n"), checkSavedLine), (lines) => lines.join("\n"));

const workerSpy: { current?: MockInstance<Worker["once"]> } = {};

const workersExited = (): Promise<void> => {
  const running = new Set(
    (workerSpy.current?.mock.contexts ?? []).filter(
      (worker): worker is Worker => worker instanceof Worker && worker.threadId !== -1,
    ),
  );
  return Promise.all([...running].map((worker) => once(worker, "exit"))).then(() => undefined);
};

const trackCodemodeWorkers = (): void => {
  beforeEach(() => {
    workerSpy.current = vi.spyOn(Worker.prototype, "once");
  });
  afterEach(() =>
    workersExited().then(() => {
      workerSpy.current?.mockRestore();
      return undefined;
    }),
  );
};

const runCodemode = (
  harness: harnessTypes.Harness,
  code: string,
): Promise<compatTypes.ToolResultMessage> =>
  runTest(
    Effect.gen(function* () {
      harness.setResponses([
        fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }),
        fauxAssistantMessage("done"),
      ]);
      yield* awaited(harness.session.prompt("go"));
      yield* awaited(workersExited());
      return codemodeResult(harness);
    }),
  );

const agentSessionCodemodeSupport = {
  TINY_PNG_BASE64,
  TINY_PNG_LABEL,
  checkSavedImages,
  codemodeResult,
  resultText,
  runCodemode,
  trackCodemodeWorkers,
  usage,
  workersExited,
};

export default agentSessionCodemodeSupport;
