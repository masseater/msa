import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { ResetEntry } from "../entries.ts";
import { addTools } from "./agent.ts";
import { commitTask } from "./bridge.ts";
import { createGeneration, handOver, startRun } from "./generation-run.ts";
import type { GenerationNext, GenerationRuntime, ToolTaskId } from "./generation-types.ts";
import { applyBoundary, type Boundary, prepareBoundary } from "./inbox.ts";
import { endRun, LiveDoc } from "./live.ts";
import type { EntryId, TaskId, ToolControl, Tx } from "./types.ts";

type RoundControls = {
  readonly terminate: boolean;
  readonly added: readonly string[];
  readonly handoff: string | undefined;
};

const readControls = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  assistant: EntryId,
  tools: readonly ToolTaskId[],
  context: Context,
) {
  const controls = new Map<TaskId, ToolControl | undefined>();
  const outcomes = yield* Effect.promise(() => runtime.outcomes(tools, context));
  tools.forEach((id, index) => {
    const outcome = outcomes[index]!;
    controls.set(
      id,
      outcome.status === "completed" && outcome.result.kind !== "nested"
        ? outcome.result.control
        : undefined,
    );
  });
  const snapshot = yield* Effect.promise(() =>
    runtime.snapshot(LiveDoc, runtime.conversationId, context),
  );
  const slots = snapshot?.tools ?? [];
  const results = slots.flatMap((slot) => (slot.entry === undefined ? [] : [slot.entry]));
  yield* Effect.promise(() =>
    runtime.hooks.each("afterTools", (hook) => hook(assistant, results, runtime, context)),
  );
  return {
    terminate:
      slots.length > 0 &&
      slots.every(
        (slot) => slot.taskId !== undefined && controls.get(slot.taskId)?.terminate === true,
      ),
    added: [...controls.values()].flatMap((control) => control?.addTools ?? []),
    handoff: [...controls.values()].findLast((control) => control?.handoff !== undefined)?.handoff,
  } satisfies RoundControls;
});

const settleHandoff = Effect.fnUntraced(function* (
  tx: Tx,
  runtime: GenerationRuntime,
  boundary: Boundary,
  input: {
    readonly assistant: EntryId;
    readonly handoff: string | undefined;
    readonly now: number;
  },
) {
  const { conversationId } = runtime;
  if (input.handoff !== undefined) {
    const message = { role: "user", content: input.handoff, timestamp: input.now } as const;
    const entry = yield* Effect.promise(() =>
      tx.appendEntry(ResetEntry, conversationId, { head: "self", model: [message] }),
    );
    boundary.head = entry.id;
  }
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
  const { users } = yield* applyBoundary(tx, boundary, "final", input.now);
  endRun(tx, live, runtime.taskId, { status: "done", answer: input.assistant });
  if (users.length > 0) yield* startRun(tx, conversationId, live, users);
});

const settleNextRound = Effect.fnUntraced(function* (
  tx: Tx,
  runtime: GenerationRuntime,
  boundary: Boundary,
  now: number,
) {
  const { conversationId } = runtime;
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
  const { users, reset } = yield* applyBoundary(tx, boundary, "postTools", now);
  if (reset) {
    endRun(tx, live, runtime.taskId, { status: "unanswered", reason: "reset" });
    if (users.length > 0) yield* startRun(tx, conversationId, live, users);
    return;
  }
  delete live.tools;
  delete live.nestedTools;
  if (live.run?.taskId === runtime.taskId) live.run.inputs.push(...users);
  handOver(live, runtime.taskId, yield* createGeneration(tx, conversationId));
});

export const finishToolRound = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  assistant: EntryId,
  tools: readonly ToolTaskId[],
  context: Context,
) {
  const { conversationId } = runtime;
  const controls = yield* readControls(runtime, assistant, tools, context);
  yield* commitTask(
    runtime,
    (tx: Tx): Effect.Effect<GenerationNext> =>
      Effect.gen(function* () {
        const boundary = yield* prepareBoundary(tx, conversationId, runtime.settings);
        if (controls.added.length > 0) yield* addTools(tx, conversationId, controls.added);
        const now = runtime.now();
        if (controls.terminate || controls.handoff !== undefined)
          yield* settleHandoff(tx, runtime, boundary, {
            assistant,
            handoff: controls.handoff,
            now,
          });
        else yield* settleNextRound(tx, runtime, boundary, now);
        return {
          status: "terminal",
          outcome: { status: "completed", result: { entryId: assistant } },
        };
      }),
    context,
  );
});
