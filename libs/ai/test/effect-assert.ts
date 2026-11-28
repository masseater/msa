import { Cause, Effect, Exit, Function } from "effect";
import { expect } from "vite-plus/test";

const defectOf = <A, R>(effect: Effect.Effect<A, never, R>): Effect.Effect<unknown, never, R> =>
  Effect.flatMap(Effect.exit(effect), (exit) =>
    Exit.isFailure(exit)
      ? exit.cause.pipe(Cause.squash, Effect.succeed)
      : Effect.die(new Error("expected the effect to fail")),
  );

const expectDefect: {
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

const effectAssert = {
  defectOf,
  expectDefect,
};

export default effectAssert;
