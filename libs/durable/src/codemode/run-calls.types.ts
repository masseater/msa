import type chordTypes from "@msa/chord/index.types";
import type { Semaphore } from "effect";

import type typesModule from "../harness/types.types.ts";
import type callRowsTypes from "./call-rows.types.ts";
import type runDocsTypes from "./run-docs.types.ts";

declare namespace runCallsTypes {
  type CallHost = {
    readonly options: runDocsTypes.CodemodeToolOptions;
    readonly api: typesModule.ToolExecutionApi;
    readonly context: chordTypes.Context;
    readonly start: runDocsTypes.Start;
    readonly rows: callRowsTypes.CallRows;
    readonly modelSlots: Semaphore.Semaphore;
    readonly stopped: () => boolean;
    readonly generated: (images: number) => void;
  };
}

export type { runCallsTypes as default };
