import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { AgentSessionRuntime } from "../../../src/core/agent-session-runtime.ts";
import { runRpcMode } from "../../../src/modes/rpc/rpc-mode.ts";
import { stringifyJson } from "../../test-json.ts";
import { createHarness, type Harness } from "../harness.ts";

const rpcIo = vi.hoisted(() => ({
  outputLines: [] as string[],
  lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../../../src/core/output-guard.js", () => ({
  flushRawStdout: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
  takeOverStdout: vi.fn(),
  waitForRawStdoutBackpressure: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
  writeRawStdout: (line: string) => {
    rpcIo.outputLines.push(line);
  },
}));

vi.mock("../../../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));

vi.mock("../../../src/modes/rpc/jsonl.js", () => ({
  attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
    rpcIo.lineHandler = onLine;
    return () => {
      rpcIo.lineHandler = undefined;
    };
  }),
  serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

type NodeListener = Parameters<typeof process.on>[1];

type ListenerSnapshot = {
  stdinEnd: NodeListener[];
  signals: Map<NodeJS.Signals, NodeListener[]>;
};

function takeListenerSnapshot(): ListenerSnapshot {
  const signals: NodeJS.Signals[] =
    process.platform === "win32" ? ["SIGTERM"] : ["SIGTERM", "SIGHUP"];
  return {
    stdinEnd: process.stdin.listeners("end") as NodeListener[],
    signals: new Map(
      signals.map((signal) => [signal, process.listeners(signal) as NodeListener[]]),
    ),
  };
}

function restoreListeners(snapshot: ListenerSnapshot): void {
  for (const listener of process.stdin.listeners("end") as NodeListener[]) {
    if (!snapshot.stdinEnd.includes(listener)) {
      process.stdin.off("end", listener);
    }
  }

  for (const [signal, previousListeners] of snapshot.signals) {
    for (const listener of process.listeners(signal) as NodeListener[]) {
      if (!previousListeners.includes(listener)) {
        process.off(signal, listener);
      }
    }
  }
}

function parseOutputLines(): Array<Record<string, unknown>> {
  return rpcIo.outputLines
    .flatMap((line) => line.split("\n"))
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function createRuntimeHost(harness: Harness): AgentSessionRuntime {
  return {
    session: harness.session,
    newSession: vi.fn(() => Promise.resolve({ cancelled: true })),
    switchSession: vi.fn(() => Promise.resolve({ cancelled: true })),
    fork: vi.fn(() => Promise.resolve({ cancelled: true, selectedText: "" })),
    dispose: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
    setRebindSession: vi.fn(),
  } as unknown as AgentSessionRuntime;
}

const preservesTheRequestIdOnUnknown = Effect.gen(function* () {
  const listenerSnapshot = takeListenerSnapshot();
  const harness = yield* Effect.promise(() => createHarness());

  try {
    void runRpcMode(createRuntimeHost(harness));
    yield* Effect.promise(() => vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined()));

    rpcIo.lineHandler?.(stringifyJson({ id: "test", type: "foobar" }));

    yield* Effect.promise(() =>
      vi.waitFor(() => {
        expect(parseOutputLines()).toContainEqual({
          id: "test",
          type: "response",
          command: "foobar",
          success: false,
          error: "Unknown command: foobar",
        });
      }),
    );
  } finally {
    harness.cleanup();
    restoreListeners(listenerSnapshot);
  }
});

describe("RPC unknown command responses (#5868)", () => {
  afterEach(() => {
    rpcIo.outputLines = [];
    rpcIo.lineHandler = undefined;
  });
  test("preserves the request id on unknown command errors", () =>
    Effect.runPromise(preservesTheRequestIdOnUnknown));
});
