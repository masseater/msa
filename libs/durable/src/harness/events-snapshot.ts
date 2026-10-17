import { AgentDoc } from "./agent-state.ts";
import type { QueuedItem, SnapshotEvent } from "./events-types.ts";
import type { InboxState } from "./inbox.ts";
import type { LiveState } from "./live.ts";
import type { AgentState } from "./types.ts";
import { UsageDoc, type UsageState } from "./usage.ts";
import type { ConversationView } from "./view-types.ts";

export type Parts = {
  live: LiveState;
  inbox: InboxState | undefined;
  agent: AgentState | undefined;
  usage: UsageState | undefined;
};

export function parts(view: ConversationView): Parts {
  return {
    live: (view.docs["msa.live"] ?? {}) as LiveState,
    inbox: view.docs["msa.inbox"] as InboxState | undefined,
    agent: view.docs["msa.agent"] as AgentState | undefined,
    usage: view.docs["msa.usage"] as UsageState | undefined,
  };
}

export function snapshotOf(view: ConversationView): SnapshotEvent {
  const { live, inbox, agent, usage } = parts(view);
  return {
    type: "snapshot",
    entries: view.entries,
    ...(live.run === undefined ? {} : { run: { inputs: live.run.inputs } }),
    ...(live.generation === undefined
      ? {}
      : { generation: live.generation as NonNullable<SnapshotEvent["generation"]> }),
    tools: live.tools ?? [],
    nestedTools: live.nestedTools ?? [],
    compactions: live.compactions ?? [],
    ...(live.compactionFailure === undefined ? {} : { compactionFailure: live.compactionFailure }),
    inbox: queued(inbox),
    agent: agent ?? AgentDoc.definition.initial(),
    usage: usage ?? UsageDoc.definition.initial(),
  };
}

export function queued(inbox: InboxState | undefined): QueuedItem[] {
  return (inbox?.items ?? []).map((item) => ({ id: item.id, mode: item.mode }));
}
