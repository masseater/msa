import { Effect } from "effect";
import { dual } from "effect/Function";

import type platformTypes from "../core/platform.types.ts";

const every: {
  (periodMs: number): (run: () => void) => platformTypes.Scheduled;
  (run: () => void, periodMs: number): platformTypes.Scheduled;
} = dual(2, (run: () => void, periodMs: number): platformTypes.Scheduled => {
  const fiber = Effect.runFork(
    Effect.forever(Effect.andThen(Effect.sleep(periodMs), Effect.sync(run))),
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
