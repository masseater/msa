import { Effect, Function } from "effect";

import abort from "./abort.ts";

const { sleepUnlessAborted } = abort;

const sleep: {
  (signal: AbortSignal): (ms: number) => Promise<void>;
  (ms: number, signal: AbortSignal): Promise<void>;
} = Function.dual(2, (ms: number, signal: AbortSignal): Promise<void> =>
  Effect.runPromise(sleepUnlessAborted(ms, signal, (aborted) => aborted.reason)),
);

const sleepModule = {
  sleep,
};

export default sleepModule;
