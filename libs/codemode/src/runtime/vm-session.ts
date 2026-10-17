import { dual } from "effect/Function";
import { JSException, type JSValueHandle, type QuickJS } from "quickjs-wasi";

import { PRELUDE_SOURCE } from "./prelude-source.ts";
import type {
  HostToWorkerMessage,
  VmControllerOptions,
  VmSession,
  WorkerToHostMessage,
} from "./protocol.ts";

export interface VirtualClock {
  creating: boolean;
  startedAt: number;
  now: number;
  seed: number;
}

type WasmMemory = { readonly buffer: ArrayBufferLike };
type QuickJSExports = ReturnType<QuickJS["_getExports"]>;
type Handle = JSValueHandle | undefined;
type Handles = Record<"api" | "settle" | "run" | "stalled", JSValueHandle>;

interface Controller {
  readonly vm: QuickJS;
  readonly options: VmControllerOptions;
  readonly clock: VirtualClock | undefined;
  readonly exports: QuickJSExports;
  readonly early: Map<number, HostToWorkerMessage>;
  handles: Handles | undefined;
  disposed: boolean;
  issued: number;
  nextSeq: number;
  current: number;
}

const DETERMINISTIC_VERSION = 1;
const JOBS_PER_POLL = 50;

export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const PRELUDE_HASH = fnv1a(PRELUDE_SOURCE);

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

function describeException(error: JSException): string {
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

export function isHostToWorkerMessage(value: unknown): value is HostToWorkerMessage {
  return (
    typeof value === "object" && value !== null && (value as { type?: unknown }).type === "result"
  );
}

const optionalString = (handle: Handle): string | undefined =>
  handle === undefined || handle.isUndefined ? undefined : handle.toString();

function handlesOf(c: Controller): Handles {
  if (c.handles === undefined) throw new Error("The VM prelude is not loaded");
  return c.handles;
}

function drain(c: Controller): void {
  const { api, stalled } = handlesOf(c);
  let jobs = 0;
  while (c.exports.qjs_is_job_pending() !== 0) {
    if (c.exports.qjs_execute_pending_job() < 0) throw new Error("Promise job failed");
    if (++jobs % JOBS_PER_POLL === 0 && c.options.shouldInterrupt())
      throw new Error("Execution interrupted");
  }
  c.vm.callFunction(stalled, api).dispose();
}

function apply(c: Controller, message: HostToWorkerMessage): void {
  const { api, settle } = handlesOf(c);
  const { vm } = c;
  vm.withScope(() => {
    vm.callFunction(
      settle,
      api,
      vm.newNumber(message.id),
      message.ok ? vm.true : vm.false,
      message.payload === undefined ? vm.undefined : vm.newString(message.payload),
      message.properties === undefined ? vm.undefined : vm.newString(message.properties),
    );
  });
  drain(c);
}

function deliverInOrder(c: Controller, message: HostToWorkerMessage, clock: VirtualClock): void {
  const { seq } = message;
  if (seq === undefined || !Number.isInteger(seq) || seq < c.nextSeq || c.early.has(seq)) {
    throw new Error(
      `Result ${message.id} has sequence number ${seq}, expected ${c.nextSeq} or later, once`,
    );
  }
  c.early.set(seq, message);
  for (let next = c.early.get(c.nextSeq); next !== undefined; next = c.early.get(c.nextSeq)) {
    c.early.delete(c.nextSeq);
    if (next.now !== undefined && Number.isFinite(next.now))
      clock.now = Math.max(clock.now, next.now);
    c.current = c.nextSeq;
    apply(c, next);
    c.options.post({ type: "idle", seq: c.nextSeq, issued: c.issued });
    c.nextSeq++;
  }
}

function onDone(c: Controller, a: JSValueHandle, b: Handle, d: Handle): void {
  const during = c.clock === undefined ? {} : { during: { seq: c.current, issued: c.issued } };
  if (a.toBoolean()) {
    const writes = (d as JSValueHandle).toString();
    c.options.post({ type: "done", ok: true, value: optionalString(b), writes, ...during });
  } else {
    c.options.post({ type: "done", ok: false, error: (b as JSValueHandle).toString(), ...during });
  }
}

function onBridge(c: Controller, kind: string, a: JSValueHandle, b: JSValueHandle, d: Handle) {
  const { post } = c.options;
  if (kind === "call" || kind === "global") {
    c.issued++;
    const target = kind === "call" ? "tool" : "global";
    post({ type: "call", id: a.toNumber(), target, name: b.toString(), args: optionalString(d) });
  } else if (kind === "output") {
    const channel = a.toString();
    post({
      type: "output",
      item:
        channel === "image"
          ? { type: "image", data: b.toString(), mimeType: (d as JSValueHandle).toString() }
          : channel === "console"
            ? { type: "text", text: b.toString(), console: true }
            : { type: "text", text: b.toString() },
    });
  } else if (kind === "done") onDone(c, a, b, d);
}

function loadPrelude(c: Controller): Handles {
  const { vm } = c;
  const { data } = c.options;
  const bridge = vm.newFunction("bridge", (kind, a, b, d) => {
    onBridge(c, kind.toString(), a, b, d);
    return vm.undefined;
  });
  const api = vm.withScope((scope) =>
    scope.escape(
      vm.callFunction(
        vm.evalCode(PRELUDE_SOURCE, "codemode-prelude.js"),
        vm.undefined,
        bridge,
        vm.newString(JSON.stringify(data.tools)),
        vm.newString(JSON.stringify(data.globals)),
        vm.newString(JSON.stringify(data.store)),
      ),
    ),
  );
  const settle = api.getProp("settle");
  const run = api.getProp("run");
  return { api, settle, run, stalled: api.getProp("stalled") };
}

function reportFingerprint(c: Controller): void {
  const { versions } = c.vm;
  const { data, maxStackSize, interruptBudget } = c.options;
  c.options.post({
    type: "started",
    fingerprint: `quickjs-wasi ${versions["quickjs-wasi"]}, quickjs ${versions["quickjs"]}, prelude ${PRELUDE_HASH}, deterministic ${DETERMINISTIC_VERSION}, stack ${maxStackSize}, heap ${data.memoryLimitBytes ?? "none"}, budget ${interruptBudget ?? "none"}`,
  });
}

function runScript(c: Controller): void {
  const handles = loadPrelude(c);
  c.handles = handles;
  if (c.clock !== undefined) reportFingerprint(c);
  let fn: JSValueHandle;
  try {
    fn = c.vm.evalCode(`(async (tools, console) => {${c.options.data.code}\n})`, "codemode.js");
  } catch (error) {
    if (!(error instanceof JSException)) throw error;
    c.options.post({ type: "done", ok: false, error: describeException(error) });
    return;
  }
  c.vm.callFunction(handles.run, handles.api, fn).dispose();
  fn.dispose();
  drain(c);
  if (c.clock !== undefined) c.options.post({ type: "idle", seq: 0, issued: c.issued });
}

export const bootVm: {
  (options: VmControllerOptions, clock: VirtualClock | undefined): (vm: QuickJS) => VmSession;
  (vm: QuickJS, options: VmControllerOptions, clock: VirtualClock | undefined): VmSession;
} = dual(
  3,
  (vm: QuickJS, options: VmControllerOptions, clock: VirtualClock | undefined): VmSession => {
    const c: Controller = {
      vm,
      options,
      clock,
      exports: vm["_getExports"](),
      early: new Map(),
      handles: undefined,
      disposed: false,
      issued: 0,
      nextSeq: 1,
      current: 0,
    };
    try {
      runScript(c);
    } catch (error) {
      options.post(crashMessage(error));
    }
    return {
      deliver: (message) => {
        if (c.disposed) return;
        try {
          if (c.clock === undefined) apply(c, message);
          else deliverInOrder(c, message, c.clock);
        } catch (error) {
          options.post(crashMessage(error));
        }
      },
      dispose: () => {
        if (c.disposed) return;
        c.disposed = true;
        vm.dispose();
      },
    };
  },
);
