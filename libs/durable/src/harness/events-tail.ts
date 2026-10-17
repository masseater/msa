import { Function } from "effect";

import { AgentDoc } from "./agent-state.ts";
import type { Changes } from "./events-changes.ts";
import type { ToolEnd } from "./events-slots.ts";
import { type Parts, queued } from "./events-snapshot.ts";
import type { Generations } from "./events-stream.ts";
import type { AgentEvent } from "./events-types.ts";
import type { Dual2, Dual3, TaskId } from "./types.ts";
import { UsageDoc } from "./usage.ts";

export type TaskEvents = { readonly events: AgentEvent[]; readonly turnEnded: boolean };

export const entryEvents: Dual3<Changes, Generations, readonly ToolEnd[], AgentEvent[]> =
  Function.dual(
    3,
    (changes: Changes, generations: Generations, toolEnds: readonly ToolEnd[]): AgentEvent[] => {
      const events: AgentEvent[] = [];
      let assistantAppended = false;
      for (const entry of changes.entries) {
        events.push(...toolEnds.filter((end) => end.entry === entry));
        const message = entry.model?.[0];
        if (message === undefined) {
          events.push({ type: "entry_appended", entry });
          continue;
        }
        const streamed =
          message.role === "assistant" &&
          generations.partialBefore !== undefined &&
          !assistantAppended;
        if (message.role === "assistant") assistantAppended = true;
        if (!streamed) events.push({ type: "message_start", message });
        events.push({ type: "message_end", entry });
      }
      events.push(...toolEnds.filter((end) => end.entry === undefined));
      return events;
    },
  );

export const compactionEnds: Dual2<Parts, Parts, AgentEvent[]> = Function.dual(
  2,
  (was: Parts, now: Parts): AgentEvent[] => {
    const events: AgentEvent[] = [];
    const compactions = now.live.compactions ?? [];
    const failure = now.live.compactionFailure;
    for (const { taskId, reason } of was.live.compactions ?? []) {
      if (compactions.some((status) => status.taskId === taskId)) continue;
      const error = failure?.taskId === taskId ? failure.error : undefined;
      events.push({
        type: "compaction_end",
        taskId,
        reason,
        ...(error === undefined ? {} : { error }),
      });
    }
    return events;
  },
);

export const taskEvents: Dual2<Changes, Set<TaskId>, TaskEvents> = Function.dual(
  2,
  (changes: Changes, held: Set<TaskId>): TaskEvents => {
    const events: AgentEvent[] = [];
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
        events.push({ type: "task_failed", taskId: task.id, kind: task.kind, message });
      }
    }
    return { events, turnEnded };
  },
);

export const tailEvents: Dual3<Parts, Parts, Changes, AgentEvent[]> = Function.dual(
  3,
  (was: Parts, now: Parts, changes: Changes): AgentEvent[] => {
    const events: AgentEvent[] = [];
    const run = now.live.run;
    const runBefore = was.live.run;
    const runChanged = run?.inputs[0] !== runBefore?.inputs[0];
    if (runBefore !== undefined && runChanged)
      events.push({ type: "run_end", inputs: runBefore.inputs });
    for (const record of changes.submissions) events.push({ type: "submission", record });
    if (now.inbox !== was.inbox) events.push({ type: "inbox_update", items: queued(now.inbox) });
    if (now.agent !== was.agent)
      events.push({ type: "agent_changed", agent: now.agent ?? AgentDoc.definition.initial() });
    if (now.usage !== was.usage)
      events.push({ type: "usage_changed", usage: now.usage ?? UsageDoc.definition.initial() });
    const compactionsBefore = was.live.compactions ?? [];
    for (const { taskId, reason, blocking } of now.live.compactions ?? []) {
      if (!compactionsBefore.some((status) => status.taskId === taskId))
        events.push({ type: "compaction_start", taskId, reason, blocking });
    }
    if (run !== undefined && runChanged) events.push({ type: "run_start", inputs: run.inputs });
    if (
      run !== undefined &&
      run.taskId !== runBefore?.taskId &&
      changes.tasks.get(run.taskId)?.kind === "msa.generation"
    )
      events.push({ type: "turn_start" });
    return events;
  },
);
