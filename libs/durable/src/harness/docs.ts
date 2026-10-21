import agentState from "./agent-state.ts";
import inboxModule from "./inbox.ts";
import liveModule from "./live.ts";
import provider from "./provider.ts";
import toolTypes from "./tool-types.ts";
import usageModule from "./usage.ts";

const harnessDocs = {
  AgentDoc: agentState.AgentDoc,
  DEFAULT_COMPACTION_POLICY: agentState.DEFAULT_COMPACTION_POLICY,
  DEFAULT_PROGRESS_POLICY: agentState.DEFAULT_PROGRESS_POLICY,
  DEFAULT_RETRY_POLICY: agentState.DEFAULT_RETRY_POLICY,
  InboxDoc: inboxModule.InboxDoc,
  LiveDoc: liveModule.LiveDoc,
  NestedCallDoc: toolTypes.NestedCallDoc,
  ProviderDoc: provider.ProviderDoc,
  UsageDoc: usageModule.UsageDoc,
  configure: agentState.configure,
};

export default harnessDocs;
