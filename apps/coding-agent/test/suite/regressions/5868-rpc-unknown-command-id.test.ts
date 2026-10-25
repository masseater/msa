import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type agentSessionRuntimeTypes from "../../../src/core/agent-session-runtime.types.ts";
import rpcMode from "../../../src/modes/rpc/rpc-mode.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { runRpcMode } = rpcMode;

const { createHarness } = harnessModule;

const { awaited, toJsonText } = testing;

const rpcIo = vi.hoisted(() => ({
  lineHandler: undefined as ((line: string) => void) | undefined,
  outputLines: [] as string[],
}));

vi.mock("../../../src/core/output-guard.js", () => ({
  default: {
    flushRawStdout: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
    takeOverStdout: vi.fn(),
    waitForRawStdoutBackpressure: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
    writeRawStdout: (line: string) => {
      rpcIo.outputLines.push(line);
    },
  },
}));

vi.mock("../../../src/modes/interactive/theme/theme.js", () => ({ default: { theme: {} } }));

vi.mock("../../../src/modes/rpc/jsonl.js", () => ({
  default: {
    attachJsonlLineReader: vi.fn(
      (_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
        rpcIo.lineHandler = onLine;
        return () => {
          rpcIo.lineHandler = undefined;
        };
      },
    ),
    serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
  },
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
    signals: new Map(
      signals.map((signal) => [signal, process.listeners(signal) as NodeListener[]]),
    ),
    stdinEnd: process.stdin.listeners("end") as NodeListener[],
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

function createRuntimeHost(
  harness: harnessTypes.Harness,
): agentSessionRuntimeTypes.AgentSessionRuntime {
  return {
    dispose: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
    fork: vi.fn(() => Promise.resolve({ cancelled: true, selectedText: "" })),
    newSession: vi.fn(() => Promise.resolve({ cancelled: true })),
    session: harness.session,
    setRebindSession: vi.fn(),
    switchSession: vi.fn(() => Promise.resolve({ cancelled: true })),
  } as unknown as agentSessionRuntimeTypes.AgentSessionRuntime;
}

const preservesTheRequestIdOnUnknown = Effect.gen(function* () {
  const listenerSnapshot = takeListenerSnapshot();
  const harness = yield* Effect.promise(() => createHarness());

  try {
    void runRpcMode(createRuntimeHost(harness));
    yield* Effect.promise(() => vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined()));

    rpcIo.lineHandler?.(yield* toJsonText({ id: "test", type: "foobar" }));

    yield* Effect.promise(() =>
      vi.waitFor(() => {
        expect(parseOutputLines()).toContainEqual({
          command: "foobar",
          error: "Unknown command: foobar",
          id: "test",
          success: false,
          type: "response",
        });
      }),
    );
  } finally {
    yield* awaited(harness.cleanup());
    restoreListeners(listenerSnapshot);
  }
});

const preservesTheRequestIdOnUnknownCommand = () =>
  Effect.runPromise(preservesTheRequestIdOnUnknown);

describe("RPC unknown command responses (#5868)", () => {
  afterEach(() => {
    rpcIo.outputLines = [];
    rpcIo.lineHandler = undefined;
  });
  test("preserves the request id on unknown command errors", preservesTheRequestIdOnUnknownCommand);
});
