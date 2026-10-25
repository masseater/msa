import testing from "@msa/testing";
import { Effect } from "effect";

import type agentSessionTypes from "../../src/core/agent-session.types.ts";
import type sessionManagerTypes from "../../src/core/session-manager.types.ts";
import closeAgentSessionModule from "../close-agent-session.ts";
import type sessionTypesModule from "./session-types.ts";

const { closeAgentSession } = closeAgentSessionModule;
const { removePath } = testing;

const harnessOf = (input: {
  readonly session: agentSessionTypes.AgentSession;
  readonly agent: sessionTypesModule.Harness["agent"];
  readonly sessionManager: sessionManagerTypes.SessionManager;
  readonly settingsManager: sessionTypesModule.Harness["settingsManager"];
  readonly faux: sessionTypesModule.Harness["faux"];
  readonly events: agentSessionTypes.AgentSessionEvent[];
  readonly tempDir: string;
}): sessionTypesModule.Harness => ({
  agent: input.agent,
  cleanup: () =>
    closeAgentSession(input.session).then(() => Effect.runPromise(removePath(input.tempDir))),
  events: input.events,
  eventsOfType<T extends agentSessionTypes.AgentSessionEvent["type"]>(type: T) {
    return input.events.filter(
      (event): event is Extract<agentSessionTypes.AgentSessionEvent, { type: T }> =>
        event.type === type,
    );
  },
  faux: input.faux,
  session: input.session,
  sessionManager: input.sessionManager,
  settingsManager: input.settingsManager,
  tempDir: input.tempDir,
});

const sessionHandle = { harnessOf };

export default sessionHandle;
