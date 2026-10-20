import type { Effect } from "effect";

import type agentOptionsTypes from "./agent-options.ts";
import type agentRun from "./agent-run.ts";
import type typesModule from "./types.ts";

declare namespace agentRunTypes {
  interface RunHooks {
    readonly onStart: () => void;
    readonly onFailure: (error: unknown, aborted: boolean) => Effect.Effect<void>;
    readonly onFinish: () => void;
  }

  interface ListenerNotice {
    readonly listeners: ReadonlySet<agentOptionsTypes.AgentListener>;
    readonly event: typesModule.AgentEvent;
    readonly signal: AbortSignal | undefined;
  }

  type AgentRuns = (typeof agentRun.AgentRuns)["prototype"];
}

export type { agentRunTypes as default };
