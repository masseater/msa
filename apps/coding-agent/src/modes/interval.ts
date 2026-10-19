import { Effect } from "effect";
import { dual } from "effect/Function";

import type { Scheduled } from "../core/platform.ts";

export const every: {
  (periodMs: number): (run: () => void) => Scheduled;
  (run: () => void, periodMs: number): Scheduled;
} = dual(2, (run: () => void, periodMs: number): Scheduled => {
  const fiber = Effect.runFork(
    Effect.forever(Effect.andThen(Effect.sleep(periodMs), Effect.sync(run))),
  );
  return {
    cancel: () => {
      fiber.interruptUnsafe();
    },
  };
});
