import { Effect, Fiber } from "effect";
import { expect, it } from "vite-plus/test";

import childProcesses from "../src/child-processes.ts";
import testing from "../src/index.ts";

const { childProcessesRunning } = childProcesses;
const { failure, pollUntil, runNodeScript, runTest } = testing;

const nextImmediate = Effect.callback<void>((resume) => {
  setImmediate(() => resume(Effect.void));
});

const slowChild = Effect.gen(function* () {
  const child = yield* Effect.forkDetach(
    runNodeScript("await new Promise((resolve) => setTimeout(resolve, 300));", {}),
  );
  yield* pollUntil(Effect.sync(childProcessesRunning), 1000, nextImmediate);
  return child;
});

it("reports a child process as running from its spawn until its handle closes", () =>
  runTest(
    Effect.gen(function* () {
      expect(childProcessesRunning()).toBe(false);
      const child = yield* slowChild;
      expect(childProcessesRunning()).toBe(true);
      yield* Fiber.join(child);
      yield* pollUntil(
        Effect.sync(() => !childProcessesRunning()),
        1000,
        nextImmediate,
      );
      expect(childProcessesRunning()).toBe(false);
    }),
  ));

it("keeps waiting past its attempts while a child process runs", () =>
  runTest(
    Effect.gen(function* () {
      const child = yield* slowChild;
      yield* pollUntil(
        Effect.sync(() => child.pollUnsafe() !== undefined),
        3,
        "1 millis",
      );
      expect(child.pollUnsafe()).toBeDefined();
    }),
  ));

it("fails once its attempts run out with no child process running", () =>
  runTest(
    Effect.gen(function* () {
      let checks = 0;
      const cause = yield* failure(
        pollUntil(
          Effect.sync(() => {
            checks++;
            return false;
          }),
          3,
          nextImmediate,
        ),
      );
      expect(String(cause)).toContain("Condition was not reached");
      expect(checks).toBe(4);
    }),
  ));
