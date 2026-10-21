import type compactionTypesModule from "./compaction-types.ts";
import type eventsTypesModule from "./events-types.ts";
import type generationTypesModule from "./generation-types.types.ts";
import type harnessTypes from "./harness.types.ts";
import type inboxTypes from "./inbox.types.ts";
import type liveTypes from "./live.types.ts";
import type providerTypes from "./provider.types.ts";
import type taskGraphTypes from "./task-graph.types.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type usageTypes from "./usage.types.ts";

declare namespace harnessPublicTypes {
  type CompactionCheckpoint = compactionTypesModule.CompactionCheckpoint;
  type CompactionInput = compactionTypesModule.CompactionInput;
  type SummaryRequest = compactionTypesModule.SummaryRequest;
  type AgentEvent = eventsTypesModule.AgentEvent;
  type AgentEventStream = eventsTypesModule.AgentEventStream;
  type MessageChange = eventsTypesModule.MessageChange;
  type SnapshotEvent = eventsTypesModule.SnapshotEvent;
  type ToolEventCall = eventsTypesModule.ToolEventCall;
  type GenerationCheckpoint = generationTypesModule.GenerationCheckpoint;
  type GenerationInput = generationTypesModule.GenerationInput;
  type GenerationResult = generationTypesModule.GenerationResult;
  type InboxItem = inboxTypes.InboxItem;
  type InboxState = inboxTypes.InboxState;
  type CompactionFailure = liveTypes.CompactionFailure;
  type CompactionStatus = liveTypes.CompactionStatus;
  type LiveState = liveTypes.LiveState;
  type NestedToolSlot = liveTypes.NestedToolSlot;
  type NestedToolSummary = liveTypes.NestedToolSummary;
  type ToolSlot = liveTypes.ToolSlot;
  type ProviderState = providerTypes.ProviderState;
  type TaskGraph = taskGraphTypes.TaskGraph;
  type TaskGraphNode = taskGraphTypes.TaskGraphNode;
  type TaskGraphState = taskGraphTypes.TaskGraphState;
  type TaskGraphWatch = taskGraphTypes.TaskGraphWatch;
  type NestedCallState = toolTypesModule.NestedCallState;
  type ToolTaskCheckpoint = toolTypesModule.ToolTaskCheckpoint;
  type ToolTaskInput = toolTypesModule.ToolTaskInput;
  type ToolTaskResult = toolTypesModule.ToolTaskResult;
  type UsageState = usageTypes.UsageState;
  type Harness = harnessTypes.Harness;
}

export type { harnessPublicTypes as default };
