import type { CodemodeError } from "../types.ts";
import type { CodemodeWasmModule } from "../wasm.ts";
import type { HostToWorkerMessage, VmStartData, WorkerToHostMessage } from "./launcher.ts";

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
