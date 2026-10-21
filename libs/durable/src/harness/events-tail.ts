import { Function } from "effect";

import agentState from "./agent-state.ts";
import type eventsSlotsTypes from "./events-slots.types.ts";
import eventsSnapshot from "./events-snapshot.ts";
import type eventsSnapshotTypes from "./events-snapshot.types.ts";
import type eventsStreamTypes from "./events-stream.types.ts";
import type eventsTailTypes from "./events-tail.types.ts";
import type eventsTypesModule from "./events-types.ts";
import type typesModule from "./types.types.ts";
import usageModule from "./usage.ts";

const { queued } = eventsSnapshot;
const { AgentDoc } = agentState;
const { UsageDoc } = usageModule;

const entryEvents: typesModule.Dual3<
  eventsTailTypes.Changes,
  eventsStreamTypes.Generations,
  readonly eventsSlotsTypes.ToolEnd[],
  eventsTypesModule.AgentEvent[]
> = Function.dual(
  3,
  (
    changes: eventsTailTypes.Changes,
    generations: eventsStreamTypes.Generations,
    toolEnds: readonly eventsSlotsTypes.ToolEnd[],
  ): eventsTypesModule.AgentEvent[] => {
    const events: eventsTypesModule.AgentEvent[] = [];
    let assistantAppended = false;
    for (const entry of changes.entries) {
      events.push(...toolEnds.filter((end) => end.entry === entry));
      const message = entry.model?.[0];
      if (message === undefined) {
        events.push({ entry, type: "entry_appended" });
        continue;
      }
      const streamed =
        message.role === "assistant" &&
        generations.partialBefore !== undefined &&
        !assistantAppended;
      if (message.role === "assistant") assistantAppended = true;
      if (!streamed) events.push({ message, type: "message_start" });
      events.push({ entry, type: "message_end" });
    }
    events.push(...toolEnds.filter((end) => end.entry === undefined));
    return events;
  },
);

const compactionEnds: typesModule.Dual2<
  eventsSnapshotTypes.Parts,
  eventsSnapshotTypes.Parts,
  eventsTypesModule.AgentEvent[]
> = Function.dual(
  2,
  (
    was: eventsSnapshotTypes.Parts,
    now: eventsSnapshotTypes.Parts,
  ): eventsTypesModule.AgentEvent[] => {
    const events: eventsTypesModule.AgentEvent[] = [];
    const compactions = now.live.compactions ?? [];
    const failure = now.live.compactionFailure;
    for (const { taskId, reason } of was.live.compactions ?? []) {
      if (compactions.some((status) => status.taskId === taskId)) continue;
      const error = failure?.taskId === taskId ? failure.error : undefined;
      events.push({
        reason,
        taskId,
        type: "compaction_end",
        ...(error === undefined ? {} : { error }),
      });
    }
    return events;
  },
);

const taskEvents: typesModule.Dual2<
  eventsTailTypes.Changes,
  Set<typesModule.TaskId>,
  eventsTailTypes.TaskEvents
> = Function.dual(
  2,
  (changes: eventsTailTypes.Changes, held: Set<typesModule.TaskId>): eventsTailTypes.TaskEvents => {
    const events: eventsTypesModule.AgentEvent[] = [];
    let turnEnded = false;
    for (const task of changes.tasks.values()) {
      const status = task.state.status;
      if (task.kind === "msa.generation" && status === "completing" && !held.has(task.id)) {
        held.add(task.id);
        turnEnded = true;
      }
      if (status !== "terminal") continue;
      if (task.kind === "msa.generation" && !held.delete(task.id)) turnEnded = true;
      const outcome = task.state.outcome;
      if (outcome.status === "faulted" || outcome.status === "orphaned") {
        const message = outcome.status === "faulted" ? outcome.error.message : outcome.reason;
        events.push({ kind: task.kind, message, taskId: task.id, type: "task_failed" });
      }
    }
    return { events, turnEnded };
  },
);

const tailEvents: typesModule.Dual3<
  eventsSnapshotTypes.Parts,
  eventsSnapshotTypes.Parts,
  eventsTailTypes.Changes,
  eventsTypesModule.AgentEvent[]
> = Function.dual(
  3,
  (
    was: eventsSnapshotTypes.Parts,
    now: eventsSnapshotTypes.Parts,
    changes: eventsTailTypes.Changes,
  ): eventsTypesModule.AgentEvent[] => {
    const events: eventsTypesModule.AgentEvent[] = [];
    const run = now.live.run;
    const runBefore = was.live.run;
    const runChanged = run?.inputs[0] !== runBefore?.inputs[0];
    if (runBefore !== undefined && runChanged)
      events.push({ inputs: runBefore.inputs, type: "run_end" });
    for (const record of changes.submissions) events.push({ record, type: "submission" });
    if (now.inbox !== was.inbox) events.push({ items: queued(now.inbox), type: "inbox_update" });
    if (now.agent !== was.agent)
      events.push({ agent: now.agent ?? AgentDoc.definition.initial(), type: "agent_changed" });
    if (now.usage !== was.usage)
      events.push({ type: "usage_changed", usage: now.usage ?? UsageDoc.definition.initial() });
    const compactionsBefore = was.live.compactions ?? [];
    for (const { taskId, reason, blocking } of now.live.compactions ?? []) {
      if (!compactionsBefore.some((status) => status.taskId === taskId))
        events.push({ blocking, reason, taskId, type: "compaction_start" });
    }
    if (run !== undefined && runChanged) events.push({ inputs: run.inputs, type: "run_start" });
    if (
      run !== undefined &&
      run.taskId !== runBefore?.taskId &&
      changes.tasks.get(run.taskId)?.kind === "msa.generation"
    )
      events.push({ type: "turn_start" });
    return events;
  },
);

const eventsTail = {
  compactionEnds,
  entryEvents,
  tailEvents,
  taskEvents,
};

export default eventsTail;
