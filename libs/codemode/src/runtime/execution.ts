import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import type {
  CodemodeCall,
  CodemodeDuring,
  CodemodeError,
  CodemodeOutcome,
  CodemodeOutputItem,
  CodemodeResult,
  CodemodeStoreWrites,
} from "../types.ts";
import {
  causeMessage,
  errorMessage,
  parseBridgeJson,
  parseScriptError,
  parseStoreWrites,
  stringifyJson,
} from "./bridge.ts";
import { BridgeError } from "./errors/bridge-error.ts";
import {
  type CallMessage,
  type Control,
  type DoneMessage,
  type ExecutionOptions,
  startData,
  type VmChannel,
  type VmEvents,
} from "./launcher.ts";
import { type HostToWorkerMessage, isWorkerToHostMessage } from "./protocol.ts";
import { schedule } from "./timer.ts";
import { invokeTool } from "./tool-call.ts";

interface PendingCall {
  record: CodemodeCall | undefined;
  startedAt: number;
  controller: AbortController;
}

const newCall = (name: string, isTool: boolean): CodemodeCall | undefined =>
  isTool ? { name, status: "cancelled", durationMs: 0 } : undefined;

export class Execution {
  private readonly result = Deferred.makeUnsafe<CodemodeResult>();
  readonly promise: Promise<CodemodeResult> = Effect.runPromise(this.result.pipe(Deferred.await));
  private channel: VmChannel | undefined;
  private unsent: HostToWorkerMessage[] = [];
  private readonly executors: ExecutionOptions["executors"];
  private readonly control: Control | undefined;
  private readonly delivered = new Set<number>();
  private readonly signal: AbortSignal | undefined;
  private cancelTimer: (() => void) | undefined;
  private readonly output: CodemodeOutputItem[] = [];
  private readonly calls: CodemodeCall[] = [];
  private readonly pending = new Map<number, PendingCall>();
  finished = false;

  constructor(options: ExecutionOptions) {
    this.executors = options.executors;
    this.control = options.control;
    this.signal = options.signal;
    if (Number.isFinite(options.timeoutMs)) {
      this.cancelTimer = schedule(options.timeoutMs, () =>
        this.finish({
          kind: "timeout",
          message: `Execution timed out after ${options.timeoutMs} ms`,
        }),
      );
    }
    if (options.signal?.aborted === true) this.onAbort();
    else options.signal?.addEventListener("abort", this.onAbort, { once: true });
    if (this.finished) return;
    const events: VmEvents = {
      message: (message) => this.receive(message),
      failure: (error) => this.finish(error),
    };
    Effect.runFork(
      options.launch(startData(options), events).pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          Exit.isSuccess(exit)
            ? this.attach(exit.value)
            : Effect.sync(() =>
                this.finish({ kind: "sandbox", message: causeMessage(exit.cause) }),
              ),
        ),
      ),
    );
  }

  deliver(seq: number, now: number, id: number, outcome: CodemodeOutcome): void {
    if (this.finished) return;
    if (!Number.isFinite(now))
      throw new Error(`The clock value of result ${seq} is not a finite number`);
    if (!Number.isInteger(seq) || seq < 1 || this.delivered.has(seq)) {
      throw new Error(`Result number ${seq} is not a positive integer used once`);
    }
    const pending = this.pending.get(id);
    if (pending === undefined) throw new Error(`Call ${id} is not waiting for a result`);
    const properties = outcome.ok ? undefined : outcome.properties;
    if (
      properties !== undefined &&
      (typeof properties !== "object" || properties === null || Array.isArray(properties))
    ) {
      throw new Error(`The properties of result ${seq} are not an object`);
    }
    const payload = outcome.ok ? stringifyJson(outcome.value) : outcome.message;
    const encoded = properties === undefined ? undefined : JSON.stringify(properties);
    this.delivered.add(seq);
    this.pending.delete(id);
    if (pending.record !== undefined) {
      pending.record.status = outcome.ok ? "ok" : "error";
      pending.record.durationMs = performance.now() - pending.startedAt;
    }
    this.post({
      type: "result",
      id,
      ok: outcome.ok,
      payload,
      seq,
      now,
      ...(encoded === undefined ? {} : { properties: encoded }),
    });
  }

  abort(message: string): Promise<CodemodeResult> {
    this.finish({ kind: "aborted", message });
    return this.promise;
  }

  private attach(channel: VmChannel): Effect.Effect<void> {
    if (this.finished) return channel.stop;
    return Effect.sync(() => {
      this.channel = channel;
      for (const message of this.unsent.splice(0)) channel.post(message);
    });
  }

  private readonly onAbort = (): void => {
    const reason: unknown = this.signal?.reason;
    this.finish({
      kind: "aborted",
      message: reason instanceof Error ? reason.message : "Execution aborted",
    });
  };

  private post(message: HostToWorkerMessage): void {
    if (this.channel === undefined) this.unsent.push(message);
    else this.channel.post(message);
  }

  private receive(message: unknown): void {
    try {
      this.handleMessage(message);
    } catch (error) {
      this.finish({
        kind: "sandbox",
        message:
          error instanceof BridgeError
            ? `Sandbox bridge broken: ${error.message}. The script may have modified built-ins such as a prototype's toJSON.`
            : `Sandbox host failed: ${errorMessage(error)}`,
      });
    }
  }

  private handleMessage(message: unknown): void {
    if (this.finished) return;
    if (!isWorkerToHostMessage(message)) throw new BridgeError("unknown message from the worker");
    switch (message.type) {
      case "output":
        this.output.push(message.item);
        break;
      case "call":
        if (this.pending.has(message.id)) throw new BridgeError(`duplicate call id ${message.id}`);
        if (this.control === undefined) this.handleCall(message);
        else this.forwardCall(message, this.control);
        break;
      case "started":
        this.control?.onStarted?.(message.fingerprint);
        break;
      case "idle":
        this.control?.onIdle?.(message.seq, message.issued);
        break;
      case "done":
        this.handleDone(message);
        break;
      case "crash":
        this.finish({ kind: "sandbox", message: message.message });
        break;
    }
  }

  private handleDone(message: DoneMessage): void {
    if (!message.ok) {
      this.finish(parseScriptError(message.error), undefined, undefined, message.during);
      return;
    }
    const value =
      message.value === undefined ? undefined : parseBridgeJson(message.value, "return value");
    this.finish(undefined, value, parseStoreWrites(message.writes), message.during);
  }

  private track(message: CallMessage): PendingCall {
    const record = newCall(message.name, message.target === "tool");
    if (record !== undefined) this.calls.push(record);
    const pending = { record, startedAt: performance.now(), controller: new AbortController() };
    this.pending.set(message.id, pending);
    return pending;
  }

  private forwardCall(message: CallMessage, control: Control): void {
    const { id, name, target } = message;
    const args =
      message.args === undefined ? undefined : parseBridgeJson(message.args, "call arguments");
    this.track(message);
    control.onCall({ id, target, name, args });
  }

  private handleCall(message: CallMessage): void {
    const pending = this.track(message);
    Effect.runFork(
      invokeTool(this.executors, message, pending.controller.signal).pipe(
        Effect.match({
          onSuccess: (payload) => ({ ok: true, payload }),
          onFailure: (error) => ({ ok: false, payload: error.message }),
        }),
        Effect.map(({ ok, payload }) => this.reply(message.id, pending, ok, payload)),
      ),
    );
  }

  private reply(id: number, pending: PendingCall, ok: boolean, payload: string | undefined): void {
    if (!this.pending.delete(id)) return;
    if (pending.record !== undefined) {
      pending.record.status = ok ? "ok" : "error";
      pending.record.durationMs = performance.now() - pending.startedAt;
    }
    this.post({ type: "result", id, ok, payload });
  }

  private settle(result: CodemodeResult): void {
    const channel = this.channel;
    if (channel === undefined) {
      Deferred.doneUnsafe(this.result, Exit.succeed(result));
      return;
    }
    Effect.runFork(channel.stop.pipe(Effect.andThen(Deferred.succeed(this.result, result))));
  }

  private finish(
    error: CodemodeError | undefined,
    value?: unknown,
    writes?: CodemodeStoreWrites,
    during?: CodemodeDuring,
  ): void {
    if (this.finished) return;
    this.finished = true;
    this.cancelTimer?.();
    this.signal?.removeEventListener("abort", this.onAbort);
    const now = performance.now();
    for (const pending of this.pending.values()) {
      if (pending.record !== undefined) pending.record.durationMs = now - pending.startedAt;
      pending.controller.abort();
    }
    this.pending.clear();
    this.unsent = [];
    const ended =
      during === undefined ? {} : { during: { seq: during.seq, issued: during.issued } };
    this.settle(
      error === undefined
        ? {
            ok: true,
            value,
            output: this.output,
            calls: this.calls,
            storeWrites: writes ?? { set: {}, delete: [] },
            ...ended,
          }
        : { ok: false, error, output: this.output, calls: this.calls, ...ended },
    );
  }
}
