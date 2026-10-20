import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";
import type durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";

import type envTypes from "../src/env/index.types.ts";
import type toolsModule from "../src/tools/index.ts";

declare namespace specUsageNamesTypes {
  interface SettingsManager {
    get(key: "timeoutMs"): number;
    get(key: "autoCompact"): boolean;
    set(key: "autoCompact", value: boolean): void;
  }

  type SpecNames = {
    readonly context: chordTypes.Context;
    readonly storage: durableTypes.Storage;
    readonly models: aiTypes.Models;
    readonly session: durableTypes.Session;
    readonly conversationId: durableTypes.ConversationId;
    readonly message: { readonly kind: string };
    readonly haiku: { readonly provider: string; readonly modelId: string };
    readonly sonnet: { readonly provider: string; readonly modelId: string };
    readonly worktree: string;
    readonly name: string;
    readonly localEnv: (cwd: string) => envTypes.ExecutionEnv;
    readonly containers: {
      env(image: string, cwd: string, context: chordTypes.Context): Promise<envTypes.ExecutionEnv>;
    };
    readonly renderAgentsMd: () => string | undefined;
    readonly renderSkills: () => string | undefined;
    readonly isDangerous: (call: aiTypes.ToolCall) => boolean;
    readonly writes: (call: aiTypes.ToolCall) => boolean;
    readonly requestSecondPass: (
      answer: aiTypes.AssistantMessage,
      api: durableTypes.HookApi,
      context: chordTypes.Context,
    ) => Promise<{ readonly continue: durableTypes.UserInput } | undefined>;
    readonly metrics: { record(name: string, ms: number): void };
    readonly answerText: (
      api: durableTypes.ToolExecutionApi,
      entry: durableTypes.EntryId,
      context: chordTypes.Context,
    ) => Promise<string>;
    readonly payments: {
      charge(key: string): Promise<{ id: string }>;
      cancel(checkpoint: { phase: string }): Promise<void>;
    };
    readonly newKey: () => string;
    readonly receiptEntry: (receipt: { id: string }) => { kind: string; data: { id: string } };
    readonly manager: SettingsManager;
    readonly Anchor: ReturnType<typeof durable.defineTask<null, { phase: "hold" }, null>>;
    readonly Reporter: ReturnType<typeof durable.defineTask<null, { phase: "report" }, null>>;
    readonly subagentTool: ReturnType<typeof toolsModule.createReadTool>;
  };
}

export type { specUsageNamesTypes as default };
