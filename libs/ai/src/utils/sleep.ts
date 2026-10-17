import { Effect, Function } from "effect";

import { sleepUnlessAborted } from "./abort.ts";

export const sleep: {
  (signal: AbortSignal): (ms: number) => Promise<void>;
  (ms: number, signal: AbortSignal): Promise<void>;
} = Function.dual(2, (ms: number, signal: AbortSignal): Promise<void> =>
  Effect.runPromise(sleepUnlessAborted(ms, signal, (aborted) => aborted.reason)),
);
