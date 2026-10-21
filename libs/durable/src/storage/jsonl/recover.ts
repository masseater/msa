import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import type memoryTypes from "../memory.types.ts";
import filesModule from "./files.ts";
import type filesTypes from "./files.types.ts";
import recoverReplay from "./recover-replay.ts";
import recoverScan from "./recover-scan.ts";
import type recoverScanTypes from "./recover-scan.types.ts";

const { analyzeMain, readMain, readSidecars } = recoverScan;
const { replayMain, settleSidecars } = recoverReplay;
const { reclaimSidecars } = filesModule;

const recoverJsonl: {
  (
    memory: memoryTypes.MemoryStorage,
    context: chordTypes.Context,
  ): (files: filesTypes.JsonlFiles) => Effect.Effect<recoverScanTypes.MainAnalysis>;
  (
    files: filesTypes.JsonlFiles,
    memory: memoryTypes.MemoryStorage,
    context: chordTypes.Context,
  ): Effect.Effect<recoverScanTypes.MainAnalysis>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (
    files: filesTypes.JsonlFiles,
    memory: memoryTypes.MemoryStorage,
    context: chordTypes.Context,
  ) {
    const main = yield* readMain(files, context);
    const index = yield* readSidecars(files, context);
    const analysis = analyzeMain(main, index);
    const confirmed = replayMain(main, analysis, index, memory);
    const reclamations = yield* settleSidecars(files, index, analysis, confirmed, context);
    yield* reclaimSidecars(files, reclamations, context);
    return analysis;
  }),
);

const recover = {
  recoverJsonl,
};

export default recover;
