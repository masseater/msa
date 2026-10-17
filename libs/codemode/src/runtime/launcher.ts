import type * as Effect from "effect/Effect";

import { toCodemodeIdentifier } from "../identifier.ts";
import type {
  CodemodeDeclaredGlobal,
  CodemodeDeclaredTool,
  CodemodeError,
  CodemodeRunOptions,
  CodemodeTool,
} from "../types.ts";
import type { LaunchError } from "./errors/launch-error.ts";
import type { HostToWorkerMessage, VmStartData, WorkerToHostMessage } from "./protocol.ts";

export interface VmEvents {
  message(message: unknown): void;
  failure(error: CodemodeError): void;
}

export interface VmChannel {
  post(message: HostToWorkerMessage): void;
  readonly stop: Effect.Effect<void>;
}

export type VmLauncher = (
  data: VmStartData,
  events: VmEvents,
) => Effect.Effect<VmChannel, LaunchError>;

export type Control = { [K in "onStarted" | "onCall" | "onIdle"]: CodemodeRunOptions[K] };
export type CallMessage = Extract<WorkerToHostMessage, { type: "call" }>;
export type DoneMessage = Extract<WorkerToHostMessage, { type: "done" }>;

export interface ExecutionOptions {
  code: string;
  tools: readonly CodemodeDeclaredTool[];
  globals: readonly CodemodeDeclaredGlobal[];
  executors: {
    tools: ReadonlyMap<string, CodemodeTool>;
    globals: ReadonlyMap<string, CodemodeTool>;
  };
  timeoutMs: number;
  signal: AbortSignal | undefined;
  memoryLimitBytes: number | undefined;
  store: Record<string, string>;
  deterministic?: { startedAt: number; seed: number };
  control?: Control;
  launch: VmLauncher;
}

export const startData = (options: ExecutionOptions): VmStartData => ({
  code: options.code,
  tools: options.tools.map((tool) => ({
    name: tool.name,
    jsName: tool.jsName ?? toCodemodeIdentifier(tool.name),
    description: tool.description ?? "",
  })),
  globals: options.globals.map((global) => ({ name: global.name, spread: global.spread === true })),
  memoryLimitBytes: options.memoryLimitBytes,
  store: options.store,
  ...(Number.isFinite(options.timeoutMs) ? { timeoutMs: options.timeoutMs } : {}),
  ...(options.deterministic === undefined ? {} : { deterministic: options.deterministic }),
});
