import type { CodemodeRun } from "@msa/codemode/portable";
import type { Effect } from "effect";

import type typesModule from "../harness/types.types.ts";
import type runCallsTypes from "./run-calls.types.ts";
import type RunJournalClass from "./run-journal.ts";
import type runStartTypes from "./run-start.types.ts";

declare namespace runJournalTypes {
  type Resumed = Exclude<
    runStartTypes.OpenedRun,
    { readonly done: typesModule.ToolExecutionResult }
  >;

  type RunControl = {
    readonly host: runCallsTypes.CallHost;
    readonly opened: Resumed;
    readonly run: () => CodemodeRun;
    readonly stopped: () => boolean;
    readonly diverge: (message: string) => void;
    readonly fail: (error: unknown) => void;
    readonly refuse: (
      result: typesModule.ToolExecutionResult,
      reason: Error,
    ) => Effect.Effect<void>;
  };

  type RunJournal = RunJournalClass;
}

export type { runJournalTypes as default };
