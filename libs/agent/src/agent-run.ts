import { Effect } from "effect";

import type agentRunTypes from "./agent-run.types.ts";
import AgentRuns from "./agent-runs.ts";
import callModule from "./call.ts";

const { call } = callModule;

const busy = (message: string): Effect.Effect<never> => Effect.die(new Error(message));

const notifyListeners = ({
  listeners,
  event,
  signal,
}: agentRunTypes.ListenerNotice): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (signal === undefined) {
      return yield* Effect.die(new Error("Agent listener invoked outside active run"));
    }
    for (const listener of listeners) {
      yield* call(() => listener(event, signal));
    }
  });

const finalizeEndMessage = ({
  event,
  finalize,
  signal,
}: agentRunTypes.EndMessageFinalization): Effect.Effect<void> => {
  if (finalize === undefined || signal === undefined) return Effect.void;
  return call(() => finalize(event.message, signal)).pipe(
    Effect.map((message) => {
      event.message = message ?? event.message;
      return undefined;
    }),
  );
};

const agentRun = {
  AgentRuns,
  busy,
  finalizeEndMessage,
  notifyListeners,
};

export default agentRun;
