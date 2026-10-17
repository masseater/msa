import type { AssistantMessage, Models, ToolCall } from "@msa/ai";
import type { Context } from "@msa/chord";
import type {
  ConversationId,
  defineTask,
  EntryId,
  HookApi,
  Session,
  Storage,
  ToolExecutionApi,
  UserInput,
} from "@msa/durable";

import type { ExecutionEnv } from "../src/env/index.ts";
import type { createReadTool } from "../src/tools/index.ts";

export interface SettingsManager {
  get(key: "timeoutMs"): number;
  get(key: "autoCompact"): boolean;
  set(key: "autoCompact", value: boolean): void;
}

// The names the spec leaves to the application.
export type SpecNames = {
  readonly context: Context;
  readonly storage: Storage;
  readonly models: Models;
  readonly session: Session;
  readonly conversationId: ConversationId;
  readonly message: { readonly kind: string };
  readonly haiku: { readonly provider: string; readonly modelId: string };
  readonly sonnet: { readonly provider: string; readonly modelId: string };
  readonly worktree: string;
  readonly name: string;
  readonly localEnv: (cwd: string) => ExecutionEnv;
  readonly containers: {
    env(image: string, cwd: string, context: Context): Promise<ExecutionEnv>;
  };
  readonly renderAgentsMd: () => string | undefined;
  readonly renderSkills: () => string | undefined;
  readonly isDangerous: (call: ToolCall) => boolean;
  readonly writes: (call: ToolCall) => boolean;
  readonly requestSecondPass: (
    answer: AssistantMessage,
    api: HookApi,
    context: Context,
  ) => Promise<{ readonly continue: UserInput } | undefined>;
  readonly metrics: { record(name: string, ms: number): void };
  readonly answerText: (api: ToolExecutionApi, entry: EntryId, context: Context) => Promise<string>;
  readonly payments: {
    charge(key: string): Promise<{ id: string }>;
    cancel(checkpoint: { phase: string }): Promise<void>;
  };
  readonly newKey: () => string;
  readonly receiptEntry: (receipt: { id: string }) => { kind: string; data: { id: string } };
  readonly manager: SettingsManager;
  readonly Anchor: ReturnType<typeof defineTask<null, { phase: "hold" }, null>>;
  readonly Reporter: ReturnType<typeof defineTask<null, { phase: "report" }, null>>;
  readonly subagentTool: ReturnType<typeof createReadTool>;
};
