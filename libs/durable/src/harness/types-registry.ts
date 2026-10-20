import type { ModelThinkingLevel } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";

import type envTypes from "../env/index.types.ts";
import type typesModule from "../types.types.ts";
import type typesToolsTypes from "./types-tools.ts";
import type typesModuleModule from "./types.types.ts";

declare namespace typesRegistryTypes {
  type PromptInput<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = {
    readonly conversationId: typesModule.ConversationId;
    readonly agent: Agent<Tool>;
    readonly env: envTypes.ExecutionEnv | undefined;
    readonly shown: Readonly<Record<string, string>>;
    readonly read: typesModule.DocumentReader;
  };

  type PromptSection<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = {
    readonly key: string;
    render(
      input: PromptInput<Tool>,
      context: chordTypes.Context,
    ): string | undefined | Promise<string | undefined>;
    readonly tag?: boolean;
  };

  type HookRegistration = { readonly task: string; readonly handlers: object };

  type Wrap<Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration> =
    | { readonly tool: string; wrap(tool: Tool): Tool }
    | { readonly section: string; wrap(section: PromptSection<Tool>): PromptSection<Tool> };

  interface Extension<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > {
    readonly name: string;
    readonly tools?: readonly Tool[];
    readonly sections?: readonly PromptSection<Tool>[];
    readonly hooks?: readonly HookRegistration[];
    readonly wraps?: readonly Wrap<Tool>[];
    readonly tasks?: readonly typesModuleModule.AnyTask[];
  }

  interface RegistrySnapshot<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > {
    installed(): readonly Extension<Tool>[];
    extension(name: string): Extension<Tool> | undefined;
    tools(): readonly { readonly extension: Extension<Tool>; readonly tool: Tool }[];
    sections(): readonly {
      readonly extension: Extension<Tool>;
      readonly section: PromptSection<Tool>;
    }[];
    tasks(): readonly typesModuleModule.AnyTask[];
    task(name: string): typesModuleModule.AnyTask | undefined;
  }

  interface RegistryReader<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > {
    snapshot(): RegistrySnapshot<Tool>;
    subscribe(listener: () => void): () => void;
  }

  interface Registry<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > extends RegistryReader<Tool> {
    install(extension: Extension<Tool>): void;
    uninstall(extension: Extension): void;
  }

  type AgentState = {
    model?: typesModuleModule.ModelRef;
    thinkingLevel?: ModelThinkingLevel;
    extensions?: string[] | { add?: string[]; remove?: string[] };
    tools?: string[] | { remove: string[] };
    modelTools?: string[] | { remove?: string[]; add?: string[] };
    instructions?: string;
    cwd?: string;
  };

  type AgentChange = {
    readonly model?: typesModuleModule.ModelRef | null | undefined;
    readonly thinkingLevel?: ModelThinkingLevel | null;
    readonly extensions?:
      | readonly Extension[]
      | { readonly add?: readonly Extension[]; readonly remove?: readonly Extension[] }
      | null;
    readonly tools?:
      | readonly typesToolsTypes.ToolRegistration[]
      | { readonly remove: readonly typesToolsTypes.ToolRegistration[] }
      | null;
    readonly modelTools?:
      | readonly typesToolsTypes.ToolRegistration[]
      | {
          readonly remove?: readonly typesToolsTypes.ToolRegistration[];
          readonly add?: readonly typesToolsTypes.ToolRegistration[];
        }
      | null;
    readonly instructions?: string | null;
    readonly cwd?: string | null;
  };

  type Agent<Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration> = {
    readonly model?: typesModuleModule.ModelRef;
    readonly thinkingLevel: ModelThinkingLevel;
    readonly extensions: readonly Extension<Tool>[];
    readonly tools: readonly Tool[];
    readonly callable: readonly Tool[];
    readonly deferred: readonly Tool[];
    readonly sections: readonly PromptSection<Tool>[];
    readonly instructions?: string;
    readonly cwd?: string;
  };
}

export type { typesRegistryTypes as default };
