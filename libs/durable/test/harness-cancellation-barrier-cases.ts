import { defineTask } from "@msa/durable";
import { Effect } from "effect";

import { awaited } from "./effect-support.ts";
import { aborted } from "./task-support.ts";

export const Dormant = defineTask<null, { phase: "work" }, null>({
  name: "test.dormant",
  version: 1,
  initial: () => ({ phase: "work" }),
  phases: {
    work: (_task, runtime) =>
      Effect.runPromise(Effect.suspend(() => awaited(aborted(runtime.signal)))),
  },
  abort: (_task, runtime, abortContext) =>
    Effect.runPromise(
      Effect.asVoid(
        Effect.suspend(() =>
          awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "aborted" } }),
              abortContext,
            ),
          ),
        ),
      ),
    ),
});
