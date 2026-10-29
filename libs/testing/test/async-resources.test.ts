import { Effect, Fiber } from "effect";
import { expect, it } from "vite-plus/test";

import testing from "../src/index.ts";

const { runNodeScript, runTest, trackChildProcesses } = testing;

const nextImmediate = Effect.callback<void>((resume) => {
  setImmediate(() => resume(Effect.void));
});

it("reports a child process as running from its spawn until its handle closes", () =>
  runTest(
    Effect.gen(function* () {
      const children = trackChildProcesses();
      expect(children.running()).toBe(false);
      const child = yield* Effect.forkDetach(
        runNodeScript("await new Promise((resolve) => setTimeout(resolve, 200));", {}),
      );
      while (!children.running()) yield* nextImmediate;
      expect(child.pollUnsafe()).toBeUndefined();
      yield* Fiber.join(child);
      while (children.running()) yield* nextImmediate;
      expect(children.running()).toBe(false);
    }),
  ));
