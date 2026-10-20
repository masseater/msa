import type { ImageContent, TextContent, ToolCall } from "@msa/ai";
import type { JsonRepresentation, JsonValue } from "@msa/chord";
import type { OutputBuffer, OutputLimits } from "@msa/chord/output";

import type typesModule from "./types.types.ts";

declare namespace toolTypesModule {
  type ToolTaskInput =
    | { kind: "model"; assistant: typesModule.EntryId; callId: string }
    | {
        kind: "nested";
        parent: typesModule.TaskId;
        parentCallId: string;
        key: string;
        call: ToolCall;
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
    result?: JsonRepresentation<typesModule.NestedToolExecutionResult>;
  };

  type ToolRuntime = typesModule.TaskRuntime<
    ToolTaskInput,
    ToolTaskCheckpoint,
    ToolTaskResult,
    typesModule.ToolHooks
  >;

  type Content = (TextContent | ImageContent)[];

  type Reported = {
    readonly output: OutputBuffer;
    readonly limits: OutputLimits;
    readonly diagnostics: typesModule.ToolDiagnostic[];
    details: JsonValue | undefined;
  };

  type Ending =
    | { readonly status: "completed" | "aborted" }
    | { readonly status: "failed"; readonly message: string };
}

export type { toolTypesModule as default };
