import type { CodemodeDuring, CodemodeOutputItem } from "../types.ts";
import type { CodemodeWasmModule } from "../wasm.ts";

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
