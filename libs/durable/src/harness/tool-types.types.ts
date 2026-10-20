import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";
import type outputTypes from "@msa/chord/output.types";

import type typesModule from "./types.types.ts";

declare namespace toolTypesModule {
  type ToolTaskInput =
    | { kind: "model"; assistant: typesModule.EntryId; callId: string }
    | {
        kind: "nested";
        parent: typesModule.TaskId;
        parentCallId: string;
        key: string;
        call: aiTypes.ToolCall;
        progress?: false;
      };

  type ToolTaskCheckpoint =
    | { phase: "call" }
    | { phase: "execute"; arguments: typesModule.JsonObject; replay: "safe" | "unsafe" };

  type ToolTaskResult =
    | { kind: "model"; entryId: typesModule.EntryId; control?: typesModule.ToolControl }
    | { kind: "nested" };

  type NestedCallState = {
    taskId?: typesModule.TaskId<ToolTaskResult>;
    result?: chordTypes.JsonRepresentation<typesModule.NestedToolExecutionResult>;
  };

  type ToolRuntime = typesModule.TaskRuntime<
    ToolTaskInput,
    ToolTaskCheckpoint,
    ToolTaskResult,
    typesModule.ToolHooks
  >;

  type Content = (aiTypes.TextContent | aiTypes.ImageContent)[];

  type Reported = {
    readonly output: outputTypes.OutputBuffer;
    readonly limits: outputTypes.OutputLimits;
    readonly diagnostics: typesModule.ToolDiagnostic[];
    details: chordTypes.JsonValue | undefined;
  };

  type Ending =
    | { readonly status: "completed" | "aborted" }
    | { readonly status: "failed"; readonly message: string };
}

export type { toolTypesModule as default };
