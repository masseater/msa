import type { JSException } from "quickjs-wasi";

import type { VmStartData, WorkerToHostMessage } from "./launcher.ts";

export interface VirtualClock {
  creating: boolean;
  startedAt: number;
  now: number;
  seed: number;
}

export const virtualClock = (data: VmStartData): VirtualClock | undefined =>
  data.deterministic === undefined
    ? undefined
    : {
        creating: true,
        startedAt: data.deterministic.startedAt,
        now: data.deterministic.startedAt,
        seed: data.deterministic.seed >>> 0,
      };

type WasmMemory = { readonly buffer: ArrayBufferLike };

export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return (value ^ (value >>> 14)) >>> 0;
  };
}

export function discardOutput(memory: WasmMemory) {
  return {
    fd_write(_fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
      const view = new DataView(memory.buffer);
      let written = 0;
      for (let i = 0; i < iovsLen; i++) {
        written += view.getUint32(iovsPtr + i * 8 + 4, true);
      }
      view.setUint32(nwrittenPtr, written, true);
      return 0;
    },
  };
}

function clockReading(clock: VirtualClock, clockId: number): bigint {
  if (clock.creating) return clockId === 0 ? BigInt(clock.seed + 1) * 1000n : 0n;
  if (clockId === 0) return BigInt(Math.round(clock.now)) * 1_000_000n;
  return BigInt(Math.round(clock.now - clock.startedAt)) * 1_000_000n;
}

export function deterministicWasi(clock: VirtualClock) {
  const random = prng(clock.seed ^ 0x9e3779b9);
  return (memory: WasmMemory) => ({
    ...discardOutput(memory),
    clock_time_get(clockId: number, _precision: bigint, resultPtr: number): number {
      new DataView(memory.buffer).setBigUint64(resultPtr, clockReading(clock, clockId), true);
      return 0;
    },
    random_get(bufPtr: number, bufLen: number): number {
      const bytes = new Uint8Array(memory.buffer, bufPtr, bufLen);
      for (let index = 0; index < bufLen; index += 4) {
        const value = random();
        for (let byte = 0; byte < 4 && index + byte < bufLen; byte++)
          bytes[index + byte] = value >>> (byte * 8);
      }
      return 0;
    },
  });
}

export function describeException(error: JSException): string {
  const head = error.message === "" ? error.name : `${error.name}: ${error.message}`;
  const stack = error.stack?.trimEnd();
  return JSON.stringify({
    name: error.name,
    message: error.message,
    stack: stack === undefined || stack === "" ? head : `${head}\n${stack}`,
  });
}

export function crashMessage(error: unknown): WorkerToHostMessage {
  return {
    type: "crash",
    message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
}
