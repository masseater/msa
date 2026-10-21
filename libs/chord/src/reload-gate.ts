import { Cause, Effect } from "effect";

import errorsModule from "./errors.ts";
import type reloadTypes from "./reload.types.ts";

const { ChordError } = errorsModule;

const unaborted = (): AbortSignal => new AbortController().signal;

export default class ReloadGate {
  readonly #reload: reloadTypes.Reload;

  constructor(reload: reloadTypes.Reload) {
    this.#reload = reload;
  }

  gate(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const reload = this.#reload;
      reload.gated = [...reload.candidates.values()].filter(
        (candidate) => candidate.reasons.length > 0 && candidate.object.status === "live",
      );
      const deadline = reload.options.gateDeadline ?? 5000;
      const timedOut = yield* Effect.forEach(
        reload.gated,
        ({ object }) =>
          Effect.callback<void>((resume) => {
            const grandfathered = new Set(object.leases.keys());
            object.gate = { drained: () => resume(Effect.void), grandfathered, queue: [] };
            object.tasks.stop();
            if (grandfathered.size === 0) resume(Effect.void);
          }),
        { concurrency: "unbounded", discard: true },
      ).pipe(
        Effect.as(false),
        Effect.timeoutOrElse({ duration: deadline, orElse: () => Effect.succeed(true) }),
      );
      if (timedOut) {
        const blocking = reload.gated.flatMap(({ object }) => [
          ...(object.gate?.grandfathered ?? []),
        ]);
        throw new ChordError(
          "aborted",
          `gate deadline (${deadline} ms) missed; blocking roots: ${blocking.join(", ")}`,
          { details: { blocking }, reason: "gate_deadline" },
        );
      }
      reload.alive();
      for (const candidate of reload.gated) {
        const { object } = candidate;
        for (const old of candidate.replaced) {
          reload.closed.push([object, old]);
          yield* old.close(object.activation.openOrder);
        }
        yield* object.activation.open(candidate.atGate, [], reload.abort.signal);
        reload.alive();
        yield* object.activation.initCells(candidate.run, reload.abort.signal);
        reload.alive();
      }
      for (const candidate of reload.gated) reload.preparer.migrate(candidate);
    });
  }

  rollback(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const reload = this.#reload;
      if (reload.rolledBack) return;
      reload.rolledBack = true;
      reload.abort.abort(new ChordError("aborted", "reload aborted"));
      for (const run of reload.facetRuns.values())
        run.abort(new ChordError("aborted", "reload aborted"));
      const host = reload.host;
      const report = (cause: Cause.Cause<unknown>): Effect.Effect<void> =>
        Effect.sync(() => host.report(Cause.squash(cause)));
      for (const candidate of reload.candidates.values()) candidate.staged?.discard();
      for (const staged of reload.deferred.values()) staged.discard();
      for (const { object, run } of reload.candidates.values()) {
        object.pending.delete(run.decls);
        yield* object.activation.unwind(run).pipe(Effect.catchCause(report));
      }
      yield* this.#restore();
      for (const { object } of reload.gated) {
        if (object.gate === undefined) continue;
        object.openGate();
        object.startTasks();
      }
      const reason = new ChordError("gone", "reload aborted; type not served");
      for (const object of [...host.objects.values()]) {
        if (!host.current.services.has(object.typeName))
          yield* Effect.promise(() =>
            object.dispose(true, reason).catch((error: unknown) => host.report(error)),
          );
      }
      host.pending = undefined;
      host.gating = undefined;
    });
  }

  #restore(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const reload = this.#reload;
      for (const [object, resource] of reload.closed) {
        if (resource.state !== "closed") continue;
        yield* resource.open(unaborted(), object.activation.openOrder).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              resource.markUnavailable();
              reload.host.report(
                new ChordError(
                  "unavailable",
                  `${object.address}: resource ${resource.key} could not be restored`,
                  { cause: Cause.squash(cause) },
                ),
              );
            }),
          ),
        );
      }
    });
  }
}
