import { Effect } from "effect";
import { vi } from "vite-plus/test";

import type agentSessionRuntimeTypes from "../../../src/core/agent-session-runtime.types.ts";
import type harnessTypes from "../harness.types.ts";
import type rpcRuntimeSupportTypes from "./rpc-runtime-support.types.ts";

type NodeListener = Parameters<typeof process.on>[1];

type ListenerSnapshot = {
  stdinEnd: NodeListener[];
  signals: Map<NodeJS.Signals, NodeListener[]>;
};

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
    if (!snapshot.stdinEnd.includes(listener)) process.stdin.off("end", listener);
  }
  for (const [signal, previousListeners] of snapshot.signals) {
    for (const listener of process.listeners(signal) as NodeListener[]) {
      if (!previousListeners.includes(listener)) process.off(signal, listener);
    }
  }
}

const rpcIo = {
  lineHandler: undefined as ((line: string) => void) | undefined,
  outputLines: [] as string[],
};

function resetRpcIo(): void {
  rpcIo.outputLines = [];
  rpcIo.lineHandler = undefined;
}

function parseOutputLines(): Array<Record<string, unknown>> {
  return rpcIo.outputLines
    .flatMap((line) => line.split("\n"))
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const outputGuardModule: rpcRuntimeSupportTypes.OutputGuardModule = {
  default: {
    flushRawStdout: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
    takeOverStdout: vi.fn(),
    waitForRawStdoutBackpressure: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
    writeRawStdout: (line: string) => {
      rpcIo.outputLines.push(line);
    },
  },
};

const jsonlModule: rpcRuntimeSupportTypes.JsonlModule = {
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
};

const rpcRuntimeSupport = {
  createRuntimeHost,
  jsonlModule,
  outputGuardModule,
  parseOutputLines,
  resetRpcIo,
  restoreListeners,
  rpcIo,
  takeListenerSnapshot,
};

export default rpcRuntimeSupport;
