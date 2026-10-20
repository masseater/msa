import { Cause, Effect, Exit } from "effect";
import { dual } from "effect/Function";

import type hostDisposeTypes from "./host-dispose.types.ts";
import type objectTypes from "./object.types.ts";
import schemaModule from "./schema.ts";

const { deepEqual } = schemaModule;

const heldBy = (object: objectTypes.ObjectImpl): Set<objectTypes.ObjectImpl> => {
  const result = new Set<objectTypes.ObjectImpl>();
  for (const decls of object.allDecls()) {
    for (const ref of decls.refs.values()) if (ref.object !== undefined) result.add(ref.object);
  }
  return result;
};

const disposeHoldersFirst = ({
  objects,
  reason,
  message,
}: hostDisposeTypes.Disposal): Effect.Effect<void> =>
  Effect.gen(function* () {
    const remaining = new Set(objects);
    const refs = new Map(objects.map((object) => [object, heldBy(object)] as const));
    const errors: unknown[] = [];
    while (remaining.size > 0) {
      const heldByRemaining = new Set<objectTypes.ObjectImpl>();
      for (const object of remaining)
        for (const target of refs.get(object) ?? []) heldByRemaining.add(target);
      let wave = [...remaining].filter((object) => !heldByRemaining.has(object));
      if (wave.length === 0) wave = [...remaining];
      for (const object of wave) remaining.delete(object);
      const exits = yield* Effect.forEach(
        wave,
        (object) => Effect.exit(Effect.promise(() => object.dispose(true, reason))),
        { concurrency: "unbounded" },
      );
      for (const exit of exits) if (Exit.isFailure(exit)) errors.push(Cause.squash(exit.cause));
    }
    if (errors.length === 1) return yield* Effect.die(errors[0]);
    if (errors.length > 1) return yield* Effect.die(new AggregateError(errors, message));
  });

const matchesPattern: {
  (principal: unknown): (pattern: Readonly<Record<string, unknown>>) => boolean;
  (pattern: Readonly<Record<string, unknown>>, principal: unknown): boolean;
} = dual(
  2,
  (pattern: Readonly<Record<string, unknown>>, principal: unknown): boolean =>
    principal !== null &&
    typeof principal === "object" &&
    Object.entries(pattern).every(([key, value]) =>
      deepEqual((principal as Record<string, unknown>)[key], value),
    ),
);

const hostDispose = {
  disposeHoldersFirst,
  matchesPattern,
};

export default hostDispose;
