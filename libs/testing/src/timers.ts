import { AsyncResource, createHook } from "node:async_hooks";

import { Effect, type Exit, Fiber } from "effect";

import type timersTypes from "./timers.types.ts";

type RefCheckable = { readonly hasRef: () => boolean };

const isRefCheckable = (resource: object): resource is RefCheckable =>
  "hasRef" in resource && typeof resource.hasRef === "function";

const nextImmediate: Effect.Effect<void> = Effect.callback<void>((resume) => {
  setImmediate(() => resume(Effect.void));
});

const runInScope = <A, E, R>(
  root: AsyncResource,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<Exit.Exit<A, E>, never, R> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<R>();
      const fiber = root.runInAsyncScope(() => Effect.runForkWith(context)(effect));
      return yield* restore(Fiber.await(fiber)).pipe(
        Effect.onInterrupt(() => Fiber.interrupt(fiber)),
      );
    }),
  );

const timersArmedBy = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<readonly [A, timersTypes.TimersArmed], E, R> =>
  Effect.gen(function* () {
    const root = new AsyncResource("TimersArmedBy");
    const lineage = new Set([root.asyncId()]);
    const live = new Map<number, RefCheckable | undefined>();
    const run = { armed: 0, tracking: true };
    const hook = createHook({
      destroy: (id) => {
        live.delete(id);
      },
      init: (id, type, trigger, resource) => {
        if (!run.tracking || !lineage.has(trigger)) return;
        lineage.add(id);
        if (type !== "Timeout") return;
        run.armed += 1;
        live.set(id, isRefCheckable(resource) ? resource : undefined);
      },
    });
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => hook.enable()),
      () =>
        runInScope(root, effect).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              run.tracking = false;
            }),
          ),
          Effect.flatMap((exit) => exit),
          Effect.tap(() => nextImmediate),
          Effect.map((value) => {
            const holding = [...live.values()].filter((timer) => timer?.hasRef() ?? true).length;
            return [value, { armed: run.armed, holding }] as const;
          }),
        ),
      () =>
        Effect.sync(() => {
          hook.disable();
          root.emitDestroy();
        }),
    );
  });

const timers = { timersArmedBy };

export default timers;
