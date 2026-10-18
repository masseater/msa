import type { JsonValue } from "@msa/chord";
import { Effect, Function } from "effect";

import type { Transaction } from "../session/transaction.ts";
import { convertPartial } from "./generation-run.ts";
import {
  endRun,
  failCompactionStatus,
  finishSlot,
  LiveDoc,
  removeNestedSlots,
  toolSlot,
} from "./live.ts";
import type { SchedulerOutcome } from "./scheduler.ts";
import type { Dual3, TaskRecord } from "./types.ts";

const RUN_TASK_KINDS: ReadonlySet<string> = new Set(["msa.generation"]);
const TOOL_TASK_KIND = "msa.tool";
const COMPACTION_TASK_KIND = "msa.compaction";

const settleToolOutcome = Effect.fnUntraced(function* (
  tx: Transaction,
  record: TaskRecord<JsonValue, JsonValue, JsonValue>,
) {
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, record.conversationId));
  const slot = toolSlot(live, record.id);
  if (slot !== undefined) finishSlot(slot);
  removeNestedSlots(live, record.id);
});

const settleRunOutcome = Effect.fnUntraced(function* (
  tx: Transaction,
  record: TaskRecord<JsonValue, JsonValue, JsonValue>,
  outcome: SchedulerOutcome,
) {
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, record.conversationId));
  if (live.run?.taskId !== record.id) return;
  yield* convertPartial(tx, live, record.conversationId);
  endRun(
    tx,
    live,
    record.id,
    outcome.status === "faulted"
      ? { status: "unanswered", reason: "faulted", detail: outcome.error.message }
      : { status: "unanswered", reason: outcome.reason },
  );
});

export const settleSchedulerOutcome: Dual3<
  Transaction,
  TaskRecord<JsonValue, JsonValue, JsonValue>,
  SchedulerOutcome,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    tx: Transaction,
    record: TaskRecord<JsonValue, JsonValue, JsonValue>,
    outcome: SchedulerOutcome,
  ) {
    if (record.kind === TOOL_TASK_KIND) return yield* settleToolOutcome(tx, record);
    if (record.kind === COMPACTION_TASK_KIND) {
      const error = outcome.status === "faulted" ? outcome.error.message : outcome.reason;
      const live = yield* Effect.promise(() => tx.doc(LiveDoc, record.conversationId));
      failCompactionStatus(live, record.id, error);
      return;
    }
    if (!RUN_TASK_KINDS.has(record.kind)) return;
    yield* settleRunOutcome(tx, record, outcome);
  }),
);
