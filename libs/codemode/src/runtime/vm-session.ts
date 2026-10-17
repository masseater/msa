import { JSException, type JSValueHandle, type QuickJS } from "quickjs-wasi";

import { PRELUDE_SOURCE } from "./prelude-source.ts";
import type { HostToWorkerMessage, VmStartData, WorkerToHostMessage } from "./protocol.ts";
import { crashMessage, describeException, fnv1a, type VirtualClock } from "./vm-wasi.ts";

export interface VmSession {
  deliver(message: HostToWorkerMessage): void;
  dispose(): void;
}

export interface VmControllerOptions {
  data: VmStartData;
  maxStackSize: number;
  interruptBudget: number | undefined;
  post(message: WorkerToHostMessage): void;
  shouldInterrupt(): boolean;
}

interface PreludeHandles {
  api: JSValueHandle;
  settle: JSValueHandle;
  run: JSValueHandle;
  stalled: JSValueHandle;
}

const DETERMINISTIC_VERSION = 1;
type QuickJSExports = ReturnType<QuickJS["_getExports"]>;

const quickJsExports = (vm: QuickJS): QuickJSExports => vm["_getExports"]();

const JOBS_PER_POLL = 50;
const PRELUDE_HASH = fnv1a(PRELUDE_SOURCE);

type Handle = JSValueHandle | undefined;

const optionalString = (handle: Handle): string | undefined =>
  handle === undefined || handle.isUndefined ? undefined : handle.toString();

export class VmController implements VmSession {
  private disposed = false;
  private issued = 0;
  private nextSeq = 1;
  private current = 0;
  private readonly early = new Map<number, HostToWorkerMessage>();
  private handles: PreludeHandles | undefined;
  private readonly exports: QuickJSExports;

  private readonly vm: QuickJS;
  private readonly options: VmControllerOptions;
  private readonly clock: VirtualClock | undefined;

  constructor(vm: QuickJS, options: VmControllerOptions, clock: VirtualClock | undefined) {
    this.vm = vm;
    this.options = options;
    this.clock = clock;
    this.exports = quickJsExports(vm);
  }

  deliver(message: HostToWorkerMessage): void {
    if (this.disposed) return;
    try {
      if (this.clock === undefined) this.apply(message);
      else this.deliverInOrder(message, this.clock);
    } catch (error) {
      this.options.post(crashMessage(error));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.vm.dispose();
  }

  boot(): VmSession {
    try {
      this.handles = this.loadPrelude();
      if (this.clock !== undefined) this.reportFingerprint();
      let fn: JSValueHandle;
      try {
        fn = this.vm.evalCode(
          `(async (tools, console) => {${this.options.data.code}\n})`,
          "codemode.js",
        );
      } catch (error) {
        if (!(error instanceof JSException)) throw error;
        this.options.post({ type: "done", ok: false, error: describeException(error) });
        return this;
      }
      this.vm.callFunction(this.handles.run, this.handles.api, fn).dispose();
      fn.dispose();
      this.drain();
      if (this.clock !== undefined)
        this.options.post({ type: "idle", seq: 0, issued: this.issued });
    } catch (error) {
      this.options.post(crashMessage(error));
    }
    return this;
  }

  private deliverInOrder(message: HostToWorkerMessage, clock: VirtualClock): void {
    const { seq } = message;
    if (seq === undefined || !Number.isInteger(seq) || seq < this.nextSeq || this.early.has(seq)) {
      throw new Error(
        `Result ${message.id} has sequence number ${seq}, expected ${this.nextSeq} or later, once`,
      );
    }
    this.early.set(seq, message);
    for (
      let next = this.early.get(this.nextSeq);
      next !== undefined;
      next = this.early.get(this.nextSeq)
    ) {
      this.early.delete(this.nextSeq);
      if (next.now !== undefined && Number.isFinite(next.now))
        clock.now = Math.max(clock.now, next.now);
      this.current = this.nextSeq;
      this.apply(next);
      this.options.post({ type: "idle", seq: this.nextSeq, issued: this.issued });
      this.nextSeq++;
    }
  }

  private prelude(): PreludeHandles {
    if (this.handles === undefined) throw new Error("The VM prelude is not loaded");
    return this.handles;
  }

  private apply(message: HostToWorkerMessage): void {
    const { api, settle } = this.prelude();
    const { vm } = this;
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
    this.drain();
  }

  private drain(): void {
    const { api, stalled } = this.prelude();
    let jobs = 0;
    while (this.exports.qjs_is_job_pending() !== 0) {
      if (this.exports.qjs_execute_pending_job() < 0) throw new Error("Promise job failed");
      if (++jobs % JOBS_PER_POLL === 0 && this.options.shouldInterrupt())
        throw new Error("Execution interrupted");
    }
    this.vm.callFunction(stalled, api).dispose();
  }

  private onBridge(kind: string, a: JSValueHandle, b: JSValueHandle, c: Handle): void {
    const { post } = this.options;
    if (kind === "call" || kind === "global") {
      this.issued++;
      post({
        type: "call",
        id: a.toNumber(),
        target: kind === "call" ? "tool" : "global",
        name: b.toString(),
        args: optionalString(c),
      });
    } else if (kind === "output") {
      const channel = a.toString();
      post({
        type: "output",
        item:
          channel === "image"
            ? { type: "image", data: b.toString(), mimeType: (c as JSValueHandle).toString() }
            : channel === "console"
              ? { type: "text", text: b.toString(), console: true }
              : { type: "text", text: b.toString() },
      });
    } else if (kind === "done") this.onDone(a, b, c);
  }

  private onDone(a: JSValueHandle, b: Handle, c: Handle): void {
    const during =
      this.clock === undefined ? {} : { during: { seq: this.current, issued: this.issued } };
    if (a.toBoolean()) {
      this.options.post({
        type: "done",
        ok: true,
        value: optionalString(b),
        writes: (c as JSValueHandle).toString(),
        ...during,
      });
    } else {
      this.options.post({
        type: "done",
        ok: false,
        error: (b as JSValueHandle).toString(),
        ...during,
      });
    }
  }

  private loadPrelude(): PreludeHandles {
    const { vm } = this;
    const { data } = this.options;
    const bridge = vm.newFunction("bridge", (kind, a, b, c) => {
      this.onBridge(kind.toString(), a, b, c);
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

  private reportFingerprint(): void {
    const { versions } = this.vm;
    const { data, maxStackSize, interruptBudget } = this.options;
    this.options.post({
      type: "started",
      fingerprint: `quickjs-wasi ${versions["quickjs-wasi"]}, quickjs ${versions["quickjs"]}, prelude ${PRELUDE_HASH}, deterministic ${DETERMINISTIC_VERSION}, stack ${maxStackSize}, heap ${data.memoryLimitBytes ?? "none"}, budget ${interruptBudget ?? "none"}`,
    });
  }
}
