import { Effect } from "effect";
import { dual } from "effect/Function";

import type platformTypes from "../core/platform/index.types.ts";

const every: {
  (periodMs: number): (run: () => void) => platformTypes.Scheduled;
  (run: () => void, periodMs: number): platformTypes.Scheduled;
} = dual(2, (run: () => void, periodMs: number): platformTypes.Scheduled => {
  const fiber = Effect.sleep(periodMs).pipe(
    Effect.andThen(Effect.sync(run)),
    Effect.forever,
    Effect.runFork,
  );
  return {
    cancel: () => {
      fiber.interruptUnsafe();
    },
  };
});

const interval = {
  every,
};

export default interval;
