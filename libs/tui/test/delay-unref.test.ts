import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import delay from "../src/delay.ts";

const { runAfter, runAfterUnref, runEveryUnref } = delay;

const timersHoldingTheProcess = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

const settle = Effect.repeat(Effect.yieldNow, { times: 3 });

const waitMillis = (millis: number): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const cancel = runAfter(millis, () => {
      resume(Effect.void);
    });
    return Effect.sync(cancel);
  });

const pendingDelaysLeaveTheProcessFreeToExit = Effect.gen(function* () {
  const before = timersHoldingTheProcess();
  const cancelAfter = runAfterUnref(60_000, () => undefined);
  const cancelEvery = runEveryUnref(60_000, () => undefined);
  yield* settle;
  const pending = timersHoldingTheProcess();
  cancelAfter();
  cancelEvery();
  assert.strictEqual(pending, before);
});

const delaysStillFire = Effect.gen(function* () {
  const fired: string[] = [];
  runAfterUnref(5, () => fired.push("after"));
  const cancelEvery = runEveryUnref(5, () => fired.push("every"));
  yield* waitMillis(40);
  cancelEvery();
  assert.ok(fired.includes("after"));
  assert.ok(fired.filter((name) => name === "every").length > 1);
});

describe("unref delays", () => {
  it("leave the process free to exit while they are pending", () =>
    Effect.runPromise(pendingDelaysLeaveTheProcessFreeToExit));

  it("still fire once and on every interval", () => Effect.runPromise(delaysStillFire));
});
