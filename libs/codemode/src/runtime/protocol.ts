import type * as Deferred from "effect/Deferred";
import type * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";

import type {
  CodemodeCall,
  CodemodeDeclaredGlobal,
  CodemodeDeclaredTool,
  CodemodeDuring,
  CodemodeError,
  CodemodeOutputItem,
  CodemodeResult,
  CodemodeRunOptions,
  CodemodeSandboxBaseOptions,
  CodemodeTool,
  CodemodeWasmModule,
} from "../types.ts";
import type { RuntimeError } from "./bridge.ts";

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
) => Effect.Effect<VmChannel, RuntimeError>;

export type Control = { [K in "onStarted" | "onCall" | "onIdle"]: CodemodeRunOptions[K] };
export type CallMessage = Extract<WorkerToHostMessage, { type: "call" }>;
export type DoneMessage = Extract<WorkerToHostMessage, { type: "done" }>;
export type Executors = ExecutionOptions["executors"];

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

export interface VmSession {
  deliver(message: HostToWorkerMessage): void;
  dispose(): void;
}

export interface StartVmOptions {
  data: VmStartData;
  wasm: CodemodeWasmModule;
  maxStackSize?: number;
  interruptBudget?: number;
  post(message: WorkerToHostMessage): void;
  shouldInterrupt(): boolean;
}

export interface VmControllerOptions {
  data: VmStartData;
  maxStackSize: number;
  interruptBudget: number | undefined;
  post(message: WorkerToHostMessage): void;
  shouldInterrupt(): boolean;
}

export interface InlineCodemodeSandboxOptions extends CodemodeSandboxBaseOptions {
  wasm: CodemodeWasmModule | Promise<CodemodeWasmModule>;
  interruptBudget?: number;
}

export interface InlineLauncherOptions {
  wasm: CodemodeWasmModule | Promise<CodemodeWasmModule>;
  interruptBudget?: number | undefined;
}

export interface CodemodeRemoteRequest {
  data: VmStartData;
  interruptBudget?: number;
}

export type CodemodeRemoteMessage = WorkerToHostMessage | { type: "failure"; error: CodemodeError };

export type CodemodeRemoteReply = HostToWorkerMessage | { type: "stop" } | null;

export type CodemodeRemoteExchange = (
  messages: CodemodeRemoteMessage[],
) => Promise<CodemodeRemoteReply>;

export interface CodemodeRemote {
  execute(request: CodemodeRemoteRequest, exchange: CodemodeRemoteExchange): Promise<void>;
}

export interface CodemodeServeOptions {
  wasm: CodemodeWasmModule | Promise<CodemodeWasmModule>;
  maxInterruptBudget?: number;
  maxMemoryLimitBytes?: number;
}

export interface RemoteCodemodeSandboxOptions extends CodemodeSandboxBaseOptions {
  remote: () => CodemodeRemote;
  interruptBudget?: number;
}

export interface PendingCall {
  record: CodemodeCall | undefined;
  startedAt: number;
  controller: AbortController;
}

export interface Execution {
  readonly options: ExecutionOptions;
  readonly result: Deferred.Deferred<CodemodeResult>;
  readonly promise: Promise<CodemodeResult>;
  readonly delivered: Set<number>;
  readonly output: CodemodeOutputItem[];
  readonly calls: CodemodeCall[];
  readonly pending: Map<number, PendingCall>;
  readonly onAbort: () => void;
  channel: VmChannel | undefined;
  unsent: HostToWorkerMessage[];
  timer: Fiber.Fiber<void> | undefined;
  finished: boolean;
}
