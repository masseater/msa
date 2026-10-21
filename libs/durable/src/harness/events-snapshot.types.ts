import type inboxTypes from "./inbox.types.ts";
import type liveTypes from "./live.types.ts";
import type typesModule from "./types.types.ts";
import type usageTypes from "./usage.types.ts";

declare namespace eventsSnapshotTypes {
  type Parts = {
    live: liveTypes.LiveState;
    inbox: inboxTypes.InboxState | undefined;
    agent: typesModule.AgentState | undefined;
    usage: usageTypes.UsageState | undefined;
  };
}

export type { eventsSnapshotTypes as default };
