import type AgentSession from "../src/core/agent-session.ts";
import runnerEvents from "../src/core/extensions/runner-events.ts";

const { emitSessionShutdownEvent } = runnerEvents;

const closeAgentSession = (session: AgentSession): Promise<void> =>
  emitSessionShutdownEvent(session.extensions.binding.extensionRunner, {
    reason: "quit",
    type: "session_shutdown",
  }).then(
    () => session.dispose(),
    (error: unknown) => session.dispose().then(() => Promise.reject(error)),
  );

const cleanupAll = (harnesses: { cleanup: () => Promise<void> }[]): Promise<void> =>
  Promise.all(harnesses.splice(0).map((harness) => harness.cleanup())).then(() => undefined);

const closeAgentSessionModule = { cleanupAll, closeAgentSession };

export default closeAgentSessionModule;
