import { defineTask } from "@msa/durable";
import { Effect } from "effect";

import effectSupport from "./effect-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { aborted } = taskSupport;

const Dormant = defineTask<null, { phase: "work" }, null>({
  abort: (_task, runtime, abortContext) =>
    Effect.runPromise(
      Effect.asVoid(
        Effect.suspend(() =>
          awaited(
            runtime.commit(
              () => ({ outcome: { status: "aborted" }, status: "terminal" }),
              abortContext,
            ),
          ),
        ),
      ),
    ),
  initial: () => ({ phase: "work" }),
  name: "test.dormant",
  phases: {
    work: (_task, runtime) =>
      Effect.runPromise(Effect.suspend(() => awaited(aborted(runtime.signal)))),
  },
  version: 1,
});

export default Dormant;
