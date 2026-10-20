import { Effect } from "effect";

import ObjectActivation from "./activation.ts";
import ObjectCalls from "./call.ts";
import type coreTypes from "./core.types.ts";
import declsModule from "./decls.ts";
import type declsTypes from "./decls.types.ts";
import ObjectLifecycle from "./lifecycle.ts";
import ObjectListeners from "./object-listeners.ts";
import ObjectTasks from "./object-tasks.ts";
import type refTypes from "./ref.types.ts";

const { Decls } = declsModule;

const noop = (): void => {};

export default class ObjectImpl {
  readonly host: coreTypes.HostCore;
  readonly address: string;
  readonly typeName: string;
  readonly input: unknown;
  readonly principal: unknown;
  readonly hostLifetime: boolean;
  status: coreTypes.ObjectStatus = "activating";
  ready: Promise<void> = Promise.resolve();
  service: ReturnType<coreTypes.HostCore["service"]>;
  minCodeVersion = 0;
  decls = new Decls();
  readonly pending = new Set<declsTypes.Decls>();
  readonly implementations = new Map<number, coreTypes.Installed>();
  readonly refs = new Set<refTypes.RefImpl>();
  readonly leases = new Map<string, number>();
  readonly callAbort = new AbortController();
  readonly activationAbort = new AbortController();
  gate: coreTypes.Gate | undefined;
  deferredRuntime = false;
  readonly invocations = new Set<Promise<unknown>>();
  readonly activation = new ObjectActivation(this);
  readonly lifecycle = new ObjectLifecycle(this);
  readonly calls = new ObjectCalls(this);
  readonly listeners = new ObjectListeners(this);
  readonly tasks = new ObjectTasks(this);
  #linger: (() => void) | undefined;
  #disposal: Promise<void> | undefined;

  constructor(host: coreTypes.HostCore, identity: coreTypes.ObjectIdentity) {
    this.host = host;
    this.address = identity.address;
    this.typeName = identity.typeName;
    this.input = identity.input;
    this.principal = identity.principal;
    this.hostLifetime = identity.hostLifetime;
  }

  start(after: Promise<void> | undefined): void {
    this.ready = Effect.runPromise(this.lifecycle.start(after));
    this.ready.catch(noop);
  }

  currentInstalled(): coreTypes.Installed | undefined {
    return (
      this.implementations.get(this.host.currentCodeVersion()) ??
      [...this.implementations.values()].at(-1)
    );
  }

  allDecls(): Set<declsTypes.Decls> {
    const result = new Set<declsTypes.Decls>([this.decls, ...this.pending]);
    for (const installed of this.implementations.values()) result.add(installed.decls);
    return result;
  }

  startRuntime(): void {
    this.listeners.stage(this.decls).activate();
    this.startTasks();
  }

  startTasks(): void {
    this.tasks.start();
  }

  openGate(): void {
    const gate = this.gate;
    this.gate = undefined;
    for (const { key, event } of gate?.queue ?? []) this.listeners.deliver(key, event);
  }

  rootEnded(rootId: string): void {
    this.leases.delete(rootId);
    const gate = this.gate;
    if (gate?.grandfathered.delete(rootId) === true && gate.grandfathered.size === 0)
      gate.drained();
  }

  addRef(ref: refTypes.RefImpl): void {
    this.refs.add(ref);
    this.clearLinger();
  }

  release(ref: refTypes.RefImpl): void {
    if (this.refs.delete(ref)) this.maybeIdle();
  }

  clearLinger(): void {
    this.#linger?.();
    this.#linger = undefined;
  }

  maybeIdle(): void {
    if (this.refs.size > 0 || this.invocations.size > 0 || this.#linger !== undefined) return;
    if (this.status === "activating") {
      this.#background(this.dispose(false));
      return;
    }
    if (this.status !== "live") return;
    const linger = this.service?.options.linger ?? 0;
    if (linger <= 0) {
      this.#background(this.dispose(false));
      return;
    }
    this.#linger = this.host.timers.after(linger, () => {
      this.#linger = undefined;
      if (this.refs.size === 0 && this.invocations.size === 0 && this.status === "live") {
        this.#background(this.dispose(false));
      }
    });
  }

  #background(disposal: Promise<void>): void {
    disposal.catch((error: unknown) => this.host.report(error));
  }

  dispose(forced: boolean, reason?: unknown): Promise<void> {
    this.#disposal ??= Effect.runPromise(this.lifecycle.dispose(forced, reason));
    return this.#disposal;
  }
}
