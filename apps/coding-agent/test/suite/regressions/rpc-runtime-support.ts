import { Effect } from "effect";
import { vi } from "vite-plus/test";

import type agentSessionRuntimeTypes from "../../../src/core/agent-session-runtime.types.ts";
import type harnessTypes from "../harness.types.ts";

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

const rpcRuntimeSupport = {
  createRuntimeHost,
  takeListenerSnapshot,
};

export default rpcRuntimeSupport;
