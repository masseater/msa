import { Cause, Effect } from "effect";
import type { TSchema } from "typebox";

import type { RefCore } from "./core.ts";
import { Decls, type Run } from "./decls.ts";
import { asChordError, ChordError, runAll } from "./errors.ts";
import type { ObjectImpl } from "./object.ts";
import { memberSchemas, type Service } from "./service.ts";
import type { Readable } from "./types.ts";

const noop = (): void => {};

export class ObjectLifecycle {
  readonly #object: ObjectImpl;

  constructor(object: ObjectImpl) {
    this.#object = object;
  }

  start(after: Promise<void> | undefined): Effect.Effect<void> {
    const object = this.#object;
    return this.#activate(after).pipe(
      Effect.matchCauseEffect({
        onSuccess: () =>
          Effect.sync(() => {
            for (const ref of object.refs) ref.live();
            object.maybeIdle();
          }),
        onFailure: (cause) => {
          if (object.status === "activating") object.status = "failed";
          object.host.forget(object);
          const error = asChordError(Cause.squash(cause), `activating ${object.address}`);
          for (const ref of object.refs) ref.gone(error);
          return Effect.die(error);
        },
      }),
    );
  }

  #activate(after: Promise<void> | undefined): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const object = this.#object;
      yield* Effect.promise(() => Promise.resolve(after?.catch(noop)));
      const signal = object.activationAbort.signal;
      if (signal.aborted) throw this.#abandoned();
      const service = object.host.service(object.typeName);
      if (service === undefined)
        throw new ChordError("unavailable", `${object.typeName} is not served`, {
          reason: "unknown_type",
        });
      object.service = service;
      const run = object.activation.run(service, undefined);
      yield* this.#install(run, service, signal).pipe(
        Effect.catchCause((cause) =>
          this.#fail(run, Cause.squash(cause)).pipe(Effect.andThen(Effect.failCause(cause))),
        ),
        Effect.ensuring(Effect.sync(() => object.pending.delete(run.decls))),
      );
    });
  }

  #abandoned(): ChordError {
    return new ChordError("aborted", `${this.#object.address} abandoned`);
  }

  #install(run: Run, service: Service, signal: AbortSignal): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const object = this.#object;
      yield* object.activation.open(run.created.resources, run.created.refs, signal);
      if (signal.aborted) throw this.#abandoned();
      yield* object.activation.waitHydrated(run);
      if (signal.aborted) throw this.#abandoned();
      yield* object.activation.initCells(run, signal);
      if (signal.aborted) throw this.#abandoned();
      this.#commit(run, service);
      if (signal.aborted) throw this.#abandoned();
      object.status = "live";
    });
  }

  #commit(run: Run, service: Service): void {
    const object = this.#object;
    const host = object.host;
    host.checkRegistrations(object, run.decls);
    object.decls = run.decls;
    for (const [retained, services] of host.retainedCodeVersions()) {
      if (services.get(object.typeName) === service) {
        object.implementations.set(retained, {
          codeVersion: retained,
          service,
          implementation: run.implementation,
          decls: run.decls,
        });
      }
    }
    const pending = host.pendingCodeVersion();
    if (
      !object.implementations.has(host.currentCodeVersion()) &&
      (pending === undefined || !object.implementations.has(pending))
    ) {
      throw new ChordError("superseded", `${object.address}: code changed during activation`);
    }
    for (const derived of run.created.derives) derived.attach();
    this.refreshSchemas();
    object.deferredRuntime = !object.implementations.has(host.currentCodeVersion());
    if (!object.deferredRuntime) {
      if (run.decls.registrations.size > 0) host.registriesChanged(object);
      object.startRuntime();
    }
  }

  #fail(run: Run, error: unknown): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const object = this.#object;
      object.callAbort.abort(error);
      object.listeners.stop();
      object.tasks.stop();
      const registered = object.decls.registrations.size > 0 && !object.deferredRuntime;
      object.implementations.clear();
      object.decls = new Decls();
      if (registered) object.host.registriesChanged();
      yield* Effect.promise(() =>
        Promise.allSettled([...object.invocations, ...object.tasks.stopped]),
      );
      yield* object.activation
        .unwind(run)
        .pipe(
          Effect.catchCause((cause) => Effect.sync(() => object.host.report(Cause.squash(cause)))),
        );
    });
  }

  dispose(forced: boolean, reason: unknown): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const object = this.#object;
      const wasActivating = object.status === "activating";
      object.status = "disposing";
      object.host.forget(object);
      object.clearLinger();
      const error = reason ?? new ChordError("gone", `${object.address} was disposed`);
      if (forced) {
        for (const ref of object.refs) ref.gone(error);
        object.callAbort.abort(error);
      }
      object.activationAbort.abort(error);
      if (wasActivating) yield* Effect.promise(() => object.ready.catch(noop));
      for (const ref of object.refs) ref.gone(error);
      const decls = object.allDecls();
      object.tasks.stop();
      object.listeners.stop();
      yield* Effect.promise(() => Promise.allSettled([...object.invocations]));
      yield* this.#release(decls).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            object.status = "disposed";
            object.host.disposed(object);
          }),
        ),
      );
    });
  }

  #release(decls: ReadonlySet<Decls>): Effect.Effect<void> {
    return Effect.suspend(() => {
      const object = this.#object;
      const registered =
        [...decls].some((set) => set.registrations.size > 0) && !object.deferredRuntime;
      object.implementations.clear();
      object.decls = new Decls();
      if (registered) object.host.registriesChanged();
      const refs = new Set<RefCore>();
      for (const set of decls) {
        for (const derived of set.derives.values()) derived.detach();
        for (const ref of set.refs.values()) refs.add(ref);
      }
      const order = object.activation.openOrder;
      return runAll(
        [
          Effect.promise(() => Promise.allSettled([...object.tasks.stopped])),
          ...[...order].reverse().map((resource) => resource.close(order)),
          ...[...refs].map((ref) => Effect.sync(() => ref.release())),
        ],
        `${object.address}: disposal failed`,
      );
    });
  }

  refreshSchemas(): void {
    const object = this.#object;
    const schemas = new Map<Readable<unknown>, TSchema[]>();
    for (const installed of object.implementations.values()) {
      for (const [source, list] of memberSchemas(installed.service, installed.implementation)) {
        schemas.set(source, [...(schemas.get(source) ?? []), ...list]);
      }
    }
    for (const decls of object.allDecls()) {
      for (const source of [...decls.cells.values(), ...decls.derives.values()])
        source.schemas = schemas.get(source) ?? [];
    }
  }
}
