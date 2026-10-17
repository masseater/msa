import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { SystemEntry } from "../entries.ts";
import { commitTask } from "./bridge.ts";
import { createCompaction } from "./compaction.ts";
import type {
  GenerationCheckpoint,
  GenerationNext,
  GenerationRuntime,
} from "./generation-types.ts";
import { LiveDoc } from "./live.ts";
import type { SystemDraft } from "./prompt.ts";
import type { Tx } from "./types.ts";

export const waitForBlockingCompaction = Effect.fn("waitForBlockingCompaction")(function* (
  runtime: GenerationRuntime,
  attempt: number,
  context: Context,
) {
  yield* commitTask(
    runtime,
    (tx: Tx): Effect.Effect<GenerationNext> =>
      Effect.gen(function* () {
        const child = yield* createCompaction(
          tx,
          runtime.conversationId,
          { reason: "threshold" },
          runtime.taskId,
        );
        const checkpoint = {
          phase: "prepare",
          attempt,
          compacted: child,
          threshold: true,
        } as const;
        return { status: "waiting", checkpoint, on: [child], policy: "allSettled" };
      }),
    context,
  );
});

const appendPlanned = (
  tx: Tx,
  conversationId: GenerationRuntime["conversationId"],
  entries: readonly SystemDraft[],
) =>
  Effect.forEach(entries, (entry) =>
    Effect.promise(() => tx.appendEntry(SystemEntry, conversationId, entry)),
  );

export const commitRequest = Effect.fn("commitRequest")(function* (
  runtime: GenerationRuntime,
  entries: readonly SystemDraft[],
  request: Omit<Extract<GenerationCheckpoint, { phase: "request" }>, "phase" | "cutoff">,
  threshold: "blocking" | "background" | undefined,
  context: Context,
) {
  const { conversationId } = runtime;
  yield* commitTask(
    runtime,
    (tx: Tx): Effect.Effect<GenerationNext> =>
      Effect.gen(function* () {
        const first = yield* Effect.promise(() => tx.scanEntries({ conversationId }, 1));
        const appended = yield* appendPlanned(tx, conversationId, entries);
        const cutoff = appended.at(-1)?.id ?? first.items[0]?.id;
        if (cutoff === undefined)
          return yield* Effect.die(
            new Error(`Conversation ${conversationId} has no entries to send`),
          );
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
        if (threshold === "background" && live.compactions === undefined)
          yield* createCompaction(tx, conversationId, { reason: "threshold" });
        return { status: "running", checkpoint: { phase: "request", ...request, cutoff } };
      }),
    context,
  );
});
