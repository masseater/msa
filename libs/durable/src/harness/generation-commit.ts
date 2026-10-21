import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import entriesModule from "../entries.ts";
import bridge from "./bridge.ts";
import compaction from "./compaction.ts";
import type generationTypesModule from "./generation-types.types.ts";
import liveModule from "./live.ts";
import type promptTypes from "./prompt.types.ts";
import type typesModule from "./types.types.ts";

const { commitTask } = bridge;
const { SystemEntry } = entriesModule;
const { LiveDoc } = liveModule;

const waitForBlockingCompaction = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  attempt: number,
  context: chordTypes.Context,
) {
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx): Effect.Effect<generationTypesModule.GenerationNext> =>
      Effect.gen(function* () {
        const child = yield* compaction.createCompaction(
          tx,
          runtime.conversationId,
          { reason: "threshold" },
          runtime.taskId,
        );
        const checkpoint = {
          attempt,
          compacted: child,
          phase: "prepare",
          threshold: true,
        } as const;
        return { checkpoint, on: [child], policy: "allSettled", status: "waiting" };
      }),
    context,
  );
});

const appendPlanned = (
  tx: typesModule.Tx,
  conversationId: generationTypesModule.GenerationRuntime["conversationId"],
  entries: readonly promptTypes.SystemDraft[],
) =>
  Effect.forEach(entries, (entry) =>
    Effect.promise(() => tx.appendEntry(SystemEntry, conversationId, entry)),
  );

const commitRequest = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  entries: readonly promptTypes.SystemDraft[],
  request: Omit<
    Extract<generationTypesModule.GenerationCheckpoint, { phase: "request" }>,
    "phase" | "cutoff"
  >,
  threshold: "blocking" | "background" | undefined,
  context: chordTypes.Context,
) {
  const { conversationId } = runtime;
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx): Effect.Effect<generationTypesModule.GenerationNext> =>
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
          yield* compaction.createCompaction(tx, conversationId, { reason: "threshold" });
        return { checkpoint: { phase: "request", ...request, cutoff }, status: "running" };
      }),
    context,
  );
});

const generationCommit = {
  commitRequest,
  waitForBlockingCompaction,
};

export default generationCommit;
