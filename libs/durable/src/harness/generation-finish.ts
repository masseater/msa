import type { Context } from "@msa/chord";
import { Effect } from "effect";

import entries from "../entries.ts";
import agentModule from "./agent.ts";
import bridge from "./bridge.ts";
import type generationFinishTypes from "./generation-finish.types.ts";
import generationRun from "./generation-run.ts";
import inboxModule from "./inbox.ts";
import liveModule from "./live.ts";
import type typesModule from "./types.types.ts";

const { LiveDoc, endRun } = liveModule;
const { ResetEntry } = entries;
const { applyBoundary, prepareBoundary } = inboxModule;
const { commitTask } = bridge;
const { addTools } = agentModule;

type RoundControls = {
  readonly terminate: boolean;
  readonly added: readonly string[];
  readonly handoff: string | undefined;
};

const readControls = Effect.fnUntraced(function* (
  runtime: generationFinishTypes.GenerationRuntime,
  assistant: typesModule.EntryId,
  tools: readonly generationFinishTypes.ToolTaskId[],
  context: Context,
) {
  const controls = new Map<typesModule.TaskId, typesModule.ToolControl | undefined>();
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
    added: [...controls.values()].flatMap((control) => control?.addTools ?? []),
    handoff: [...controls.values()].findLast((control) => control?.handoff !== undefined)?.handoff,
    terminate:
      slots.length > 0 &&
      slots.every(
        (slot) => slot.taskId !== undefined && controls.get(slot.taskId)?.terminate === true,
      ),
  } satisfies RoundControls;
});

const settleHandoff = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  runtime: generationFinishTypes.GenerationRuntime,
  boundary: generationFinishTypes.Boundary,
  input: {
    readonly assistant: typesModule.EntryId;
    readonly handoff: string | undefined;
    readonly now: number;
  },
) {
  const { conversationId } = runtime;
  if (input.handoff !== undefined) {
    const message = { content: input.handoff, role: "user", timestamp: input.now } as const;
    const entry = yield* Effect.promise(() =>
      tx.appendEntry(ResetEntry, conversationId, { head: "self", model: [message] }),
    );
    boundary.head = entry.id;
  }
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
  const { users } = yield* applyBoundary(tx, boundary, "final", input.now);
  endRun(tx, live, runtime.taskId, { answer: input.assistant, status: "done" });
  if (users.length > 0) yield* generationRun.startRun(tx, conversationId, live, users);
});

const settleNextRound = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  runtime: generationFinishTypes.GenerationRuntime,
  boundary: generationFinishTypes.Boundary,
  now: number,
) {
  const { conversationId } = runtime;
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
  const { users, reset } = yield* applyBoundary(tx, boundary, "postTools", now);
  if (reset) {
    endRun(tx, live, runtime.taskId, { reason: "reset", status: "unanswered" });
    if (users.length > 0) yield* generationRun.startRun(tx, conversationId, live, users);
    return;
  }
  delete live.tools;
  delete live.nestedTools;
  if (live.run?.taskId === runtime.taskId) live.run.inputs.push(...users);
  generationRun.handOver(
    live,
    runtime.taskId,
    yield* generationRun.createGeneration(tx, conversationId),
  );
});

const finishToolRound = Effect.fnUntraced(function* (
  runtime: generationFinishTypes.GenerationRuntime,
  assistant: typesModule.EntryId,
  tools: readonly generationFinishTypes.ToolTaskId[],
  context: Context,
) {
  const { conversationId } = runtime;
  const controls = yield* readControls(runtime, assistant, tools, context);
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx): Effect.Effect<generationFinishTypes.GenerationNext> =>
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
          outcome: { result: { entryId: assistant }, status: "completed" },
          status: "terminal",
        };
      }),
    context,
  );
});

const generationFinish = {
  finishToolRound,
};

export default generationFinish;
