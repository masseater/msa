import { dual } from "effect/Function";
import { JSException, type JSValueHandle, type QuickJS } from "quickjs-wasi";

import preludeSource from "./prelude-source.ts";
import type protocolTypes from "./protocol.ts";
import type vmSessionTypes from "./vm-session.types.ts";
import vmWasi from "./vm-wasi.ts";

const { deterministicWasi, discardOutput, fnv1a } = vmWasi;

const { PRELUDE_SOURCE } = preludeSource;
type QuickJSExports = ReturnType<QuickJS["_getExports"]>;
type Handle = JSValueHandle | undefined;
type Handles = Record<"api" | "settle" | "run" | "stalled", JSValueHandle>;

interface Controller {
  readonly vm: QuickJS;
  readonly options: protocolTypes.VmControllerOptions;
  readonly clock: vmSessionTypes.VirtualClock | undefined;
  readonly exports: QuickJSExports;
  readonly early: Map<number, protocolTypes.HostToWorkerMessage>;
  handles: Handles | undefined;
  disposed: boolean;
  issued: number;
  nextSeq: number;
  current: number;
}

const DETERMINISTIC_VERSION = 1;
const JOBS_PER_POLL = 50;

const PRELUDE_HASH = fnv1a(PRELUDE_SOURCE);

function describeException(error: JSException): string {
  const head = error.message === "" ? error.name : `${error.name}: ${error.message}`;
  const stack = error.stack?.trimEnd();
  return JSON.stringify({
    message: error.message,
    name: error.name,
    stack: stack === undefined || stack === "" ? head : `${head}\n${stack}`,
  });
}

function crashMessage(error: unknown): protocolTypes.WorkerToHostMessage {
  return {
    message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    type: "crash",
  };
}

function isHostToWorkerMessage(value: unknown): value is protocolTypes.HostToWorkerMessage {
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

function apply(c: Controller, message: protocolTypes.HostToWorkerMessage): void {
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

function deliverInOrder(
  c: Controller,
  message: protocolTypes.HostToWorkerMessage,
  clock: vmSessionTypes.VirtualClock,
): void {
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
    c.options.post({ issued: c.issued, seq: c.nextSeq, type: "idle" });
    c.nextSeq++;
  }
}

function onDone(c: Controller, a: JSValueHandle, b: Handle, d: Handle): void {
  const during = c.clock === undefined ? {} : { during: { issued: c.issued, seq: c.current } };
  if (a.toBoolean()) {
    const writes = (d as JSValueHandle).toString();
    c.options.post({ ok: true, type: "done", value: optionalString(b), writes, ...during });
  } else {
    c.options.post({ error: (b as JSValueHandle).toString(), ok: false, type: "done", ...during });
  }
}

function onBridge(c: Controller, kind: string, a: JSValueHandle, b: JSValueHandle, d: Handle) {
  const { post } = c.options;
  if (kind === "call" || kind === "global") {
    c.issued++;
    const target = kind === "call" ? "tool" : "global";
    post({ args: optionalString(d), id: a.toNumber(), name: b.toString(), target, type: "call" });
  } else if (kind === "output") {
    const channel = a.toString();
    post({
      item:
        channel === "image"
          ? { data: b.toString(), mimeType: (d as JSValueHandle).toString(), type: "image" }
          : channel === "console"
            ? { console: true, text: b.toString(), type: "text" }
            : { text: b.toString(), type: "text" },
      type: "output",
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
  return { api, run, settle, stalled: api.getProp("stalled") };
}

function reportFingerprint(c: Controller): void {
  const { versions } = c.vm;
  const { data, maxStackSize, interruptBudget } = c.options;
  c.options.post({
    fingerprint: `quickjs-wasi ${versions["quickjs-wasi"]}, quickjs ${versions["quickjs"]}, prelude ${PRELUDE_HASH}, deterministic ${DETERMINISTIC_VERSION}, stack ${maxStackSize}, heap ${data.memoryLimitBytes ?? "none"}, budget ${interruptBudget ?? "none"}`,
    type: "started",
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
    c.options.post({ error: describeException(error), ok: false, type: "done" });
    return;
  }
  c.vm.callFunction(handles.run, handles.api, fn).dispose();
  fn.dispose();
  drain(c);
  if (c.clock !== undefined) c.options.post({ issued: c.issued, seq: 0, type: "idle" });
}

const bootVm: {
  (
    options: protocolTypes.VmControllerOptions,
    clock: vmSessionTypes.VirtualClock | undefined,
  ): (vm: QuickJS) => protocolTypes.VmSession;
  (
    vm: QuickJS,
    options: protocolTypes.VmControllerOptions,
    clock: vmSessionTypes.VirtualClock | undefined,
  ): protocolTypes.VmSession;
} = dual(
  3,
  (
    vm: QuickJS,
    options: protocolTypes.VmControllerOptions,
    clock: vmSessionTypes.VirtualClock | undefined,
  ): protocolTypes.VmSession => {
    const c: Controller = {
      clock,
      current: 0,
      disposed: false,
      early: new Map(),
      exports: vm["_getExports"](),
      handles: undefined,
      issued: 0,
      nextSeq: 1,
      options,
      vm,
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

const vmSession = {
  bootVm,
  crashMessage,
  deterministicWasi,
  discardOutput,
  fnv1a,
  isHostToWorkerMessage,
};

export default vmSession;
