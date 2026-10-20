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

const agentRun = {
  AgentRuns,
  busy,
  notifyListeners,
};

export default agentRun;
