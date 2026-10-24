import { Console, Effect, Option } from "effect";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import crossProviderHandoffSupport from "./cross-provider-handoff-support.ts";

const { currentTimeMillis } = clock;

const { completeOrReport, generateFixture, handoffTargets, isAuthorized } =
  crossProviderHandoffSupport;

const authorizedTargets = handoffTargets.filter((target) => isAuthorized(target.model));
const fixtures = new Map<string, typesModule.Message[]>();

const generateFixtures = () =>
  Effect.runPromise(
    Effect.forEach(authorizedTargets, (target) =>
      generateFixture(target).pipe(
        Effect.tap((fixture) =>
          Option.match(fixture, {
            onNone: () => Console.log(`[${target.label}] Failed to generate fixture, skipping`),
            onSome: (messages) => Effect.sync(() => fixtures.set(target.label, messages)),
          }),
        ),
      ),
    ),
  );

const confirmation: typesModule.Message = {
  content:
    "Great, thanks for all that help! Now just say 'Hello, handoff successful!' to confirm you received everything.",
  role: "user",
  timestamp: currentTimeMillis(),
};

const handsOffToEveryTarget = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const failures = yield* Effect.filter(
        authorizedTargets.filter((target) => fixtures.has(target.label)),
        (target) => {
          const others = [...fixtures].flatMap(([label, messages]) =>
            label === target.label ? [] : messages,
          );
          return completeOrReport(
            target,
            target.label,
            [...others, confirmation],
            "You are a helpful assistant.",
          ).pipe(Effect.map(Option.isNone));
        },
      );
      expect(failures.map((target) => target.label)).toEqual([]);
    }),
  );

describe.skipIf(authorizedTargets.length === 0)("Cross-Provider Handoff", () => {
  beforeAll(generateFixtures, 300000);

  it("should have at least 2 fixtures to test handoffs", () => {
    expect(fixtures.size).toBeGreaterThanOrEqual(2);
  });
  it("should handle cross-provider handoffs for each target", handsOffToEveryTarget, 600000);
});
