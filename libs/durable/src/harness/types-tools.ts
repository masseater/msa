import type { Tool as AiTool, Models, Static, TSchema, ToolResultMessage, Usage } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";

import type envTypes from "../env/index.types.ts";
import type typesModule from "../types.types.ts";
import type typesRegistryTypes from "./types-registry.ts";
import type typesModuleModule from "./types.types.ts";

declare namespace typesToolsTypes {
  type ToolControl = {
    readonly addTools?: readonly string[] | undefined;
    readonly terminate?: true | undefined;
    readonly handoff?: string | undefined;
  };

  type ToolDiagnostic = {
    readonly severity: "info" | "warn" | "error";
    readonly message: string;
    readonly code?: string;
  };

  type ToolExecutionResult<TDetails extends JsonValue = JsonValue> = {
    readonly output?: ToolResultMessage["content"];
    readonly structuredOutput?: JsonValue;
    readonly isError?: boolean;
    readonly details?: TDetails;
    readonly diagnostics?: readonly ToolDiagnostic[];
    readonly usage?: Usage;
    readonly control?: ToolControl;
  };

  type NestedToolExecutionResult = {
    readonly taskId: typesModule.TaskId;
    readonly structuredOutput?: JsonValue;
    readonly isError: boolean;
    readonly details?: JsonValue;
    readonly diagnostics: readonly ToolDiagnostic[];
    readonly usage?: Usage;
    readonly durationMs?: number;
  };

  type ToolExecutionMode = "parallel" | "sequential";

  type QueueMode = "all" | "one-at-a-time";

  interface ToolExecutionApi<TDetails extends JsonValue = JsonValue>
    extends typesModule.DocumentObserver, typesModule.DocumentReader {
    readonly taskId: typesModule.TaskId;
    readonly conversationId: typesModule.ConversationId;
    readonly callId: string;
    readonly registry: typesRegistryTypes.RegistrySnapshot;
    agent(context: Context): Promise<typesRegistryTypes.Agent>;
    readonly models: Models;
    readonly env: envTypes.ExecutionEnv | undefined;
    output(chunk: string | Uint8Array, skipped?: envTypes.ShellOutputSkip): void;
    readonly outputWindow: envTypes.ShellOutputWindow | undefined;
    retainedOutput(): { readonly text: string; readonly truncated: boolean };
    diagnostic(diagnostic: ToolDiagnostic): void;
    details(value: TDetails, context: Context): Promise<void>;
    commit<T>(change: (tx: typesModule.Tx) => T | Promise<T>, context: Context): Promise<T>;
    memo<T extends JsonValue>(name: string, context: Context): Promise<T | undefined>;
    memo<T extends JsonValue>(name: string, candidate: T, context: Context): Promise<T>;
    createTask<I, S extends { phase: string }, R, H extends object>(
      task: typesModule.Task<I, S, R, H>,
      input: I,
      options: Omit<typesModule.TaskOptions, "conversationId">,
      context: Context,
    ): Promise<typesModule.TaskId<R>>;
    getTask<R>(
      id: typesModule.TaskId<R>,
      context: Context,
    ): Promise<typesModule.TaskRecord<JsonValue, JsonValue, R> | undefined>;
    waitForTask<R>(
      id: typesModule.TaskId<R>,
      context: Context,
    ): Promise<typesModuleModule.SettledTask<R>>;
    conversation(
      id: typesModule.ConversationId,
      context: Context,
    ): Promise<typesModuleModule.ConversationHandle | undefined>;
    executeTool(
      name: string,
      args: typesModule.JsonObject,
      context: Context,
      options?: { readonly key?: string; readonly progress?: boolean },
    ): Promise<NestedToolExecutionResult>;
  }

  type ToolRegistration<
    TParameters extends TSchema = TSchema,
    TDetails extends JsonValue = JsonValue,
  > = AiTool<TParameters> & {
    readonly replay?: "safe" | "unsafe";
    readonly executionMode?: ToolExecutionMode;
    prepareArguments?(args: unknown): Static<TParameters>;
    readonly structuredOutputSchema?: TSchema;
    readonly callers?: readonly ("model" | "tools")[];
    readonly deferred?: true;
    readonly outputLimits?: {
      readonly maxBytes?: number;
      readonly maxLines?: number;
      readonly retain?: "head" | "tail";
    };
    execute(
      args: Static<TParameters>,
      api: ToolExecutionApi<TDetails>,
      context: Context,
    ): Promise<ToolExecutionResult<TDetails>>;
  };
}

export type { typesToolsTypes as default };
