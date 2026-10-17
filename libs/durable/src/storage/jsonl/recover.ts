import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import type { MemoryStorage } from "../memory.ts";
import { type JsonlFiles, reclaimSidecars } from "./files.ts";
import { replayMain, settleSidecars } from "./recover-replay.ts";
import { analyzeMain, type MainAnalysis, readMain, readSidecars } from "./recover-scan.ts";

export const recoverJsonl: {
  (memory: MemoryStorage, context: Context): (files: JsonlFiles) => Effect.Effect<MainAnalysis>;
  (files: JsonlFiles, memory: MemoryStorage, context: Context): Effect.Effect<MainAnalysis>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (files: JsonlFiles, memory: MemoryStorage, context: Context) {
    const main = yield* readMain(files, context);
    const index = yield* readSidecars(files, context);
    const analysis = analyzeMain(main, index);
    const confirmed = replayMain(main, analysis, index, memory);
    const reclamations = yield* settleSidecars(files, index, analysis, confirmed, context);
    yield* reclaimSidecars(files, reclamations, context);
    return analysis;
  }),
);
