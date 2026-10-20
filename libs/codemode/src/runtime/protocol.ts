import type * as Deferred from "effect/Deferred";
import type * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";

import type typesModule from "../types.ts";
import type bridgeTypes from "./bridge.types.ts";

declare namespace protocolTypes {
  interface VmEvents {
    message(message: unknown): void;
    failure(error: typesModule.CodemodeError): void;
  }

  interface VmChannel {
    post(message: HostToWorkerMessage): void;
    readonly stop: Effect.Effect<void>;
  }

  type VmLauncher = (
    data: VmStartData,
    events: VmEvents,
  ) => Effect.Effect<VmChannel, bridgeTypes.RuntimeError>;

  type Control = { [K in "onStarted" | "onCall" | "onIdle"]: typesModule.CodemodeRunOptions[K] };

  type CallMessage = Extract<WorkerToHostMessage, { type: "call" }>;

  type DoneMessage = Extract<WorkerToHostMessage, { type: "done" }>;

  type Executors = ExecutionOptions["executors"];

  interface ExecutionOptions {
    code: string;
    tools: readonly typesModule.CodemodeDeclaredTool[];
    globals: readonly typesModule.CodemodeDeclaredGlobal[];
    executors: {
      tools: ReadonlyMap<string, typesModule.CodemodeTool>;
      globals: ReadonlyMap<string, typesModule.CodemodeTool>;
    };
    timeoutMs: number;
    signal: AbortSignal | undefined;
    memoryLimitBytes: number | undefined;
    store: Record<string, string>;
    deterministic?: { startedAt: number; seed: number };
    control?: Control;
    launch: VmLauncher;
  }

  interface VmStartData {
    code: string;
    tools: { name: string; jsName: string; description: string }[];
    globals: { name: string; spread: boolean }[];
    memoryLimitBytes: number | undefined;
    store: Record<string, string>;
    timeoutMs?: number;
    deterministic?: { startedAt: number; seed: number };
  }

  interface WorkerData extends VmStartData {
    wasm: typesModule.CodemodeWasmModule;
    interrupt: SharedArrayBuffer;
  }

  type ScriptErrorJson = string;

  type WorkerToHostMessage =
    | {
        type: "call";
        id: number;
        target: "tool" | "global";
        name: string;
        args: string | undefined;
      }
    | { type: "output"; item: typesModule.CodemodeOutputItem }
    | {
        type: "done";
        ok: true;
        value: string | undefined;
        writes: string;
        during?: typesModule.CodemodeDuring;
      }
    | { type: "done"; ok: false; error: ScriptErrorJson; during?: typesModule.CodemodeDuring }
    | { type: "crash"; message: string }
    | { type: "started"; fingerprint: string }
    | { type: "idle"; seq: number; issued: number };

  type HostToWorkerMessage = {
    type: "result";
    id: number;
    ok: boolean;
    payload: string | undefined;
    seq?: number;
    now?: number;
    properties?: string;
  };

  interface VmSession {
    deliver(message: HostToWorkerMessage): void;
    dispose(): void;
  }

  interface StartVmOptions {
    data: VmStartData;
    wasm: typesModule.CodemodeWasmModule;
    maxStackSize?: number;
    interruptBudget?: number;
    post(message: WorkerToHostMessage): void;
    shouldInterrupt(): boolean;
  }

  interface VmControllerOptions {
    data: VmStartData;
    maxStackSize: number;
    interruptBudget: number | undefined;
    post(message: WorkerToHostMessage): void;
    shouldInterrupt(): boolean;
  }

  interface InlineCodemodeSandboxOptions extends typesModule.CodemodeSandboxBaseOptions {
    wasm: typesModule.CodemodeWasmModule | Promise<typesModule.CodemodeWasmModule>;
    interruptBudget?: number;
  }

  interface InlineLauncherOptions {
    wasm: typesModule.CodemodeWasmModule | Promise<typesModule.CodemodeWasmModule>;
    interruptBudget?: number | undefined;
  }

  interface CodemodeRemoteRequest {
    data: VmStartData;
    interruptBudget?: number;
  }

  type CodemodeRemoteMessage =
    | WorkerToHostMessage
    | { type: "failure"; error: typesModule.CodemodeError };

  type CodemodeRemoteReply = HostToWorkerMessage | { type: "stop" } | null;

  type CodemodeRemoteExchange = (messages: CodemodeRemoteMessage[]) => Promise<CodemodeRemoteReply>;

  interface CodemodeRemote {
    execute(request: CodemodeRemoteRequest, exchange: CodemodeRemoteExchange): Promise<void>;
  }

  interface CodemodeServeOptions {
    wasm: typesModule.CodemodeWasmModule | Promise<typesModule.CodemodeWasmModule>;
    maxInterruptBudget?: number;
    maxMemoryLimitBytes?: number;
  }

  interface RemoteCodemodeSandboxOptions extends typesModule.CodemodeSandboxBaseOptions {
    remote: () => CodemodeRemote;
    interruptBudget?: number;
  }

  interface PendingCall {
    record: typesModule.CodemodeCall | undefined;
    startedAt: number;
    controller: AbortController;
  }

  interface Execution {
    readonly options: ExecutionOptions;
    readonly result: Deferred.Deferred<typesModule.CodemodeResult>;
    readonly promise: Promise<typesModule.CodemodeResult>;
    readonly delivered: Set<number>;
    readonly output: typesModule.CodemodeOutputItem[];
    readonly calls: typesModule.CodemodeCall[];
    readonly pending: Map<number, PendingCall>;
    readonly onAbort: () => void;
    channel: VmChannel | undefined;
    unsent: HostToWorkerMessage[];
    timer: Fiber.Fiber<void> | undefined;
    finished: boolean;
  }
}

export type { protocolTypes as default };
