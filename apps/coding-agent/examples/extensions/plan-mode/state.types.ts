import type codingAgentTypes from "@msa/coding-agent/index.types";

import type utilsTypes from "./utils.types.ts";

declare namespace stateTypes {
  interface PlanModeEntry {
    enabled: boolean;
    todos?: utilsTypes.TodoItem[];
    executing?: boolean;
    toolsBeforePlanMode?: string[];
  }

  interface PlanRuntime {
    enabled: boolean;
    executing: boolean;
    todos: utilsTypes.TodoItem[];
    toolsBeforePlanMode: string[] | undefined;
  }

  interface PlanStore {
    readonly runtime: PlanRuntime;
    updateStatus(ctx: codingAgentTypes.ExtensionContext): void;
    enableTools(): void;
    restoreTools(): void;
    persist(): void;
    toggle(ctx: codingAgentTypes.ExtensionContext): void;
    restore(entry: PlanModeEntry | undefined, ctx: codingAgentTypes.ExtensionContext): void;
  }
}

export type { stateTypes as default };
