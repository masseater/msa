import testing from "@msa/testing";
import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vite-plus/test";

import httpSupport from "../src/transports/http-support.ts";

const { sleepUnlessAborted } = httpSupport;

const { abortController } = testing;

const timersHoldingTheProcess = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

const settle = Effect.repeat(Effect.yieldNow, { times: 3 });

const aPendingBackoffLeavesTheProcessFreeToExit = Effect.gen(function* () {
  const before = timersHoldingTheProcess();
  const waiting = yield* Effect.forkDetach(sleepUnlessAborted(60_000, abortController().signal));
  yield* settle;
  const pending = timersHoldingTheProcess();
  yield* Fiber.interrupt(waiting);
  expect(pending).toBe(before);
});

const theBackoffEndsOnTimeOrOnAbort = Effect.gen(function* () {
  expect(yield* sleepUnlessAborted(5, abortController().signal)).toBe(true);
  const controller = abortController();
  const waiting = yield* Effect.forkDetach(sleepUnlessAborted(60_000, controller.signal));
  controller.abort();
  expect(yield* Fiber.join(waiting)).toBe(false);
});

describe("sleepUnlessAborted", () => {
  it("leaves the process free to exit while the backoff is pending", () =>
    Effect.runPromise(aPendingBackoffLeavesTheProcessFreeToExit));

  it("resolves true when the time passes and false when aborted", () =>
    Effect.runPromise(theBackoffEndsOnTimeOrOnAbort));
});
