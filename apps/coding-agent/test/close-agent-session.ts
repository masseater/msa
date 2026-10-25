import testing from "@msa/testing";
import { Effect, Exit } from "effect";

import type AgentSession from "../src/core/agent-session.ts";
import runnerEvents from "../src/core/extensions/runner-events.ts";

const { emitSessionShutdownEvent } = runnerEvents;
const { awaited } = testing;

const closeAgentSession = (session: AgentSession): Promise<void> =>
  emitSessionShutdownEvent(session.extensions.binding.extensionRunner, {
    reason: "quit",
    type: "session_shutdown",
  }).then(
    () => session.dispose(),
    (error: unknown) => session.dispose().then(() => Promise.reject(error)),
  );

const cleanupAll = (harnesses: { cleanup: () => Promise<void> }[]): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exits: Exit.Exit<void>[] = [];
      for (const harness of harnesses.splice(0)) {
        const closing = harness.cleanup();
        exits.push(yield* Effect.exit(awaited(closing)));
      }
      const failed = exits.find(Exit.isFailure);
      if (failed !== undefined) return yield* Effect.failCause(failed.cause);
    }),
  );

const closeAgentSessionModule = { cleanupAll, closeAgentSession };

export default closeAgentSessionModule;
