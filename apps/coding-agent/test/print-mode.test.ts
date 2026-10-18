import type { AssistantMessage, ImageContent } from "@msa/ai";
import { awaited, runTest, currentTimeMillis } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { SessionShutdownEvent } from "../src/index.ts";
import { runPrintMode } from "../src/modes/print-mode.ts";

type EmitEvent = SessionShutdownEvent;

type FakeExtensionRunner = {
  hasHandlers: (eventType: string) => boolean;
  emit: ReturnType<typeof vi.fn<(event: EmitEvent) => Promise<void>>>;
};

type FakeSession = {
  sessionManager: { getHeader: () => object | undefined };
  agent: { waitForIdle: () => Promise<void>; subscribe: ReturnType<typeof vi.fn> };
  state: { messages: AssistantMessage[] };
  extensionRunner: FakeExtensionRunner;
  bindExtensions: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
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
  stopReason?: AssistantMessage["stopReason"];
  errorMessage?: string;
}): AssistantMessage {
  return {
    role: "assistant",
    content:
      options?.text !== undefined && options?.text.length > 0
        ? [{ type: "text" as const, text: options.text }]
        : [],
    api: "openai-responses" as const,
    provider: "openai",
    model: "gpt-4o-mini",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: options?.stopReason ?? "stop",
    ...(options?.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
    timestamp: currentTimeMillis(),
  };
}

function createRuntimeHost(assistantMessage: AssistantMessage): FakeRuntimeHost {
  const extensionRunner: FakeExtensionRunner = {
    hasHandlers: (eventType: string) => eventType === "session_shutdown",
    emit: vi.fn(() => runTest(Effect.sync(() => {}))),
  };

  const state = { messages: [assistantMessage] };

  const session: FakeSession = {
    sessionManager: { getHeader: () => undefined },
    agent: { waitForIdle: () => runTest(Effect.sync(() => {})), subscribe: vi.fn(() => () => {}) },
    state,
    extensionRunner,
    bindExtensions: vi.fn(() => runTest(Effect.sync(() => {}))),
    subscribe: vi.fn(() => () => {}),
    prompt: vi.fn(() => runTest(Effect.sync(() => {}))),
    reload: vi.fn(() => runTest(Effect.sync(() => {}))),
  };

  return {
    session,
    newSession: vi.fn(() => runTest(awaited(undefined))),
    fork: vi.fn(() => runTest(awaited({ selectedText: "" }))),
    switchSession: vi.fn(() => runTest(awaited(undefined))),
    dispose: vi.fn(() =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(
            session.extensionRunner.emit({ type: "session_shutdown" as const, reason: "quit" }),
          );
        }),
      ),
    ),
    setRebindSession: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runPrintMode", () => {
  it("emits session_shutdown in text mode", () =>
    runTest(
      Effect.gen(function* () {
        const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
        const { session } = runtimeHost;
        const images: ImageContent[] = [
          { type: "image" as const, mimeType: "image/png", data: "abc" },
        ];

        const exitCode = yield* awaited(
          runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
            mode: "text",
            initialMessage: "Say done",
            initialImages: images,
          }),
        );

        expect(exitCode).toBe(0);
        expect(session.prompt).toHaveBeenCalledWith("Say done", { images });
        expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
        expect(session.extensionRunner.emit).toHaveBeenCalledWith({
          type: "session_shutdown" as const,
          reason: "quit",
        });
      }),
    ));

  it("emits session_shutdown in json mode", () =>
    runTest(
      Effect.gen(function* () {
        const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
        const { session } = runtimeHost;

        const exitCode = yield* awaited(
          runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
            mode: "json",
            messages: ["hello"],
          }),
        );

        expect(exitCode).toBe(0);
        expect(session.prompt).toHaveBeenCalledWith("hello");
        expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
        expect(session.extensionRunner.emit).toHaveBeenCalledWith({
          type: "session_shutdown" as const,
          reason: "quit",
        });
      }),
    ));

  it("emits session_shutdown and returns non-zero on assistant error", () =>
    runTest(
      Effect.gen(function* () {
        const runtimeHost = createRuntimeHost(
          createAssistantMessage({ stopReason: "error", errorMessage: "provider failure" }),
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
        expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
        expect(session.extensionRunner.emit).toHaveBeenCalledWith({
          type: "session_shutdown" as const,
          reason: "quit",
        });
      }),
    ));

  it("warns on stderr and returns non-zero when the response was truncated", () =>
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
    ));
});
