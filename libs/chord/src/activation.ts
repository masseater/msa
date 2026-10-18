import { Cause, Duration, Effect, Exit } from "effect";

import { hydrationOf, unhydrated } from "./cell.ts";
import type { RefCore } from "./core.ts";
import type { Decls, Run } from "./decls.ts";
import { ChordError, invalid, runAll } from "./errors.ts";
import type { ObjectImpl } from "./object.ts";
import { ResourceImpl } from "./resource.ts";
import { SelfImpl } from "./self.ts";
import { type Service, validateImplementation } from "./service.ts";

const settleAll = (effects: readonly Effect.Effect<unknown>[]): Effect.Effect<void> =>
  Effect.gen(function* () {
    const exits = yield* Effect.forEach(effects, Effect.exit, { concurrency: "unbounded" });
    const failure = exits.find(Exit.isFailure);
    if (failure !== undefined) yield* failure;
  });

export class ObjectActivation {
  readonly openOrder: ResourceImpl[] = [];
  readonly #object: ObjectImpl;

  constructor(object: ObjectImpl) {
    this.#object = object;
  }

  run(service: Service, previous: Decls | undefined): Run {
    const object = this.#object;
    const self = new SelfImpl(object, previous);
    object.pending.add(self.run(undefined).decls);
    object.host.inFactory += 1;
    let implementation: unknown;
    try {
      implementation = service.factory(object.input, object.principal, self);
    } catch (error) {
      object.host.inFactory -= 1;
      this.#discard(self.run(undefined));
      throw error;
    }
    object.host.inFactory -= 1;
    const run = self.run(implementation);
    try {
      if (implementation instanceof Promise)
        throw invalid("implementation", `${object.typeName}: factories must be synchronous`);
      validateImplementation(service, run.implementation);
    } catch (error) {
      this.#discard(run);
      throw error;
    }
    return run;
  }

  #discard(run: Run): void {
    const object = this.#object;
    object.pending.delete(run.decls);
    Effect.runFork(
      this.unwind(run).pipe(
        Effect.catchCause((cause) => Effect.sync(() => object.host.report(Cause.squash(cause)))),
      ),
    );
  }

  withinReadyTimeout<T>(work: Promise<T>, waiting: () => readonly string[]): Effect.Effect<T> {
    const object = this.#object;
    const ms = object.host.readyTimeout;
    const settled = Effect.promise(() => work);
    if (!Number.isFinite(ms)) return settled;
    const timedOut = Effect.flatMap(Effect.sleep(Duration.millis(ms)), () => {
      const list = waiting();
      return Effect.die(
        new ChordError(
          "unavailable",
          `${object.address} was not ready after ${ms} ms${list.length === 0 ? "" : `, waiting on ${list.join(", ")}`} (a reference cycle across hosts?)`,
          { reason: "ready_timeout" },
        ),
      );
    });
    return Effect.raceFirst(settled, timedOut);
  }

  open(
    resources: readonly ResourceImpl[],
    refs: readonly RefCore[],
    signal: AbortSignal,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const opening = new Map<ResourceImpl, Effect.Effect<void>>();
      const openDep = (dep: RefCore | ResourceImpl): Effect.Effect<unknown> =>
        dep instanceof ResourceImpl
          ? Effect.suspend(() => opening.get(dep) ?? Effect.void)
          : Effect.promise(() => dep.ready);
      for (const resource of resources) {
        const open = Effect.forEach(resource.deps, openDep, { concurrency: "unbounded" }).pipe(
          Effect.andThen(resource.open(signal, this.openOrder)),
        );
        opening.set(resource, yield* Effect.cached(open));
      }
      const ready = this.withinReadyTimeout(Promise.all(refs.map((ref) => ref.ready)), () =>
        refs.filter((ref) => ref.status === "loading").map((ref) => ref.address),
      );
      yield* settleAll([...resources.map((resource) => opening.get(resource)!), ready]);
    });
  }

  waitHydrated(run: Run): Effect.Effect<void> {
    const address = this.#object.address;
    const exposed = Object.entries(run.implementation ?? {});
    const pending = unhydrated([...run.created.derives, ...exposed.map(([, value]) => value)]);
    if (pending.length === 0) return Effect.void;
    return this.withinReadyTimeout(
      Promise.all(pending.map((hydration) => hydration.whenHydrated())),
      () => [
        ...exposed
          .filter(([, value]) => hydrationOf(value)?.hydrated === false)
          .map(([name]) => `${address}.${name}`),
        ...run.created.derives
          .filter((derived) => hydrationOf(derived) !== undefined)
          .map((derived) => `derive ${derived.key}`),
      ],
    ).pipe(Effect.asVoid);
  }

  initCells(run: Run, signal: AbortSignal): Effect.Effect<void> {
    const host = this.#object.host;
    if (run.created.inits.length === 0) return Effect.void;
    return settleAll(
      run.created.inits.map(([cell, init]) =>
        Effect.promise(() => host.root((ctx) => init(ctx), { signal })).pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              if (!signal.aborted) cell.initialize(value);
            }),
          ),
        ),
      ),
    );
  }

  unwind(run: Run): Effect.Effect<void> {
    return Effect.suspend(() => {
      for (const derived of run.created.derives) derived.detach();
      const resources = [...run.created.resources].sort(
        (a, b) => this.openOrder.indexOf(b) - this.openOrder.indexOf(a),
      );
      return runAll(
        [
          ...resources.map((resource) => resource.close(this.openOrder)),
          ...run.created.refs.map((ref) => Effect.sync(() => ref.release())),
        ],
        `${this.#object.address}: cleanup failed`,
      );
    });
  }
}
