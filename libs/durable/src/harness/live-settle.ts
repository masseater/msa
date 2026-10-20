import type { JsonValue } from "@msa/chord";
import { Effect, Function } from "effect";

import type transactionTypes from "../session/transaction.types.ts";
import generationRun from "./generation-run.ts";
import liveModule from "./live.ts";
import type schedulerTypes from "./scheduler.types.ts";
import type typesModule from "./types.types.ts";

const { LiveDoc, endRun, failCompactionStatus, finishSlot, removeNestedSlots, toolSlot } =
  liveModule;
const { convertPartial } = generationRun;

const RUN_TASK_KINDS: ReadonlySet<string> = new Set(["msa.generation"]);
const TOOL_TASK_KIND = "msa.tool";
const COMPACTION_TASK_KIND = "msa.compaction";

const settleToolOutcome = Effect.fnUntraced(function* (
  tx: transactionTypes.Transaction,
  record: typesModule.TaskRecord<JsonValue, JsonValue, JsonValue>,
) {
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, record.conversationId));
  const slot = toolSlot(live, record.id);
  if (slot !== undefined) finishSlot(slot);
  removeNestedSlots(live, record.id);
});

const settleRunOutcome = Effect.fnUntraced(function* (
  tx: transactionTypes.Transaction,
  record: typesModule.TaskRecord<JsonValue, JsonValue, JsonValue>,
  outcome: schedulerTypes.SchedulerOutcome,
) {
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, record.conversationId));
  if (live.run?.taskId !== record.id) return;
  yield* convertPartial(tx, live, record.conversationId);
  endRun(
    tx,
    live,
    record.id,
    outcome.status === "faulted"
      ? { detail: outcome.error.message, reason: "faulted", status: "unanswered" }
      : { reason: outcome.reason, status: "unanswered" },
  );
});

const settleSchedulerOutcome: typesModule.Dual3<
  transactionTypes.Transaction,
  typesModule.TaskRecord<JsonValue, JsonValue, JsonValue>,
  schedulerTypes.SchedulerOutcome,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    tx: transactionTypes.Transaction,
    record: typesModule.TaskRecord<JsonValue, JsonValue, JsonValue>,
    outcome: schedulerTypes.SchedulerOutcome,
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

const liveSettle = {
  settleSchedulerOutcome,
};

export default liveSettle;
