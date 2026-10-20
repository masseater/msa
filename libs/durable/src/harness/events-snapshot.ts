import agentState from "./agent-state.ts";
import type eventsSnapshotTypes from "./events-snapshot.types.ts";
import type eventsTypesModule from "./events-types.ts";
import type inboxTypes from "./inbox.types.ts";
import type liveTypes from "./live.types.ts";
import type typesModule from "./types.types.ts";
import usageModule from "./usage.ts";
import type usageTypes from "./usage.types.ts";
import type viewTypesModule from "./view-types.ts";

const { AgentDoc } = agentState;
const { UsageDoc } = usageModule;

function parts(view: viewTypesModule.ConversationView): eventsSnapshotTypes.Parts {
  return {
    agent: view.docs["msa.agent"] as typesModule.AgentState | undefined,
    inbox: view.docs["msa.inbox"] as inboxTypes.InboxState | undefined,
    live: (view.docs["msa.live"] ?? {}) as liveTypes.LiveState,
    usage: view.docs["msa.usage"] as usageTypes.UsageState | undefined,
  };
}

function snapshotOf(view: viewTypesModule.ConversationView): eventsTypesModule.SnapshotEvent {
  const { live, inbox, agent, usage } = parts(view);
  return {
    entries: view.entries,
    type: "snapshot",
    ...(live.run === undefined ? {} : { run: { inputs: live.run.inputs } }),
    ...(live.generation === undefined
      ? {}
      : {
          generation: live.generation as NonNullable<eventsTypesModule.SnapshotEvent["generation"]>,
        }),
    compactions: live.compactions ?? [],
    nestedTools: live.nestedTools ?? [],
    tools: live.tools ?? [],
    ...(live.compactionFailure === undefined ? {} : { compactionFailure: live.compactionFailure }),
    agent: agent ?? AgentDoc.definition.initial(),
    inbox: queued(inbox),
    usage: usage ?? UsageDoc.definition.initial(),
  };
}

function queued(inbox: inboxTypes.InboxState | undefined): eventsTypesModule.QueuedItem[] {
  return (inbox?.items ?? []).map((item) => ({ id: item.id, mode: item.mode }));
}

const eventsSnapshot = {
  parts,
  queued,
  snapshotOf,
};

export default eventsSnapshot;
