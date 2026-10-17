import type { ModelThinkingLevel } from "@msa/ai";
import type { Context } from "@msa/chord";

import type { ExecutionEnv } from "../env/index.ts";
import type { ConversationId, DocumentReader } from "../types.ts";
import type { ToolRegistration } from "./types-tools.ts";
import type { AnyTask, ModelRef } from "./types.ts";

export type PromptInput<Tool extends ToolRegistration = ToolRegistration> = {
  readonly conversationId: ConversationId;
  readonly agent: Agent<Tool>;
  readonly env: ExecutionEnv | undefined;
  readonly shown: Readonly<Record<string, string>>;
  readonly read: DocumentReader;
};

export type PromptSection<Tool extends ToolRegistration = ToolRegistration> = {
  readonly key: string;
  render(
    input: PromptInput<Tool>,
    context: Context,
  ): string | undefined | Promise<string | undefined>;
  readonly tag?: boolean;
};

export type HookRegistration = { readonly task: string; readonly handlers: object };

export type Wrap<Tool extends ToolRegistration = ToolRegistration> =
  | { readonly tool: string; wrap(tool: Tool): Tool }
  | { readonly section: string; wrap(section: PromptSection<Tool>): PromptSection<Tool> };

export interface Extension<Tool extends ToolRegistration = ToolRegistration> {
  readonly name: string;
  readonly tools?: readonly Tool[];
  readonly sections?: readonly PromptSection<Tool>[];
  readonly hooks?: readonly HookRegistration[];
  readonly wraps?: readonly Wrap<Tool>[];
  readonly tasks?: readonly AnyTask[];
}

export interface RegistrySnapshot<Tool extends ToolRegistration = ToolRegistration> {
  installed(): readonly Extension<Tool>[];
  extension(name: string): Extension<Tool> | undefined;
  tools(): readonly { readonly extension: Extension<Tool>; readonly tool: Tool }[];
  sections(): readonly {
    readonly extension: Extension<Tool>;
    readonly section: PromptSection<Tool>;
  }[];
  tasks(): readonly AnyTask[];
  task(name: string): AnyTask | undefined;
}

export interface RegistryReader<Tool extends ToolRegistration = ToolRegistration> {
  snapshot(): RegistrySnapshot<Tool>;
  subscribe(listener: () => void): () => void;
}

export interface Registry<
  Tool extends ToolRegistration = ToolRegistration,
> extends RegistryReader<Tool> {
  install(extension: Extension<Tool>): void;
  uninstall(extension: Extension): void;
}

export type AgentState = {
  model?: ModelRef;
  thinkingLevel?: ModelThinkingLevel;
  extensions?: string[] | { add?: string[]; remove?: string[] };
  tools?: string[] | { remove: string[] };
  modelTools?: string[] | { remove?: string[]; add?: string[] };
  instructions?: string;
  cwd?: string;
};

export type AgentChange = {
  readonly model?: ModelRef | null | undefined;
  readonly thinkingLevel?: ModelThinkingLevel | null;
  readonly extensions?:
    | readonly Extension[]
    | { readonly add?: readonly Extension[]; readonly remove?: readonly Extension[] }
    | null;
  readonly tools?:
    | readonly ToolRegistration[]
    | { readonly remove: readonly ToolRegistration[] }
    | null;
  readonly modelTools?:
    | readonly ToolRegistration[]
    | { readonly remove?: readonly ToolRegistration[]; readonly add?: readonly ToolRegistration[] }
    | null;
  readonly instructions?: string | null;
  readonly cwd?: string | null;
};

export type Agent<Tool extends ToolRegistration = ToolRegistration> = {
  readonly model?: ModelRef;
  readonly thinkingLevel: ModelThinkingLevel;
  readonly extensions: readonly Extension<Tool>[];
  readonly tools: readonly Tool[];
  readonly callable: readonly Tool[];
  readonly deferred: readonly Tool[];
  readonly sections: readonly PromptSection<Tool>[];
  readonly instructions?: string;
  readonly cwd?: string;
};
