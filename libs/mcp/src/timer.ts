import { Effect } from "effect";
import { dual } from "effect/Function";

export const schedule: {
  (task: () => void): (millis: number) => () => void;
  (millis: number, task: () => void): () => void;
} = dual(2, (millis: number, task: () => void): (() => void) => {
  const fiber = Effect.runFork(Effect.sleep(millis).pipe(Effect.andThen(Effect.sync(task))));
  return () => fiber.interruptUnsafe();
});
