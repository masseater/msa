import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

import { toCodemodeIdentifier } from "../identifier.ts";
import type {
  CodemodeDeclaredGlobal,
  CodemodeDeclaredTool,
  CodemodeDuring,
  CodemodeError,
  CodemodeOutputItem,
  CodemodeRunOptions,
  CodemodeTool,
} from "../types.ts";
import type { CodemodeWasmModule } from "../wasm.ts";

export class LaunchError extends Data.TaggedError("LaunchError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

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

export interface VmStartData {
  code: string;
  tools: { name: string; jsName: string; description: string }[];
  globals: { name: string; spread: boolean }[];
  memoryLimitBytes: number | undefined;
  store: Record<string, string>;
  timeoutMs?: number;
  deterministic?: { startedAt: number; seed: number };
}

export interface WorkerData extends VmStartData {
  wasm: CodemodeWasmModule;
  interrupt: SharedArrayBuffer;
}

export type ScriptErrorJson = string;

export type WorkerToHostMessage =
  | { type: "call"; id: number; target: "tool" | "global"; name: string; args: string | undefined }
  | { type: "output"; item: CodemodeOutputItem }
  | { type: "done"; ok: true; value: string | undefined; writes: string; during?: CodemodeDuring }
  | { type: "done"; ok: false; error: ScriptErrorJson; during?: CodemodeDuring }
  | { type: "crash"; message: string }
  | { type: "started"; fingerprint: string }
  | { type: "idle"; seq: number; issued: number };

export type HostToWorkerMessage = {
  type: "result";
  id: number;
  ok: boolean;
  payload: string | undefined;
  seq?: number;
  now?: number;
  properties?: string;
};

export function isWorkerToHostMessage(value: unknown): value is WorkerToHostMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "call" ||
    type === "output" ||
    type === "done" ||
    type === "crash" ||
    type === "started" ||
    type === "idle"
  );
}

export function isHostToWorkerMessage(value: unknown): value is HostToWorkerMessage {
  return (
    typeof value === "object" && value !== null && (value as { type?: unknown }).type === "result"
  );
}
