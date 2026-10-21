import type { Effect } from "effect";

import type agentSession from "./agent-session.ts";

declare namespace agentSessionTypes {
  type PreparedModel = Effect.Success<ReturnType<typeof agentSession.prepareModel>>;
}

export type { agentSessionTypes as default };
