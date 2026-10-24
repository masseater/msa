import testing from "@msa/testing";
import { Clock, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, it } from "vite-plus/test";

import decideModule from "../src/core/decision/decide.ts";
import decideSupport from "./decide-support.ts";

const { runTest } = testing;
const { DECISION_TIMEOUT } = decideModule;
const { FIXTURE, blocking, classifierAt, cleanUp, loadedDecide, request } = decideSupport;

afterEach(() => runTest(cleanUp));

const isUndecidedWhenTheModelIsLate = () =>
  runTest(
    Effect.scoped(
      Effect.gen(function* () {
        const { decide, recorded } = yield* loadedDecide(classifierAt(FIXTURE));
        const clock = yield* TestClock.make();

        const fiber = yield* decide(
          request(`The build fails. ${"word ".repeat(3000)}`, { route: 0, severity: 0 }),
        ).pipe(Effect.provideService(Clock.Clock, clock), Effect.forkChild);
        yield* Effect.yieldNow;
        yield* clock.adjust(Duration.sum(DECISION_TIMEOUT, Duration.millis(1)));
        const decision = yield* Fiber.join(fiber);

        expect(decision).toEqual({
          reason: `no answer within ${Duration.format(DECISION_TIMEOUT)}`,
          status: "undecided",
        });
        expect(recorded.undecided).toHaveLength(1);
      }),
    ),
  );

const decidesRightAfterSlowInferencesTimeOut = () =>
  runTest(
    Effect.scoped(
      Effect.gen(function* () {
        const { decide } = yield* loadedDecide(classifierAt(FIXTURE));
        const warm = yield* decide(blocking(0.5));
        expect(warm.status).toBe("decided");
        const clock = yield* TestClock.make();
        const slow = (index: number) =>
          decide({ ...blocking(0.5), state: { ticket: `${index} ${"word ".repeat(3000)}` } }).pipe(
            Effect.provideService(Clock.Clock, clock),
            Effect.forkChild,
          );

        const fibers = yield* Effect.forEach(
          Array.from({ length: 12 }, (_, index) => index),
          slow,
        );
        yield* Effect.yieldNow;
        yield* clock.adjust(Duration.sum(DECISION_TIMEOUT, Duration.millis(1)));
        const late = yield* Effect.forEach(fibers, Fiber.join);
        const next = yield* decide({ ...blocking(0.5), state: { ticket: "The deploy fails." } });

        expect(late.map((decision) => decision.status)).toEqual(Array(12).fill("undecided"));
        expect(next.status).toBe("decided");
      }),
    ),
  );

describe("decide time limit", () => {
  it("is undecided when the model does not answer in time", isUndecidedWhenTheModelIsLate);

  it(
    "decides right after slow inferences time out, because they stop and release the model",
    decidesRightAfterSlowInferencesTimeOut,
    60_000,
  );
});
