import type typesModule from "../harness/types.types.ts";
import type runDocsTypes from "./run-docs.types.ts";

declare namespace runStartTypes {
  type OpenedRun =
    | { readonly done: typesModule.ToolExecutionResult }
    | {
        readonly start: runDocsTypes.Start;
        readonly journal: runDocsTypes.JournalEntry[];
        readonly firstIssued: number | undefined;
        readonly rerun: boolean;
      };
}

export type { runStartTypes as default };
