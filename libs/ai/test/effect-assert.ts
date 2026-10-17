import { Cause, Effect, Exit, Function } from "effect";
import { expect } from "vite-plus/test";

export const defectOf = <A, R>(
  effect: Effect.Effect<A, never, R>,
): Effect.Effect<unknown, never, R> =>
  Effect.flatMap(Effect.exit(effect), (exit) =>
    Exit.isFailure(exit)
      ? Effect.succeed(Cause.squash(exit.cause))
      : Effect.die(new Error("expected the effect to fail")),
  );

export const expectDefect: {
  (message: string): <A, R>(effect: Effect.Effect<A, never, R>) => Effect.Effect<void, never, R>;
  <A, R>(effect: Effect.Effect<A, never, R>, message: string): Effect.Effect<void, never, R>;
} = Function.dual(
  2,
  <A, R>(effect: Effect.Effect<A, never, R>, message: string): Effect.Effect<void, never, R> =>
    Effect.map(defectOf(effect), (defect) => {
      expect(defect).toBeInstanceOf(Error);
      expect((defect as Error).message).toContain(message);
    }),
);
