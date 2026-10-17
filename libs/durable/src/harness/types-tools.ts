import type { Models, Static, Tool as AiTool, ToolResultMessage, TSchema, Usage } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";

import type { ExecutionEnv, ShellOutputSkip, ShellOutputWindow } from "../env/index.ts";
import type {
  ConversationId,
  DocumentObserver,
  DocumentReader,
  JsonObject,
  Task,
  TaskId,
  TaskOptions,
  TaskRecord,
  Tx,
} from "../types.ts";
import type { Agent, RegistrySnapshot } from "./types-registry.ts";
import type { ConversationHandle, SettledTask } from "./types.ts";

export type ToolControl = {
  readonly addTools?: readonly string[] | undefined;
  readonly terminate?: true | undefined;
  readonly handoff?: string | undefined;
};

export type ToolDiagnostic = {
  readonly severity: "info" | "warn" | "error";
  readonly message: string;
  readonly code?: string;
};

export type ToolExecutionResult<TDetails extends JsonValue = JsonValue> = {
  readonly output?: ToolResultMessage["content"];
  readonly structuredOutput?: JsonValue;
  readonly isError?: boolean;
  readonly details?: TDetails;
  readonly diagnostics?: readonly ToolDiagnostic[];
  readonly usage?: Usage;
  readonly control?: ToolControl;
};

export type NestedToolExecutionResult = {
  readonly taskId: TaskId;
  readonly structuredOutput?: JsonValue;
  readonly isError: boolean;
  readonly details?: JsonValue;
  readonly diagnostics: readonly ToolDiagnostic[];
  readonly usage?: Usage;
  readonly durationMs?: number;
};

export type ToolExecutionMode = "parallel" | "sequential";

export type QueueMode = "all" | "one-at-a-time";

export interface ToolExecutionApi<TDetails extends JsonValue = JsonValue>
  extends DocumentObserver, DocumentReader {
  readonly taskId: TaskId;
  readonly conversationId: ConversationId;
  readonly callId: string;
  readonly registry: RegistrySnapshot;
  agent(context: Context): Promise<Agent>;
  readonly models: Models;
  readonly env: ExecutionEnv | undefined;
  output(chunk: string | Uint8Array, skipped?: ShellOutputSkip): void;
  readonly outputWindow: ShellOutputWindow | undefined;
  retainedOutput(): { readonly text: string; readonly truncated: boolean };
  diagnostic(diagnostic: ToolDiagnostic): void;
  details(value: TDetails, context: Context): Promise<void>;
  commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T>;
  memo<T extends JsonValue>(name: string, context: Context): Promise<T | undefined>;
  memo<T extends JsonValue>(name: string, candidate: T, context: Context): Promise<T>;
  createTask<I, S extends { phase: string }, R, H extends object>(
    task: Task<I, S, R, H>,
    input: I,
    options: Omit<TaskOptions, "conversationId">,
    context: Context,
  ): Promise<TaskId<R>>;
  getTask<R>(
    id: TaskId<R>,
    context: Context,
  ): Promise<TaskRecord<JsonValue, JsonValue, R> | undefined>;
  waitForTask<R>(id: TaskId<R>, context: Context): Promise<SettledTask<R>>;
  conversation(id: ConversationId, context: Context): Promise<ConversationHandle | undefined>;
  executeTool(
    name: string,
    args: JsonObject,
    context: Context,
    options?: { readonly key?: string; readonly progress?: boolean },
  ): Promise<NestedToolExecutionResult>;
}

export type ToolRegistration<
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
