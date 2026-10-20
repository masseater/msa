import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";

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

  type ToolExecutionResult<TDetails extends chordTypes.JsonValue = chordTypes.JsonValue> = {
    readonly output?: aiTypes.ToolResultMessage["content"];
    readonly structuredOutput?: chordTypes.JsonValue;
    readonly isError?: boolean;
    readonly details?: TDetails;
    readonly diagnostics?: readonly ToolDiagnostic[];
    readonly usage?: aiTypes.Usage;
    readonly control?: ToolControl;
  };

  type NestedToolExecutionResult = {
    readonly taskId: typesModule.TaskId;
    readonly structuredOutput?: chordTypes.JsonValue;
    readonly isError: boolean;
    readonly details?: chordTypes.JsonValue;
    readonly diagnostics: readonly ToolDiagnostic[];
    readonly usage?: aiTypes.Usage;
    readonly durationMs?: number;
  };

  type ToolExecutionMode = "parallel" | "sequential";

  type QueueMode = "all" | "one-at-a-time";

  interface ToolExecutionApi<TDetails extends chordTypes.JsonValue = chordTypes.JsonValue>
    extends typesModule.DocumentObserver, typesModule.DocumentReader {
    readonly taskId: typesModule.TaskId;
    readonly conversationId: typesModule.ConversationId;
    readonly callId: string;
    readonly registry: typesRegistryTypes.RegistrySnapshot;
    agent(context: chordTypes.Context): Promise<typesRegistryTypes.Agent>;
    readonly models: aiTypes.Models;
    readonly env: envTypes.ExecutionEnv | undefined;
    output(chunk: string | Uint8Array, skipped?: envTypes.ShellOutputSkip): void;
    readonly outputWindow: envTypes.ShellOutputWindow | undefined;
    retainedOutput(): { readonly text: string; readonly truncated: boolean };
    diagnostic(diagnostic: ToolDiagnostic): void;
    details(value: TDetails, context: chordTypes.Context): Promise<void>;
    commit<T>(
      change: (tx: typesModule.Tx) => T | Promise<T>,
      context: chordTypes.Context,
    ): Promise<T>;
    memo<T extends chordTypes.JsonValue>(
      name: string,
      context: chordTypes.Context,
    ): Promise<T | undefined>;
    memo<T extends chordTypes.JsonValue>(
      name: string,
      candidate: T,
      context: chordTypes.Context,
    ): Promise<T>;
    createTask<I, S extends { phase: string }, R, H extends object>(
      task: typesModule.Task<I, S, R, H>,
      input: I,
      options: Omit<typesModule.TaskOptions, "conversationId">,
      context: chordTypes.Context,
    ): Promise<typesModule.TaskId<R>>;
    getTask<R>(
      id: typesModule.TaskId<R>,
      context: chordTypes.Context,
    ): Promise<typesModule.TaskRecord<chordTypes.JsonValue, chordTypes.JsonValue, R> | undefined>;
    waitForTask<R>(
      id: typesModule.TaskId<R>,
      context: chordTypes.Context,
    ): Promise<typesModuleModule.SettledTask<R>>;
    conversation(
      id: typesModule.ConversationId,
      context: chordTypes.Context,
    ): Promise<typesModuleModule.ConversationHandle | undefined>;
    executeTool(
      name: string,
      args: typesModule.JsonObject,
      context: chordTypes.Context,
      options?: { readonly key?: string; readonly progress?: boolean },
    ): Promise<NestedToolExecutionResult>;
  }

  type ToolRegistration<
    TParameters extends aiTypes.TSchema = aiTypes.TSchema,
    TDetails extends chordTypes.JsonValue = chordTypes.JsonValue,
  > = aiTypes.Tool<TParameters> & {
    readonly replay?: "safe" | "unsafe";
    readonly executionMode?: ToolExecutionMode;
    prepareArguments?(args: unknown): aiTypes.Static<TParameters>;
    readonly structuredOutputSchema?: aiTypes.TSchema;
    readonly callers?: readonly ("model" | "tools")[];
    readonly deferred?: true;
    readonly outputLimits?: {
      readonly maxBytes?: number;
      readonly maxLines?: number;
      readonly retain?: "head" | "tail";
    };
    execute(
      args: aiTypes.Static<TParameters>,
      api: ToolExecutionApi<TDetails>,
      context: chordTypes.Context,
    ): Promise<ToolExecutionResult<TDetails>>;
  };
}

export type { typesToolsTypes as default };
