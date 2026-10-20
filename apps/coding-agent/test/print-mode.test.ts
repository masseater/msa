import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type srcTypes from "../src/index.types.ts";
import printMode from "../src/modes/print-mode.ts";

const { runPrintMode } = printMode;

const { awaited, currentTimeMillis, runTest } = testing;

type EmitEvent = srcTypes.SessionShutdownEvent;

type FakeExtensionRunner = {
  hasHandlers: (eventType: string) => boolean;
  emit: ReturnType<typeof vi.fn<(event: EmitEvent) => Promise<void>>>;
};

type FakeSession = {
  agent: { waitForIdle: () => Promise<void>; subscribe: ReturnType<typeof vi.fn> };
  extensions: {
    binding: { bindExtensions: ReturnType<typeof vi.fn>; extensionRunner: FakeExtensionRunner };
    runtime: { reload: ReturnType<typeof vi.fn> };
  };
  run: { prompting: { prompt: ReturnType<typeof vi.fn> } };
  sessionManager: { getHeader: () => object | undefined };
  state: { messages: aiTypes.AssistantMessage[] };
  subscribe: ReturnType<typeof vi.fn>;
};

type FakeRuntimeHost = {
  session: FakeSession;
  newSession: ReturnType<typeof vi.fn>;
  fork: ReturnType<typeof vi.fn>;
  switchSession: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  setRebindSession: ReturnType<typeof vi.fn>;
};

function createAssistantMessage(options?: {
  text?: string;
  stopReason?: aiTypes.AssistantMessage["stopReason"];
  errorMessage?: string;
}): aiTypes.AssistantMessage {
  return {
    api: "openai-responses" as const,
    content:
      options?.text !== undefined && options?.text.length > 0
        ? [{ text: options.text, type: "text" as const }]
        : [],
    model: "gpt-4o-mini",
    provider: "openai",
    role: "assistant",
    stopReason: options?.stopReason ?? "stop",
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
    ...(options?.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
    timestamp: currentTimeMillis(),
  };
}

function createRuntimeHost(assistantMessage: aiTypes.AssistantMessage): FakeRuntimeHost {
  const extensionRunner: FakeExtensionRunner = {
    emit: vi.fn(() => runTest(Effect.sync(() => {}))),
    hasHandlers: (eventType: string) => eventType === "session_shutdown",
  };

  const state = { messages: [assistantMessage] };

  const session: FakeSession = {
    agent: { subscribe: vi.fn(() => () => {}), waitForIdle: () => runTest(Effect.sync(() => {})) },
    extensions: {
      binding: { bindExtensions: vi.fn(() => runTest(Effect.sync(() => {}))), extensionRunner },
      runtime: { reload: vi.fn(() => runTest(Effect.sync(() => {}))) },
    },
    run: { prompting: { prompt: vi.fn(() => runTest(Effect.sync(() => {}))) } },
    sessionManager: { getHeader: () => undefined },
    state,
    subscribe: vi.fn(() => () => {}),
  };

  return {
    dispose: vi.fn(() =>
      runTest(
        awaited(
          session.extensions.binding.extensionRunner.emit({
            reason: "quit",
            type: "session_shutdown" as const,
          }),
        ),
      ),
    ),
    fork: vi.fn(() => runTest(awaited({ selectedText: "" }))),
    newSession: vi.fn(() => runTest(awaited(undefined))),
    session,
    setRebindSession: vi.fn(),
    switchSession: vi.fn(() => runTest(awaited(undefined))),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

const warnsOnStderrAndReturnsNonZero = () =>
  runTest(
    Effect.gen(function* () {
      const runtimeHost = createRuntimeHost(createAssistantMessage({ stopReason: "length" }));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const exitCode = yield* awaited(
        runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
          mode: "text",
        }),
      );

      expect(exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalled();
    }),
  );

describe("runPrintMode", () => {
  it("emits session_shutdown in text mode", () =>
    runTest(
      Effect.gen(function* () {
        const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
        const { session } = runtimeHost;
        const images: aiTypes.ImageContent[] = [
          { data: "abc", mimeType: "image/png", type: "image" as const },
        ];

        const exitCode = yield* awaited(
          runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
            initialImages: images,
            initialMessage: "Say done",
            mode: "text",
          }),
        );

        expect(exitCode).toBe(0);
        expect(session.run.prompting.prompt).toHaveBeenCalledWith("Say done", { images });
        expect(session.extensions.binding.extensionRunner.emit).toHaveBeenCalledTimes(1);
        expect(session.extensions.binding.extensionRunner.emit).toHaveBeenCalledWith({
          reason: "quit",
          type: "session_shutdown" as const,
        });
      }),
    ));
});

describe("runPrintMode", () => {
  it("emits session_shutdown in json mode", () =>
    runTest(
      Effect.gen(function* () {
        const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
        const { session } = runtimeHost;

        const exitCode = yield* awaited(
          runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
            messages: ["hello"],
            mode: "json",
          }),
        );

        expect(exitCode).toBe(0);
        expect(session.run.prompting.prompt).toHaveBeenCalledWith("hello");
        expect(session.extensions.binding.extensionRunner.emit).toHaveBeenCalledTimes(1);
        expect(session.extensions.binding.extensionRunner.emit).toHaveBeenCalledWith({
          reason: "quit",
          type: "session_shutdown" as const,
        });
      }),
    ));
});

describe("runPrintMode", () => {
  it("emits session_shutdown and returns non-zero on assistant error", () =>
    runTest(
      Effect.gen(function* () {
        const runtimeHost = createRuntimeHost(
          createAssistantMessage({ errorMessage: "provider failure", stopReason: "error" }),
        );
        const { session } = runtimeHost;
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const exitCode = yield* awaited(
          runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
            mode: "text",
          }),
        );

        expect(exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalledWith("provider failure");
        expect(session.extensions.binding.extensionRunner.emit).toHaveBeenCalledTimes(1);
        expect(session.extensions.binding.extensionRunner.emit).toHaveBeenCalledWith({
          reason: "quit",
          type: "session_shutdown" as const,
        });
      }),
    ));

  it(
    "warns on stderr and returns non-zero when the response was truncated",
    warnsOnStderrAndReturnsNonZero,
  );
});
